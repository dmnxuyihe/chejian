import { formatLocalDateTime } from './derived.js'
import { buildResourceReport } from './resource-report.js'

const MINUTE = 60000
const DAY = 24 * 60 * MINUTE
const active = row => !['CANCELLED', 'CANCELED'].includes(row.status)
const time = value => new Date(value).getTime()
const overlaps = (start, end, row) => start < row.end && row.start < end
const unique = rows => [...new Set(rows)]
const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
const sourceFields = {
  vehicleRepairs: ['id','locomotiveNo','repairProgramId','plannedEntryAt','plannedExitAt','status','currentVersionId','priority'],
  schedules: ['id','vehicleRepairId','taskId','versionId','workstationId','plannedStartAt','plannedEndAt','actualStartAt','actualEndAt','status','isLocked'],
  scheduleVersions: ['id','vehicleRepairId','versionNo','status'],
  employeeAssignments: ['id','scheduleTaskId','employeeId','status'],
  equipmentAssignments: ['id','scheduleTaskId','equipmentId','startAt','endAt','status'],
  componentAssignments: ['id','scheduleTaskId','componentInstanceId','action','status'],
  tasks: ['id','name','process','repairProgramId','duration','sequence','workstationId','status'],
  dependencies: ['parentTaskId','childTaskId','type','lagMinutes'],
  teamRequirements: ['taskId','teamId','headcount','workDurationMin'],
  toolRequirements: ['taskId','toolId','quantity'], materialRequirements: ['taskId','materialId','quantity'],
  equipmentRequirements: ['taskId','equipmentType','quantity'], componentRequirements: ['taskId','componentTypeId','quantity','action'],
  employees: ['id','teamId','status'], employeeLeaves: ['employeeId','startAt','endAt','status'], teams: ['id','status'],
  tools: ['id','name','quantity','status'], materials: ['id','name','quantity','unit','status'],
  equipment: ['id','type','workstationId','status'], componentInstances: ['id','typeId','status','locomotiveNo'],
  workstations: ['id','capacity','status'], workCalendar: ['date','isWorkday','type','start','end'],
  repairPrograms: ['id','modelId','code','status'],
}
const nextId = rows => Math.max(0, ...rows.map(row => Number(row.id) || 0)) + 1
const taskKey = row => `${row.vehicleRepairId}:${row.taskId}`
const tasksFor = (state, vehicle) => state.tasks.filter(task => task.repairProgramId === vehicle.repairProgramId && task.status !== 'DISABLED')

export function pc1SourceSignature(state) {
  // Database-generated audit timestamps and alias fields do not change the
  // scheduling inputs. Compare canonical business fields across save/reload.
  const sources=Object.fromEntries(Object.entries(sourceFields).map(([key, fields]) => [key, (state[key] || []).map(row => Object.fromEntries(fields.map(field => [field, row[field] ?? null]))).sort((a,b) => stable(a).localeCompare(stable(b)))]))
  sources.toolAssets=(state.toolManagement?.assets||[]).map(a=>Object.fromEntries(['id','toolId','quantity','status','inspectionCycleMonths','lastInspectionAt'].map(k=>[k,a[k]??null])))
  return stable(sources)
}

function formalRows(state) {
  return state.schedules.filter(row => active(row) && state.vehicleRepairs.some(vehicle => active(vehicle) && vehicle.id === row.vehicleRepairId && vehicle.currentVersionId != null && vehicle.currentVersionId === row.versionId) && time(row.plannedEndAt) > time(row.plannedStartAt))
}

export function canPlanVehicle(state, vehicle) {
  return active(vehicle) && !['SUBMITTED','REVIEWED','PUBLISHED'].includes(vehicle.approvalStatus) && !['COMPLETED','IN_PROGRESS','FINISHED','CLOSED'].includes(vehicle.status) && !formalRows(state).some(row => row.vehicleRepairId === vehicle.id && ['IN_PROGRESS','COMPLETED'].includes(row.status))
}

