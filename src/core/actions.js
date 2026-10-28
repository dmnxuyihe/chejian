import { addMinutes, formatLocalDateTime, minutesBetween, taskOf, scheduleOf } from './derived.js'

const iso = (d) => formatLocalDateTime(d)
const maxIso = (...items) => {
  const valid = items.filter(Boolean).map(v => new Date(v)).filter(d => !Number.isNaN(d.getTime()))
  return valid.length ? iso(new Date(Math.max(...valid.map(d => d.getTime())))) : ''
}

function selectedVehicle(state, vehicleRepairId = state.selectedVehicleRepairId) {
  return state.vehicleRepairs.find(v => v.id === Number(vehicleRepairId)) || state.vehicleRepairs[0]
}

function ensureVehicleSchedules(state, vehicle) {
  const existing = state.schedules.filter(s => s.vehicleRepairId === vehicle.id)
  const existingTaskIds = new Set(existing.map(s => s.taskId))
  let nextId = Math.max(0, ...state.schedules.map(s => s.id)) + 1
  for (const task of state.tasks) {
    if (existingTaskIds.has(task.id)) continue
    state.schedules.push({
      id: nextId++, vehicleRepairId: vehicle.id, taskId: task.id,
      versionId: vehicle.currentVersionId || null, workstationId: task.workstationId,
      plannedStartAt: vehicle.plannedEntryAt, plannedEndAt: vehicle.plannedEntryAt,
      actualStartAt: null, actualEndAt: null, status: 'NOT_STARTED',
      isLocked: false, delayMinutes: 0, remark: '待自动排程'
    })
  }
  return state.schedules.filter(s => s.vehicleRepairId === vehicle.id)
}

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

function onLeave(state, employeeId, start, end) {
  return (state.employeeLeaves || []).some(leave => leave.employeeId === Number(employeeId) && overlaps(start, end, leave.startAt, leave.endAt))
}

function employeeReadyAt(state, employee, availableAt, duration) {
  let ready = availableAt
  for (let guard = 0; guard < 20; guard += 1) {
    const blockingLeave = (state.employeeLeaves || [])
      .filter(leave => leave.employeeId === employee.id && overlaps(ready, addMinutes(ready, duration), leave.startAt, leave.endAt))
      .sort((a,b)=>new Date(a.endAt)-new Date(b.endAt))[0]
    if (!blockingLeave) return ready
    ready = maxIso(ready, blockingLeave.endAt)
  }
  return ready
}

