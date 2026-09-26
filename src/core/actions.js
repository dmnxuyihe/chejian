import { addMinutes, minutesBetween, taskOf, scheduleOf } from './derived.js'

const iso = (d) => new Date(d).toISOString().slice(0,19)
const maxIso = (...items) => iso(new Date(Math.max(...items.filter(Boolean).map(v => new Date(v).getTime()))))

function overlaps(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd)
}

function log(state, type, text) {
  state.activityLog.unshift({
    id: (state.activityLog[0]?.id || 0) + 1,
    time: new Date().toLocaleString('zh-CN', { hour12:false }),
    type, text
  })
  state.activityLog = state.activityLog.slice(0, 30)
}

function requiredTeams(state, taskId) {
  return state.teamRequirements.filter(r => r.taskId === taskId)
}
function requiredEquipment(state, taskId) {
  return state.equipmentRequirements.filter(r => r.taskId === taskId)
}
function requiredComponents(state, taskId) {
  return state.componentRequirements.filter(r => r.taskId === taskId)
}

export function runAutoSchedule(state) {
  const vehicle = state.vehicleRepairs[0]
  const employeeAvailable = new Map(state.employees.map(e => [e.id, vehicle.plannedEntryAt]))
  const employeeLoad = new Map(state.employees.map(e => [e.id, 0]))
  const stationAvailable = new Map(state.workstations.map(w => [w.id, vehicle.plannedEntryAt]))
  const equipmentAvailable = new Map(state.equipment.map(e => [e.id, vehicle.plannedEntryAt]))
  const componentAvailable = new Map(state.componentInstances.map(c => [c.id, vehicle.plannedEntryAt]))
  const taskEnds = new Map()
  const newAssignments = []
  const newEquipmentAssignments = []
  const newComponentAssignments = []
  const exceptions = []
  let assignmentId = 1
  let equipmentAssignmentId = 1
  let componentAssignmentId = 1

  const orderedTasks = [...state.tasks].sort((a,b) => {
    if (a.process !== b.process) return a.process === '构架' ? -1 : 1
    return a.sequence - b.sequence
  })

  for (const task of orderedTasks) {
    const dep = state.dependencies.filter(d => d.childTaskId === task.id)
    let earliest = vehicle.plannedEntryAt
    for (const d of dep) {
      const parentEnd = taskEnds.get(d.parentTaskId)
      if (parentEnd) earliest = maxIso(earliest, addMinutes(parentEnd, d.lagMinutes || 0))
    }

    earliest = maxIso(earliest, stationAvailable.get(task.workstationId))

    const equipReqs = requiredEquipment(state, task.id)
    const chosenEquipment = []
    for (const req of equipReqs) {
      const candidates = state.equipment
        .filter(e => e.type === req.equipmentType && e.status === 'AVAILABLE')
        .sort((a,b) => new Date(equipmentAvailable.get(a.id)) - new Date(equipmentAvailable.get(b.id)))
      const chosen = candidates[0]
      if (!chosen) {
        exceptions.push({ id:exceptions.length+1, scheduleTaskId:null, taskId:task.id, type:'EQUIPMENT_SHORTAGE', severity:'HIGH', message:`${task.name} 缺少设备：${req.equipmentType}`, status:'OPEN' })
        continue
      }
      earliest = maxIso(earliest, equipmentAvailable.get(chosen.id))
      chosenEquipment.push(chosen)
    }

    // 先根据可用时间估算每个班组最早能凑齐的人数。
    const teamReqs = requiredTeams(state, task.id)
    for (const req of teamReqs) {
      const candidates = state.employees.filter(e => e.teamId === req.teamId && e.status === 'ACTIVE')
      if (candidates.length < req.headcount) {
        exceptions.push({ id:exceptions.length+1, scheduleTaskId:null, taskId:task.id, type:'EMPLOYEE_SHORTAGE', severity:'HIGH', message:`${task.name} 班组人数不足`, status:'OPEN' })
        continue
      }
      const times = candidates.map(e => employeeAvailable.get(e.id)).sort((a,b)=>new Date(a)-new Date(b))
      earliest = maxIso(earliest, times[req.headcount-1])
    }

    // 在最终 earliest 上，用累计负荷最低优先挑人，达到人员负荷均衡。
    const chosenEmployees = []
    for (const req of teamReqs) {
      const candidates = state.employees
        .filter(e => e.teamId === req.teamId && e.status === 'ACTIVE' && new Date(employeeAvailable.get(e.id)) <= new Date(earliest))
        .sort((a,b) => (employeeLoad.get(a.id) - employeeLoad.get(b.id)) || (a.id-b.id))
      const chosen = candidates.slice(0, req.headcount)
      if (chosen.length < req.headcount) {
        exceptions.push({ id:exceptions.length+1, scheduleTaskId:null, taskId:task.id, type:'EMPLOYEE_CONFLICT', severity:'HIGH', message:`${task.name} 在目标时间无法凑齐人员`, status:'OPEN' })
      }
      chosenEmployees.push(...chosen)
    }

    // 配件只检查需求存在，不扩展复杂库存逻辑。
    const compReqs = requiredComponents(state, task.id)
    const chosenComponents = []
    for (const req of compReqs) {
      let candidates = state.componentInstances
        .filter(c => c.typeId === req.componentTypeId && c.status !== 'SCRAPPED')
        .sort((a,b) => {
          const aVehicle = a.locomotiveNo === vehicle.locomotiveNo ? 0 : 1
          const bVehicle = b.locomotiveNo === vehicle.locomotiveNo ? 0 : 1
          return aVehicle - bVehicle || new Date(componentAvailable.get(a.id)) - new Date(componentAvailable.get(b.id)) || a.id-b.id
        })
      candidates = candidates.filter(c => new Date(componentAvailable.get(c.id)) <= new Date(earliest))
      const chosen = candidates.slice(0, req.quantity)
      if (chosen.length < req.quantity) {
        exceptions.push({ id:exceptions.length+1, scheduleTaskId:null, taskId:task.id, type:'COMPONENT_SHORTAGE', severity:'HIGH', message:`${task.name} 配件数量不足`, status:'OPEN' })
      }
      chosenComponents.push(...chosen.map(c => ({ component:c, action:req.action })))
    }

    const start = earliest
    const end = addMinutes(start, task.duration)
    const schedule = state.schedules.find(s => s.taskId === task.id)
    if (schedule && !schedule.isLocked) {
      schedule.plannedStartAt = start
      schedule.plannedEndAt = end
      schedule.status = schedule.status === 'COMPLETED' ? 'COMPLETED' : 'NOT_STARTED'
      schedule.delayMinutes = 0
      schedule.remark = '智能排程结果'
    }
    const scheduleTaskId = schedule?.id

    taskEnds.set(task.id, end)
    stationAvailable.set(task.workstationId, end)
    for (const e of chosenEmployees) {
      employeeAvailable.set(e.id, end)
      employeeLoad.set(e.id, employeeLoad.get(e.id) + task.duration)
      newAssignments.push({
        id:assignmentId++, scheduleTaskId, employeeId:e.id, source:'AUTO', status:'ASSIGNED',
        originalEmployeeId:null, adjustedBy:null, adjustReason:'', assignedAt:state.demoClock
      })
    }
    for (const e of chosenEquipment) {
      equipmentAvailable.set(e.id, end)
      newEquipmentAssignments.push({ id:equipmentAssignmentId++, scheduleTaskId, equipmentId:e.id, startAt:start, endAt:end, status:'ALLOCATED' })
    }
    for (const item of chosenComponents) {
      componentAvailable.set(item.component.id, end)
      newComponentAssignments.push({ id:componentAssignmentId++, scheduleTaskId, componentInstanceId:item.component.id, action:item.action, source:'AUTO', status:'ASSIGNED' })
    }
  }

  // Locked tasks retain their manual assignments; current demo data has no lock by default.
  const lockedIds = new Set(state.schedules.filter(s => s.isLocked).map(s => s.id))
  const lockedAssignments = state.employeeAssignments.filter(a => lockedIds.has(a.scheduleTaskId))
  const lockedEquipment = state.equipmentAssignments.filter(a => lockedIds.has(a.scheduleTaskId))
  const lockedComponents = state.componentAssignments.filter(a => lockedIds.has(a.scheduleTaskId))
  state.employeeAssignments = [...lockedAssignments, ...newAssignments.filter(a => !lockedIds.has(a.scheduleTaskId))]
  state.equipmentAssignments = [...lockedEquipment, ...newEquipmentAssignments.filter(a => !lockedIds.has(a.scheduleTaskId))]
  state.componentAssignments = [...lockedComponents, ...newComponentAssignments.filter(a => !lockedIds.has(a.scheduleTaskId))]
  state.exceptions = exceptions
  state.published = false
  state.lastScheduleRunAt = new Date().toISOString().slice(0,19)
  const nextVersion = Math.max(...state.scheduleVersions.map(v=>v.versionNo),0) + 1
  state.scheduleVersions.push({ id:nextVersion, vehicleRepairId:vehicle.id, versionNo:nextVersion, parentVersionId:state.scheduleVersions.at(-1)?.id || null, reason:'智能排程', status:'DRAFT', createdAt:state.lastScheduleRunAt })
  vehicle.currentVersionId = nextVersion
  state.schedules.forEach(s => { if (!s.isLocked) s.versionId = nextVersion })
  log(state,'排程',`完成第 ${nextVersion} 版智能排程，人员按负荷均衡重新分配`)
  return { exceptionCount:exceptions.length, versionNo:nextVersion }
}

