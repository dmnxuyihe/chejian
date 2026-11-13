import assert from 'node:assert/strict'
import { createDatabase } from '../server/database.js'
import { loadConfig } from '../server/config.js'
import { createMonthlyPlanService } from '../server/monthly-plans-v2.js'

const schema = `pc1_test_monthly_whole_${Date.now()}_${process.pid}`
const db = createDatabase({ ...loadConfig(), schema })
try {
  await db.init()
  const service = createMonthlyPlanService(db)
  const source = (await db.pool.query(`SELECT repair_program_id FROM "${schema}".repair_program ORDER BY repair_program_id LIMIT 1`)).rows[0]
  const plan = (await db.pool.query(`INSERT INTO "${schema}".monthly_plan(plan_year,plan_month,plan_title,title_source) VALUES(2199,1,'整月版本测试','MANUAL') RETURNING monthly_plan_id`)).rows[0]
  const version = (await db.pool.query(`INSERT INTO "${schema}".monthly_plan_version(monthly_plan_id,version_no,owner_role,version_status,snapshot_title) VALUES($1,1,'PLANNER','DRAFT','整月版本测试') RETURNING plan_version_id`, [plan.monthly_plan_id])).rows[0]
  for (const [index, loco] of ['WHOLE-01', 'WHOLE-02'].entries()) {
    await db.pool.query(`INSERT INTO "${schema}".monthly_plan_item(plan_version_id,stable_item_key,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,change_type) VALUES($1,$2,$3,$4,$5,'测试局','测试段','ADDED')`, [version.plan_version_id, `whole-${index}`, loco, source.repair_program_id, `2199-01-0${index + 1}`])
  }
  const period = { year: 2199, month: 1 }
  const submitted = await service.submit({ ...period, role: 'PLANNER', note: '整月首次申请' })
  assert.equal(submitted.submittedCount, 2)
  assert.equal((await service.read({ ...period, role: 'PLANNER' })).application.status, 'PENDING_REVIEW')
  const chief = await service.read({ ...period, role: 'SECTION_CHIEF' })
  const first = chief.items.find(item => item.locomotiveNo === 'WHOLE-01')
  await service.updateItem({ ...period, role: 'SECTION_CHIEF', vehicleRepairId: first.vehicleRepairId ?? first.id, changeReason: '科长修订', values: { ...first, plannedEntryAt: '2199-01-04', repairSequence: 1 } })
  assert.equal((await db.pool.query(`SELECT count(*)::int value FROM "${schema}".monthly_plan_revision_history`)).rows[0].value, 1)
  assert.equal((await service.decide({ ...period, role: 'SECTION_CHIEF', action: 'APPROVE' })).status, 'PENDING_PUBLISH')
  assert.equal((await service.read({ ...period, role: 'DEPUTY_DIRECTOR' })).application.status, 'PENDING_PUBLISH')
  await service.decide({ ...period, role: 'DEPUTY_DIRECTOR', action: 'APPROVE', reason: '整月发布' })
  const published = await service.read({ ...period, role: 'PLANNER' })
  assert.equal(published.status, '已发布')
  assert.equal(published.items.filter(item => item.isPublished).length, 2)
  const formal = published.items.find(item => item.locomotiveNo === 'WHOLE-01')
  const dictionary = (await db.pool.query(`SELECT lm.model_name,(SELECT rp2.repair_program_name FROM "${schema}".repair_program rp2 WHERE rp2.model_id=lm.model_id AND rp2.repair_program_name='C1' LIMIT 1) AS repair_program_name FROM "${schema}".repair_program rp JOIN "${schema}".locomotive_model lm ON lm.model_id=rp.model_id WHERE rp.repair_program_id=$1`, [source.repair_program_id])).rows[0]
  await service.createDraftItem({ ...period, role: 'PLANNER', values: { modelName: dictionary.model_name, locomotiveNo: 'PLANNER-ADD-01', repairProgramName: dictionary.repair_program_name, repairSequence: 1, plannedEntryAt: '2199-01-08', ownerBureau: '测试局', ownerDepot: '测试段', mileageKm: 100, remark: '计划员新增草稿' } })
  await service.submit({ ...period, role: 'PLANNER', note: '计划员新增车辆申请', adjustReason: '已发布月份新增车辆' })
  const plannerPending = await service.read({ ...period, role: 'PLANNER' })
  assert.ok(plannerPending.items.filter(item => item.locomotiveNo !== 'PLANNER-ADD-01').every(item => item.approvalStatus === 'PUBLISHED' && item.isPublished), '未修改的正式车辆提交后仍必须保持已发布')
  assert.equal(plannerPending.items.find(item => item.locomotiveNo === 'PLANNER-ADD-01')?.approvalStatus, 'SUBMITTED')
  await service.withdraw({ ...period, role: 'PLANNER' })
  await service.updateItem({ ...period, role: 'SECTION_CHIEF', vehicleRepairId: formal.vehicleRepairId, changeReason: '已发布月份调整', values: { ...formal, plannedEntryAt: '2199-01-06' } })
  const adjusted = await service.read({ ...period, role: 'SECTION_CHIEF' })
  assert.ok(adjusted.hasOwnDraft, '已发布月份仍应允许形成新的工作版本')
  const chiefRequest = await service.requestPublish({ ...period, role: 'SECTION_CHIEF', note: '科长申请发布', adjustReason: '已发布月份调整' })
  assert.equal(chiefRequest.status, 'PENDING_PUBLISH')
  await service.decide({ ...period, role: 'DEPUTY_DIRECTOR', action: 'APPROVE' })
  const republished = await service.read({ ...period, role: 'PLANNER' })
  assert.equal(republished.items.find(item => item.locomotiveNo === 'WHOLE-01').plannedEntryAt.slice(0, 10), '2199-01-06')
  await service.createDraftItem({ ...period, role: 'DEPUTY_DIRECTOR', values: { modelName: dictionary.model_name, locomotiveNo: 'DEPUTY-ADD-01', repairProgramName: dictionary.repair_program_name, repairSequence: 1, plannedEntryAt: '2199-01-10', ownerBureau: '测试局', ownerDepot: '测试段', mileageKm: 100, remark: '副段长直接发布新增车辆' } })
  const deputyDraft = await service.read({ ...period, role: 'DEPUTY_DIRECTOR' })
  assert.ok(deputyDraft.items.some(item => item.locomotiveNo === 'DEPUTY-ADD-01' && item.isDraft), '副段长新增车辆应进入自己的草稿')
  const direct = await service.directPublish({ ...period, role: 'DEPUTY_DIRECTOR', note: '直接发布新增车辆' })
  assert.equal(direct.status, 'PUBLISHED')
  const afterDirect = await service.read({ ...period, role: 'PLANNER' })
  assert.ok(afterDirect.items.some(item => item.locomotiveNo === 'DEPUTY-ADD-01' && item.approvalStatus === 'PUBLISHED'), '副段长新增车辆应直接成为正式发布车辆')
  console.log('PASS: 整月工作版本提交、科长审核直达待发布、整月发布、已发布月份再次调整和副段长新增直发')
} finally {
  await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await db.close()
}
