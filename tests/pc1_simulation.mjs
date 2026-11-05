import assert from 'node:assert/strict'
import { createState } from '../src/core/state.js'
import { commitImport, parseCsv, templateCsv } from '../src/core/plan-import.js'
import { simulatePc1, pc1Preflight, pc1PreviewIssues, movePc1Task, togglePc1Lock, confirmPc1Preview } from '../src/core/pc1-simulation.js'
import { exportDemoSnapshot, parseDemoSnapshot } from '../src/core/demo-persistence.js'
import { confirmedExit, planningTasks } from '../src/core/planning-view.js'
import { formatLocalDateTime } from '../src/core/derived.js'
import { processPlanFlow } from '../src/core/planning-json-workflow.js'

const fixture = () => { const state = createState(); const { ids } = commitImport(state, parseCsv(templateCsv)); return { state, ids } }
const deadline = '2026-11-15T18:00:00'
const formal = state => structuredClone({ schedules: state.schedules, versions: state.scheduleVersions, employees: state.employeeAssignments, equipment: state.equipmentAssignments, components: state.componentAssignments, vehicles: state.vehicleRepairs })
let assertions = 0
function verify(condition, message) { assert.ok(condition, message); assertions++ }

{
  const { state, ids } = fixture(), before = structuredClone(state)
  const result = simulatePc1(state, ids, deadline)
  verify(result.ok && !result.issues.length, result.issues.join('\n'))
  assert.deepEqual(state, before, 'simulation must be pure')
  state.pc1SchedulePreview = result.preview
  verify(result.preview.schedules.length === 40, 'two cars have all frame/wheel tasks')
  verify(planningTasks(state, ids[0]).length === 20, 'calendar uses simulated rows')
  verify(confirmedExit(state, ids[0]) === null, 'simulation cannot create a formal exit marker')
  assert.deepEqual(parseDemoSnapshot(JSON.stringify(exportDemoSnapshot(state))).data.pc1SchedulePreview, result.preview)
  const row = result.preview.schedules.find(row => row.vehicleRepairId === ids[0] && row.taskId === 1001)
  const newStart = formatLocalDateTime(new Date(new Date(row.plannedStartAt).getTime() + 60 * 60000))
  verify(movePc1Task(state, row.id, newStart).ok, 'a simulated task can be shifted')
  verify(row.isLocked && state.pc1SchedulePreview.needsRecompute, 'moving creates a temporary time lock and requires recompute')
  verify(!movePc1Task(state,row.id,newStart).ok, 'locked task cannot be silently moved')
  verify(!confirmPc1Preview(state).ok, 'unrecomputed adjustment cannot be confirmed')
  const rerun = simulatePc1(state,ids,deadline)
  verify(rerun.ok && !rerun.issues.length, rerun.issues.join('\n'))
  verify(rerun.preview.schedules.find(item => item.id === row.id).plannedStartAt === newStart, 'locked time survives recompute')
  assert.deepEqual(formal(state), formal(before), 'recompute does not change the formal state')
  state.pc1SchedulePreview = rerun.preview
  const accepted = confirmPc1Preview(state)
  verify(accepted.ok && accepted.approvalFlows === 2 && accepted.dispatches === 0, 'confirmation creates two approval flows without early dispatch')
  verify(!state.pc1SchedulePreview, 'confirmation clears the preview')
  verify(ids.every(id => !confirmedExit(state,id)), 'unapproved schedules do not create formal exit markers')
  verify(state.schedules.length === 60, 'old vehicle and its tasks are preserved')
  for(const id of ids){const flow=state.planApprovalFlows.find(row=>row.entityType==='MONTHLY'&&row.entityId===id&&row.status==='SUBMITTED');verify(processPlanFlow(state,flow.id,'REVIEW','科长审核').ok,'section review succeeds');verify(processPlanFlow(state,flow.id,'PUBLISH','领导审批发布').ok,'deput approval publishes schedule')}
  verify(ids.every(id => confirmedExit(state,id)), 'approved schedules create exit markers')
  verify(state.pc1Dispatches.every(row => row.employeeIds.length && row.scheduleTaskIds.length && Array.isArray(row.materials)), 'dispatches carry actual task/person/supply lists')
  exportDemoSnapshot(state)
  const repeated = simulatePc1(state,ids,deadline)
  verify(repeated.ok && !repeated.issues.length, repeated.issues.join('\n'))
  state.pc1SchedulePreview = repeated.preview
  verify(confirmPc1Preview(state).ok, 'a second confirmation is a new version')
  verify(state.scheduleVersions.some(row => row.vehicleRepairId === ids[0] && row.status === 'PUBLISHED'), 'previous publication remains active until the new draft is approved')
  verify(planningTasks(state,ids[0]).length === 20, 'history does not duplicate current tasks')
  exportDemoSnapshot(state)
}

