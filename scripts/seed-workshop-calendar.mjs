import { loadConfig } from '../server/config.js'
import { createDatabase } from '../server/database.js'

const database = createDatabase(loadConfig())
const demo = [
  { locomotiveNo: 'TEST-CAL-001', entry: '2026-11-03T08:00:00', offsetDays: 33, versionStatus: 'PUBLISHED' },
  { locomotiveNo: 'TEST-CAL-002', entry: '2026-11-04T08:00:00', offsetDays: 34, versionStatus: 'DRAFT' },
]

const addDays = (value, days) => {
  const result = new Date(value)
  result.setDate(result.getDate() + days)
  return result.toISOString().slice(0, 19)
}

try {
  const loaded = await database.read()
  const data = loaded.snapshot.data
  const sourceVehicle = data.vehicleRepairs.find(vehicle => data.schedules.some(row => row.vehicleRepairId === vehicle.id))
  if (!sourceVehicle) throw new Error('数据库中没有可用于演示的排程任务')
  const sourceRows = data.schedules.filter(row => row.vehicleRepairId === sourceVehicle.id).slice(0, 8)
  let nextVehicleId = Math.max(0, ...data.vehicleRepairs.map(row => Number(row.id))) + 1
  let nextVersionId = Math.max(0, ...data.scheduleVersions.map(row => Number(row.id))) + 1
  let nextScheduleId = Math.max(0, ...data.schedules.map(row => Number(row.id))) + 1
  let insertedVehicles = 0, insertedTasks = 0, changed = false

  for (const item of demo) {
    let vehicle = data.vehicleRepairs.find(row => row.locomotiveNo === item.locomotiveNo)
    if (!vehicle) {
      vehicle = { ...sourceVehicle, id: nextVehicleId++, locomotiveNo: item.locomotiveNo, plannedEntryAt: item.entry, plannedExitAt: null, currentVersionId: null, status: 'SCHEDULED', approvalStatus: 'DRAFT', planSource: 'MONTHLY', remark: '车间任务日历开发测试数据' }
      data.vehicleRepairs.push(vehicle)
      insertedVehicles++; changed = true
    }
    let version = data.scheduleVersions.find(row => row.vehicleRepairId === vehicle.id)
    if (!version) {
      version = { ...data.scheduleVersions[0], id: nextVersionId++, vehicleRepairId: vehicle.id, versionNo: 1, status: item.versionStatus, remark: '车间任务日历演示版本' }
      data.scheduleVersions.push(version)
      changed = true
    } else if (version.status !== item.versionStatus) { version.status = item.versionStatus; changed = true }
    if (vehicle.currentVersionId !== version.id) { vehicle.currentVersionId = version.id; changed = true }
    if (vehicle.status !== 'SCHEDULED') { vehicle.status = 'SCHEDULED'; changed = true }
    if (!data.schedules.some(row => row.vehicleRepairId === vehicle.id)) {
      for (const source of sourceRows) {
        data.schedules.push({ ...source, id: nextScheduleId++, vehicleRepairId: vehicle.id, versionId: version.id, plannedStartAt: addDays(source.plannedStartAt, item.offsetDays), plannedEndAt: addDays(source.plannedEndAt, item.offsetDays), status: 'NOT_STARTED', isLocked: false })
        insertedTasks++; changed = true
      }
    }
  }
  const result = changed ? await database.save(loaded.revision, loaded.snapshot) : { revision: loaded.revision }
  console.log(JSON.stringify({ message: changed ? '车间任务日历演示数据已就绪' : '演示数据已存在，未重复写入', insertedVehicles, insertedTasks, revision: result.revision, vehicles: demo.map(row => row.locomotiveNo) }, null, 2))
} finally {
  await database.close()
}
