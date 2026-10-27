import assert from 'node:assert/strict'
import { createState } from '../src/core/state.js'
import { exportDemoSnapshot } from '../src/core/demo-persistence.js'
import { createDatabasePersistence, VIEW_STORAGE_KEY } from '../src/core/database-persistence.js'
import { commitImport, parseCsv, templateCsv } from '../src/core/plan-import.js'

let revision = 1, snapshot = exportDemoSnapshot(createState()), puts = 0
let delayNext = null
const fetchImpl = async (_, options) => {
  if (options.method === 'GET') return { ok: true, json: async () => ({ revision, snapshot: structuredClone(snapshot) }) }
  const value = JSON.parse(options.body)
  if (delayNext) { const wait = delayNext; delayNext = null; await wait }
  if (value.revision !== revision) return { ok: false, status: 409, json: async () => ({ message: '版本冲突' }) }
  puts++; revision++; snapshot = value.snapshot
  return { ok: true, json: async () => ({ revision, savedAt: new Date().toISOString() }) }
}
const oldState = createState()
commitImport(oldState, parseCsv(templateCsv))
const oldBackup = JSON.stringify(exportDemoSnapshot(oldState))
const state = createState()
const p = createDatabasePersistence(state, { fetchImpl, storage: { getItem: () => oldBackup } })
assert.ok((await p.load()).migrated)
assert.equal(state.vehicleRepairs.length, 3)
assert.equal(puts, 1)
assert.equal(revision, 2)
await p.save(); await p.save()
assert.equal(puts, 1, '无变化保存不得写数据库或卡住队列')
let release
delayNext = new Promise(resolve => { release = resolve })
state.vehicleRepairs[0].remark = 'first-edit'
const saving = p.save()
await new Promise(resolve => setTimeout(resolve, 0))
state.vehicleRepairs[0].remark = 'edit-while-saving'
p.save()
release()
assert.ok((await saving).ok)
assert.equal(snapshot.data.vehicleRepairs[0].remark, 'edit-while-saving')
assert.equal(puts, 3, '保存期间的新修改必须跟随提交')
// Reopening a browser containing old data must not replace an already used DB.
const otherState = createState()
const other = createDatabasePersistence(otherState, { fetchImpl, storage: { getItem: () => oldBackup } })
assert.ok(!(await other.load()).migrated)
assert.equal(otherState.vehicleRepairs[0].remark, 'edit-while-saving')
assert.equal(puts, 3)
// A dirty client does not accept background remote changes.
otherState.vehicleRepairs[0].remark = 'unsaved'
state.vehicleRepairs[0].remark = 'new-shared'
await p.save(); await other.poll()
assert.equal(otherState.vehicleRepairs[0].remark, 'unsaved')
assert.equal((await other.save()).ok, false)
assert.ok(other.status.message.includes('冲突'))
assert.equal(snapshot.data.vehicleRepairs[0].remark, 'new-shared')
const viewMemory = new Map()
const viewStorage = { getItem: k => viewMemory.get(k) ?? null, setItem: (k, v) => viewMemory.set(k, v) }
const viewedState = createState(), viewed = createDatabasePersistence(viewedState, { fetchImpl, viewStorage, storage: { getItem: () => null } })
await viewed.load()
viewedState.planningView = { tab: 'vehicle', month: '2026-11', day: '2026-11-01', vehicleFilter: '2', importReport: { secret: 'not a view setting' } }
viewedState.selectedVehicleRepairId = 2
await viewed.save()
const reloadedView = createState(), reloader = createDatabasePersistence(reloadedView, { fetchImpl, viewStorage, storage: { getItem: () => null } })
await reloader.load()
assert.equal(reloadedView.planningView.month, '2026-11')
assert.equal(reloadedView.planningView.tab, 'vehicle')
assert.equal(reloadedView.selectedVehicleRepairId, 2)
assert.ok(!viewMemory.get(VIEW_STORAGE_KEY).includes('not a view setting'))
assert.ok(!JSON.stringify(snapshot.data).includes('2026-11-01'), '查看位置不应写入共享数据')
console.log('PASS: safe first-use migration, existing DB preserved, unchanged-save queue, concurrent in-flight edits, dirty poll guard and stale revision')