export function publishSchedule(state) {
  state.published = true
  const current = state.scheduleVersions.find(v => v.id === state.vehicleRepairs[0].currentVersionId)
  if (current) {
    current.status = 'PUBLISHED'
    current.publishedAt = new Date().toISOString().slice(0,19)
  }
  log(state,'排程','当前排程版本已发布')
}

export function toggleTaskLock(state, scheduleTaskId) {
  const s = scheduleOf(state, scheduleTaskId)
  if (!s) return false
  s.isLocked = !s.isLocked
  log(state,'排程',`${taskOf(state,s.taskId)?.name || '任务'} ${s.isLocked ? '已锁定' : '已解锁'}`)
  return s.isLocked
}

export function swapEmployee(state, scheduleTaskId, oldEmployeeId, newEmployeeId, adjustedBy = 9001, reason = '工班长现场微调') {
  const schedule = scheduleOf(state, scheduleTaskId)
  if (!schedule) return { ok:false, message:'未找到排程任务' }
  const oldAssignment = state.employeeAssignments.find(a => a.scheduleTaskId === Number(scheduleTaskId) && a.employeeId === Number(oldEmployeeId) && a.status !== 'CANCELLED')
  if (!oldAssignment) return { ok:false, message:'原人员不在该任务中' }
  const newEmployee = state.employees.find(e => e.id === Number(newEmployeeId))
  const oldEmployee = state.employees.find(e => e.id === Number(oldEmployeeId))
  if (!newEmployee || !oldEmployee) return { ok:false, message:'人员不存在' }
  if (newEmployee.teamId !== oldEmployee.teamId) return { ok:false, message:'第一版仅允许同班组换人' }
  if (state.employeeAssignments.some(a => a.scheduleTaskId === Number(scheduleTaskId) && a.employeeId === Number(newEmployeeId) && a.status !== 'CANCELLED')) return { ok:false, message:'该人员已在当前任务中' }

  const conflicts = state.employeeAssignments
    .filter(a => a.employeeId === Number(newEmployeeId) && a.status !== 'CANCELLED')
    .map(a => scheduleOf(state,a.scheduleTaskId))
    .filter(Boolean)
    .some(other => other.id !== schedule.id && overlaps(schedule.plannedStartAt,schedule.plannedEndAt,other.plannedStartAt,other.plannedEndAt))
  if (conflicts) return { ok:false, message:'目标人员在该时间段已有任务' }

  oldAssignment.status = 'CANCELLED'
  state.employeeAssignments.push({
    id:Math.max(0,...state.employeeAssignments.map(a=>a.id))+1,
    scheduleTaskId:Number(scheduleTaskId), employeeId:Number(newEmployeeId), source:'FOREMAN', status:'ASSIGNED',
    originalEmployeeId:Number(oldEmployeeId), adjustedBy, adjustReason:reason, assignedAt:new Date().toISOString().slice(0,19)
  })
  log(state,'工班长',`${taskOf(state,schedule.taskId)?.name}：${oldEmployee.name} 调整为 ${newEmployee.name}`)
  return { ok:true, message:'人员调整成功' }
}