export function runAutoSchedule(state, vehicleRepairId = state.selectedVehicleRepairId) {
  const vehicle = selectedVehicle(state, vehicleRepairId)
  if (!vehicle) return { exceptionCount: 1, versionNo: null, message: '没有可排程的车辆计划' }
  state.selectedVehicleRepairId = vehicle.id
  const vehicleSchedules = ensureVehicleSchedules(state, vehicle)
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
  let assignmentId = Math.max(0, ...state.employeeAssignments.map(a => Number(a.id) || 0)) + 1
  let equipmentAssignmentId = Math.max(0, ...state.equipmentAssignments.map(a => Number(a.id) || 0)) + 1
  let componentAssignmentId = Math.max(0, ...state.componentAssignments.map(a => Number(a.id) || 0)) + 1

  // 其他车辆已经占用的资源必须参与本车排程，避免逐车重排造成跨车冲突。
  const otherSchedules = state.schedules.filter(s => s.vehicleRepairId !== vehicle.id && s.status !== 'CANCELLED')
  const otherScheduleById = new Map(otherSchedules.map(s => [s.id, s]))
  for (const schedule of otherSchedules) {
    stationAvailable.set(schedule.workstationId, maxIso(stationAvailable.get(schedule.workstationId), schedule.plannedEndAt))
  }
  for (const assignment of state.employeeAssignments.filter(a => a.status !== 'CANCELLED')) {
    const schedule = otherScheduleById.get(assignment.scheduleTaskId)
    if (schedule) employeeAvailable.set(assignment.employeeId, maxIso(employeeAvailable.get(assignment.employeeId), schedule.plannedEndAt))
  }
  for (const assignment of state.equipmentAssignments.filter(a => a.status !== 'CANCELLED')) {
    const schedule = otherScheduleById.get(assignment.scheduleTaskId)
    if (schedule) equipmentAvailable.set(assignment.equipmentId, maxIso(equipmentAvailable.get(assignment.equipmentId), assignment.endAt || schedule.plannedEndAt))
  }
  for (const assignment of state.componentAssignments.filter(a => a.status !== 'CANCELLED')) {
    const schedule = otherScheduleById.get(assignment.scheduleTaskId)
    if (schedule) componentAvailable.set(assignment.componentInstanceId, maxIso(componentAvailable.get(assignment.componentInstanceId), schedule.plannedEndAt))
  }

  const orderedTasks = [...state.tasks].sort((a,b) => {
    if (a.process !== b.process) return a.process === '构架' ? -1 : 1
    return a.sequence - b.sequence
  })

  for (const task of orderedTasks) {
    const schedule = vehicleSchedules.find(s => s.taskId === task.id)
    const dep = state.dependencies.filter(d => d.childTaskId === task.id)
    let earliest = vehicle.plannedEntryAt
    for (const d of dep) {
      const parentEnd = taskEnds.get(d.parentTaskId)
      if (parentEnd) earliest = maxIso(earliest, addMinutes(parentEnd, d.lagMinutes || 0))
    }

    earliest = maxIso(earliest, stationAvailable.get(task.workstationId))

    // 锁定或已执行任务以原计划时间和原资源为准，后续任务从其真实结束时间继续。
    if (schedule && (schedule.isLocked || ['IN_PROGRESS', 'COMPLETED'].includes(schedule.status))) {
      if (new Date(schedule.plannedStartAt) < new Date(earliest)) {
        exceptions.push({ id:exceptions.length+1, scheduleTaskId:schedule.id, taskId:task.id, type:'LOCK_CONFLICT', severity:'HIGH', message:`${task.name} 的锁定时间与前置或资源约束冲突`, status:'OPEN' })
      }
      taskEnds.set(task.id, schedule.plannedEndAt)
      stationAvailable.set(task.workstationId, maxIso(stationAvailable.get(task.workstationId), schedule.plannedEndAt))
      for (const assignment of state.employeeAssignments.filter(a => a.scheduleTaskId === schedule.id && a.status !== 'CANCELLED')) {
        employeeAvailable.set(assignment.employeeId, maxIso(employeeAvailable.get(assignment.employeeId), schedule.plannedEndAt))
        employeeLoad.set(assignment.employeeId, (employeeLoad.get(assignment.employeeId) || 0) + minutesBetween(schedule.plannedStartAt, schedule.plannedEndAt))
      }
      for (const assignment of state.equipmentAssignments.filter(a => a.scheduleTaskId === schedule.id && a.status !== 'CANCELLED')) {
        equipmentAvailable.set(assignment.equipmentId, maxIso(equipmentAvailable.get(assignment.equipmentId), assignment.endAt || schedule.plannedEndAt))
      }
      for (const assignment of state.componentAssignments.filter(a => a.scheduleTaskId === schedule.id && a.status !== 'CANCELLED')) {
        componentAvailable.set(assignment.componentInstanceId, maxIso(componentAvailable.get(assignment.componentInstanceId), schedule.plannedEndAt))
      }
      continue
    }

    const equipReqs = requiredEquipment(state, task.id)
    const chosenEquipment = []
    for (const req of equipReqs) {
      const used = new Set()
      for (let index = 0; index < Number(req.quantity || 1); index += 1) {
      const candidates = state.equipment
        .filter(e => e.type === req.equipmentType && e.status === 'AVAILABLE' && !used.has(e.id))
        .sort((a,b) => new Date(equipmentAvailable.get(a.id)) - new Date(equipmentAvailable.get(b.id)))
      const chosen = candidates[0]
      if (!chosen) {
        exceptions.push({ id:exceptions.length+1, scheduleTaskId:null, taskId:task.id, type:'EQUIPMENT_SHORTAGE', severity:'HIGH', message:`${task.name} 缺少设备：${req.equipmentType}`, status:'OPEN' })
        continue
      }
      used.add(chosen.id)
      earliest = maxIso(earliest, equipmentAvailable.get(chosen.id))
      chosenEquipment.push(chosen)
      }
    }

    // 先根据可用时间估算每个班组最早能凑齐的人数。
    const teamReqs = requiredTeams(state, task.id)
    for (const req of teamReqs) {
      const candidates = state.employees.filter(e => e.teamId === req.teamId && e.status === 'ACTIVE')
      if (candidates.length < req.headcount) {
        exceptions.push({ id:exceptions.length+1, scheduleTaskId:null, taskId:task.id, type:'EMPLOYEE_SHORTAGE', severity:'HIGH', message:`${task.name} 班组人数不足`, status:'OPEN' })
        continue
      }
      const times = candidates.map(e => employeeReadyAt(state, e, maxIso(earliest, employeeAvailable.get(e.id)), task.duration)).sort((a,b)=>new Date(a)-new Date(b))
      earliest = maxIso(earliest, times[req.headcount-1])
    }

    // 在最终 earliest 上，用累计负荷最低优先挑人，达到人员负荷均衡。
    const chosenEmployees = []
    for (const req of teamReqs) {
      const candidates = state.employees
        .filter(e => e.teamId === req.teamId && e.status === 'ACTIVE' && new Date(employeeAvailable.get(e.id)) <= new Date(earliest) && !onLeave(state, e.id, earliest, addMinutes(earliest, task.duration)))
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
      newEquipmentAssignments.push({ id:equipmentAssignmentId++, scheduleTaskId, equipmentId:e.id, startAt:start, endAt:end, status:'ASSIGNED' })
    }
    for (const item of chosenComponents) {
      componentAvailable.set(item.component.id, end)
      newComponentAssignments.push({ id:componentAssignmentId++, scheduleTaskId, componentInstanceId:item.component.id, action:item.action, source:'AUTO', status:'ASSIGNED' })
    }
  }

  // Locked tasks retain their manual assignments; current demo data has no lock by default.
  const vehicleScheduleIds = new Set(vehicleSchedules.map(s => s.id))
  const lockedIds = new Set(vehicleSchedules.filter(s => s.isLocked).map(s => s.id))
  const lockedAssignments = state.employeeAssignments.filter(a => lockedIds.has(a.scheduleTaskId))
  const lockedEquipment = state.equipmentAssignments.filter(a => lockedIds.has(a.scheduleTaskId))
  const lockedComponents = state.componentAssignments.filter(a => lockedIds.has(a.scheduleTaskId))
  state.employeeAssignments = [
    ...state.employeeAssignments.filter(a => !vehicleScheduleIds.has(a.scheduleTaskId)),
    ...lockedAssignments,
    ...newAssignments.filter(a => !lockedIds.has(a.scheduleTaskId)),
  ]
  state.equipmentAssignments = [
    ...state.equipmentAssignments.filter(a => !vehicleScheduleIds.has(a.scheduleTaskId)),
    ...lockedEquipment,
    ...newEquipmentAssignments.filter(a => !lockedIds.has(a.scheduleTaskId)),
  ]
  state.componentAssignments = [
    ...state.componentAssignments.filter(a => !vehicleScheduleIds.has(a.scheduleTaskId)),
    ...lockedComponents,
    ...newComponentAssignments.filter(a => !lockedIds.has(a.scheduleTaskId)),
  ]
  const otherExceptions = state.exceptions.filter(e => e.vehicleRepairId !== vehicle.id)
  state.published = false
  state.lastScheduleRunAt = iso(new Date())
  const nextVersionId = Math.max(...state.scheduleVersions.map(v=>Number(v.id)||0),0) + 1
  const nextVersion = Math.max(...state.scheduleVersions.filter(v=>v.vehicleRepairId===vehicle.id).map(v=>Number(v.versionNo)||0),0) + 1
  const parentVersionId = vehicle.currentVersionId || null
  state.scheduleVersions.push({ id:nextVersionId, vehicleRepairId:vehicle.id, versionNo:nextVersion, parentVersionId, reason:'智能排程', status:'DRAFT', createdAt:state.lastScheduleRunAt })
  vehicle.currentVersionId = nextVersionId
  vehicleSchedules.forEach(s => { if (!s.isLocked && !['IN_PROGRESS', 'COMPLETED'].includes(s.status)) s.versionId = nextVersionId })
  state.exceptions = [...otherExceptions, ...exceptions.map(e => ({ ...e, vehicleRepairId:vehicle.id, versionId:nextVersionId }))]
  log(state,'排程',`完成第 ${nextVersion} 版智能排程，人员按负荷均衡重新分配`)
  return { exceptionCount:exceptions.length, versionNo:nextVersion }
}

