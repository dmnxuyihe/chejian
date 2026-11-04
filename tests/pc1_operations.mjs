import assert from 'node:assert/strict'
import { createState } from '../src/core/state.js'
import { recordVehicleMilestones, editUnscheduledPlan, deleteUnscheduledPlan, vehicleFacts, taskTiming, formalVehicleTasks } from '../src/core/vehicle-operations.js'
import { workstationProgress } from '../src/shared/workstation-monitor.js'
import { exportDemoSnapshot, parseDemoSnapshot } from '../src/core/demo-persistence.js'
import { createDatabase } from '../server/database.js'
import { loadConfig } from '../server/config.js'
import { runAutoSchedule, publishSchedule, startTask, completeTask, qualityDecision } from '../src/core/actions.js'
import { myTasksPage } from '../src/roles/worker/pages/my-tasks-gantt.js'

const draft=createState()
runAutoSchedule(draft,1)
const pending=draft.schedules.find(row=>row.versionId===draft.vehicleRepairs[0].currentVersionId)
const owner=draft.employeeAssignments.find(row=>row.scheduleTaskId===pending.id && row.status!=='CANCELLED').employeeId
const draftBefore=structuredClone(draft)
assert.equal(startTask(draft,pending.id,owner).ok,false,'unpublished work cannot start')
assert.equal(completeTask(draft,pending.id,owner).ok,false,'unpublished work cannot finish')
assert.deepEqual(draft,draftBefore,'rejected execution does not change draft state')
const draftHtml=myTasksPage.render({state:draft})
assert.ok(draftHtml.includes('待正式发布'))
assert.ok(!draftHtml.includes('data-start-task='),'unpublished personal tasks do not expose an execute button')
assert.equal(publishSchedule(draft),true)
assert.equal(startTask(draft,pending.id,owner).ok,true)
assert.equal(draft.vehicleRepairs[0].status,'IN_PROGRESS')
assert.equal(draft.vehicleRepairs[0].actualEntryAt,null,'starting a task never fabricates reception time')
assert.equal(completeTask(draft,pending.id,owner).ok,true)
draft.scheduleVersions.find(row=>row.id===pending.versionId).status='ARCHIVED'
assert.equal(qualityDecision(draft,pending.id,'PASS').ok,false,'archived task cannot change quality state')