export function pc1Preflight(state, vehicleIds) {
  const ids = unique(vehicleIds.map(Number)), issues = []
  if (!ids.length) issues.push('请在月度日历中选择需要排程的车辆')
  if (ids.length !== vehicleIds.length) issues.push('车辆选择重复')
  for (const id of ids) {
    const vehicle = state.vehicleRepairs.find(row => row.id === id)
    if (!vehicle) { issues.push('所选车辆已不存在'); continue }
    if (!canPlanVehicle(state, vehicle)) issues.push(`${vehicle.locomotiveNo}已有执行记录或已结束，不能重新编排`)
    const tasks = tasksFor(state, vehicle)
    if (!tasks.length) issues.push(`${vehicle.locomotiveNo}没有可用的修程工序配置`)
    if (tasks.some(task => !['构架','轮驱'].includes(task.process))) issues.push('本次PC1演示仅支持构架和轮驱修程')
    for (const task of tasks) {
      if (!(task.duration > 0) || !Number.isFinite(task.duration)) issues.push(`${task.name}的作业时长无效`)
      const station = state.workstations.find(row => row.id === task.workstationId)
      if (!station || station.status !== 'AVAILABLE' || !Number.isInteger(station.capacity) || station.capacity < 1) issues.push(`${task.name}的工位不可用或容量无效`)
      for (const req of state.equipmentRequirements.filter(row => row.taskId === task.id)) {
        if (!Number.isInteger(req.quantity) || req.quantity < 1 || state.equipment.filter(row => row.type === req.equipmentType && row.status === 'AVAILABLE').length < req.quantity) issues.push(`${task.name}缺少可用设备：${req.equipmentType}`)
      }
      for (const req of state.componentRequirements.filter(row => row.taskId === task.id)) {
        if (!Number.isInteger(req.quantity) || req.quantity < 1 || state.componentInstances.filter(row => row.typeId === req.componentTypeId && !['SCRAPPED','DISABLED'].includes(row.status)).length < req.quantity) issues.push(`${task.name}的配件实例数量不足`)
      }
    }
  }
  const selected = new Set(ids)
  const copy = { ...state, schedules: formalRows(state).filter(row => !selected.has(row.vehicleRepairId)) }
  delete copy.pc1SchedulePreview
  const report = buildResourceReport(copy, ids)
  issues.push(...report.issues.map(row => row.message))
  for (const row of report.staffing.filter(row => row.gap > 0)) issues.push(`${row.team.name}人数不足：缺少${row.gap}人`)
  for (const row of report.tools.filter(row => row.gap > 0)) issues.push(`${row.name}工具不足：缺少${row.gap}件`)
  for (const row of report.materials.filter(row => row.gap > 0)) issues.push(`${row.name}物料不足：缺少${row.gap}${row.unit}`)
  return { ok: !issues.length, issues: unique(issues), report }
}