export function publishSchedule(state) {
  const vehicle = selectedVehicle(state)
  if (!vehicle) return false
  if (state.exceptions.some(e => e.vehicleRepairId === vehicle.id && e.status === 'OPEN')) { state.published = false; return false }
  if (!state.schedules.some(s => s.vehicleRepairId === vehicle.id && s.versionId === vehicle.currentVersionId)) { state.published = false; return false }
  state.published = true
  const current = state.scheduleVersions.find(v => v.id === vehicle.currentVersionId)
  if (current) {
    current.status = 'PUBLISHED'
    current.publishedAt = iso(new Date())
  }
  log(state,'排程','当前排程版本已发布')
  return true
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
  if (newEmployee.status !== 'ACTIVE') return { ok:false, message:'目标人员当前不可用' }
  if (newEmployee.teamId !== oldEmployee.teamId) return { ok:false, message:'第一版仅允许同班组换人' }
  if (state.employeeAssignments.some(a => a.scheduleTaskId === Number(scheduleTaskId) && a.employeeId === Number(newEmployeeId) && a.status !== 'CANCELLED')) return { ok:false, message:'该人员已在当前任务中' }

  const conflicts = state.employeeAssignments
    .filter(a => a.employeeId === Number(newEmployeeId) && a.status !== 'CANCELLED')
    .map(a => scheduleOf(state,a.scheduleTaskId))
    .filter(Boolean)
    .some(other => other.id !== schedule.id && overlaps(schedule.plannedStartAt,schedule.plannedEndAt,other.plannedStartAt,other.plannedEndAt))
  if (conflicts) return { ok:false, message:'目标人员在该时间段已有任务' }
  if (onLeave(state, newEmployee.id, schedule.plannedStartAt, schedule.plannedEndAt)) return { ok:false, message:'目标人员在该时间段请假' }

  oldAssignment.status = 'CANCELLED'
  state.employeeAssignments.push({
    id:Math.max(0,...state.employeeAssignments.map(a=>a.id))+1,
    scheduleTaskId:Number(scheduleTaskId), employeeId:Number(newEmployeeId), source:'MANUAL', status:'ASSIGNED',
    originalEmployeeId:Number(oldEmployeeId), adjustedBy, adjustReason:reason, assignedAt:iso(new Date())
  })
  log(state,'工班长',`${taskOf(state,schedule.taskId)?.name}：${oldEmployee.name} 调整为 ${newEmployee.name}`)
  return { ok:true, message:'人员调整成功' }
}

