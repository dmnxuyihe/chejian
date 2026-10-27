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
  for (const key of ['tab', 'month', 'vehicleFilter', 'day', 'ganttRange', 'dataToolsOpen']) {
    if (view[key] !== undefined) result[key] = view[key]
  }
  return result
}

function snapshotData(state) {
  const data = Object.fromEntries(keys.filter(k => state[k] !== undefined).map(k => [k, k === 'planningView' ? cleanView(state[k]) : state[k]]))
  return JSON.parse(JSON.stringify(data))
}

function validateData(data) {
  if (!object(data)) throw new Error('备份中缺少演示数据')
  for (const [key, value] of Object.entries(defaults)) {
    if (Array.isArray(value)) {
      if (!Array.isArray(data[key]) || data[key].length > 50000 || data[key].some(row => !object(row))) throw new Error(`备份中的${key}数据格式无效`)
      if (value[0]?.id !== undefined && !['activityLog', 'exceptions'].includes(key)) {
        const ids = data[key].map(row => row.id)
        if (ids.some(id => !positiveId(id)) || new Set(ids).size !== ids.length) throw new Error(`备份中的${key}编号重复或无效`)
      }
    } else if (object(value)) {
      if (!object(data[key])) throw new Error(`备份中的${key}格式无效`)
    } else if (value !== null && typeof data[key] !== typeof value && !(key.startsWith('selected') && data[key] === null)) throw new Error(`备份中的${key}类型无效`)
  }
  const ids = key => new Set(data[key].map(v => v.id))
  const vehicles = ids('vehicleRepairs'), tasks = ids('tasks'), stations = ids('workstations'), versions = ids('scheduleVersions')
  for (const row of data.vehicleRepairs) {
    if (typeof row.locomotiveNo !== 'string' || !row.locomotiveNo.trim() || !validDate(row.plannedEntryAt) || !validDate(row.plannedExitAt) || new Date(row.plannedExitAt) <= new Date(row.plannedEntryAt) ||
      !Number.isFinite(row.priority) || !Number.isFinite(row.mileageKm) || typeof row.status !== 'string' || (row.currentVersionId != null && !versions.has(row.currentVersionId))) throw new Error('车辆计划日期、状态或排程版本无效')
  }
  for (const row of data.scheduleVersions) if (!vehicles.has(row.vehicleRepairId) || !['DRAFT', 'PUBLISHED'].includes(row.status)) throw new Error('排程版本与车辆不匹配')
  if (data.vehicleRepairs.some(row => row.currentVersionId != null && !data.scheduleVersions.some(v => v.id === row.currentVersionId && v.vehicleRepairId === row.id))) throw new Error('当前排程版本不属于该车辆')
  function validSchedule(row, preview = false) {
    return object(row) && positiveId(row.id) && vehicles.has(row.vehicleRepairId) && tasks.has(row.taskId) && stations.has(row.workstationId) &&
      validDate(row.plannedStartAt) && validDate(row.plannedEndAt) && new Date(row.plannedEndAt) >= new Date(row.plannedStartAt) &&
      typeof row.status === 'string' && (row.isLocked == null || typeof row.isLocked === 'boolean') &&
      (preview || row.versionId == null || versions.has(row.versionId))
  }
  if (!data.schedules.every(row => validSchedule(row))) throw new Error('任务的车辆、工序、工位或日期无效')
  const schedules = ids('schedules')
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
  }
  if (data.pc1SchedulePreview !== undefined) {
    const preview = data.pc1SchedulePreview
    if (!object(preview) || !Array.isArray(preview.vehicleRepairIds) || !Array.isArray(preview.schedules) || preview.vehicleRepairIds.some(id => !vehicles.has(id)) || preview.schedules.length > 50000 ||
      preview.schedules.some(row => !validSchedule(row, true) || !preview.vehicleRepairIds.includes(row.vehicleRepairId)) || new Set(preview.schedules.map(s => s.id)).size !== preview.schedules.length) throw new Error('模拟排程备份存在无效关联')
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
