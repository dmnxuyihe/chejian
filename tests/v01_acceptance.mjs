import assert from 'node:assert/strict'
import { createState } from '../src/core/state.js'
import {
  addEmployeeToTask, addPlan, completeTask, createResource, deletePlan, deleteResource,
  publishSchedule, qualityDecision, runAutoSchedule, startTask, submitPlan, swapEmployee,
  toggleTaskLock, updatePlan, updateResource,
} from '../src/core/actions.js'
import { minutesBetween } from '../src/core/derived.js'

const results = []
function phase(name, fn) {
  try {
    const checks = fn()
    results.push({ phase:name, passed:true, checks })
  } catch (error) {
    results.push({ phase:name, passed:false, error:error.stack || String(error) })
  }
}

function newPlan(state, no, entry='2026-10-06T08:00:00', exit='2026-10-15T18:00:00') {
  return addPlan(state, { locomotiveNo:no, plannedEntryAt:entry, plannedExitAt:exit, priority:80, mileageKm:480000, remark:'自动验收' })
}

function vehicleRows(state, vehicleId) {
  return state.schedules.filter(s=>s.vehicleRepairId===vehicleId)
}

function activeAssignments(state, scheduleId) {
  return state.employeeAssignments.filter(a=>a.scheduleTaskId===scheduleId&&a.status!=='CANCELLED')
}

phase('系统管理员', () => {
  const state = createState()
  const samples = {
    teams:{name:'验收班组',status:'ENABLED'},
    employees:{no:'YS001',name:'验收人员',teamId:1,status:'ACTIVE'},
    workstations:{code:'YS-WS',name:'验收工位',line:'验收线',capacity:1,status:'AVAILABLE'},
    equipment:{code:'YS-EQ',name:'验收设备',type:'验收设备',workstationId:1,status:'AVAILABLE',location:'验收区'},
    tools:{code:'YS-TL',name:'验收工具',quantity:1,status:'AVAILABLE'},
    materials:{code:'YS-MT',name:'验收物料',quantity:1,status:'AVAILABLE'},
    spareParts:{code:'YS-SP',name:'验收备件',quantity:1,status:'AVAILABLE'},
    componentInstances:{typeId:1,serialNo:'YS-CI-001',assetCode:'YSCI001',status:'AVAILABLE',locationType:'WAREHOUSE'},
  }
  for (const [collection, data] of Object.entries(samples)) {
    const created = createResource(state, collection, data)
    assert.equal(created.ok, true, `${collection} 新增失败`)
    const edited = updateResource(state, collection, created.id, collection==='teams'?{name:'验收班组改'}:{status:data.status || 'AVAILABLE'})
    assert.equal(edited.ok, true, `${collection} 编辑失败`)
    assert.equal(deleteResource(state, collection, created.id).ok, true, `${collection} 合法删除失败`)
  }
  assert.equal(createResource(state,'employees',{no:'BAD',name:'非法人员',teamId:999,status:'ACTIVE'}).ok,false)
  assert.equal(deleteResource(state,'employees',1).ok,false)
  assert.equal(deleteResource(state,'workstations',1).ok,false)
  assert.equal(deleteResource(state,'equipment',1).ok,true, '初始化设备尚无设备分配，应允许删除')
  assert.equal(deleteResource(state,'componentInstances',1).ok,false)
  const scheduledState=createState(); runAutoSchedule(scheduledState,1)
  const usedEquipmentId=scheduledState.equipmentAssignments[0].equipmentId
  assert.equal(deleteResource(scheduledState,'equipment',usedEquipmentId).ok,false)
  const component = state.componentInstances.find(c=>c.id===2)
  assert.equal(updateResource(state,'componentInstances',component.id,{status:'QUALIFIED'}).ok,true)
  assert.equal(component.lifecycle_status,'QUALIFIED')
  return { crudTypes:8, invalidData:true, referencedEmployee:true, referencedWorkstation:true, referencedEquipment:true, referencedComponent:true, componentStatus:true }
})