function resourceBook(state, selected) {
  const capacities = new Map(), busy = new Map()
  const define = (key, capacity) => { capacities.set(key, capacity); busy.set(key, []) }
  const reserve = (key, start, end, quantity = 1) => {
    if (end > start) { if (!busy.has(key)) busy.set(key, []); busy.get(key).push({ start, end, quantity }) }
  }
  const fits = (key, start, end, quantity = 1) => {
    const capacity = capacities.get(key) || 0
    if (quantity > capacity) return false
    const rows = (busy.get(key) || []).filter(row => overlaps(start, end, row))
    const points = unique([start, ...rows.map(row => Math.max(start, row.start))])
    return points.every(at => quantity + rows.filter(row => row.start <= at && row.end > at).reduce((sum, row) => sum + row.quantity, 0) <= capacity)
  }
  for (const row of state.workstations) define(`station:${row.id}`, row.status === 'AVAILABLE' ? Number(row.capacity) : 0)
  for (const row of state.tools) define(`tool:${row.id}`, row.status === 'AVAILABLE' ? Number(row.quantity) : 0)
  for (const row of state.employees) define(`employee:${row.id}`, row.status === 'ACTIVE' && state.teams.find(team => team.id === row.teamId)?.status !== 'DISABLED' ? 1 : 0)
  for (const row of state.equipment) define(`equipment:${row.id}`, row.status === 'AVAILABLE' ? 1 : 0)
  for (const row of state.componentInstances) define(`component:${row.id}`, !['SCRAPPED','DISABLED'].includes(row.status) ? 1 : 0)
  for (const row of state.employeeLeaves.filter(active)) reserve(`employee:${row.employeeId}`, time(row.startAt), time(row.endAt))
  const external = formalRows(state).filter(row => !selected.has(row.vehicleRepairId))
  for (const row of external) {
    const start = time(row.plannedStartAt), end = time(row.plannedEndAt)
    reserve(`station:${row.workstationId}`, start, end)
    for (const req of state.toolRequirements.filter(req => req.taskId === row.taskId)) reserve(`tool:${req.toolId}`, start, end, req.quantity)
    for (const [collection, field, kind] of [['employeeAssignments','employeeId','employee'],['equipmentAssignments','equipmentId','equipment'],['componentAssignments','componentInstanceId','component']]) {
      for (const assigned of state[collection].filter(assigned => active(assigned) && assigned.scheduleTaskId === row.id)) reserve(`${kind}:${assigned[field]}`, start, end)
    }
  }
  const holidayEnd = (start, end) => {
    const day = state.workCalendar.find(row => (row.isWorkday === false || row.type === 'HOLIDAY') && start < time(`${row.date}T00:00:00`) + DAY && end > time(`${row.date}T00:00:00`))
    return day ? time(`${day.date}T00:00:00`) + DAY : null
  }
  return {
    fits, reserve, holidayEnd,
    next(start, end) {
      const holiday = holidayEnd(start, end)
      const ends = [...busy.values()].flat().map(row => row.end).filter(value => value > start)
      if (holiday) ends.push(holiday)
      return ends.length ? Math.min(...ends) : start + DAY
    },
    load(key) { return (busy.get(key) || []).reduce((sum, row) => sum + (row.end - row.start) / MINUTE, 0) },
  }
}

function allocate(state, book, task, start, end) {
  if (book.holidayEnd(start, end)) return null
  const uses = [[`station:${task.workstationId}`, 1]], employees = [], equipment = [], components = []
  for (const req of state.toolRequirements.filter(row => row.taskId === task.id)) uses.push([`tool:${req.toolId}`, req.quantity])
  if (!uses.every(([key, quantity]) => book.fits(key, start, end, quantity))) return null
  for (const req of state.teamRequirements.filter(row => row.taskId === task.id)) {
    const available = state.employees.filter(row => row.teamId === req.teamId && !employees.includes(row.id) && book.fits(`employee:${row.id}`, start, end))
      .sort((a,b) => book.load(`employee:${a.id}`) - book.load(`employee:${b.id}`) || a.id - b.id)
    if (available.length < req.headcount) return null
    employees.push(...available.slice(0, req.headcount).map(row => row.id))
  }
  for (const req of state.equipmentRequirements.filter(row => row.taskId === task.id)) {
    const available = state.equipment.filter(row => row.type === req.equipmentType && !equipment.includes(row.id) && book.fits(`equipment:${row.id}`, start, end))
    if (available.length < req.quantity) return null
    equipment.push(...available.slice(0, req.quantity).map(row => row.id))
  }
  for (const req of state.componentRequirements.filter(row => row.taskId === task.id)) {
    const available = state.componentInstances.filter(row => row.typeId === req.componentTypeId && !components.some(item => item.id === row.id) && book.fits(`component:${row.id}`, start, end))
    if (available.length < req.quantity) return null
    components.push(...available.slice(0, req.quantity).map(row => ({ id: row.id, action: req.action })))
  }
  uses.push(...employees.map(id => [`employee:${id}`, 1]), ...equipment.map(id => [`equipment:${id}`, 1]), ...components.map(row => [`component:${row.id}`, 1]))
  return { uses, employees, equipment, components }
}

