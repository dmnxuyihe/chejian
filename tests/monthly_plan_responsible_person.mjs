import assert from 'node:assert/strict'
import { createDatabase } from '../server/database.js'
import { loadConfig } from '../server/config.js'
import { createMonthlyPlanService } from '../server/monthly-plans-v2.js'

const schema=`pc1_test_monthly_responsible_${Date.now()}_${process.pid}`
const db=createDatabase({...loadConfig(),schema})
try{
  await db.init()
  const service=createMonthlyPlanService(db)
  const program=(await db.pool.query(`SELECT repair_program_id FROM "${schema}".repair_program ORDER BY repair_program_id LIMIT 1`)).rows[0]
  const plan=(await db.pool.query(`INSERT INTO "${schema}".monthly_plan(plan_year,plan_month,plan_title,title_source) VALUES(2198,12,'责任人测试月计划','MANUAL') RETURNING monthly_plan_id`)).rows[0]
  const version=(await db.pool.query(`INSERT INTO "${schema}".monthly_plan_version(monthly_plan_id,version_no,owner_role,version_status,snapshot_title) VALUES($1,1,'PLANNER','DRAFT','责任人测试月计划') RETURNING plan_version_id`,[plan.monthly_plan_id])).rows[0]
  await db.pool.query(`INSERT INTO "${schema}".monthly_plan_item(plan_version_id,stable_item_key,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,repair_sequence,change_type) VALUES($1,'responsible-1','RESP-001',$2,'2198-12-08','郑州局','郑州机务段',1,'ADDED')`,[version.plan_version_id,program.repair_program_id])

  const period={year:2198,month:12}
  const submitted=await service.submit({...period,role:'PLANNER',note:'责任人申请测试'})
  assert.equal(submitted.status,'PENDING_REVIEW')
  const application=(await db.pool.query(`SELECT application_status,handler_name FROM "${schema}".monthly_plan_application WHERE application_id=$1`,[submitted.applicationId])).rows[0]
  assert.deepEqual(application,{application_status:'PENDING_REVIEW',handler_name:'计划员'})

  await service.decide({...period,role:'SECTION_CHIEF',action:'APPROVE'})
  const review=(await db.pool.query(`SELECT responsible_person FROM "${schema}".approval_record WHERE business_type='MONTHLY_PLAN_APPLICATION' AND business_id=$1 AND approval_status='APPROVED' ORDER BY approval_id DESC LIMIT 1`,[submitted.applicationId])).rows[0]
  assert.equal(review.responsible_person,'运用科主管科长')

  await service.decide({...period,role:'DEPUTY_DIRECTOR',action:'APPROVE',reason:'责任人发布测试'})
  const publication=(await db.pool.query(`SELECT responsible_person FROM "${schema}".monthly_plan_publication_history WHERE application_id=$1 ORDER BY publication_id DESC LIMIT 1`,[submitted.applicationId])).rows[0]
  assert.equal(publication.responsible_person,'主管副段长')
  console.log('PASS: 申请经办人、审核责任人、审批发布责任人均由当前模拟登录用户自动写入')
}finally{
  await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await db.close()
}