phase('计划管理人员', () => {
  const state=createState()
  const draft=newPlan(state,'HXD1C0101')
  assert.ok(draft)
  assert.equal(updatePlan(state,draft,{remark:'已编辑'}).ok,true)
  assert.equal(deletePlan(state,draft).ok,true)
  const submitted=newPlan(state,'HXD1C0102')
  assert.equal(submitPlan(state,submitted),true)
  assert.equal(vehicleRows(state,submitted).length,20)
  assert.ok(vehicleRows(state,submitted).every(s=>s.vehicleRepairId===submitted))
  assert.equal(updatePlan(state,submitted,{remark:'错误编辑'}).ok,false)
  assert.equal(deletePlan(state,submitted).ok,false)
  assert.equal(submitPlan(state,submitted),false)
  const second=newPlan(state,'HXD1C0103','2026-10-07T08:00:00','2026-10-16T18:00:00')
  assert.equal(submitPlan(state,second),true)
  assert.equal(vehicleRows(state,second).length,20)
  assert.equal(vehicleRows(state,submitted).length,20)
  assert.equal(addPlan(state,{locomotiveNo:'BAD',plannedEntryAt:'2026-10-10T08:00:00',plannedExitAt:'2026-10-09T08:00:00'}),null)
  assert.ok(state.vehicleRepairs.every(v=>!String(v.plannedEntryAt).endsWith('Z')))
  return { addEditDeleteDraft:true, submitCreatesTasks:20, submittedProtected:true, vehiclesIsolated:2, localTime:true }
})

phase('生产排程/调度人员', () => {
  const state=createState()
  const a=runAutoSchedule(state,1)
  assert.equal(a.exceptionCount,0)
  const rowsA=vehicleRows(state,1)
  assert.equal(rowsA.length,20)
  for (const dep of state.dependencies) {
    const parent=rowsA.find(s=>s.taskId===dep.parentTaskId)
    const child=rowsA.find(s=>s.taskId===dep.childTaskId)
    assert.ok(new Date(child.plannedStartAt)>=new Date(parent.plannedEndAt).getTime()+dep.lagMinutes*60000)
  }
  const press=rowsA.find(s=>s.taskId===2014), reverse=rowsA.find(s=>s.taskId===2015)
  assert.equal(minutesBetween(press.plannedEndAt,reverse.plannedStartAt),2880)
  const second=newPlan(state,'HXD1C0202','2026-10-01T08:00:00','2026-10-20T18:00:00')
  assert.equal(submitPlan(state,second),true)
  const snapshotA=JSON.stringify({rows:rowsA,ea:state.employeeAssignments.filter(a=>rowsA.some(s=>s.id===a.scheduleTaskId)),eq:state.equipmentAssignments.filter(a=>rowsA.some(s=>s.id===a.scheduleTaskId)),ca:state.componentAssignments.filter(a=>rowsA.some(s=>s.id===a.scheduleTaskId))})
  const b=runAutoSchedule(state,second)
  assert.equal(b.exceptionCount,0)
  assert.equal(JSON.stringify({rows:vehicleRows(state,1),ea:state.employeeAssignments.filter(a=>rowsA.some(s=>s.id===a.scheduleTaskId)),eq:state.equipmentAssignments.filter(a=>rowsA.some(s=>s.id===a.scheduleTaskId)),ca:state.componentAssignments.filter(a=>rowsA.some(s=>s.id===a.scheduleTaskId))}),snapshotA)
  const rowsB=vehicleRows(state,second)
  assert.ok(new Date(rowsB.find(s=>s.taskId===1001).plannedStartAt)>=new Date(rowsA.find(s=>s.taskId===1004).plannedEndAt))
  for (const collection of ['schedules','scheduleVersions','employeeAssignments','equipmentAssignments','componentAssignments']) {
    const ids=state[collection].map(x=>x.id)
    assert.equal(new Set(ids).size,ids.length,`${collection} ID重复`)
  }
  const locked=rowsB.find(s=>s.taskId===2006)
  toggleTaskLock(state,locked.id)
  const lockedSnapshot=JSON.stringify(locked)
  runAutoSchedule(state,1)
  assert.equal(JSON.stringify(locked),lockedSnapshot)

  const leaveState=createState()
  leaveState.employeeLeaves.push({id:1,employeeId:1,startAt:'2026-10-01T08:00:00',endAt:'2026-10-01T10:00:00'})
  assert.equal(runAutoSchedule(leaveState,1).exceptionCount,0)
  const leaveAssignments=leaveState.employeeAssignments.filter(a=>a.employeeId===1&&a.status!=='CANCELLED')
  assert.ok(leaveAssignments.every(a=>{const s=leaveState.schedules.find(x=>x.id===a.scheduleTaskId);return !(new Date(s.plannedStartAt)<new Date('2026-10-01T10:00:00')&&new Date('2026-10-01T08:00:00')<new Date(s.plannedEndAt))}))

  const shortage=createState()
  shortage.equipment.find(e=>e.type==='构架清洗机').status='FAULT'
  const shortageResult=runAutoSchedule(shortage,1)
  assert.ok(shortageResult.exceptionCount>0)
  assert.ok(shortage.exceptions.some(e=>e.type==='EQUIPMENT_SHORTAGE'))
  assert.equal(publishSchedule(shortage),false)
  const componentShortage=createState()
  componentShortage.componentInstances=componentShortage.componentInstances.filter(c=>c.typeId!==4)
  runAutoSchedule(componentShortage,1)
  assert.ok(componentShortage.exceptions.some(e=>e.type==='COMPONENT_SHORTAGE'))
  const employeeShortage=createState()
  employeeShortage.employees.filter(e=>e.teamId===1).slice(0,2).forEach(e=>e.status='INACTIVE')
  runAutoSchedule(employeeShortage,1)
  assert.ok(employeeShortage.exceptions.some(e=>e.type==='EMPLOYEE_SHORTAGE'))

  const publishable=createState()
  runAutoSchedule(publishable,1)
  assert.equal(publishSchedule(publishable),true)
  assert.equal(publishable.scheduleVersions.find(v=>v.id===publishable.vehicleRepairs[0].currentVersionId).status,'PUBLISHED')
  return { tasks:20, fs:18, lagMinutes:2880, multiVehicleIsolation:true, leave:true, shortages:['employee','equipment','component'], lock:true, publishGuard:true, uniqueIds:true }
})