function reserveAllocation(book, allocation, start, end) {
  for (const [key, quantity] of allocation.uses) book.reserve(key, start, end, quantity)
}

export function simulatePc1(state, vehicleIds, deadline, previous = state.pc1SchedulePreview) {
  const preflight = pc1Preflight(state, vehicleIds)
  if (!preflight.ok) return { ok: false, issues: preflight.issues }
  const ids = unique(vehicleIds.map(Number)), selected = new Set(ids)
  const vehicles = state.vehicleRepairs.filter(row => selected.has(row.id)).sort((a,b) => time(a.plannedEntryAt) - time(b.plannedEntryAt) || b.priority - a.priority || a.id - b.id)
  const finish = time(deadline)
  if (!Number.isFinite(finish) || vehicles.some(vehicle => finish <= time(vehicle.plannedEntryAt))) return { ok: false, issues: ['最晚完成时间必须晚于所有所选车辆的计划入段时间'] }
  const preview = { schemaVersion: 2, vehicleRepairIds: ids, deadline: formatLocalDateTime(finish), createdAt: formatLocalDateTime(new Date()), sourceSignature: pc1SourceSignature(state), needsRecompute: false, schedules: [], employeeAssignments: [], equipmentAssignments: [], componentAssignments: [] }
  const previousRows = previous?.schedules || []
  let scheduleId = Math.max(nextId(state.schedules), nextId(previousRows))
  const jobs = vehicles.flatMap(vehicle => tasksFor(state, vehicle).map(task => {
    const saved = previousRows.find(row => row.vehicleRepairId === vehicle.id && row.taskId === task.id) || formalRows(state).find(row => row.vehicleRepairId === vehicle.id && row.taskId === task.id && row.isLocked)
    return { vehicle, task, saved, id: saved?.id || scheduleId++, key: `${vehicle.id}:${task.id}` }
  }))
  // A preview has its own IDs; a formal task ID must not be reused for a second car.
  if (new Set(jobs.map(job => job.id)).size !== jobs.length) for (const job of jobs) job.id = scheduleId++
  const book = resourceBook(state, selected), done = new Map(), allocations = new Map(), errors = []
  for (const job of jobs.filter(job => job.saved?.isLocked)) {
    const start = time(job.saved.plannedStartAt), end = start + job.task.duration * MINUTE
    const allocation = allocate(state, book, job.task, start, end)
    if (allocation) { allocations.set(job.key, allocation); reserveAllocation(book, allocation, start, end) }
    else errors.push(`${job.vehicle.locomotiveNo} · ${job.task.name}的锁定时间存在资源或工作日冲突`)
  }
  let pending = [...jobs]
  while (pending.length) {
    const ready = pending.filter(job => state.dependencies.filter(dep => dep.childTaskId === job.task.id).every(dep => done.has(`${job.vehicle.id}:${dep.parentTaskId}`)))
    if (!ready.length) { errors.push('工艺前后置依赖存在循环或缺少前置工序'); break }
    const candidates = ready.map(job => {
      const deps = state.dependencies.filter(dep => dep.childTaskId === job.task.id)
      const earliest = Math.max(time(job.vehicle.plannedEntryAt), ...deps.map(dep => time(done.get(`${job.vehicle.id}:${dep.parentTaskId}`).plannedEndAt) + (dep.lagMinutes || 0) * MINUTE))
      if (job.saved?.isLocked) return { job, start: time(job.saved.plannedStartAt), earliest, allocation: allocations.get(job.key) }
      let start = earliest, allocation
      for (let attempt = 0; attempt < 10000; attempt++) {
        allocation = allocate(state, book, job.task, start, start + job.task.duration * MINUTE)
        if (allocation) break
        start = book.next(start, start + job.task.duration * MINUTE)
        if (start > finish + 366 * DAY) break
      }
      return { job, start, earliest, allocation }
    }).sort((a,b) => a.start - b.start || time(a.job.vehicle.plannedEntryAt) - time(b.job.vehicle.plannedEntryAt) || a.job.task.id - b.job.task.id)
    const { job, start, earliest, allocation } = candidates[0]
    const end = start + job.task.duration * MINUTE
    if (!allocation) errors.push(`${job.vehicle.locomotiveNo} · ${job.task.name}无法分配可用资源`)
    if (start < earliest) errors.push(`${job.vehicle.locomotiveNo} · ${job.task.name}的锁定时间早于前置任务完成或车辆入段`)
    const row = { id: job.id, vehicleRepairId: job.vehicle.id, taskId: job.task.id, versionId: null, workstationId: job.task.workstationId, plannedStartAt: formatLocalDateTime(start), plannedEndAt: formatLocalDateTime(end), actualStartAt: null, actualEndAt: null, status: 'NOT_STARTED', isLocked: !!job.saved?.isLocked, delayMinutes: 0, remark: 'PC1模拟排程' }
    preview.schedules.push(row); done.set(job.key, row)
    if (allocation) {
      if (!row.isLocked) reserveAllocation(book, allocation, start, end)
      preview.employeeAssignments.push(...allocation.employees.map(id => ({ id: preview.employeeAssignments.length + 1 + allocation.employees.indexOf(id), scheduleTaskId: row.id, employeeId: id, source: 'AUTO', status: 'ASSIGNED', assignedAt: preview.createdAt })))
      preview.equipmentAssignments.push(...allocation.equipment.map(id => ({ id: preview.equipmentAssignments.length + 1 + allocation.equipment.indexOf(id), scheduleTaskId: row.id, equipmentId: id, startAt: row.plannedStartAt, endAt: row.plannedEndAt, status: 'ASSIGNED' })))
      preview.componentAssignments.push(...allocation.components.map((item,index) => ({ id: preview.componentAssignments.length + index + 1, scheduleTaskId: row.id, componentInstanceId: item.id, action: item.action, source: 'AUTO', status: 'ASSIGNED' })))
    }
    pending = pending.filter(item => item !== job)
  }
  preview.generationIssues = unique(errors)
  preview.issues = pc1PreviewIssues(state, preview)
  return { ok: true, preview, issues: preview.issues }
}