export function addEmployeeToTask(state, scheduleTaskId, employeeId, adjustedBy=9001, reason='现场增员') {
  const schedule = scheduleOf(state,scheduleTaskId)
  const emp = state.employees.find(e=>e.id===Number(employeeId))
  if (!schedule || !emp) return {ok:false,message:'任务或人员不存在'}
  if (emp.status !== 'ACTIVE') return {ok:false,message:'目标人员当前不可用'}
  const allowedTeams = new Set(requiredTeams(state, schedule.taskId).map(r=>r.teamId))
  if (!allowedTeams.has(emp.teamId)) return {ok:false,message:'该人员所属班组不符合任务需求'}
  if (state.employeeAssignments.some(a=>a.scheduleTaskId===schedule.id && a.employeeId===emp.id && a.status!=='CANCELLED')) return {ok:false,message:'该人员已在任务中'}
  const conflict = state.employeeAssignments.filter(a=>a.employeeId===emp.id && a.status!=='CANCELLED').map(a=>scheduleOf(state,a.scheduleTaskId)).filter(Boolean).some(s=>s.id!==schedule.id && overlaps(schedule.plannedStartAt,schedule.plannedEndAt,s.plannedStartAt,s.plannedEndAt))
  if (conflict) return {ok:false,message:'该人员时间冲突'}
  if (onLeave(state, emp.id, schedule.plannedStartAt, schedule.plannedEndAt)) return {ok:false,message:'该人员在任务时间段请假'}
  state.employeeAssignments.push({ id:Math.max(0,...state.employeeAssignments.map(a=>a.id))+1, scheduleTaskId:schedule.id, employeeId:emp.id, source:'MANUAL', status:'ASSIGNED', originalEmployeeId:null, adjustedBy, adjustReason:reason || '现场增员', assignedAt:iso(new Date()) })
  log(state,'工班长',`${taskOf(state,schedule.taskId)?.name} 增加人员 ${emp.name}`)
  return {ok:true,message:'已增加人员'}
}