export function addEmployeeToTask(state, scheduleTaskId, employeeId, adjustedBy=9001) {
  const schedule = scheduleOf(state,scheduleTaskId)
  const emp = state.employees.find(e=>e.id===Number(employeeId))
  if (!schedule || !emp) return {ok:false,message:'任务或人员不存在'}
  if (state.employeeAssignments.some(a=>a.scheduleTaskId===schedule.id && a.employeeId===emp.id && a.status!=='CANCELLED')) return {ok:false,message:'该人员已在任务中'}
  const conflict = state.employeeAssignments.filter(a=>a.employeeId===emp.id && a.status!=='CANCELLED').map(a=>scheduleOf(state,a.scheduleTaskId)).filter(Boolean).some(s=>s.id!==schedule.id && overlaps(schedule.plannedStartAt,schedule.plannedEndAt,s.plannedStartAt,s.plannedEndAt))
  if (conflict) return {ok:false,message:'该人员时间冲突'}
  state.employeeAssignments.push({ id:Math.max(0,...state.employeeAssignments.map(a=>a.id))+1, scheduleTaskId:schedule.id, employeeId:emp.id, source:'FOREMAN', status:'ASSIGNED', originalEmployeeId:null, adjustedBy, adjustReason:'现场增员', assignedAt:new Date().toISOString().slice(0,19) })
  log(state,'工班长',`${taskOf(state,schedule.taskId)?.name} 增加人员 ${emp.name}`)
  return {ok:true,message:'已增加人员'}
}