export function pc1PreviewIssues(state, preview = state.pc1SchedulePreview) {
  if (!preview) return ['尚未生成模拟排程']
  const selected = new Set(preview.vehicleRepairIds), issues = [...(preview.generationIssues || [])]
  if (preview.sourceSignature !== pc1SourceSignature(state)) issues.push('计划、资源或正式排程已有变化，请重新模拟')
  if (preview.needsRecompute) issues.push('任务已调整，请重新模拟后再确认')
  if (!Number.isFinite(time(preview.deadline))) issues.push('模拟排程缺少有效的最晚完成时间')
  const report = buildResourceReport({ ...state, pc1SchedulePreview: preview }, preview.vehicleRepairIds)
  issues.push(...report.issues.map(row => row.message))
  if (report.shortageCount) issues.push('人员、工具或物料仍存在缺口')
  if (report.pendingAssignments.length) issues.push('部分任务尚未分配到足够的可用人员')
  const book = resourceBook(state, selected)
  const rows = preview.schedules
  if (new Set(rows.map(row => row.id)).size !== rows.length) issues.push('模拟任务编号重复')
  for (const vehicleId of selected) {
    const vehicle = state.vehicleRepairs.find(row => row.id === vehicleId)
    if (!vehicle || !canPlanVehicle(state, vehicle)) { issues.push('所选车辆已不存在、已开工或已结束'); continue }
    for (const task of tasksFor(state, vehicle)) if (rows.filter(row => row.vehicleRepairId === vehicleId && row.taskId === task.id).length !== 1) issues.push(`${vehicle.locomotiveNo} · ${task.name}的模拟任务缺失或重复`)
  }
  for (const row of rows) {
    const task = state.tasks.find(task => task.id === row.taskId), vehicle = state.vehicleRepairs.find(vehicle => vehicle.id === row.vehicleRepairId)
    const label = `${vehicle?.locomotiveNo || '车辆'} · ${task?.name || '工序'}`
    if (!task || !vehicle || !selected.has(row.vehicleRepairId) || task.repairProgramId !== vehicle.repairProgramId || task.status === 'DISABLED') { issues.push(`${label}的工序关联无效`); continue }
    const start = time(row.plannedStartAt), end = time(row.plannedEndAt)
    if (!Number.isFinite(start) || end - start !== task.duration * MINUTE || start < time(vehicle.plannedEntryAt) || row.workstationId !== task.workstationId || row.status !== 'NOT_STARTED') issues.push(`${label}的任务时间、工位或状态无效`)
    if (end > time(preview.deadline)) issues.push(`${label}超过最晚完成时间`)
    if (book.holidayEnd(start, end)) issues.push(`${label}占用了已配置的非工作日`)
    for (const dep of state.dependencies.filter(dep => dep.childTaskId === row.taskId)) {
      const parent = rows.find(parent => parent.vehicleRepairId === row.vehicleRepairId && parent.taskId === dep.parentTaskId)
      if (!parent || start < time(parent.plannedEndAt) + (dep.lagMinutes || 0) * MINUTE) issues.push(`${label}不满足前置工序及工艺等待时间`)
    }
    const uses = [[`station:${row.workstationId}`, 1], ...state.toolRequirements.filter(req => req.taskId === row.taskId).map(req => [`tool:${req.toolId}`, req.quantity])]
    for (const [collection, field, kind] of [['employeeAssignments','employeeId','employee'],['equipmentAssignments','equipmentId','equipment'],['componentAssignments','componentInstanceId','component']]) {
      const assignments = (preview[collection] || []).filter(assignment => assignment.scheduleTaskId === row.id && active(assignment))
      if (new Set(assignments.map(item => item[field])).size !== assignments.length) issues.push(`${label}存在重复资源安排`)
      uses.push(...assignments.map(item => [`${kind}:${item[field]}`, 1]))
      if (kind === 'equipment') for (const req of state.equipmentRequirements.filter(req => req.taskId === row.taskId)) if (assignments.filter(item => state.equipment.find(equipment => equipment.id === item.equipmentId)?.type === req.equipmentType).length !== req.quantity) issues.push(`${label}的设备安排不完整`)
      if (kind === 'component') for (const req of state.componentRequirements.filter(req => req.taskId === row.taskId)) if (assignments.filter(item => state.componentInstances.find(component => component.id === item.componentInstanceId)?.typeId === req.componentTypeId && item.action === req.action).length !== req.quantity) issues.push(`${label}的配件安排不完整`)
    }
    if (!uses.every(([key, quantity]) => book.fits(key, start, end, quantity))) issues.push(`${label}与其他任务或不可用资源冲突`)
    for (const [key, quantity] of uses) book.reserve(key, start, end, quantity)
  }
  return unique(issues)
}