export function startTask(state, scheduleTaskId, employeeId) {
  const schedule = scheduleOf(state,scheduleTaskId)
  if (!schedule) return {ok:false,message:'任务不存在'}
  const hasAssignment = state.employeeAssignments.some(a=>a.scheduleTaskId===schedule.id && a.employeeId===Number(employeeId) && a.status!=='CANCELLED')
  if (!hasAssignment) return {ok:false,message:'当前人员未分配该任务'}
  if (schedule.status !== 'NOT_STARTED') return {ok:false,message:schedule.status === 'IN_PROGRESS' ? '任务已经开始' : '任务当前状态不能开始'}
  schedule.status = 'IN_PROGRESS'
  schedule.actualStartAt = iso(new Date())
  state.employeeAssignments.filter(a=>a.scheduleTaskId===schedule.id && a.status!=='CANCELLED').forEach(a=>a.status='WORKING')
  log(state,'作业',`${taskOf(state,schedule.taskId)?.name} 开始作业`)
  return {ok:true,message:'已开始作业'}
}

export function completeTask(state, scheduleTaskId, employeeId) {
  const schedule = scheduleOf(state,scheduleTaskId)
  if (!schedule) return {ok:false,message:'任务不存在'}
  const hasAssignment = state.employeeAssignments.some(a=>a.scheduleTaskId===schedule.id && a.employeeId===Number(employeeId) && a.status!=='CANCELLED')
  if (!hasAssignment) return {ok:false,message:'当前人员未分配该任务'}
  if (schedule.status !== 'IN_PROGRESS') return {ok:false,message:schedule.status === 'COMPLETED' ? '任务已经完成' : '任务尚未开始'}
  schedule.status = 'COMPLETED'
  schedule.actualEndAt = iso(new Date())
  state.employeeAssignments.filter(a=>a.scheduleTaskId===schedule.id && a.status!=='CANCELLED').forEach(a=>a.status='DONE')
  if (!state.qualityRecords.some(q=>q.scheduleTaskId===schedule.id)) {
    state.qualityRecords.push({ id:Math.max(0,...state.qualityRecords.map(q=>q.id))+1, scheduleTaskId:schedule.id, status:'PENDING', opinion:'', checkedAt:null })
  }
  log(state,'作业',`${taskOf(state,schedule.taskId)?.name} 完成，进入质量待检`)
  return {ok:true,message:'任务已完成并进入待检'}
}

export function qualityDecision(state, scheduleTaskId, result, opinion='') {
  const schedule = scheduleOf(state, scheduleTaskId)
  if (!schedule || schedule.status !== 'COMPLETED') return {ok:false,message:'只有已完成作业才能进行质量确认'}
  const rec = state.qualityRecords.find(q=>q.scheduleTaskId===Number(scheduleTaskId))
  if (!rec) return {ok:false,message:'未找到该任务的待检记录'}
  if (rec.status !== 'PENDING') return {ok:false,message:'该质量记录已经处理'}
  if (!['PASS', 'FAILED'].includes(result)) return {ok:false,message:'质量结果无效'}
  rec.status = result
  rec.opinion = opinion
  rec.checkedAt = iso(new Date())
  log(state,'质量',`${taskOf(state,schedule.taskId)?.name || '任务'} 检验结果：${result==='PASS'?'通过':'不通过'}`)
  return {ok:true,message:result==='PASS'?'检验通过':'已记录不通过'}
}

export function addPlan(state, data) {
  const validation = validatePlan(state, data)
  if (!validation.ok) return null
  const id = Math.max(0,...state.vehicleRepairs.map(v=>v.id))+1
  state.vehicleRepairs.push({
    id,
    locomotiveNo:data.locomotiveNo.trim(),
    repairProgramId:1,
    plannedEntryAt:data.plannedEntryAt,
    plannedExitAt:data.plannedExitAt,
    actualEntryAt:null, actualExitAt:null,
    status:'DRAFT', approvalStatus:'DRAFT', currentVersionId:null,
    ownerBureau:data.ownerBureau || '模拟局', ownerDepot:data.ownerDepot || '模拟段',
    repairSequence:1, mileageKm:Number(data.mileageKm ?? 0), planSource:'MANUAL', priority:Number(data.priority ?? 50), remark:data.remark||''
  })
  state.selectedVehicleRepairId = id
  log(state,'计划',`新增检修计划 ${data.locomotiveNo}`)
  return id
}

