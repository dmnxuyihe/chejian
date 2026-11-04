import assert from 'node:assert/strict'
import { createState } from '../src/core/state.js'
import { commitImport, parseCsv, templateCsv } from '../src/core/plan-import.js'
import { formatLocalDateTime } from '../src/core/derived.js'
import { simulatePc1, pc1Preflight, pc1PreviewIssues, movePc1Task, confirmPc1Preview } from '../src/core/pc1-simulation.js'
import { exportDemoSnapshot, parseDemoSnapshot } from '../src/core/demo-persistence.js'
import { confirmedExit, planningTasks } from '../src/core/planning-view.js'
import { buildResourceReport } from '../src/core/resource-report.js'

const DAY = 86400000
let assertions = 0
const check = (value, message) => { assert.ok(value, message); assertions++ }
for (let cycle = 1; cycle <= 500; cycle++) {
  const state = createState(), { ids } = commitImport(state,parseCsv(templateCsv))
  const oldCar = JSON.stringify(state.schedules.filter(row => row.vehicleRepairId === 1))
  for (const vehicle of state.vehicleRepairs.filter(row => ids.includes(row.id))) {
    vehicle.plannedEntryAt = formatLocalDateTime(new Date(vehicle.plannedEntryAt).getTime() + cycle % 12 * DAY)
    vehicle.plannedExitAt = formatLocalDateTime(new Date(vehicle.plannedEntryAt).getTime() + 18 * DAY)
  }
  const deadline = state.vehicleRepairs.find(row => row.id === ids[1]).plannedExitAt
  const baseline = JSON.stringify(state.schedules)
  check(pc1Preflight(state,ids).ok,'resource preflight')
  const bolts = state.materials.find(row => row.name === '螺栓'), stock = bolts.quantity
  bolts.quantity = 0
  check(!simulatePc1(state,ids,deadline).ok,'shortage blocks without side effects')
  bolts.quantity = stock
  const initial = simulatePc1(state,ids,deadline)
  check(initial.ok && !initial.issues.length,initial.issues.join('\n'))
  check(initial.preview.schedules.length === 40,'complete two-car plan')
  check(JSON.stringify(state.schedules) === baseline,'simulation does not modify formal rows')
  check(!confirmedExit(state,ids[0]),'no premature exit marker')
  state.pc1SchedulePreview = initial.preview
  const first = initial.preview.schedules.find(row => row.vehicleRepairId === ids[0] && row.taskId === 1001)
  const start = formatLocalDateTime(new Date(first.plannedStartAt).getTime() + 15 * 60000)
  check(movePc1Task(state,first.id,start).ok,'manual time adjustment')
  check(first.isLocked,'temporary lock')
  check(state.pc1SchedulePreview.needsRecompute,'recompute required')
  check(!confirmPc1Preview(state).ok,'cannot confirm unvalidated drag')
  const rerun = simulatePc1(state,ids,deadline)
  check(rerun.ok && !rerun.issues.length,rerun.issues.join('\n'))
  check(rerun.preview.schedules.find(row => row.id === first.id).plannedStartAt === start,'lock preserved')
  check(JSON.stringify(state.schedules) === baseline,'recompute leaves formal data intact')
  state.pc1SchedulePreview = rerun.preview
  state.tools[0].quantity++
  check(pc1PreviewIssues(state).some(issue => issue.includes('已有变化')),'resource changes invalidate preview')
  state.tools[0].quantity--
  const restored = parseDemoSnapshot(JSON.stringify(exportDemoSnapshot(state))).data
  check(!pc1PreviewIssues(restored).length,'backup restores the complete simulation')
  const result = confirmPc1Preview(restored)
  check(result.ok,'confirm atomically')
  check(!restored.pc1SchedulePreview,'clear adopted preview')
  check(ids.every(id => planningTasks(restored,id).length === 20),'per-car current version task count')
  check(ids.every(id => confirmedExit(restored,id)),'formal exits generated')
  check(restored.pc1Dispatches.length === 4,'team dispatches')
  check(JSON.stringify(restored.schedules.filter(row => row.vehicleRepairId === 1)) === oldCar,'unselected vehicle unchanged')
  check(buildResourceReport(restored,ids).ready,'published resources remain feasible')
  if (cycle % 25 === 0) console.log(`PC1 ${cycle}/500 cycles; ${assertions} assertions passed`)
}
console.log(JSON.stringify({passed:true,cycles:500,assertions,scope:'fresh two-car planning, shortages, adjustment/locks, recompute, stale guards, restore, confirmation, dispatch and formal exits'},null,2))