export function movePc1Task(state, scheduleTaskId, value) {
  const preview = state.pc1SchedulePreview, row = preview?.schedules.find(row => row.id === Number(scheduleTaskId))
  if (!row) return { ok: false, message: '请选择模拟任务进行调整' }
  if (preview.sourceSignature !== pc1SourceSignature(state)) return { ok: false, message: '数据已有变化，请先重新模拟' }
  if (row.isLocked) return { ok: false, message: '此任务已锁定，请先解锁再调整' }
  const task = state.tasks.find(task => task.id === row.taskId), vehicle = state.vehicleRepairs.find(vehicle => vehicle.id === row.vehicleRepairId)
  const start = time(value), end = start + task.duration * MINUTE
  if (!Number.isFinite(start) || start < time(vehicle.plannedEntryAt) || end > time(preview.deadline)) return { ok: false, message: '调整时间须在车辆入段后，并在最晚完成时间前结束' }
  row.plannedStartAt = formatLocalDateTime(start); row.plannedEndAt = formatLocalDateTime(end)
  row.isLocked = true; preview.needsRecompute = true
  preview.issues = pc1PreviewIssues(state, preview)
  return { ok: true, message: '已暂时锁定调整后的时间，请重新模拟其他任务' }
}

export function togglePc1Lock(state, scheduleTaskId) {
  const row = state.pc1SchedulePreview?.schedules.find(row => row.id === Number(scheduleTaskId))
  if (!row) return false
  row.isLocked = !row.isLocked
  return row.isLocked
}