export function startTask(state, scheduleTaskId, employeeId) {
  const schedule = scheduleOf(state,scheduleTaskId)
  if (!schedule) return {ok:false,message:'任务不存在'}
  const hasAssignment = state.employeeAssignments.some(a=>a.scheduleTaskId===schedule.id && a.employeeId===Number(employeeId) && a.status!=='CANCELLED')
  if (!hasAssignment) return {ok:false,message:'当前人员未分配该任务'}
  schedule.status = 'IN_PROGRESS'
  schedule.actualStartAt ||= schedule.plannedStartAt
  state.employeeAssignments.filter(a=>a.scheduleTaskId===schedule.id && a.status!=='CANCELLED').forEach(a=>a.status='WORKING')
  log(state,'作业',`${taskOf(state,schedule.taskId)?.name} 开始作业`)
  return {ok:true,message:'已开始作业'}
}

export function completeTask(state, scheduleTaskId, employeeId) {
  const schedule = scheduleOf(state,scheduleTaskId)
  if (!schedule) return {ok:false,message:'任务不存在'}
  const hasAssignment = state.employeeAssignments.some(a=>a.scheduleTaskId===schedule.id && a.employeeId===Number(employeeId) && a.status!=='CANCELLED')
  if (!hasAssignment) return {ok:false,message:'当前人员未分配该任务'}
  schedule.status = 'COMPLETED'
  schedule.actualStartAt ||= schedule.plannedStartAt
  schedule.actualEndAt = schedule.plannedEndAt
  state.employeeAssignments.filter(a=>a.scheduleTaskId===schedule.id && a.status!=='CANCELLED').forEach(a=>a.status='DONE')
  if (!state.qualityRecords.some(q=>q.scheduleTaskId===schedule.id)) {
    state.qualityRecords.push({ id:Math.max(0,...state.qualityRecords.map(q=>q.id))+1, scheduleTaskId:schedule.id, status:'PENDING', opinion:'', checkedAt:null })
  }
  log(state,'作业',`${taskOf(state,schedule.taskId)?.name} 完成，进入质量待检`)
  return {ok:true,message:'任务已完成并进入待检'}
}

export function qualityDecision(state, scheduleTaskId, result, opinion='') {
  let rec = state.qualityRecords.find(q=>q.scheduleTaskId===Number(scheduleTaskId))
  if (!rec) {
    rec = { id:Math.max(0,...state.qualityRecords.map(q=>q.id))+1, scheduleTaskId:Number(scheduleTaskId), status:'PENDING', opinion:'', checkedAt:null }
    state.qualityRecords.push(rec)
  }
  rec.status = result === 'PASS' ? 'PASS' : 'FAILED'
  rec.opinion = opinion
  rec.checkedAt = scheduleOf(state, scheduleTaskId)?.actualEndAt || state.demoClock
  log(state,'质量',`${taskOf(state,scheduleOf(state,scheduleTaskId)?.taskId)?.name || '任务'} 检验结果：${result==='PASS'?'通过':'不通过'}`)
  return {ok:true,message:result==='PASS'?'检验通过':'已记录不通过'}
}

export function addPlan(state, data) {
  const id = Math.max(0,...state.vehicleRepairs.map(v=>v.id))+1
  state.vehicleRepairs.push({
    id,
    locomotiveNo:data.locomotiveNo,
    repairProgramId:1,
    plannedEntryAt:data.plannedEntryAt,
    plannedExitAt:data.plannedExitAt,
    actualEntryAt:null, actualExitAt:null,
    status:'DRAFT', approvalStatus:'APPROVED', currentVersionId:null,
    ownerBureau:data.ownerBureau || '模拟局', ownerDepot:data.ownerDepot || '模拟段',
    repairSequence:1, mileageKm:Number(data.mileageKm||0), planSource:'MANUAL', priority:Number(data.priority||50), remark:data.remark||''
  })
  log(state,'计划',`新增检修计划 ${data.locomotiveNo}`)
  return id
}

export function submitPlan(state, id) {
  const plan = state.vehicleRepairs.find(v=>v.id===Number(id))
  if (!plan) return false
  plan.status = 'SCHEDULED'
  log(state,'计划',`${plan.locomotiveNo} 已提交排程`)
  return true
}

export function updateComponentStatus(state, componentId, status) {
  const c = state.componentInstances.find(x=>x.id===Number(componentId))
  if (!c) return false
  c.status = status
  log(state,'配件',`${c.serialNo} 状态调整为 ${status}`)
  return true
}

export function addEmployee(state, data) {
  const id = Math.max(0,...state.employees.map(e=>e.id))+1
  const team = state.teams.find(t=>t.id===Number(data.teamId))
  state.employees.push({ id, no:data.no, name:data.name, teamId:Number(data.teamId), teamName:team?.name || '', status:'ACTIVE' })
  log(state,'系统',`新增人员 ${data.name}`)
  return id
}