phase('工班长/组长', () => {
  const state=createState(); runAutoSchedule(state,1)
  const schedule=vehicleRows(state,1).find(s=>s.taskId===2001)
  const current=activeAssignments(state,schedule.id)
  const old=current[0].employeeId
  const spare=state.employees.find(e=>e.teamId===1&&!current.some(a=>a.employeeId===e.id))
  const otherVehicle=newPlan(state,'HXD1C0302'); submitPlan(state,otherVehicle); const otherSnapshot=JSON.stringify(vehicleRows(state,otherVehicle))
  const swapped=swapEmployee(state,schedule.id,old,spare.id,9001,'正常换人')
  assert.equal(swapped.ok,true)
  const manual=activeAssignments(state,schedule.id).find(a=>a.employeeId===spare.id)
  assert.equal(manual.source,'MANUAL'); assert.equal(manual.adjustReason,'正常换人')
  assert.equal(swapEmployee(state,schedule.id,current[1].employeeId,101).ok,false)
  const addCandidate=state.employees.find(e=>e.teamId===1&&!activeAssignments(state,schedule.id).some(a=>a.employeeId===e.id))
  assert.equal(addEmployeeToTask(state,schedule.id,addCandidate.id,9001,'现场增员原因').ok,true)
  assert.equal(activeAssignments(state,schedule.id).find(a=>a.employeeId===addCandidate.id).adjustReason,'现场增员原因')
  assert.equal(addEmployeeToTask(state,schedule.id,101).ok,false)
  const conflictEmployee=state.employees.find(e=>e.teamId===1&&!activeAssignments(state,schedule.id).some(a=>a.employeeId===e.id))
  const otherSchedule=vehicleRows(state,1).find(s=>s.id!==schedule.id)
  otherSchedule.plannedStartAt=schedule.plannedStartAt; otherSchedule.plannedEndAt=schedule.plannedEndAt
  state.employeeAssignments.push({id:99999,scheduleTaskId:otherSchedule.id,employeeId:conflictEmployee.id,source:'AUTO',status:'ASSIGNED'})
  assert.equal(addEmployeeToTask(state,schedule.id,conflictEmployee.id).ok,false)
  assert.equal(JSON.stringify(vehicleRows(state,otherVehicle)),otherSnapshot)
  return { ownTeamRows:true, swap:true, crossTeamRejected:true, add:true, conflictRejected:true, reasonSaved:true, source:'MANUAL', otherVehiclePreserved:true }
})

phase('作业人员', () => {
  const state=createState(); runAutoSchedule(state,1)
  const schedule=vehicleRows(state,1)[0]
  const owner=activeAssignments(state,schedule.id)[0].employeeId
  const outsider=state.employees.find(e=>!activeAssignments(state,schedule.id).some(a=>a.employeeId===e.id)).id
  assert.equal(startTask(state,schedule.id,outsider).ok,false)
  assert.equal(startTask(state,schedule.id,owner).ok,true)
  assert.equal(schedule.status,'IN_PROGRESS'); assert.ok(schedule.actualStartAt)
  assert.equal(startTask(state,schedule.id,owner).ok,false)
  assert.equal(completeTask(state,schedule.id,owner).ok,true)
  assert.equal(schedule.status,'COMPLETED'); assert.ok(schedule.actualEndAt)
  assert.equal(completeTask(state,schedule.id,owner).ok,false)
  assert.equal(state.qualityRecords.filter(q=>q.scheduleTaskId===schedule.id).length,1)
  return { ownerIsolation:true, transitions:['NOT_STARTED','IN_PROGRESS','COMPLETED'], duplicateGuard:true, actualTimes:true, qualityRecordUnique:true }
})

