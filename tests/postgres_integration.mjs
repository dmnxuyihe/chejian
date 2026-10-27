import assert from 'node:assert/strict'
import http from 'node:http'
import { loadConfig } from '../server/config.js'
import { createDatabase } from '../server/database.js'
import { createHandler } from '../server/http.js'
import { createState } from '../src/core/state.js'
import { commitImport, parseCsv, templateCsv } from '../src/core/plan-import.js'
import { submitPlan, runAutoSchedule, publishSchedule } from '../src/core/actions.js'
import { exportDemoSnapshot } from '../src/core/demo-persistence.js'

const schema = `pc1_test_${Date.now()}_${process.pid}`
const config = { ...loadConfig(), schema }
let db = createDatabase(config), server
async function serve() {
  await db.init()
  server = http.createServer(createHandler(db))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${server.address().port}`
}
async function stop() { if (server) await new Promise(resolve => server.close(resolve)); await db.close() }
try {
  let base = await serve()
  async function request(path, method = 'GET', data, headers = {}) {
    const r = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) })
    return { status: r.status, value: await r.json() }
  }
  const initial = (await request('/api/state')).value
  assert.equal(initial.revision, 1)
  assert.equal(initial.snapshot.data.vehicleRepairs.length, 1)
  assert.equal((await request('/api/health')).value.storage, 'postgresql')
  const state = createState()
  const imported = commitImport(state, parseCsv(templateCsv))
  for (const id of imported.ids) { submitPlan(state, id); runAutoSchedule(state, id); state.selectedVehicleRepairId = id; assert.ok(publishSchedule(state)) }
  state.pc1SchedulePreview = { vehicleRepairIds: [2], schedules: [{ ...state.schedules.find(s => s.vehicleRepairId === 2), isLocked: true }] }
  let result = await request('/api/state', 'PUT', { revision: initial.revision, snapshot: exportDemoSnapshot(state) })
  assert.equal(result.status, 200)
  const revision = result.value.revision
  const counts = await db.pool.query(`SELECT (SELECT count(*) FROM "${schema}".vehicle_repair)::int AS vehicles,(SELECT count(*) FROM "${schema}".vehicle_repair_schedule)::int AS tasks,((SELECT count(*) FROM "${schema}".schedule_employee_assignment)+(SELECT count(*) FROM "${schema}".schedule_equipment_assignment)+(SELECT count(*) FROM "${schema}".schedule_component_assignment))::int AS assignments`)
  assert.equal(counts.rows[0].vehicles, 3)
  assert.equal(counts.rows[0].tasks, 60)
  assert.ok(counts.rows[0].assignments > 0)
  const saved = (await request('/api/state')).value
  assert.deepEqual(saved.snapshot.data.schedules, state.schedules)
  assert.deepEqual(saved.snapshot.data.employeeAssignments, state.employeeAssignments)
  assert.equal(saved.snapshot.data.pc1SchedulePreview.schedules[0].isLocked, true)
  assert.equal(saved.snapshot.data.vehicleRepairs[1].plannedEntryAt, '2026-10-27T08:00:00')
  assert.equal((await request('/api/state', 'PUT', { revision: 1, snapshot: exportDemoSnapshot(createState()) })).status, 409)
  const invalid = exportDemoSnapshot(state)
  invalid.data.schedules[0].vehicleRepairId = 999
  assert.equal((await request('/api/state', 'PUT', { revision, snapshot: invalid })).status, 400)
  const duplicate = exportDemoSnapshot(state)
  duplicate.data.vehicleRepairs[1].locomotiveNo = duplicate.data.vehicleRepairs[2].locomotiveNo
  duplicate.data.vehicleRepairs[1].plannedEntryAt = duplicate.data.vehicleRepairs[2].plannedEntryAt
  assert.equal((await request('/api/state', 'PUT', { revision, snapshot: duplicate })).status, 400)
  const unchanged = (await request('/api/state')).value
  assert.equal(unchanged.revision, revision, '失败请求不得增加版本或破坏原数据')
  assert.deepEqual(unchanged.snapshot.data.schedules, saved.snapshot.data.schedules)
  for (const path of ['/.env', '/server/config.js', '/node_modules/pg/package.json']) assert.ok([403, 404].includes((await request(path)).status))
  assert.equal((await request('/api/state', 'PUT', { revision, snapshot: exportDemoSnapshot(state) }, { Origin: 'http://untrusted.example' })).status, 403)
  await stop()
  db = createDatabase(config)
  base = await serve()
  const afterRestart = (await request('/api/state')).value
  assert.equal(afterRestart.revision, revision)
  assert.deepEqual(afterRestart.snapshot.data.vehicleRepairs, saved.snapshot.data.vehicleRepairs)
  assert.deepEqual(afterRestart.snapshot.data.pc1SchedulePreview, state.pc1SchedulePreview)
  console.log(JSON.stringify({ passed: true, database: 'PostgreSQL', tests: ['real relational rows', 'plan/schedule/assignment roundtrip', 'local wall time', 'draft locks', 'CAS conflict', 'validation and SQL rollback', 'credential files blocked', 'cross-origin write blocked', 'server restart persistence'], counts: counts.rows[0] }, null, 2))
} finally {
  if (server) await new Promise(resolve => server.close(resolve))
  assert.ok(/^pc1_test_\d+_\d+$/.test(schema), '只能清理当前测试创建的数据区')
  await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await db.close()
}
