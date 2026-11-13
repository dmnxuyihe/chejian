import assert from 'node:assert/strict'
import { createDatabase } from '../server/database.js'
import { loadConfig } from '../server/config.js'
import { createMonthlyPlanService } from '../server/monthly-plans-v2.js'

const schema = `pc1_test_monthly_status_logs_${Date.now()}_${process.pid}`
const db = createDatabase({ ...loadConfig(), schema })

try {
  await db.init()
  const service = createMonthlyPlanService(db)
  const dictionary = (await db.pool.query(`
    SELECT lm.model_name, rp.repair_program_name
    FROM "${schema}".repair_program rp
    JOIN "${schema}".locomotive_model lm ON lm.model_id = rp.model_id
    WHERE rp.repair_program_name = 'C1'
    ORDER BY rp.repair_program_id
    LIMIT 1
  `)).rows[0]

  const period = { year: 2198, month: 9 }
  const values = (locomotiveNo, day, remark = '状态日志测试') => ({
    modelName: dictionary.model_name,
    repairProgramName: dictionary.repair_program_name,
    locomotiveNo,
    repairSequence: 1,
    plannedEntryAt: `2198-09-${String(day).padStart(2, '0')}`,
    ownerBureau: '哈尔滨局',
    ownerDepot: '哈尔滨机务段',
    mileageKm: 100,
    remark
  })

  await service.createDraftItem({ ...period, role: 'PLANNER', values: values('STATUS-A', 8) })
  await service.createDraftItem({ ...period, role: 'PLANNER', values: values('STATUS-B', 9) })
  await service.createDraftItem({ ...period, role: 'PLANNER', values: values('STATUS-C', 10) })
  await service.createDraftItem({ ...period, role: 'SECTION_CHIEF', values: values('PRIVATE-CHIEF', 11) })
  assert.equal((await service.logs({ ...period, role: 'PLANNER' })).total, 0, '草稿操作不得写状态变更日志')

  const submitted = await service.submit({
    ...period,
    role: 'PLANNER',
    note: '第一轮提交审核',
    adjustReason: '新增三辆车'
  })
  let logs = await service.logs({ ...period, role: 'PLANNER' })
  assert.equal(logs.total, 1)
  assert.equal(logs.items[0].actionType, 'PLANNER_SUBMITTED')
  assert.equal(logs.items[0].beforeStatus, 'DRAFT')
  assert.equal(logs.items[0].afterStatus, 'PENDING_REVIEW')
  assert.equal(logs.items[0].roundNo, 1)

  const submittedDetail = (await service.logs({ ...period, role: 'PLANNER', logId: logs.items[0].id })).item
  assert.equal(submittedDetail.details.addedCount, 3)
  assert.equal(submittedDetail.details.changes.some(row => row.locomotiveNo === 'PRIVATE-CHIEF'), false)
  assert.equal(submittedDetail.details.changes.find(row => row.locomotiveNo === 'STATUS-A').after.plannedEntryAt, '2198-09-08')

  const submittedItem = (await db.pool.query(`
    SELECT i.item_id
    FROM "${schema}".monthly_plan_application a
    JOIN "${schema}".monthly_plan_item i ON i.plan_version_id = a.current_review_version_id
    WHERE a.application_id = $1 AND i.locomotive_no = 'STATUS-A'
  `, [submitted.applicationId])).rows[0]
  await service.updateItem({
    ...period,
    role: 'SECTION_CHIEF',
    vehicleRepairId: submittedItem.item_id,
    values: values('STATUS-A', 12, '科长审核修订'),
    changeReason: '调整入段日期'
  })
  assert.equal((await service.logs({ ...period, role: 'SECTION_CHIEF' })).total, 1, '普通审核修订不得写状态变更日志')

  await service.decide({ ...period, role: 'SECTION_CHIEF', action: 'APPROVE', reason: '科长审核通过' })
  logs = await service.logs({ ...period, role: 'SECTION_CHIEF' })
  assert.equal(logs.total, 2)
  assert.equal(logs.items[0].actionType, 'CHIEF_APPROVED')
  assert.equal(logs.items[0].beforeStatus, 'PENDING_REVIEW')
  assert.equal(logs.items[0].afterStatus, 'PENDING_PUBLISH')
  const chiefDetail = (await service.logs({ ...period, role: 'SECTION_CHIEF', logId: logs.items[0].id })).item
  assert.equal(chiefDetail.details.changes.find(row => row.locomotiveNo === 'STATUS-A').after.plannedEntryAt, '2198-09-12')
  const frozenSubmittedAgain = (await service.logs({ ...period, role: 'DEPUTY_DIRECTOR', logId: submittedDetail.id })).item
  assert.equal(frozenSubmittedAgain.details.changes.find(row => row.locomotiveNo === 'STATUS-A').after.plannedEntryAt, '2198-09-08')

  await service.decide({ ...period, role: 'DEPUTY_DIRECTOR', action: 'APPROVE', reason: '副段长审批发布' })
  logs = await service.logs({ ...period, role: 'DEPUTY_DIRECTOR' })
  assert.equal(logs.total, 3)
  assert.equal(logs.items[0].actionType, 'DEPUTY_APPROVED_PUBLISH')
  assert.equal(logs.items[0].beforeStatus, 'PENDING_PUBLISH')
  assert.equal(logs.items[0].afterStatus, 'PUBLISHED')
  const publishDetail = (await service.logs({ ...period, role: 'PLANNER', logId: logs.items[0].id })).item
  assert.equal(publishDetail.details.beforeVehicleCount, 0)
  assert.equal(publishDetail.details.addedCount, 3)
  assert.equal(publishDetail.details.updatedCount, 0)
  assert.equal(publishDetail.details.deletedCount, 0)
  assert.equal(publishDetail.details.afterVehicleCount, 3)
  assert.equal(publishDetail.details.afterVehicleCount, publishDetail.details.beforeVehicleCount + publishDetail.details.addedCount - publishDetail.details.deletedCount)

  await assert.rejects(
    () => service.decide({ ...period, role: 'DEPUTY_DIRECTOR', action: 'APPROVE', reason: '重复发布' }),
    /没有流转中的申请|没有待处理的审核申请|当前状态/
  )
  assert.equal((await service.logs({ ...period, role: 'PLANNER' })).total, 3, '失败事务不得留下状态日志')

  const roleLogIds = []
  for (const role of ['PLANNER', 'SECTION_CHIEF', 'DEPUTY_DIRECTOR']) {
    roleLogIds.push((await service.logs({ ...period, role })).items.map(row => row.id))
  }
  assert.deepEqual(roleLogIds[0], roleLogIds[1])
  assert.deepEqual(roleLogIds[1], roleLogIds[2], '三个角色应看到相同的公开状态日志')

  await service.createDraftItem({ ...period, role: 'PLANNER', values: values('STATUS-D', 13) })
  await service.submit({ ...period, role: 'PLANNER', note: '第二轮提交', adjustReason: '补充车辆' })
  await service.withdraw({ ...period, role: 'PLANNER' })
  const secondRound = (await service.logs({ ...period, role: 'PLANNER' })).items.filter(row => row.roundNo === 2)
  assert.deepEqual(secondRound.map(row => row.actionType), ['APPLICATION_WITHDRAWN', 'PLANNER_SUBMITTED'])

  const directPeriod = { year: 2198, month: 10 }
  await service.createDraftItem({ ...directPeriod, role: 'DEPUTY_DIRECTOR', values: { ...values('DIRECT-A', 14), plannedEntryAt: '2198-10-14' } })
  await service.directPublish({ ...directPeriod, role: 'DEPUTY_DIRECTOR', note: '副段长直接发布' })
  const directLogs = await service.logs({ ...directPeriod, role: 'PLANNER' })
  assert.equal(directLogs.total, 1)
  assert.equal(directLogs.items[0].actionType, 'DEPUTY_DIRECT_PUBLISHED')
  assert.equal(directLogs.items[0].beforeStatus, 'DRAFT')
  assert.equal(directLogs.items[0].afterStatus, 'PUBLISHED')

  const rejectPeriod = { year: 2198, month: 11 }
  await service.createDraftItem({ ...rejectPeriod, role: 'PLANNER', values: { ...values('REJECT-A', 15), plannedEntryAt: '2198-11-15' } })
  await service.submit({ ...rejectPeriod, role: 'PLANNER', note: '驳回测试', adjustReason: '测试科长驳回' })
  await service.decide({ ...rejectPeriod, role: 'SECTION_CHIEF', action: 'REJECT', reason: '资料需要补充' })
  const rejectLogs = await service.logs({ ...rejectPeriod, role: 'PLANNER' })
  assert.deepEqual(rejectLogs.items.map(row => row.actionType), ['CHIEF_REJECTED', 'PLANNER_SUBMITTED'])

  const chiefPeriod = { year: 2198, month: 12 }
  await service.createDraftItem({ ...chiefPeriod, role: 'SECTION_CHIEF', values: { ...values('CHIEF-OWN-A', 16), plannedEntryAt: '2198-12-16' } })
  await service.requestPublish({ ...chiefPeriod, role: 'SECTION_CHIEF', note: '科长本人申请发布', adjustReason: '科长新增车辆' })
  let chiefOwnLogs = await service.logs({ ...chiefPeriod, role: 'PLANNER' })
  assert.deepEqual(chiefOwnLogs.items.map(row => row.actionType), ['CHIEF_SUBMITTED_FOR_PUBLISH'])
  assert.equal(chiefOwnLogs.items[0].beforeStatus, 'DRAFT')
  assert.equal(chiefOwnLogs.items[0].afterStatus, 'PENDING_PUBLISH')
  await service.decide({ ...chiefPeriod, role: 'DEPUTY_DIRECTOR', action: 'REJECT', reason: '副段长退回补充资料' })
  chiefOwnLogs = await service.logs({ ...chiefPeriod, role: 'SECTION_CHIEF' })
  assert.deepEqual(chiefOwnLogs.items.map(row => row.actionType), ['DEPUTY_REJECTED', 'CHIEF_SUBMITTED_FOR_PUBLISH'])

  const rollbackPeriod = { year: 2199, month: 1 }
  await service.createDraftItem({ ...rollbackPeriod, role: 'PLANNER', values: { ...values('ROLLBACK-A', 17), plannedEntryAt: '2199-01-17' } })
  const rollbackApp = await service.submit({ ...rollbackPeriod, role: 'PLANNER', note: '回退测试', adjustReason: '验证真实状态回退' })
  await service.decide({ ...rollbackPeriod, role: 'SECTION_CHIEF', action: 'APPROVE', reason: '先审核通过' })
  const rollbackItem = (await db.pool.query(`
    SELECT i.item_id
    FROM "${schema}".monthly_plan_application a
    JOIN "${schema}".monthly_plan_item i ON i.plan_version_id = a.current_review_version_id
    WHERE a.application_id = $1 AND i.locomotive_no = 'ROLLBACK-A'
  `, [rollbackApp.applicationId])).rows[0]
  await service.updateItem({
    ...rollbackPeriod,
    role: 'SECTION_CHIEF',
    vehicleRepairId: rollbackItem.item_id,
    values: { ...values('ROLLBACK-A', 18, '通过后再次修订'), plannedEntryAt: '2199-01-18' },
    changeReason: '通过后修订，退回待审核'
  })
  const rollbackLogs = await service.logs({ ...rollbackPeriod, role: 'DEPUTY_DIRECTOR' })
  assert.equal(rollbackLogs.items[0].actionType, 'RETURNED_TO_CHIEF_REVIEW')
  assert.equal(rollbackLogs.items[0].beforeStatus, 'PENDING_PUBLISH')
  assert.equal(rollbackLogs.items[0].afterStatus, 'PENDING_REVIEW')

  console.log('PASS: 月度计划状态日志仅记录流程迁移，历史快照、公开可见、轮次、发布摘要及事务回滚均正确')
} finally {
  await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await db.close()
}
