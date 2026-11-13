import assert from 'node:assert/strict'
import { createDatabase } from '../server/database.js'
import { loadConfig } from '../server/config.js'
import { createMonthlyPlanService } from '../server/monthly-plans-v2.js'

const schema=`pc1_test_stale_merge_${Date.now()}_${process.pid}`
const db=createDatabase({...loadConfig(),schema})
try{
  await db.init()
  const service=createMonthlyPlanService(db)
  const program=(await db.pool.query(`SELECT repair_program_id FROM "${schema}".repair_program ORDER BY repair_program_id LIMIT 1`)).rows[0]
  const plan=(await db.pool.query(`INSERT INTO "${schema}".monthly_plan(plan_year,plan_month,plan_title,title_source) VALUES(2197,10,'旧草稿合并测试','MANUAL') RETURNING monthly_plan_id`)).rows[0]
  const published=(await db.pool.query(`INSERT INTO "${schema}".monthly_plan_version(monthly_plan_id,version_no,owner_role,version_status,snapshot_title,published_at) VALUES($1,1,'DEPUTY_DIRECTOR','PUBLISHED','旧草稿合并测试',now()) RETURNING plan_version_id`,[plan.monthly_plan_id])).rows[0]
  await db.pool.query(`UPDATE "${schema}".monthly_plan SET current_published_version_id=$1 WHERE monthly_plan_id=$2`,[published.plan_version_id,plan.monthly_plan_id])
  await db.pool.query(`INSERT INTO "${schema}".monthly_plan_item(plan_version_id,stable_item_key,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,repair_sequence,change_type,is_cancelled) VALUES
    ($1,'active-a','ACTIVE-A',$2,'2197-10-02','郑州局','郑州机务段',1,'UNCHANGED',false),
    ($1,'cancelled-b','CANCELLED-B',$2,'2197-10-03','郑州局','郑州机务段',1,'CANCELLED',true)`,[published.plan_version_id,program.repair_program_id])
  const draft=(await db.pool.query(`INSERT INTO "${schema}".monthly_plan_version(monthly_plan_id,version_no,base_version_id,owner_role,version_status,snapshot_title) VALUES($1,2,$2,'PLANNER','DRAFT','旧草稿合并测试') RETURNING plan_version_id`,[plan.monthly_plan_id,published.plan_version_id])).rows[0]
  await db.pool.query(`INSERT INTO "${schema}".monthly_plan_item(plan_version_id,stable_item_key,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,repair_sequence,change_type,is_cancelled) VALUES
    ($1,'active-a','ACTIVE-A',$2,'2197-10-02','郑州局','郑州机务段',1,'UNCHANGED',false),
    ($1,'cancelled-b','CANCELLED-B',$2,'2197-10-03','郑州局','郑州机务段',1,'UNCHANGED',false),
    ($1,'new-c','NEW-C',$2,'2197-10-05','郑州局','郑州机务段',1,'ADDED',false)`,[draft.plan_version_id,program.repair_program_id])

  const period={year:2197,month:10}
  await service.submit({...period,role:'PLANNER',note:'只提交新增车辆',adjustReason:'新增车辆'})
  const pendingReview=await service.read({...period,role:'PLANNER'})
  const unchangedFormal=pendingReview.items.find(item=>item.stableItemKey==='active-a')
  assert.equal(unchangedFormal.approvalStatus,'PUBLISHED')
  assert.equal(unchangedFormal.isPublished,true)
  assert.equal(Boolean(unchangedFormal.isSubmitted),false)
  assert.equal(Boolean(unchangedFormal.pendingModification),false)
  assert.equal(pendingReview.items.some(item=>item.stableItemKey==='cancelled-b'),false)
  assert.equal(pendingReview.items.find(item=>item.stableItemKey==='new-c')?.approvalStatus,'SUBMITTED')
  await service.decide({...period,role:'SECTION_CHIEF',action:'APPROVE'})
  const pendingPublish=await service.read({...period,role:'DEPUTY_DIRECTOR'})
  assert.equal(pendingPublish.items.find(item=>item.stableItemKey==='active-a')?.approvalStatus,'PUBLISHED')
  assert.equal(Boolean(pendingPublish.items.find(item=>item.stableItemKey==='active-a')?.pendingModification),false)
  assert.equal(pendingPublish.items.find(item=>item.stableItemKey==='new-c')?.approvalStatus,'PENDING_PUBLISH')
  await service.decide({...period,role:'DEPUTY_DIRECTOR',action:'APPROVE',reason:'审批发布'})

  const current=(await db.pool.query(`SELECT current_published_version_id FROM "${schema}".monthly_plan WHERE monthly_plan_id=$1`,[plan.monthly_plan_id])).rows[0]
  const active=(await db.pool.query(`SELECT stable_item_key FROM "${schema}".monthly_plan_item WHERE plan_version_id=$1 AND NOT is_cancelled ORDER BY stable_item_key`,[current.current_published_version_id])).rows.map(row=>row.stable_item_key)
  assert.deepEqual(active,['active-a','new-c'])
  console.log('PASS: 发布仅应用本次申请明细，旧草稿不会恢复已取消车辆或触发错误删除校验')
}finally{
  await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await db.close()
}