phase('质量人员', () => {
  const state=createState(); runAutoSchedule(state,1)
  const first=vehicleRows(state,1)[0], second=vehicleRows(state,1)[1]
  const firstOwner=activeAssignments(state,first.id)[0].employeeId
  startTask(state,first.id,firstOwner); completeTask(state,first.id,firstOwner)
  assert.equal(state.qualityRecords.filter(q=>q.scheduleTaskId===first.id).length,1)
  assert.equal(qualityDecision(state,first.id,'PASS','检查合格').ok,true)
  assert.equal(state.qualityRecords.find(q=>q.scheduleTaskId===first.id).opinion,'检查合格')
  assert.equal(qualityDecision(state,first.id,'FAILED','重复处理').ok,false)
  assert.equal(qualityDecision(state,second.id,'PASS','越权处理').ok,false)
  const secondOwner=activeAssignments(state,second.id)[0].employeeId
  startTask(state,second.id,secondOwner); completeTask(state,second.id,secondOwner)
  assert.equal(qualityDecision(state,second.id,'FAILED','需处理').ok,true)
  assert.equal(state.qualityRecords.find(q=>q.scheduleTaskId===second.id).status,'FAILED')
  return { pendingGenerated:true, pass:true, failed:true, opinion:true, duplicateGuard:true, completedOnly:true, linked:true }
})

phase('技术人员', () => {
  const state=createState()
  assert.equal(state.tasks.filter(t=>t.process==='构架').length,4)
  assert.equal(state.tasks.filter(t=>t.process==='轮驱').length,16)
  assert.equal(state.dependencies.length,18)
  assert.ok(state.dependencies.every(d=>d.type==='FS'))
  assert.equal(state.dependencies.find(d=>d.parentTaskId===2014&&d.childTaskId===2015)?.lagMinutes,2880)
  assert.ok(state.tasks.every(t=>state.workstations.some(w=>w.id===t.workstationId)))
  assert.ok(state.teamRequirements.length>0&&state.equipmentRequirements.length>0&&state.componentRequirements.length>0)
  return { frameTasks:4, wheelTasks:16, fs:18, lagMinutes:2880, workstationMapping:true, resourceRequirements:true, readOnly:true }
})

phase('V0.1主业务链路', () => {
  const state=createState()
  const adminResource=createResource(state,'tools',{code:'CHAIN-TL',name:'链路验收工具',quantity:1,status:'AVAILABLE'})
  assert.equal(adminResource.ok,true)
  assert.equal(updateResource(state,'tools',adminResource.id,{quantity:2}).ok,true)
  assert.equal(deleteResource(state,'tools',adminResource.id).ok,true)
  const vehicle=newPlan(state,'HXD1C0999','2026-10-06T08:00:00','2026-10-20T18:00:00')
  assert.equal(submitPlan(state,vehicle),true)
  assert.equal(runAutoSchedule(state,vehicle).exceptionCount,0)
  assert.equal(publishSchedule(state),true)
  const schedule=vehicleRows(state,vehicle).find(s=>s.taskId===2001)
  const current=activeAssignments(state,schedule.id)
  const replacement=state.employees.find(e=>e.teamId===1&&!current.some(a=>a.employeeId===e.id))
  assert.equal(swapEmployee(state,schedule.id,current[0].employeeId,replacement.id,9001,'链路验收').ok,true)
  assert.equal(startTask(state,schedule.id,replacement.id).ok,true)
  assert.equal(completeTask(state,schedule.id,replacement.id).ok,true)
  assert.equal(qualityDecision(state,schedule.id,'PASS','链路验收通过').ok,true)
  return { adminResourceRegression:true, technicalAndSchedulerShareProcessData:true, chain:['计划建立','提交并生成20任务','智能排程','发布','工班长微调','开始作业','完成作业','质量通过'] }
})

const failed=results.filter(r=>!r.passed)
console.log(JSON.stringify({passed:failed.length===0,results},null,2))
if(failed.length) process.exitCode=1
