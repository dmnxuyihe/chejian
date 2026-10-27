import assert from 'node:assert/strict'
import { createState } from '../src/core/state.js'
import { commitImport, parseCsv, templateCsv } from '../src/core/plan-import.js'
import { runAutoSchedule, submitPlan, publishSchedule } from '../src/core/actions.js'
import { createDemoPersistence, DEMO_STORAGE_KEY, exportDemoSnapshot, parseDemoSnapshot } from '../src/core/demo-persistence.js'
const memory = new Map()
const storage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) }
const state = createState(), controller = createDemoPersistence(state, storage)
assert.deepEqual(controller.load(), { ok: true, restored: false })
const result = commitImport(state, parseCsv(templateCsv))
for (const id of result.ids) { submitPlan(state, id); runAutoSchedule(state, id); state.selectedVehicleRepairId = id; publishSchedule(state) }
state.planningView = { tab: 'vehicle', month: '2026-10', vehicleFilter: '', day: '', importReport: { matrix: ['never save unconfirmed imports'] }, dataAction: { type: 'reset' }, undoBackup: 'never nested' }
state.pc1SchedulePreview = { vehicleRepairIds: [2], schedules: [{ ...state.schedules.find(s => s.vehicleRepairId === 2), isLocked: true }] }
assert.ok(controller.save().ok)
const raw = memory.get(DEMO_STORAGE_KEY)
assert.ok(!raw.includes('never save'))
assert.ok(!raw.includes('dataAction'))
assert.ok(!raw.includes('undoBackup'))
const restored = createState(), reader = createDemoPersistence(restored, storage)
assert.ok(reader.load().restored)
assert.equal(restored.vehicleRepairs.length, 3)
assert.equal(restored.pc1SchedulePreview.schedules[0].isLocked, true)
assert.deepEqual(restored.schedules, state.schedules)
assert.deepEqual(restored.employeeAssignments, state.employeeAssignments)
const reference = restored
const backup = reader.export()
assert.ok(reader.reset().ok)
assert.equal(restored, reference)
assert.equal(restored.vehicleRepairs.length, 1)
assert.ok(!restored.pc1SchedulePreview)
assert.ok(reader.restore(backup).ok)
assert.equal(restored.vehicleRepairs.length, 3)
const previous = structuredClone(restored)
assert.equal(reader.restore('{"bad":1}').ok, false)
assert.deepEqual(restored, previous)
const invalid = exportDemoSnapshot(restored)
invalid.data.schedules[0].vehicleRepairId = 999
assert.throws(() => parseDemoSnapshot(JSON.stringify(invalid)), /车辆、工序/)
const corruptMemory = new Map([[DEMO_STORAGE_KEY, 'corrupt original']])
const corrupted = createDemoPersistence(createState(), { getItem: k => corruptMemory.get(k), setItem: (k, v) => corruptMemory.set(k, v) })
assert.equal(corrupted.load().ok, false)
assert.equal(corrupted.save().ok, false)
assert.equal(corruptMemory.get(DEMO_STORAGE_KEY), 'corrupt original')
const noSpace = createDemoPersistence(createState(), { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } })
assert.equal(noSpace.save().ok, false)
const beforeFailure = createState()
const writer = createDemoPersistence(beforeFailure, { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } })
assert.equal(writer.restore(backup).ok, false)
assert.equal(beforeFailure.vehicleRepairs.length, 1)
// A stale tab must not overwrite a newer tab's saved state.
const first = createDemoPersistence(createState(), storage), secondState = createState(), second = createDemoPersistence(secondState, storage)
first.load(); second.load()
secondState.vehicleRepairs[0].remark = 'updated in second tab'
assert.ok(second.save().ok)
assert.equal(first.save().ok, false)
assert.equal(parseDemoSnapshot(memory.get(DEMO_STORAGE_KEY)).data.vehicleRepairs[0].remark, 'updated in second tab')
console.log('PASS: snapshot reload, schedules and preview locks, export/restore/reset, failed restore atomicity, corrupt storage preservation, quota error, stale-tab guard')