export function confirmPc1Preview(state, submission={}) {
  const preview = state.pc1SchedulePreview, issues = pc1PreviewIssues(state, preview)
  if (issues.length) return { ok: false, issues }
  const next = structuredClone(state), selected = new Set(preview.vehicleRepairIds), idMap = new Map(), versions = new Map()
  let versionId = nextId(next.scheduleVersions), scheduleId = nextId(next.schedules)
  const publishedAt = formatLocalDateTime(new Date())
  for (const vehicle of next.vehicleRepairs.filter(vehicle => selected.has(vehicle.id))) {
    const version = { id: versionId++, vehicleRepairId: vehicle.id, versionNo: Math.max(0, ...next.scheduleVersions.filter(row => row.vehicleRepairId === vehicle.id).map(row => Number(row.versionNo) || 0)) + 1, parentVersionId: vehicle.currentVersionId || null, reason: '排程模拟确认，等待月度计划审批', status: 'DRAFT', createdAt: publishedAt, publishedAt: null }
    next.scheduleVersions.push(version); versions.set(vehicle.id, version)
    vehicle.currentVersionId = version.id; vehicle.status = 'SCHEDULED'; vehicle.approvalStatus = 'SUBMITTED'
  }
  const confirmed = preview.schedules.map(row => {
    const id = scheduleId++; idMap.set(row.id, id)
    return { ...row, id, versionId: versions.get(row.vehicleRepairId).id, remark: '排程已确认，等待月度计划审批' }
  })
  next.schedules.push(...confirmed)
  for (const collection of ['employeeAssignments','equipmentAssignments','componentAssignments']) {
    let id = nextId(next[collection])
    next[collection].push(...preview[collection].map(row => ({ ...row, id: id++, scheduleTaskId: idMap.get(row.scheduleTaskId), ...(collection === 'employeeAssignments' ? { assignedAt: publishedAt } : {}) })))
  }
  next.exceptions = next.exceptions.filter(row => !selected.has(row.vehicleRepairId) || row.status !== 'OPEN')
  next.planApprovalFlows ||= []
  let flowId = nextId(next.planApprovalFlows)
  for (const vehicle of next.vehicleRepairs.filter(vehicle => selected.has(vehicle.id))) {
    const existing = next.planApprovalFlows.find(flow => flow.entityType === 'MONTHLY' && flow.entityId === vehicle.id && ['SUBMITTED','REVIEWED'].includes(flow.status))
    if (existing) continue
    const defaultNote=`${vehicle.locomotiveNo}排程已确认，共${confirmed.filter(row=>row.vehicleRepairId===vehicle.id).length}项工序，申请主管科长审核。`
    next.planApprovalFlows.push({ id:flowId++, entityType:'MONTHLY', entityId:vehicle.id, status:'SUBMITTED', submittedAt:publishedAt, updatedAt:publishedAt, planName:String(submission.planName||`${String(vehicle.plannedEntryAt).slice(0,7)}月度检修计划`).trim().slice(0,100), submitterDepartment:String(submission.submitterDepartment||'计划编制').trim().slice(0,100), note:String(submission.note||defaultNote).trim().slice(0,500), history:[{ action:'SUBMIT', at:publishedAt, comment:String(submission.note||'检修排程确认后提交月度计划审核').trim().slice(0,500) }] })
  }
  next.lastScheduleRunAt = publishedAt; next.selectedVehicleRepairId = preview.vehicleRepairIds[0]
  next.activityLog.unshift({ id: nextId(next.activityLog), time: publishedAt, type: '排程', text: `确认${selected.size}辆机车模拟排程，已提交月度计划审核` })
  delete next.pc1SchedulePreview
  Object.assign(state, next); delete state.pc1SchedulePreview
  return { ok: true, vehicleIds: [...selected], schedules: confirmed.length, approvalFlows: next.planApprovalFlows.filter(row => selected.has(row.entityId) && row.entityType === 'MONTHLY' && row.status === 'SUBMITTED').length, dispatches: 0 }
}

