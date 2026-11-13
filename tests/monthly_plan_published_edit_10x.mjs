import assert from 'node:assert/strict'
import { createDatabase } from '../server/database.js'
import { loadConfig } from '../server/config.js'
import { createMonthlyPlanService } from '../server/monthly-plans-v2.js'

const schema = `pc1_test_published_edit_${Date.now()}_${process.pid}`
const db = createDatabase({ ...loadConfig(), schema })
const period = { year: 2198, month: 2 }
const vehicleId = 990001

try {
  await db.init()
  const service = createMonthlyPlanService(db)
  const source = (await db.pool.query(`SELECT repair_program_id FROM "${schema}".repair_program ORDER BY repair_program_id LIMIT 1`)).rows[0]
  assert.ok(source, '基础修程字典不能为空')
  await db.pool.query(`INSERT INTO "${schema}".vehicle_repair(vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,planned_exit_at,status,approval_status,owner_bureau,owner_depot,repair_sequence,mileage_km,plan_source,remark) VALUES($1,'EDIT-BASE-01',$2,'2198-02-05','2198-02-23','UNSCHEDULED','PUBLISHED','哈尔滨局','哈尔滨机务段',1,100,'MONTHLY','正式版本')`, [vehicleId, source.repair_program_id])
  const plan = (await db.pool.query(`INSERT INTO "${schema}".monthly_plan(plan_year,plan_month,plan_title,title_source) VALUES($1,$2,'已发布修改测试','MANUAL') RETURNING monthly_plan_id`, [period.year, period.month])).rows[0]
  const version = (await db.pool.query(`INSERT INTO "${schema}".monthly_plan_version(monthly_plan_id,version_no,owner_role,version_status,snapshot_title) VALUES($1,1,'PLANNER','PUBLISHED','已发布修改测试') RETURNING plan_version_id`, [plan.monthly_plan_id])).rows[0]
  await db.pool.query(`INSERT INTO "${schema}".monthly_plan_item(plan_version_id,stable_item_key,vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,repair_sequence,mileage_km,remark,change_type,is_cancelled) VALUES($1,'edit-stable-01',$2,'EDIT-BASE-01',$3,'2198-02-05','哈尔滨局','哈尔滨机务段',1,100,'正式版本','UNCHANGED',false)`, [version.plan_version_id, vehicleId, source.repair_program_id])
  await db.pool.query(`UPDATE "${schema}".monthly_plan SET current_published_version_id=$1 WHERE monthly_plan_id=$2`, [version.plan_version_id, plan.monthly_plan_id])
  const staleDraft = (await db.pool.query(`INSERT INTO "${schema}".monthly_plan_version(monthly_plan_id,version_no,base_version_id,owner_role,version_status,snapshot_title) VALUES($1,2,$2,'PLANNER','DRAFT','旧工作副本') RETURNING plan_version_id`, [plan.monthly_plan_id, version.plan_version_id])).rows[0]
  await db.pool.query(`INSERT INTO "${schema}".monthly_plan_item(plan_version_id,stable_item_key,vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,repair_sequence,mileage_km,remark,change_type,is_cancelled) VALUES($1,'edit-stable-01',NULL,'EDIT-BASE-01',$2,'2198-02-05','哈尔滨局','哈尔滨机务段',1,100,'旧草稿缺少正式车辆ID','UNCHANGED',false)`, [staleDraft.plan_version_id, source.repair_program_id])

  for (let index = 1; index <= 10; index += 1) {
    const before = await service.read({ ...period, role: 'PLANNER' })
    const formal = before.items.find(item => item.vehicleRepairId === vehicleId)
    assert.ok(formal?.isPublished, `第${index}次修改前应为已发布`)
    const nextNo = `EDIT-CHANGED-${String(index).padStart(2, '0')}`
    await service.updateItem({
      ...period,
      role: 'PLANNER',
      vehicleRepairId: vehicleId,
      changeReason: `第${index}次修改编号`,
      values: { ...formal, locomotiveNo: nextNo, plannedEntryAt: '2198-02-05' }
    })
    const draft = await service.read({ ...period, role: 'PLANNER' })
    const draftView = draft.items.find(item => item.vehicleRepairId === vehicleId)
    assert.equal(draftView?.approvalStatus, 'DRAFT', `第${index}次应为修改草稿`)
    assert.equal(draftView?.pendingSnapshot?.locomotiveNo, nextNo, `第${index}次修改副本编号错误`)
    assert.equal(draftView?.originalSnapshot?.locomotiveNo, 'EDIT-BASE-01', `第${index}次原正式编号错误`)
    await service.deleteItem({ ...period, role: 'PLANNER', vehicleRepairId: vehicleId, operation: 'CANCEL_MODIFICATION' })
    const restored = await service.read({ ...period, role: 'PLANNER' })
    const restoredView = restored.items.find(item => item.vehicleRepairId === vehicleId)
    assert.equal(restoredView?.approvalStatus, 'PUBLISHED', `第${index}次取消后应恢复已发布`)
    assert.equal(restoredView?.locomotiveNo, 'EDIT-BASE-01', `第${index}次取消后编号未恢复`)
  }

  await service.updateItem({ ...period, role: 'PLANNER', vehicleRepairId: vehicleId, changeReason: '最终提交修改编号', values: { locomotiveNo: 'EDIT-FINAL-01', repairProgramId: source.repair_program_id, plannedEntryAt: '2198-02-06', ownerBureau: '哈尔滨局', ownerDepot: '哈尔滨机务段', repairSequence: 1, mileageKm: 100, remark: '提交修改草稿' } })
  const submitted = await service.submit({ ...period, role: 'PLANNER', note: '提交修改副本', adjustReason: '已发布车辆编号调整' })
  assert.equal(submitted.status, 'PENDING_REVIEW')
  const pending = await service.read({ ...period, role: 'PLANNER' })
  const pendingView = pending.items.find(item => item.vehicleRepairId === vehicleId)
  assert.equal(pendingView?.approvalStatus, 'PUBLISHED', '提交审核后正式车辆底层状态仍应为已发布')
  assert.equal(pendingView?.pendingApprovalStatus, 'PENDING_REVIEW')
  assert.equal(pendingView?.pendingSnapshot?.locomotiveNo, 'EDIT-FINAL-01')
  assert.equal(pending.items.filter(item => item.vehicleRepairId === vehicleId).length, 1, '正式车辆和修改副本只能展示一辆')
  console.log('PASS: 已发布车辆修改编号、前后版本快照、取消修改恢复、重复修改10次和提交审核')
} finally {
  await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await db.close()
}
