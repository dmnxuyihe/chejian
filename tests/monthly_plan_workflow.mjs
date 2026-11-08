import assert from 'node:assert/strict'
import { createDatabase } from '../server/database.js'
import { loadConfig } from '../server/config.js'
import { createMonthlyPlanService } from '../server/monthly-plans.js'

const schema=`pc1_test_monthly_${Date.now()}_${process.pid}`
const db=createDatabase({...loadConfig(),schema})
try{
  await db.init()
  const service=createMonthlyPlanService(db)
  const migrated=(await db.pool.query(`SELECT plan_year,plan_month FROM "${schema}".monthly_plan ORDER BY plan_year,plan_month LIMIT 1`)).rows[0]
  assert.ok(migrated,'初始化迁移应生成月度计划')
  await service.read({...migrated,year:migrated.plan_year,month:migrated.plan_month,role:'PLANNER'})
  const candidate=(await db.pool.query(`SELECT p.plan_year,p.plan_month,count(i.item_id)::int AS item_count FROM "${schema}".monthly_plan p JOIN "${schema}".monthly_plan_version v ON v.monthly_plan_id=p.monthly_plan_id AND v.owner_role='PLANNER' AND v.version_status='DRAFT' JOIN "${schema}".monthly_plan_item i ON i.plan_version_id=v.plan_version_id GROUP BY p.monthly_plan_id ORDER BY item_count DESC LIMIT 1`)).rows[0]
  assert.ok(candidate?.item_count>0,'读取已迁移计划时应基于正式版本生成当前角色草稿')
  const input={year:candidate.plan_year,month:candidate.plan_month}
  let planner=await service.read({...input,role:'PLANNER'})
  assert.equal(planner.status,planner.hasPublishedVersion?'已发布':'编制中')
  if(!planner.draftItems.length&&planner.hasPublishedVersion){
    const formal=planner.items.find(item=>item.isPublished)
    await service.updateItem({...input,role:'PLANNER',vehicleRepairId:formal.vehicleRepairId,changeReason:'测试已发布月份再次申请',values:{...formal,plannedEntryAt:formal.plannedEntryAt.slice(0,10),remark:'测试再次申请草稿'}})
    planner=await service.read({...input,role:'PLANNER'})
  }
  const submitted=await service.submit({...input,role:'PLANNER',selectedItemKeys:planner.draftItems.map(item=>item.stableItemKey),note:'月度计划选择草稿提报',adjustReason:planner.hasPublishedVersion?'演示调整后重新提报':''})
  assert.equal(submitted.statusText,'待审核')
  assert.equal((await service.todos({role:'SECTION_CHIEF'})).items.some(item=>item.year===input.year&&item.month===input.month),true,'科长应收到跨月份待审核提醒')
  assert.equal((await service.read({...input,role:'PLANNER'})).readOnly,true)
  await assert.rejects(()=>service.submit({...input,role:'SECTION_CHIEF',note:'重复申请'}),/已有流转中的审核申请/)
  const reviewed=await service.decide({...input,role:'SECTION_CHIEF',action:'APPROVE'})
  assert.equal(reviewed.statusText,'已审核待申请发布')
  const chiefReviewed=await service.read({...input,role:'SECTION_CHIEF'})
  const reviewedKeys=chiefReviewed.items.filter(item=>item.isReviewedPending).map(item=>item.stableItemKey)
  const requested=await service.requestPublish({...input,role:'SECTION_CHIEF',selectedItemKeys:reviewedKeys,note:'科长申请发布',adjustReason:chiefReviewed.hasPublishedVersion?'测试调整后申请发布':''})
  assert.equal(requested.status,'PENDING_PUBLISH')
  assert.equal((await service.read({...input,role:'DEPUTY_DIRECTOR'})).application.status,'PENDING_PUBLISH')
  const published=await service.decide({...input,role:'DEPUTY_DIRECTOR',action:'APPROVE'})
  assert.equal(published.statusText,'已发布')
  const final=await service.read({...input,role:'PLANNER'})
  assert.equal(final.status,'已发布')
  assert.ok(final.hasPublishedVersion)
  const chief=await service.read({...input,role:'SECTION_CHIEF'}),target=chief.items[0]
  assert.ok(target,'科长应基于正式版本拥有独立草稿')
  await service.updateItem({...input,role:'SECTION_CHIEF',vehicleRepairId:target.vehicleRepairId,changeReason:'调整科长草稿测试',values:{...target,plannedEntryAt:target.plannedEntryAt.slice(0,10),remark:'科长草稿修改'}})
  assert.equal((await service.read({...input,role:'SECTION_CHIEF'})).items.find(item=>item.vehicleRepairId===target.vehicleRepairId&&item.isDraft).remark,'科长草稿修改')
  assert.notEqual((await db.pool.query(`SELECT remark FROM "${schema}".vehicle_repair WHERE vehicle_repair_id=$1`,[target.vehicleRepairId])).rows[0].remark,'科长草稿修改','科长修改在发布前不得覆盖正式车辆数据')
  console.log('PASS: 月度计划按角色完成整月提交、科长审核、主管副段长发布。')
}finally{
  assert.match(schema,/^pc1_test_monthly_\d+_\d+$/)
  await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await db.close()
}
