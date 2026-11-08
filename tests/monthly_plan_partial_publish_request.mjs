import assert from 'node:assert/strict'
import { createDatabase } from '../server/database.js'
import { loadConfig } from '../server/config.js'
import { createMonthlyPlanService } from '../server/monthly-plans.js'

const schema = `pc1_test_partial_publish_${Date.now()}_${process.pid}`
const db = createDatabase({ ...loadConfig(), schema })

try {
  await db.init()
  const service = createMonthlyPlanService(db)
  const source = (await db.pool.query(`SELECT repair_program_id FROM "${schema}".repair_program ORDER BY repair_program_id LIMIT 1`)).rows[0]
  const nextVehicleId = Number((await db.pool.query(`SELECT COALESCE(max(vehicle_repair_id),0)+1 value FROM "${schema}".vehicle_repair`)).rows[0].value)
  const plan = (await db.pool.query(`INSERT INTO "${schema}".monthly_plan(plan_year,plan_month,plan_title,title_source) VALUES(2198,12,'分批申请发布测试','MANUAL') RETURNING *`)).rows[0]
  const draft = (await db.pool.query(`INSERT INTO "${schema}".monthly_plan_version(monthly_plan_id,version_no,owner_role,version_status,snapshot_title) VALUES($1,1,'PLANNER','DRAFT','分批申请发布测试') RETURNING *`, [plan.monthly_plan_id])).rows[0]

  for (let index = 0; index < 2; index += 1) {
    const vehicleId = nextVehicleId + index
    const key = `partial-publish-${index + 1}`
    await db.pool.query(`INSERT INTO "${schema}".vehicle_repair(vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,status,approval_status,owner_bureau,owner_depot,plan_source) VALUES($1,$2,$3,$4,'UNSCHEDULED','DRAFT','测试局','测试段','MONTHLY')`, [vehicleId, `PARTIAL-${index + 1}`, source.repair_program_id, `2198-12-0${index + 1}`])
    await db.pool.query(`INSERT INTO "${schema}".monthly_plan_item(plan_version_id,stable_item_key,vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,change_type) VALUES($1,$2,$3,$4,$5,$6,'测试局','测试段','ADDED')`, [draft.plan_version_id, key, vehicleId, `PARTIAL-${index + 1}`, source.repair_program_id, `2198-12-0${index + 1}`])
  }

  const period = { year: 2198, month: 12 }
  const planner = await service.read({ ...period, role: 'PLANNER' })
  const bothKeys = planner.draftItems.map(item => item.stableItemKey)
  assert.equal(bothKeys.length, 2)
  await service.submit({ ...period, role: 'PLANNER', selectedItemKeys: bothKeys, note: '员工提交两项' })
  const reviewed = await service.decide({ ...period, role: 'SECTION_CHIEF', action: 'APPROVE' })
  assert.deepEqual(reviewed, { status: 'REVIEWED', statusText: '已审核待申请发布' })

  const chiefBefore = await service.read({ ...period, role: 'SECTION_CHIEF' })
  const reviewedItems = chiefBefore.items.filter(item => item.isReviewedPending)
  assert.equal(reviewedItems.length, 2)
  assert.ok(reviewedItems.every(item => item.approvalStatus === 'REVIEWED'))
  await assert.rejects(() => service.requestPublish({ ...period, role: 'SECTION_CHIEF', note: '不得默认全选' }), /必须明确选择/)

  const selectedKey = reviewedItems[0].stableItemKey
  const unselectedKey = reviewedItems[1].stableItemKey
  const requested = await service.requestPublish({ ...period, role: 'SECTION_CHIEF', selectedItemKeys: [selectedKey], note: '只申请发布一项' })
  assert.equal(requested.selectedCount, 1)
  assert.equal(requested.status, 'PENDING_PUBLISH')

  const deputy = await service.read({ ...period, role: 'DEPUTY_DIRECTOR' })
  assert.equal(deputy.application.status, 'PENDING_PUBLISH')
  assert.equal(deputy.application.selectedCount, 1)
  const pending = deputy.items.find(item => item.stableItemKey === selectedKey && item.isPending)
  assert.equal(pending?.approvalStatus, 'PENDING_PUBLISH')
  const stillReviewed = deputy.items.find(item => item.stableItemKey === unselectedKey && item.isReviewedPending)
  assert.equal(stillReviewed?.approvalStatus, 'REVIEWED')

  await service.decide({ ...period, role: 'DEPUTY_DIRECTOR', action: 'APPROVE', reason: '发布已勾选项' })
  const chiefAfter = await service.read({ ...period, role: 'SECTION_CHIEF' })
  assert.ok(chiefAfter.items.some(item => item.stableItemKey === selectedKey && item.isPublished))
  assert.ok(chiefAfter.items.some(item => item.stableItemKey === unselectedKey && item.isReviewedPending))

  console.log(JSON.stringify({ passed: true, checks: ['科长审核通过只进入紫色中间态', '申请发布必须明确勾选', '未勾选紫色事项不会进入待发布', '副段长只看到已勾选事项为待发布'] }, null, 2))
} finally {
  await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await db.close()
}