export function publishApprovedPc1Plan(state, vehicleRepairId, now=new Date()) {
  const vehicle=state.vehicleRepairs.find(row=>row.id===Number(vehicleRepairId))
  const version=state.scheduleVersions.find(row=>row.id===vehicle?.currentVersionId&&row.vehicleRepairId===vehicle.id)
  if(!vehicle||!version)return {ok:false,message:'审批关联的排程版本不存在'}
  if(version.status==='PUBLISHED')return {ok:true,dispatches:(state.pc1Dispatches||[]).filter(row=>row.versionId===version.id).length}
  for(const old of state.scheduleVersions.filter(row=>row.vehicleRepairId===vehicle.id&&row.id!==version.id&&row.status==='PUBLISHED'))old.status='ARCHIVED'
  const publishedAt=formatLocalDateTime(now);version.status='PUBLISHED';version.publishedAt=publishedAt
  state.pc1Dispatches||=[];let dispatchId=nextId(state.pc1Dispatches),created=0
  const confirmed=state.schedules.filter(row=>row.vehicleRepairId===vehicle.id&&row.versionId===version.id&&row.status!=='CANCELLED')
  for(const team of state.teams){
    if(state.pc1Dispatches.some(row=>row.versionId===version.id&&row.teamId===team.id))continue
    const rows=confirmed.filter(row=>state.teamRequirements.some(req=>req.taskId===row.taskId&&req.teamId===team.id))
    if(!rows.length)continue
    const rowIds=new Set(rows.map(row=>row.id)),taskIds=new Set(rows.map(row=>row.taskId))
    state.pc1Dispatches.push({id:dispatchId++,vehicleRepairId:vehicle.id,versionId:version.id,teamId:team.id,publishedAt,scheduleTaskIds:[...rowIds],employeeIds:unique(state.employeeAssignments.filter(row=>rowIds.has(row.scheduleTaskId)&&state.employees.find(employee=>employee.id===row.employeeId)?.teamId===team.id).map(row=>row.employeeId)),tools:structuredClone(state.toolRequirements.filter(row=>taskIds.has(row.taskId))),materials:structuredClone(state.materialRequirements.filter(row=>taskIds.has(row.taskId))),components:structuredClone(state.componentRequirements.filter(row=>taskIds.has(row.taskId)))});created++
  }
  vehicle.status='SCHEDULED';vehicle.approvalStatus='PUBLISHED';state.published=true;state.lastScheduleRunAt=publishedAt
  state.activityLog.unshift({id:nextId(state.activityLog),time:publishedAt,type:'审批',text:`${vehicle.locomotiveNo}月度计划审批发布，正式下发${created}份班组任务清单`})
  return {ok:true,dispatches:created}
}