const state=createState(),now=new Date('2026-10-29T12:00:00')
const before=structuredClone(state)
assert.equal(recordVehicleMilestones(state,1,{actualEntryAt:'2026-10-01T08:00',onStandAt:'2026-09-30T08:00'},now).ok,false)
assert.deepEqual(state,before)
assert.equal(recordVehicleMilestones(state,1,{actualEntryAt:'2099-01-01T08:00'},now).ok,false)
assert.equal(recordVehicleMilestones(state,1,{actualEntryAt:'2026-10-01T07:00',onStandAt:'2026-10-01T08:00'},now).ok,true)
assert.equal(state.vehicleRepairs[0].lifecycleHistory.length,1)
assert.equal(recordVehicleMilestones(state,1,{actualEntryAt:'2026-10-01T06:00',onStandAt:'2026-10-01T08:00'},now).ok,false)
assert.equal(recordVehicleMilestones(state,1,{actualEntryAt:'2026-10-01T06:00',onStandAt:'2026-10-01T08:00',note:'更正接车记录'},now).ok,true)
const rows=formalVehicleTasks(state,1)
assert.equal(rows.length,20)
assert.ok(vehicleFacts(state,state.vehicleRepairs[0],rows,'2026-10-02').dayProgress.startsWith('实际第2天'))
assert.equal(vehicleFacts(state,{...state.vehicleRepairs[0],actualEntryAt:null},[{plannedEndAt:'2026-10-02T00:00:00'}],'2026-10-01').dayProgress,'计划第1天 / 计划1天')
const task=rows[0]
task.actualStartAt='2026-10-01T08:00:00';task.actualEndAt='2026-10-01T09:00:00';task.status='COMPLETED'
// Use explicit task copy for timing boundaries; formal rows are state objects.
assert.equal(taskTiming(task,now).workMinutes,60)
assert.equal(taskTiming(task,now).overdueMinutes,0)
assert.equal(taskTiming({...task,status:'IN_PROGRESS',actualEndAt:null},now).overdueMinutes>0,true)
assert.equal(taskTiming({...task,status:'NOT_STARTED',plannedEndAt:'2026-10-29T11:59:30'},now).overdueMinutes,1,'sub-minute overdue tasks still warn')
assert.equal(recordVehicleMilestones(state,1,{actualEntryAt:'2026-10-02T06:00',onStandAt:'2026-10-02T08:00',note:'不合法调整'},now).ok,false)
const progress=workstationProgress(state,1,now)
assert.equal(progress.find(row=>row.station.id===task.workstationId).completed,1)
assert.ok(progress.some(row=>row.overdue>0))
state.pc1SchedulePreview={vehicleRepairIds:[1],schedules:[]}
assert.equal(formalVehicleTasks(state,1).length,20,'execution monitoring never replaces formal tasks with simulation')
delete state.pc1SchedulePreview
state.vehicleRepairs.push({...structuredClone(state.vehicleRepairs[0]),id:2,locomotiveNo:'OPS-NEW',status:'UNSCHEDULED',approvalStatus:'DRAFT',currentVersionId:null,actualEntryAt:null,onStandAt:null,lifecycleHistory:[],plannedExitAt:null})
const input={locomotiveNo:'OPS-EDIT',repairProgramId:1,plannedEntryAt:'2026-10-30',repairSequence:'2',mileageKm:'1234.5',ownerBureau:'测试局',ownerDepot:'测试段',remark:'测试备注'}
assert.equal(editUnscheduledPlan(state,2,input).ok,true)
assert.equal(state.vehicleRepairs[1].ownerDepot,'测试段')
assert.equal(state.vehicleRepairs[1].plannedEntryAt,'2026-10-30T08:00:00','date editing preserves original entry time')
assert.equal(editUnscheduledPlan(state,2,{...input,remark:'只改备注'}).ok,true)
assert.equal(state.vehicleRepairs[1].plannedEntryAt,'2026-10-30T08:00:00','metadata editing must not shift entry time')
const guarded=structuredClone(state)
guarded.vehicleRepairs[1].plannedExitAt='2026-10-31T07:00:00'
assert.equal(editUnscheduledPlan(guarded,2,{...input,plannedEntryAt:'2026-10-31'}).ok,false,'preserved entry time must still precede requested exit')
assert.equal(editUnscheduledPlan(state,2,{...input,plannedEntryAt:'2026-02-30'}).ok,false)
assert.equal(editUnscheduledPlan(state,2,{...input,mileageKm:'1.23'}).ok,false)
assert.equal(editUnscheduledPlan(state,1,input).ok,false)
state.pc1SchedulePreview={vehicleRepairIds:[2]}
assert.equal(deleteUnscheduledPlan(state,2).ok,false)
delete state.pc1SchedulePreview
const snapshot=exportDemoSnapshot(state)
assert.equal(parseDemoSnapshot(JSON.stringify(snapshot)).data.vehicleRepairs[0].onStandAt,'2026-10-01T08:00:00')
const invalid=structuredClone(snapshot);invalid.data.vehicleRepairs[0].onStandAt='invalid'
assert.throws(()=>parseDemoSnapshot(JSON.stringify(invalid)))

const schema=`pc1_test_operations_${Date.now()}_${process.pid}`,db=createDatabase({...loadConfig(),schema})
try {
  await db.init({snapshot})
  const restored=await db.read()
  assert.equal(restored.snapshot.data.vehicleRepairs[0].onStandAt,'2026-10-01T08:00:00')
  assert.equal(restored.snapshot.data.vehicleRepairs[0].lifecycleHistory.length,2)
  assert.equal(restored.snapshot.data.vehicleRepairs[1].ownerDepot,'测试段')
  const actual=await db.pool.query(`SELECT actual_entry_at FROM "${schema}".vehicle_repair WHERE vehicle_repair_id=1`)
  assert.equal(actual.rows[0].actual_entry_at,'2026-10-01T06:00:00','actual reception uses canonical business table')
  const candidate=restored.snapshot.data
  assert.equal(deleteUnscheduledPlan(candidate,2).ok,true)
  await db.save(restored.revision,exportDemoSnapshot(candidate))
  await assert.rejects(()=>db.save(restored.revision,exportDemoSnapshot(candidate)),error=>error.status===409)
  assert.equal((await db.read()).snapshot.data.vehicleRepairs.length,1)
  assert.equal((await db.read()).snapshot.data.schedules.length,20)
  console.log('PASS: actual-time validation and correction audit, day counters, formal station progress, overdue timing, guarded plan edit/delete, PostgreSQL restart recovery and stale-save rejection')
} finally {
  assert.match(schema,/^pc1_test_operations_\d+_\d+$/)
  await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await db.close()
}