for (const [name, change, expected] of [
  ['material', state => { state.materials.find(row => row.name === '螺栓').quantity = 0 }, /物料不足/],
  ['tool', state => { state.tools[0].quantity = 0 }, /工具不足/],
  ['team', state => { state.employees.filter(row => row.teamId === 1).slice(2).forEach(row => { row.status = 'INACTIVE' }) }, /人数不足/],
  ['equipment', state => { state.equipment[0].status = 'MAINTENANCE' }, /设备/],
]) {
  const { state, ids } = fixture(); change(state)
  const before = structuredClone(state), result = simulatePc1(state,ids,deadline)
  verify(!result.ok && result.issues.some(issue => expected.test(issue)), `${name} shortage must block before scheduling`)
  assert.deepEqual(state,before,'failed resource preflight must be atomic')
}

{
  const { state, ids } = fixture()
  verify(!pc1Preflight(state,[]).ok, 'empty selection is rejected')
  verify(!simulatePc1(state,ids,'2026-10-27T07:00:00').ok, 'deadline before entry is rejected')
  const tight = simulatePc1(state,ids,'2026-10-28T09:00:00')
  verify(tight.ok && tight.issues.some(issue => issue.includes('超过最晚完成')), 'infeasible deadline is exposed without false readiness')
  state.pc1SchedulePreview = tight.preview
  verify(!confirmPc1Preview(state).ok,'an overdue plan cannot be confirmed')
  state.pc1SchedulePreview = simulatePc1(state,ids,deadline).preview
  const before = formal(state)
  state.tools[0].quantity += 1
  verify(pc1PreviewIssues(state).some(issue => issue.includes('已有变化')), 'resource changes invalidate a pending preview')
  verify(!confirmPc1Preview(state).ok,'stale plans cannot publish')
  delete state.pc1SchedulePreview
  assert.deepEqual(formal(state),before,'cancel preserves the whole formal plan')
}

{
  const { state, ids } = fixture()
  state.employeeLeaves.push({id:1,employeeId:1,startAt:'2026-10-27T00:00:00',endAt:'2026-10-28T12:00:00',status:'APPROVED'})
  state.workCalendar.push({date:'2026-10-29',isWorkday:false,type:'HOLIDAY',start:'00:00:00',end:'23:59:59'})
  const result = simulatePc1(state,ids,deadline)
  verify(result.ok && !result.issues.length,result.issues.join('\n'))
  verify(result.preview.schedules.every(row => !(new Date(row.plannedStartAt) < new Date('2026-10-30T00:00:00') && new Date(row.plannedEndAt) > new Date('2026-10-29T00:00:00'))), 'explicit non-working day is avoided')
  state.pc1SchedulePreview = result.preview
  const row = result.preview.schedules.find(row => row.vehicleRepairId === ids[0] && row.taskId === 1002)
  verify(movePc1Task(state,row.id,'2026-10-27T08:00:00').ok,'fixed conflicting time can be evaluated in simulation')
  const blocked = simulatePc1(state,ids,deadline)
  verify(blocked.issues.length > 0,'locked dependency/resource conflict is exposed')
  state.pc1SchedulePreview = blocked.preview
  verify(!confirmPc1Preview(state).ok,'conflicting locks cannot publish')
  togglePc1Lock(state,row.id)
  const recovered = simulatePc1(state,ids,deadline)
  verify(!recovered.issues.length,'unlocking allows a feasible recomputation')
}

console.log(JSON.stringify({passed:true, assertions, checks:['isolated two-car simulation','full resources and explicit calendar','drag/lock/recompute','deadline and stale-preview guards','confirmation and approval-gated dispatch','history and cancellation','snapshot restore']},null,2))