export function submitPlan(state, id) {
  const plan = state.vehicleRepairs.find(v=>v.id===Number(id))
  if (!plan || !['DRAFT', 'UNSCHEDULED'].includes(plan.status)) return false
  ensureVehicleSchedules(state, plan)
  plan.status = 'SCHEDULED'
  state.selectedVehicleRepairId = plan.id
  log(state,'计划',`${plan.locomotiveNo} 已提交排程`)
  return true
}

export function updatePlan(state, id, data) {
  const plan = state.vehicleRepairs.find(v => v.id === Number(id))
  if (!plan) return { ok:false, message:'计划不存在' }
  if (plan.status !== 'DRAFT') return { ok:false, message:'已提交排程的计划不能直接编辑' }
  if (state.pc1SchedulePreview?.vehicleRepairIds?.includes(plan.id)) return { ok:false, message:'本车正在模拟排程，请先结束模拟再编辑计划' }
  const validation = validatePlan(state, { ...plan, ...data }, plan.id)
  if (!validation.ok) return validation
  Object.assign(plan, {
    locomotiveNo: (data.locomotiveNo ?? plan.locomotiveNo).trim(),
    plannedEntryAt: data.plannedEntryAt ?? plan.plannedEntryAt,
    plannedExitAt: data.plannedExitAt ?? plan.plannedExitAt,
    priority: Number(data.priority ?? plan.priority),
    mileageKm: Number(data.mileageKm ?? plan.mileageKm),
    remark: data.remark ?? plan.remark,
  })
  log(state, '计划', `更新检修计划 ${plan.locomotiveNo}`)
  return { ok:true, row:plan }
}

export function deletePlan(state, id) {
  const numericId = Number(id)
  const plan = state.vehicleRepairs.find(v => v.id === numericId)
  if (!plan) return { ok:false, message:'计划不存在' }
  if (plan.status !== 'DRAFT') return { ok:false, message:'已提交的计划不能删除' }
  if (state.schedules.some(s => s.vehicleRepairId === numericId)) return { ok:false, message:'计划已经生成排程，不能删除' }
  if (state.pc1SchedulePreview?.vehicleRepairIds?.includes(numericId)) return { ok:false, message:'本车正在模拟排程，请先结束模拟再删除计划' }
  state.vehicleRepairs = state.vehicleRepairs.filter(v => v.id !== numericId)
  if (state.selectedVehicleRepairId === numericId) state.selectedVehicleRepairId = state.vehicleRepairs[0]?.id || null
  log(state, '计划', `删除检修计划 ${plan.locomotiveNo}`)
  return { ok:true }
}

