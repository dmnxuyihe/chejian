import assert from 'node:assert/strict'
import { createDatabase } from '../server/database.js'
import { loadConfig } from '../server/config.js'
import { createMonthlyPlanService } from '../server/monthly-plans-v2.js'

const schema = `pc1_test_deputy_direct_${Date.now()}_${process.pid}`
const db = createDatabase({ ...loadConfig(), schema })

try {
  await db.init()
  const service = createMonthlyPlanService(db)
  const dictionary = (await db.pool.query(`
    SELECT lm.model_name, rp.repair_program_name
    FROM "${schema}".repair_program rp
    JOIN "${schema}".locomotive_model lm ON lm.model_id=rp.model_id
    WHERE rp.repair_program_name='C1'
    ORDER BY rp.repair_program_id
    LIMIT 1
  `)).rows[0]
  const period = { year: 2198, month: 8 }
  const values = (locomotiveNo, day) => ({
    modelName: dictionary.model_name,
    repairProgramName: dictionary.repair_program_name,
    locomotiveNo,
    repairSequence: 1,
    plannedEntryAt: `2198-08-${String(day).padStart(2, '0')}`,
    ownerBureau: '哈尔滨局',
    ownerDepot: '哈尔滨机务段',
    mileageKm: 100,
    remark: '主管副段长直接发布测试'
  })

  await service.createDraftItem({ ...period, role: 'DEPUTY_DIRECTOR', values: values('DEPUTY-DIRECT-UPDATE', 3) })
  await service.createDraftItem({ ...period, role: 'DEPUTY_DIRECTOR', values: values('DEPUTY-DIRECT-DELETE', 4) })
  await service.directPublish({ ...period, role: 'DEPUTY_DIRECTOR', note: '首次直接发布' })

  const formal = await service.read({ ...period, role: 'DEPUTY_DIRECTOR' })
  const updateTarget = formal.items.find(item => item.locomotiveNo === 'DEPUTY-DIRECT-UPDATE')
  const deleteTarget = formal.items.find(item => item.locomotiveNo === 'DEPUTY-DIRECT-DELETE')
  assert.ok(updateTarget?.isPublished && deleteTarget?.isPublished, '首次直接发布后两辆车都应为已发布')

  await service.updateItem({
    ...period,
    role: 'DEPUTY_DIRECTOR',
    vehicleRepairId: updateTarget.vehicleRepairId,
    changeReason: '主管副段长调整编号和日期',
    values: {
      ...updateTarget,
      locomotiveNo: 'DEPUTY-DIRECT-UPDATED',
      plannedEntryAt: '2198-08-13',
      ownerBureau: '北京局',
      ownerDepot: '北京机务段'
    }
  })
  await service.deleteItem({
    ...period,
    role: 'DEPUTY_DIRECTOR',
    vehicleRepairId: deleteTarget.vehicleRepairId,
    changeReason: '主管副段长删除正式车辆'
  })

  const pending = await service.read({ ...period, role: 'DEPUTY_DIRECTOR' })
  assert.equal(pending.pendingChangeCount, 2, '修改和删除都应计入副段长本人待直接发布变更')
  assert.ok(!['PENDING_REVIEW', 'PENDING_PUBLISH'].includes(pending.application?.status), '副段长本人变更不应生成流转中的科长审核申请')
  assert.equal(pending.draftItems.find(item => item.vehicleRepairId === updateTarget.vehicleRepairId)?.pendingChangeType, 'MODIFIED')
  assert.equal(pending.draftItems.find(item => item.vehicleRepairId === deleteTarget.vehicleRepairId)?.pendingChangeType, 'DELETE')

  const beforePublish = await db.pool.query(`
    SELECT locomotive_no, approval_status
    FROM "${schema}".vehicle_repair
    WHERE vehicle_repair_id=$1
  `, [updateTarget.vehicleRepairId])
  assert.equal(beforePublish.rows[0].locomotive_no, 'DEPUTY-DIRECT-UPDATE', '直接发布前不得覆盖正式车辆')
  assert.equal(beforePublish.rows[0].approval_status, 'PUBLISHED')

  const result = await service.directPublish({ ...period, role: 'DEPUTY_DIRECTOR', note: '直接发布修改和删除' })
  assert.equal(result.status, 'PUBLISHED')
  assert.equal(result.publishedCount, 2)

  const published = await service.read({ ...period, role: 'PLANNER' })
  const updated = published.items.find(item => item.vehicleRepairId === updateTarget.vehicleRepairId)
  assert.equal(updated?.locomotiveNo, 'DEPUTY-DIRECT-UPDATED')
  assert.equal(updated?.plannedEntryAt.slice(0, 10), '2198-08-13')
  assert.equal(updated?.approvalStatus, 'PUBLISHED')
  assert.equal(updated?.isPublished, true)
  assert.equal(published.items.some(item => item.vehicleRepairId === deleteTarget.vehicleRepairId), false, '删除发布后车辆不再出现在有效月计划')

  const deletedRepair = (await db.pool.query(`
    SELECT status, approval_status
    FROM "${schema}".vehicle_repair
    WHERE vehicle_repair_id=$1
  `, [deleteTarget.vehicleRepairId])).rows[0]
  assert.equal(deletedRepair.status, 'CANCELLED')
  assert.equal(deletedRepair.approval_status, 'PUBLISHED')
  assert.equal(Number((await db.pool.query(`
    SELECT count(*) value
    FROM "${schema}".monthly_plan_publication_history
    WHERE publish_method='DIRECT_PUBLISH' AND published_by_role='DEPUTY_DIRECTOR'
  `)).rows[0].value), 2)

  console.log('PASS: 主管副段长可修改、删除正式车辆，并通过直接发布立即形成新的已发布版本')
} finally {
  await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await db.close()
}
