import { loadConfig } from '../server/config.js'
import { createDatabase } from '../server/database.js'

const samples = [
  ['HXD1C6101','西安机务段','2026-11-03','PASSED'],
  ['HXD1C6108','西安机务段','2026-11-08','PENDING'],
  ['HXD1C6116','西安机务段','2026-11-18','PENDING'],
  ['HXD1C6203','新丰镇机务段','2026-11-05','PASSED'],
  ['HXD1C6211','新丰镇机务段','2026-11-12','FAILED'],
  ['HXD1C6227','新丰镇机务段','2026-11-24','PENDING'],
  ['HXD1C6305','安康机务段','2026-11-07','PASSED'],
  ['HXD1C6312','安康机务段','2026-11-15','PENDING'],
  ['HXD1C6320','安康机务段','2026-11-26','PENDING'],
  ['HXD1C6406','延安机务段','2026-11-10','PASSED'],
  ['HXD1C6418','延安机务段','2026-11-20','PENDING'],
  ['HXD1C6425','延安机务段','2026-11-28','PENDING'],
]

const database = createDatabase(loadConfig())
try {
  const current = await database.read(), state = current.snapshot.data
  state.monthlyVerificationRecords ||= []
  state.planApprovalFlows ||= []
  let vehicleId = Math.max(0, ...state.vehicleRepairs.map(row => Number(row.id) || 0)) + 1
  let recordId = Math.max(0, ...state.monthlyVerificationRecords.map(row => Number(row.id) || 0)) + 1
  let flowId = Math.max(0, ...state.planApprovalFlows.map(row => Number(row.id) || 0)) + 1
  for (const [locomotiveNo, ownerDepot, date, result] of samples) {
    let vehicle = state.vehicleRepairs.find(row => row.locomotiveNo === locomotiveNo)
    if (!vehicle) {
      vehicle = {
        id: vehicleId++, locomotiveNo, repairProgramId: 1,
        plannedEntryAt: `${date}T08:00:00`, plannedExitAt: `${date}T16:00:00`,
        actualEntryAt: null, actualExitAt: null, status: 'SCHEDULED', approvalStatus: 'PUBLISHED',
        currentVersionId: null, ownerBureau: '西安局集团', ownerDepot,
        repairSequence: 1, mileageKm: 480000 + vehicleId * 1250,
        planSource: 'MANUAL', priority: 50, remark: '2026年11月月度交验统计演示车辆',
      }
      state.vehicleRepairs.push(vehicle)
    } else {
      Object.assign(vehicle, { ownerDepot, plannedExitAt: `${date}T16:00:00`, approvalStatus: 'PUBLISHED' })
    }
    let record = state.monthlyVerificationRecords.find(row => row.vehicleRepairId === vehicle.id)
    if (record) Object.assign(record, { date, depot: ownerDepot, result })
    else state.monthlyVerificationRecords.push({ id: recordId++, vehicleRepairId: vehicle.id, date, depot: ownerDepot, result })
    if (!state.planApprovalFlows.some(row => row.entityType === 'MONTHLY' && row.entityId === vehicle.id && row.status === 'PUBLISHED')) {
      state.planApprovalFlows.push({ id: flowId++, entityType: 'MONTHLY', entityId: vehicle.id, status: 'PUBLISHED', planName: '2026年11月月度检修计划', submitterDepartment: '计划编制', note: '演示审批发布记录', submittedAt: '2026-10-28T09:00:00', updatedAt: '2026-10-29T15:00:00', history: [{ action: 'SUBMIT', at: '2026-10-28T09:00:00', comment: '排程完成后提交审核' }, { action: 'REVIEW', at: '2026-10-29T09:00:00', comment: '主管科长审核通过' }, { action: 'PUBLISH', at: '2026-10-29T15:00:00', comment: '主管副段长审批发布' }] })
    }
  }
  await database.save(current.revision, current.snapshot)
  console.log(JSON.stringify({ added: samples.length, month: '2026-11', depots: [...new Set(samples.map(row => row[1]))] }, null, 2))
} finally {
  await database.close()
}