export function validatePlan(state, data, excludeId = null) {
  const name = String(data.locomotiveNo || '').trim()
  if (!name || name.length > 80) return { ok:false, message:'机车号不能为空且不能超过80字' }
  const entry = new Date(data.plannedEntryAt)
  const exit = new Date(data.plannedExitAt)
  if (Number.isNaN(entry.getTime()) || Number.isNaN(exit.getTime())) return { ok:false, message:'计划时间无效' }
  if (entry >= exit) return { ok:false, message:'计划交车时间必须晚于进场时间' }
  if (state.vehicleRepairs.some(v => v.id !== excludeId && v.locomotiveNo.trim().toUpperCase() === name.toUpperCase() && v.plannedEntryAt.slice(0,10) === data.plannedEntryAt.slice(0,10))) return { ok:false, message:'相同车辆和入段日的计划已存在，请编辑已有计划' }
  const priority = Number(data.priority ?? 50)
  const mileage = Number(data.mileageKm ?? 0)
  if (!Number.isFinite(priority) || priority < 0) return { ok:false, message:'优先级必须是非负数' }
  if (!Number.isFinite(mileage) || mileage < 0) return { ok:false, message:'累计走行公里必须是非负数' }
  return { ok:true }
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

const resourceLabel = {
  teams: '班组', employees: '人员', workstations: '工位', equipment: '设备',
  tools: '工具', materials: '物料', spareParts: '备件',
  componentInstances: '配件实例',
}

const allowedResourceStatuses = {
  teams: ['ENABLED', 'DISABLED'],
  employees: ['ACTIVE', 'INACTIVE'],
  workstations: ['AVAILABLE', 'MAINTENANCE', 'DISABLED'],
  equipment: ['AVAILABLE', 'MAINTENANCE', 'FAULT', 'DISABLED'],
  tools: ['AVAILABLE', 'MAINTENANCE', 'DISABLED'],
  materials: ['AVAILABLE', 'DISABLED'],
  spareParts: ['AVAILABLE', 'DISABLED'],
  componentInstances: ['AVAILABLE', 'INSTALLED', 'WAIT_REPAIR', 'REPAIRING', 'QUALIFIED', 'SCRAPPED'],
}

function validateResource(state, collection, data, currentId = null) {
  const rows = state[collection]
  if (!Array.isArray(rows)) return { ok:false, message:'资源类型不存在' }
  const row = data || {}
  const required = {
    teams: ['name'], employees: ['no', 'name', 'teamId'], workstations: ['code', 'name', 'capacity'],
    equipment: ['code', 'name', 'type'], tools: ['name', 'quantity'], materials: ['name', 'quantity'],
    spareParts: ['name', 'quantity'], componentInstances: ['typeId', 'serialNo'],
  }[collection] || []
  for (const field of required) {
    if (row[field] === undefined || row[field] === null || String(row[field]).trim() === '') return { ok:false, message:`${field} 不能为空` }
  }
  if (['tools', 'materials', 'spareParts'].includes(collection) && (!Number.isFinite(Number(row.quantity)) || Number(row.quantity) < 0)) return { ok:false, message:'数量必须是非负数字' }
  if (collection === 'workstations' && (!Number.isInteger(Number(row.capacity)) || Number(row.capacity) < 1)) return { ok:false, message:'工位容量必须是大于 0 的整数' }
  if (collection === 'employees' && !state.teams.some(t => t.id === Number(row.teamId))) return { ok:false, message:'所属班组不存在' }
  if (collection === 'equipment' && row.workstationId !== '' && row.workstationId != null && !state.workstations.some(w => w.id === Number(row.workstationId))) return { ok:false, message:'所属工位不存在' }
  if (collection === 'componentInstances' && !state.componentTypes.some(t => t.id === Number(row.typeId))) return { ok:false, message:'配件类型不存在' }
  if (collection === 'componentInstances' && row.workstationId !== '' && row.workstationId != null && !state.workstations.some(w => w.id === Number(row.workstationId))) return { ok:false, message:'当前工位不存在' }
  if (collection === 'componentInstances' && row.locationType && !['WAREHOUSE', 'WORKSTATION', 'VEHICLE', 'OTHER'].includes(row.locationType)) return { ok:false, message:'位置类型不合法' }
  const statuses = allowedResourceStatuses[collection]
  if (row.status && statuses && !statuses.includes(row.status)) return { ok:false, message:'状态值不合法' }
  const uniqueField = collection === 'employees' ? 'no' : collection === 'teams' ? 'name' : ['workstations','equipment','tools','materials','spareParts'].includes(collection) ? 'code' : collection === 'componentInstances' ? 'serialNo' : null
  if (uniqueField && row[uniqueField]) {
    const duplicate = rows.find(x => x.id !== Number(currentId) && String(x[uniqueField] || '').trim() === String(row[uniqueField]).trim())
    if (duplicate) return { ok:false, message:`${uniqueField} 已存在，不能重复` }
  }
  return { ok:true }
}

function syncResourceDbFields(collection, row) {
  const aliases = {
    teams: { name:'team_name' }, employees: { no:'employee_no', name:'employee_name' },
    workstations: { code:'workstation_code', name:'workstation_name', line:'production_line' },
    equipment: { code:'equipment_code', name:'equipment_name', type:'equipment_type' },
    tools: { code:'tool_code', name:'tool_name' }, materials: { code:'material_code', name:'material_name' },
    spareParts: { code:'part_code', name:'part_name' },
  }[collection]
  if (aliases) Object.entries(aliases).forEach(([source, target]) => { row[target] = row[source] })
  if (collection === 'componentInstances') {
    row.lifecycle_status = row.status
    row.current_workstation_id = row.workstationId || null
    row.current_locomotive_no = row.locomotiveNo || ''
    row.location_text = row.location || ''
  }
  return row
}

export function createResource(state, collection, data) {
  const rows = state[collection]
  if (!Array.isArray(rows)) return { ok:false, message:'资源类型不存在' }
  const validation = validateResource(state, collection, data)
  if (!validation.ok) return validation
  const id = Math.max(0, ...rows.map(x=>Number(x.id)||0)) + 1
  const timestamp = iso(new Date())
  const row = { ...data, id, createdAt: timestamp, updatedAt: timestamp, created_at: timestamp, updated_at: timestamp }
  if (collection === 'employees') {
    const team = state.teams.find(t=>t.id===Number(row.teamId))
    row.teamId = Number(row.teamId)
    row.teamName = team?.name || ''
    row.status ||= 'ACTIVE'
  }
  if (collection === 'componentInstances') {
    row.lifecycle_status = row.status || 'AVAILABLE'
    row.locationType ||= 'WAREHOUSE'
    row.current_workstation_id = row.workstationId || null
    row.current_locomotive_no = row.locomotiveNo || ''
    row.location_text = row.location || ''
  }
  syncResourceDbFields(collection, row)
  rows.push(row)
  log(state, '系统', `新增${resourceLabel[collection]||'资源'} ${row.name||row.code||id}`)
  return { ok:true, id, row }
}

export function updateResource(state, collection, id, data) {
  const row = state[collection]?.find(x=>x.id===Number(id))
  if (!row) return { ok:false, message:'资源不存在' }
  const validation = validateResource(state, collection, { ...row, ...data }, id)
  if (!validation.ok) return validation
  Object.assign(row, data)
  row.updatedAt = iso(new Date())
  row.updated_at = row.updatedAt
  if (collection === 'employees') {
    row.teamId = Number(row.teamId)
    row.teamName = state.teams.find(t=>t.id===row.teamId)?.name || row.teamName || ''
  }
  if (collection === 'componentInstances') {
    if (data.status !== undefined) row.lifecycle_status = row.status
    if (data.workstationId !== undefined) row.current_workstation_id = row.workstationId || null
    if (data.locomotiveNo !== undefined) row.current_locomotive_no = row.locomotiveNo || ''
    if (data.location !== undefined) row.location_text = row.location || ''
  }
  syncResourceDbFields(collection, row)
  log(state, '系统', `更新${resourceLabel[collection]||'资源'} ${row.name||row.code||id}`)
  return { ok:true, row }
}

export function deleteResource(state, collection, id) {
  const numericId = Number(id)
  const row = state[collection]?.find(x=>x.id===numericId)
  if (!row) return { ok:false, message:'资源不存在' }
  if (collection === 'employees' && state.employeeAssignments.some(a=>a.employeeId===numericId && a.status!=='CANCELLED')) {
    return { ok:false, message:'人员已有排程分配，不能删除，可改为停用' }
  }
  if (collection === 'teams' && (state.employees.some(e=>e.teamId===numericId) || state.teamRequirements.some(r=>r.teamId===numericId))) {
    return { ok:false, message:'班组仍被人员或工艺需求引用，不能删除' }
  }
  if (collection === 'workstations' && (state.tasks.some(t=>t.workstationId===numericId) || state.equipment.some(e=>e.workstationId===numericId))) {
    return { ok:false, message:'工位仍被任务或设备引用，不能删除' }
  }
  if (collection === 'equipment' && state.equipmentAssignments.some(a => a.equipmentId === numericId && a.status !== 'CANCELLED')) {
    return { ok:false, message:'设备已经被排程使用，不能删除' }
  }
  if (collection === 'componentInstances' && state.componentAssignments.some(a => a.componentInstanceId === numericId && a.status !== 'CANCELLED')) {
    return { ok:false, message:'配件实例已经被排程使用，不能删除' }
  }
  const index = state[collection].findIndex(x=>x.id===numericId)
  state[collection].splice(index, 1)
  log(state, '系统', `删除${resourceLabel[collection]||'资源'} ${row.name||row.code||id}`)
  return { ok:true }
}
