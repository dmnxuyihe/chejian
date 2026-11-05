import { milestoneError } from './vehicle-operations.js'
import { createState } from './state.js'

export const DEMO_STORAGE_KEY = 'rail-maintenance.pc1-demo.v1'
const FORMAT = 'rail-maintenance-pc1'
const defaults = createState()
const keys = [...Object.keys(defaults), 'planningView', 'pc1SchedulePreview']
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const validDate = value => typeof value === 'string' && Number.isFinite(new Date(value).getTime())
const positiveId = value => Number.isSafeInteger(value) && value > 0

function cleanView(view) {
  if (!object(view)) return undefined
  const result = {}
  for (const key of ['tab', 'month', 'vehicleFilter', 'day', 'ganttRange', 'dataToolsOpen', 'resourceVehicleIds', 'resourceListTab', 'importMonth', 'importType', 'annualYear']) {
    if (view[key] !== undefined) result[key] = view[key]
  }
  return result
}

function snapshotData(state) {
  const data = Object.fromEntries(keys.filter(k => state[k] !== undefined).map(k => [k, k === 'planningView' ? cleanView(state[k]) : state[k]]))
  return JSON.parse(JSON.stringify(data))
}

function validateData(data) {
  if (data?.planningDemoSeedVersion === undefined) data.planningDemoSeedVersion = 0
  if (!object(data)) throw new Error('备份中缺少演示数据')
  for (const key of ['maintenanceRecords', 'pc1Dispatches']) if (data[key] === undefined) data[key] = []
  for(const key of ['temporaryRepairPlans','componentTemporaryPlans','planApprovalFlows','annualPlanAdjustments','componentMonthlyPlanRecords','monthlyVerificationRecords','monthlyPlanAdjustmentHistory'])if(data[key]===undefined)data[key]=[]
  // Upgrade pre-resource-list backups once; a deliberately empty new-format
  // requirement list remains empty.
  for (const [key, inventory, idField] of [['toolRequirements', 'tools', 'toolId'], ['materialRequirements', 'materials', 'materialId']]) {
    if (data[key] !== undefined || !Array.isArray(data[inventory])) continue
    const idsByDefaultId = new Map()
    for (const requirement of defaults[key]) {
      const source = defaults[inventory].find(row => row.id === requirement[idField])
      if (!source || idsByDefaultId.has(source.id)) continue
      let resource = data[inventory].find(row => row.name === source.name)
      if (!resource) {
        resource = { ...structuredClone(source), id: Math.max(0, ...data[inventory].map(row => Number(row.id) || 0)) + 1 }
        data[inventory].push(resource)
      }
      idsByDefaultId.set(source.id, resource.id)
    }
    data[key] = defaults[key].filter(row => data.tasks?.some(task => task.id === row.taskId))
      .map(row => ({ ...structuredClone(row), [idField]: idsByDefaultId.get(row[idField]) }))
  }
  for (const [key, value] of Object.entries(defaults)) {
    if (Array.isArray(value)) {
      if (!Array.isArray(data[key]) || data[key].length > 50000 || data[key].some(row => !object(row))) throw new Error(`备份中的${key}数据格式无效`)
      if (value[0]?.id !== undefined && !['activityLog', 'exceptions'].includes(key)) {
        const ids = data[key].map(row => row.id)
        if (ids.some(id => !positiveId(id)) || new Set(ids).size !== ids.length) throw new Error(`备份中的${key}编号重复或无效`)
      }
    } else if (['toolRequirements', 'partRequirements', 'materialRequirements', 'approvalRecords', 'componentMovements'].includes(key) && data[key] === undefined) {
      data[key] = []
    } else if (object(value)) {
      if (!object(data[key])) throw new Error(`备份中的${key}格式无效`)
    } else if (value !== null && typeof data[key] !== typeof value && !(key.startsWith('selected') && data[key] === null)) throw new Error(`备份中的${key}类型无效`)
  }
  const ids = key => new Set(data[key].map(v => v.id))
  const vehicles = ids('vehicleRepairs'), tasks = ids('tasks'), stations = ids('workstations'), versions = ids('scheduleVersions')
  for (const row of data.vehicleRepairs) {
    if (typeof row.locomotiveNo !== 'string' || !row.locomotiveNo.trim() || !validDate(row.plannedEntryAt) ||
      (row.plannedExitAt != null && (!validDate(row.plannedExitAt) || new Date(row.plannedExitAt) <= new Date(row.plannedEntryAt))) ||
      !Number.isFinite(row.priority) || (row.mileageKm != null && !Number.isFinite(row.mileageKm)) || typeof row.status !== 'string' || (row.currentVersionId != null && !versions.has(row.currentVersionId))) throw new Error('车辆计划日期、状态或排程版本无效')
  }
  if (new Set(data.temporaryRepairPlans.map(row => row.id)).size !== data.temporaryRepairPlans.length) throw new Error('整车临修计划编号重复')
  for (const row of data.temporaryRepairPlans) {
    if (!positiveId(row.id) || typeof row.locomotiveNo !== 'string' || !row.locomotiveNo.trim() || !data.locomotiveModels.some(model => model.id === row.modelId) || typeof row.ownerDepot !== 'string' || !row.ownerDepot.trim() || !validDate(row.plannedEntryAt) || !validDate(row.plannedPlatformAt) || new Date(row.plannedPlatformAt) < new Date(row.plannedEntryAt) || typeof row.content !== 'string' || !row.content.trim() || row.content.length > 1000 || !['DRAFT','SUBMITTED','APPROVED','PUBLISHED'].includes(row.status)) throw new Error('整车临修计划内容无效')
    const file = row.solutionAttachment
    if (file != null && (!object(file) || typeof file.name !== 'string' || file.name.length > 128 || !['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg','image/webp'].includes(file.mimeType) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > 2 * 1024 * 1024 || typeof file.contentBase64 !== 'string' || file.contentBase64.length > 3 * 1024 * 1024)) throw new Error('临修方案附件格式无效或超过2MB')
  }
  const uniqueIds = (rows,label) => { if (rows.some(row=>!positiveId(row.id)) || new Set(rows.map(row=>row.id)).size!==rows.length) throw new Error(`${label}编号重复或无效`) }
  uniqueIds(data.componentTemporaryPlans,'配件临修计划');uniqueIds(data.planApprovalFlows,'计划审批记录');uniqueIds(data.annualPlanAdjustments,'年度调整记录');uniqueIds(data.componentMonthlyPlanRecords,'配件月计划');uniqueIds(data.monthlyVerificationRecords,'月度交验记录')
  uniqueIds(data.monthlyPlanAdjustmentHistory,'月计划调整记录')
  for(const row of data.componentTemporaryPlans){if(typeof row.name!=='string'||!row.name||!data.locomotiveModels.some(model=>model.id===row.modelId)||typeof row.serialNo!=='string'||!row.serialNo||typeof row.specification!=='string'||!validDate(row.plannedEntryAt)||typeof row.content!=='string'||!row.content||!['DRAFT','SUBMITTED','APPROVED','PUBLISHED'].includes(row.status))throw new Error('配件临修计划内容无效');const file=row.solutionAttachment;if(file!=null&&(!object(file)||typeof file.name!=='string'||typeof file.contentBase64!=='string'||!Number.isSafeInteger(file.bytes)||file.bytes<=0||file.bytes>2*1024*1024))throw new Error('配件临修方案附件无效')}
  for(const row of data.planApprovalFlows){if(!['MONTHLY','TEMP_VEHICLE','TEMP_COMPONENT','COMPONENT_UP'].includes(row.entityType)||!positiveId(row.entityId)||!['SUBMITTED','REVIEWED','REJECTED','PUBLISHED'].includes(row.status)||!validDate(row.submittedAt)||!validDate(row.updatedAt)||!Array.isArray(row.history))throw new Error('计划审批流程记录无效')}
  for(const row of data.annualPlanAdjustments)if(!Number.isInteger(row.year)||!Number.isInteger(row.month)||row.month<1||row.month>12||!data.locomotiveModels.some(x=>x.id===row.modelId)||!data.repairPrograms.some(x=>x.id===row.programId)||!['baseline','adjusted','actual','deliveryDays'].every(key=>Number.isFinite(row[key])&&row[key]>=0))throw new Error('年度计划调整记录无效')
  for(const row of data.componentMonthlyPlanRecords)if(!/^\d{4}-\d{2}$/.test(row.month)||!['DOWN','UP'].includes(row.direction)||!data.componentTypes.some(x=>x.id===row.componentTypeId)||!['planned','calculated','mileageKm'].every(key=>Number.isFinite(row[key])&&row[key]>=0)||!['DRAFT','SUBMITTED','APPROVED','PUBLISHED'].includes(row.status))throw new Error('配件月计划记录无效')
  for(const row of data.monthlyVerificationRecords)if(!vehicles.has(row.vehicleRepairId)||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||typeof row.depot!=='string'||!row.depot||!['PASSED','FAILED','PENDING'].includes(row.result))throw new Error('月度交验记录无效')
  for(const row of data.monthlyPlanAdjustmentHistory)if(!vehicles.has(row.vehicleRepairId)||typeof row.reason!=='string'||!row.reason||!validDate(row.requestedAt)||typeof row.previousApprovalStatus!=='string')throw new Error('月计划调整记录无效')
  for (const vehicle of data.vehicleRepairs) {
    if(['actualEntryAt','actualExitAt','onStandAt'].some(key=>vehicle[key]!=null && !validDate(vehicle[key]))) throw new Error('车辆实际时间无效')
    const error=milestoneError(vehicle,vehicle.actualEntryAt??null,vehicle.onStandAt??null,data.schedules.filter(row=>row.vehicleRepairId===vehicle.id))
    // Old snapshots may have task timestamps without reception data. Preserve those records.
    if((vehicle.onStandAt || vehicle.lifecycleHistory?.length) && error) throw new Error(error)
  }
  for (const row of data.scheduleVersions) if (!vehicles.has(row.vehicleRepairId) || !['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(row.status)) throw new Error('排程版本与车辆不匹配')
  if (data.vehicleRepairs.some(row => row.currentVersionId != null && !data.scheduleVersions.some(v => v.id === row.currentVersionId && v.vehicleRepairId === row.id))) throw new Error('当前排程版本不属于该车辆')
  function validSchedule(row, preview = false) {
    return object(row) && positiveId(row.id) && vehicles.has(row.vehicleRepairId) && tasks.has(row.taskId) && stations.has(row.workstationId) &&
      validDate(row.plannedStartAt) && validDate(row.plannedEndAt) && new Date(row.plannedEndAt) >= new Date(row.plannedStartAt) &&
      typeof row.status === 'string' && (row.isLocked == null || typeof row.isLocked === 'boolean') &&
      (preview || row.versionId == null || versions.has(row.versionId))
  }
  if (!data.schedules.every(row => validSchedule(row))) throw new Error('任务的车辆、工序、工位或日期无效')
  const schedules = ids('schedules')
  for (const key of ['maintenanceRecords', 'pc1Dispatches']) {
    const values = data[key].map(row => row.id)
    if (values.some(id => !positiveId(id)) || new Set(values).size !== values.length) throw new Error('检修记录或任务下发编号无效')
  }
  for (const row of data.maintenanceRecords) {
    const schedule = data.schedules.find(item => item.id === row.scheduleTaskId && item.vehicleRepairId === row.vehicleRepairId && item.taskId === row.taskId)
    if (!schedule || schedule.status !== 'COMPLETED' || !data.scheduleVersions.some(version => version.id === schedule.versionId && ['PUBLISHED','ARCHIVED'].includes(version.status)) || !validDate(row.submittedAt) || typeof row.submittedBy !== 'string' || typeof row.notes !== 'string' || !Array.isArray(row.measurements) || row.measurements.length > 100 || row.measurements.some(item => !object(item) || typeof item.name !== 'string' || !['string','number'].includes(typeof item.value) || typeof item.unit !== 'string') || !Array.isArray(row.attachments) || row.attachments.length > 12) throw new Error('已完成任务的检修记录关联或内容无效')
    if (row.attachments.some(item => !object(item) || !/^[a-f0-9-]{36}$/.test(item.id) || item.url !== `/api/pc1/attachments/${item.id}` || typeof item.name !== 'string' || !['image/png','image/jpeg','image/webp','video/mp4','video/webm'].includes(item.mimeType) || !Number.isSafeInteger(item.bytes) || item.bytes <= 0)) throw new Error('检修记录的图片或视频格式无效')
  }
  for (const row of data.pc1Dispatches) {
    if (!vehicles.has(row.vehicleRepairId) || !data.scheduleVersions.some(version => version.id === row.versionId && version.vehicleRepairId === row.vehicleRepairId) || !data.teams.some(team => team.id === row.teamId) || !validDate(row.publishedAt) || !Array.isArray(row.scheduleTaskIds) || row.scheduleTaskIds.some(id => !data.schedules.some(task => task.id === id && task.vehicleRepairId === row.vehicleRepairId && task.versionId === row.versionId)) || !Array.isArray(row.employeeIds) || row.employeeIds.some(id => !data.employees.some(employee => employee.id === id && employee.teamId === row.teamId)) || ['tools','materials','components'].some(key => !Array.isArray(row[key]))) throw new Error('班组任务下发的车辆、版本或资源关联无效')
  }
  for (const [key, collection, idField] of [['toolRequirements', 'tools', 'toolId'], ['materialRequirements', 'materials', 'materialId']]) {
    if (data[key].some(row => !tasks.has(row.taskId) || !data[collection].some(resource => resource.id === row[idField]) || !Number.isFinite(row.quantity) || row.quantity <= 0 || (key === 'toolRequirements' && !Number.isInteger(row.quantity)))) throw new Error('工具或物料需求存在无效关联或数量')
    const pairs = data[key].map(row => `${row.taskId}:${row[idField]}`)
    if (new Set(pairs).size !== pairs.length) throw new Error('同一任务的工具或物料需求重复')
  }
  for (const [key, resourceKey, field] of [['employeeAssignments', 'employees', 'employeeId'], ['equipmentAssignments', 'equipment', 'equipmentId'], ['componentAssignments', 'componentInstances', 'componentInstanceId']]) {
    const resourceIds = ids(resourceKey)
    if (data[key].some(row => !schedules.has(row.scheduleTaskId) || !resourceIds.has(row[field]))) throw new Error('任务资源分配存在无效关联')
  }
  for (const task of data.tasks) if (typeof task.name !== 'string' || typeof task.process !== 'string' || !Number.isFinite(task.duration)) throw new Error('工序数据格式无效')
  if (data.planningView !== undefined) {
    const view = data.planningView
    if (!object(view) || !['monthly', 'vehicle', 'workshop'].includes(view.tab) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(view.month) || view.month < '1900-01' || view.month > '2199-12' ||
      typeof view.vehicleFilter !== 'string' || !/^\d*$/.test(view.vehicleFilter) || typeof view.day !== 'string' || (view.day && !/^\d{4}-\d{2}-\d{2}$/.test(view.day))) throw new Error('日历视图设置无效')
    if (view.ganttRange && (!object(view.ganttRange) || typeof view.ganttRange.key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(view.ganttRange.start) || !/^\d{4}-\d{2}-\d{2}$/.test(view.ganttRange.end) || view.ganttRange.start > view.ganttRange.end)) throw new Error('甘特图日期范围无效')
    if (view.resourceVehicleIds !== undefined && (!Array.isArray(view.resourceVehicleIds) || view.resourceVehicleIds.length > data.vehicleRepairs.length || view.resourceVehicleIds.some(id => !vehicles.has(id)) || new Set(view.resourceVehicleIds).size !== view.resourceVehicleIds.length)) throw new Error('资源核对的车辆选择无效')
    if (view.resourceListTab !== undefined && !['people', 'tools', 'materials'].includes(view.resourceListTab)) throw new Error('资源清单分类无效')
  }
  if (data.pc1SchedulePreview !== undefined) {
    const preview = data.pc1SchedulePreview
    if (!object(preview) || !Array.isArray(preview.vehicleRepairIds) || !Array.isArray(preview.schedules) || preview.vehicleRepairIds.some(id => !vehicles.has(id)) || preview.schedules.length > 50000 ||
      preview.schedules.some(row => !validSchedule(row, true) || !preview.vehicleRepairIds.includes(row.vehicleRepairId)) || new Set(preview.schedules.map(s => s.id)).size !== preview.schedules.length) throw new Error('模拟排程备份存在无效关联')
    if (preview.employeeAssignments !== undefined && (!Array.isArray(preview.employeeAssignments) || preview.employeeAssignments.length > 50000 || preview.employeeAssignments.some(row => !object(row) || !preview.schedules.some(schedule => schedule.id === row.scheduleTaskId && (row.vehicleRepairId == null || schedule.vehicleRepairId === row.vehicleRepairId)) || !data.employees.some(employee => employee.id === row.employeeId)) || new Set(preview.employeeAssignments.map(row => `${row.scheduleTaskId}:${row.employeeId}`)).size !== preview.employeeAssignments.length)) throw new Error('模拟人员安排与作业任务不匹配或存在重复')
    if (preview.schemaVersion === 2) {
      if (!validDate(preview.deadline) || typeof preview.sourceSignature !== 'string' || preview.sourceSignature.length > 6 * 1024 * 1024 || typeof preview.needsRecompute !== 'boolean' || !Array.isArray(preview.generationIssues) || !Array.isArray(preview.issues) || [...preview.generationIssues,...preview.issues].some(item => typeof item !== 'string')) throw new Error('模拟排程的截止时间或校验信息无效')
      for (const [key, collection, field] of [['equipmentAssignments','equipment','equipmentId'],['componentAssignments','componentInstances','componentInstanceId']]) {
        if (!Array.isArray(preview[key]) || preview[key].length > 50000 || preview[key].some(row => !object(row) || !preview.schedules.some(task => task.id === row.scheduleTaskId) || !data[collection].some(item => item.id === row[field]))) throw new Error('模拟设备或配件安排关联无效')
      }
    }
  }
  return data
}

export function exportDemoSnapshot(state) {
  const data = validateData(snapshotData(state))
  return { format: FORMAT, schemaVersion: 1, savedAt: new Date().toISOString(), data }
}

export function parseDemoSnapshot(text) {
  if (typeof text !== 'string' || text.length > 12 * 1024 * 1024) throw new Error('备份格式无效或超过12MB')
  let backup
  try { backup = JSON.parse(text) } catch { throw new Error('备份不是有效的JSON文件') }
  if (!object(backup) || backup.format !== FORMAT || backup.schemaVersion !== 1 || !validDate(backup.savedAt)) throw new Error('不是受支持的PC1演示备份')
  validateData(backup.data)
  return { format: FORMAT, schemaVersion: 1, savedAt: backup.savedAt, data: snapshotData(backup.data) }
}

export function applyDemoData(state, data) {
  // Preserve the shared state object, so all pages and integrations keep their reference.
  for (const key of keys) delete state[key]
  Object.assign(state, structuredClone(defaults), structuredClone(data))
  if (!state.vehicleRepairs.some(v => v.id === state.selectedVehicleRepairId)) state.selectedVehicleRepairId = state.vehicleRepairs[0]?.id ?? null
}

export function createDemoPersistence(state, storage) {
  let lastRaw = null, lastData = '', blocked = false
  const status = { ok: true, savedAt: null, message: '尚未保存' }
  const fail = message => { Object.assign(status, { ok: false, message }); return { ok: false, message } }
  const controller = {
    status,
    load() {
      try {
        lastRaw = storage.getItem(DEMO_STORAGE_KEY)
        if (!lastRaw) return { ok: true, restored: false }
        const backup = parseDemoSnapshot(lastRaw)
        applyDemoData(state, backup.data)
        lastData = JSON.stringify(snapshotData(state))
        Object.assign(status, { ok: true, savedAt: backup.savedAt, message: '已恢复本机演示记录' })
        return { ok: true, restored: true }
      } catch (error) {
        blocked = true
        return fail(`本地记录无法读取，原记录已保留。${error.message}`)
      }
    },
    save() {
      if (blocked) return { ok: false, message: status.message }
      try {
        if (storage.getItem(DEMO_STORAGE_KEY) !== lastRaw) { blocked = true; return fail('其他页面已更新演示记录，当前页暂停保存；请先导出备份或刷新页面。') }
        const data = snapshotData(state)
        const serialized = JSON.stringify(data)
        if (serialized === lastData && status.ok) return { ok: true, savedAt: status.savedAt }
        validateData(data)
        const backup = { format: FORMAT, schemaVersion: 1, savedAt: new Date().toISOString(), data }
        const raw = JSON.stringify(backup)
        storage.setItem(DEMO_STORAGE_KEY, raw)
        lastRaw = raw; lastData = serialized
        Object.assign(status, { ok: true, savedAt: backup.savedAt, message: '已自动保存在本机' })
        return { ok: true, savedAt: backup.savedAt }
      } catch (error) { return fail(`本机保存失败，当前页面数据仍保留，请导出备份。${error.message}`) }
    },
    restore(text) {
      try {
        const backup = parseDemoSnapshot(text)
        // Write successfully before replacing the live state; a failed restore changes neither.
        const raw = JSON.stringify(backup)
        storage.setItem(DEMO_STORAGE_KEY, raw)
        applyDemoData(state, backup.data)
        lastRaw = raw; lastData = JSON.stringify(snapshotData(state)); blocked = false
        Object.assign(status, { ok: true, savedAt: backup.savedAt, message: '已恢复备份并保存在本机' })
        return { ok: true }
      } catch (error) { return fail(`恢复失败，原数据未改变。${error.message}`) }
    },
    reset() { return controller.restore(JSON.stringify(exportDemoSnapshot(createState()))) },
    export() { return JSON.stringify(exportDemoSnapshot(state), null, 2) },
  }
  return controller
}
