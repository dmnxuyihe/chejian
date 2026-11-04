import assert from 'node:assert/strict'
import { createResourceDemo } from '../src/core/resource-demo.js'
import { buildResourceReport } from '../src/core/resource-report.js'
import { createState } from '../src/core/state.js'
import { parseDemoSnapshot } from '../src/core/demo-persistence.js'
import { commitImport, parseCsv, templateCsv } from '../src/core/plan-import.js'

let checks = 0
const check = fn => { fn(); checks++ }
for (let cycle = 1; cycle <= 500; cycle++) {
  // Rebuild both vehicles and execute their schedules in every cycle.
  const normal = createResourceDemo(false).data
  const before = JSON.stringify(normal)
  const ready = buildResourceReport(normal, normal.pc1SchedulePreview.vehicleRepairIds)
  check(() => assert.equal(ready.rows.length, 40))
  check(() => assert.equal(ready.personMinutes, 30880))
  check(() => assert.equal(ready.ready, true))

  const shortage = createResourceDemo(true).data
  const blocked = buildResourceReport(shortage, shortage.pc1SchedulePreview.vehicleRepairIds)
  check(() => assert.equal(blocked.shortageCount, 3))
  check(() => assert.equal(blocked.staffing.find(row => row.team.id === 1)?.gap, 6))
  check(() => assert.equal(blocked.tools.find(row => row.name === '铲刀')?.gap, 1))
  check(() => assert.equal(blocked.materials.find(row => row.name === '螺栓')?.gap, 32))
  check(() => assert.equal(blocked.ready, false))

  const partial = structuredClone(normal)
  partial.pc1SchedulePreview.schedules = partial.pc1SchedulePreview.schedules.slice(0, 1)
  const partialReport = buildResourceReport(partial, partial.pc1SchedulePreview.vehicleRepairIds)
  check(() => assert.equal(partialReport.rows.length, 1))
  check(() => assert.equal(partialReport.materials.length, 2))
  check(() => assert.equal(partialReport.unscheduled, true))
  check(() => assert.equal(partialReport.ready, false))

  const empty = structuredClone(normal)
  empty.pc1SchedulePreview.schedules = []
  const emptyReport = buildResourceReport(empty, empty.pc1SchedulePreview.vehicleRepairIds)
  check(() => assert.equal(emptyReport.rows.length, 0))
  check(() => assert.equal(emptyReport.ready, false))

  const backup = JSON.stringify({ format: 'rail-maintenance-pc1', schemaVersion: 1, savedAt: new Date().toISOString(), data: normal })
  const restored = parseDemoSnapshot(backup).data
  check(() => assert.equal(restored.materialRequirements.length, 45))
  check(() => assert.equal(restored.pc1SchedulePreview.employeeAssignments.length, 152))
  check(() => assert.deepEqual(restored.pc1SchedulePreview.vehicleRepairIds.map(id => {
    const taskIds = new Set(restored.pc1SchedulePreview.schedules.filter(row => row.vehicleRepairId === id).map(row => row.id))
    return restored.pc1SchedulePreview.employeeAssignments.filter(row => taskIds.has(row.scheduleTaskId)).length
  }), [76, 76]))

  const imported = createState()
  const result = commitImport(imported, parseCsv(templateCsv))
  check(() => assert.equal(result.ids.length, 2))
  check(() => assert.equal(imported.vehicleRepairs.length, 3))
  check(() => assert.equal(JSON.stringify(normal), before, 'reports and backup parsing must not mutate the scheduling state'))
  if (cycle % 25 === 0) process.stdout.write(`completed ${cycle}/500 cycles (${checks} assertions)\n`)
}
console.log(`PASS: ${checks} assertions across 500 full resource, preview, backup, and import cycles`)
