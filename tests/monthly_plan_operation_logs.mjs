import assert from 'node:assert/strict'
import { createDatabase } from '../server/database.js'
import { loadConfig } from '../server/config.js'
import { createMonthlyPlanService } from '../server/monthly-plans-v2.js'

const schema=`pc1_test_monthly_logs_${Date.now()}_${process.pid}`
const db=createDatabase({...loadConfig(),schema})
try{
  await db.init()
  const service=createMonthlyPlanService(db)
  const dictionary=(await db.pool.query(`SELECT lm.model_name,rp.repair_program_name FROM "${schema}".repair_program rp JOIN "${schema}".locomotive_model lm ON lm.model_id=rp.model_id WHERE rp.repair_program_name='C1' ORDER BY rp.repair_program_id LIMIT 1`)).rows[0]
  const period={year:2198,month:9}
  const values=(locomotiveNo,day)=>({modelName:dictionary.model_name,repairProgramName:dictionary.repair_program_name,locomotiveNo,repairSequence:1,plannedEntryAt:`2198-09-${String(day).padStart(2,'0')}`,ownerBureau:'哈尔滨局',ownerDepot:'哈尔滨机务段',mileageKm:100,remark:'日志测试'})

  await service.createDraftItem({...period,role:'PLANNER',values:values('LOG-PLANNER',3)})
  await service.createDraftItem({...period,role:'SECTION_CHIEF',values:values('LOG-CHIEF',4)})
  await service.createDraftItem({...period,role:'DEPUTY_DIRECTOR',values:values('LOG-DEPUTY',5)})

  const plannerInitial=await service.logs({...period,role:'PLANNER'})
  const chiefInitial=await service.logs({...period,role:'SECTION_CHIEF'})
  const deputyInitial=await service.logs({...period,role:'DEPUTY_DIRECTOR'})
  assert.deepEqual(plannerInitial.items.map(row=>row.actionType),['DRAFT_CREATED'])
  assert.deepEqual(chiefInitial.items.map(row=>row.actionType),['DRAFT_CREATED'])
  assert.deepEqual(deputyInitial.items.map(row=>row.actionType),['DRAFT_CREATED'])
  await assert.rejects(()=>service.logs({...period,role:'SECTION_CHIEF',logId:plannerInitial.items[0].id}),/无权查看|不存在/)

  const countBeforeFailure=Number((await db.pool.query(`SELECT count(*) value FROM "${schema}".monthly_plan_operation_log`)).rows[0].value)
  await assert.rejects(()=>service.createDraftItem({...period,role:'PLANNER',values:values('LOG-PLANNER',6)}),/不能重复|已存在/)
  assert.equal(Number((await db.pool.query(`SELECT count(*) value FROM "${schema}".monthly_plan_operation_log`)).rows[0].value),countBeforeFailure,'失败业务不得留下成功日志')

  let plannerItem=(await service.read({...period,role:'PLANNER'})).draftItems.find(row=>row.locomotiveNo==='LOG-PLANNER')
  for(let index=1;index<=21;index+=1){
    await service.updateItem({...period,role:'PLANNER',vehicleRepairId:plannerItem.id,draftItemId:plannerItem.draftItemId,values:{...plannerItem,plannedEntryAt:plannerItem.plannedEntryAt.slice(0,10),remark:`第${index}次私人修改`}})
    plannerItem=(await service.read({...period,role:'PLANNER'})).draftItems.find(row=>row.stableItemKey===plannerItem.stableItemKey)
  }
  const firstPage=await service.logs({...period,role:'PLANNER',page:1,pageSize:20})
  const secondPage=await service.logs({...period,role:'PLANNER',page:2,pageSize:20})
  assert.equal(firstPage.total,22)
  assert.equal(firstPage.items.length,20)
  assert.equal(secondPage.items.length,2)
  assert.ok(firstPage.items.every((row,index,items)=>index===0||items[index-1].id>row.id),'日志必须按时间和编号倒序')

  const submitted=await service.submit({...period,role:'PLANNER',note:'提交日志测试申请'})
  for(const role of ['PLANNER','SECTION_CHIEF','DEPUTY_DIRECTOR']){
    const publicLogs=await service.logs({...period,role,actionType:'APPLICATION_SUBMITTED'})
    assert.equal(publicLogs.total,1,`${role}应看到公开申请日志`)
    assert.equal(publicLogs.items[0].applicationId,submitted.applicationId)
  }
  assert.equal((await service.logs({...period,role:'SECTION_CHIEF'})).items.some(row=>row.actionType==='DRAFT_UPDATED'),false,'科长不能看到计划员私人编辑过程')

  const submittedItem=(await db.pool.query(`SELECT i.item_id FROM "${schema}".monthly_plan_application a JOIN "${schema}".monthly_plan_item i ON i.plan_version_id=a.submitted_version_id WHERE a.application_id=$1 AND i.change_type<>'UNCHANGED' LIMIT 1`,[submitted.applicationId])).rows[0]
  await service.updateItem({...period,role:'SECTION_CHIEF',vehicleRepairId:submittedItem.item_id,values:{...values('LOG-PLANNER',3),remark:'科长审核修订'},changeReason:'核对资料后修订备注'})
  for(const role of ['PLANNER','SECTION_CHIEF','DEPUTY_DIRECTOR']){
    const revisionLogs=await service.logs({...period,role,actionType:'WORKING_CHANGE_UPDATED'})
    assert.equal(revisionLogs.items.some(row=>row.applicationId===submitted.applicationId),true,`${role}应看到公开的审核修订日志`)
  }

  await service.decide({...period,role:'SECTION_CHIEF',action:'APPROVE',reason:'审核同意'})
  await service.decide({...period,role:'DEPUTY_DIRECTOR',action:'APPROVE',reason:'审批发布'})
  const publishLog=(await service.logs({...period,role:'PLANNER',actionType:'DEPUTY_APPROVED_PUBLISH'})).items[0]
  assert.ok(publishLog)
  const detail=(await service.logs({...period,role:'PLANNER',logId:publishLog.id})).item
  assert.equal(detail.details.beforeVehicleCount,0)
  assert.equal(detail.details.addedCount,1)
  assert.equal(detail.details.deletedCount,0)
  assert.equal(detail.details.afterVehicleCount,1)
  assert.equal(detail.details.afterVehicleCount,detail.details.beforeVehicleCount+detail.details.addedCount-detail.details.deletedCount)
  assert.equal((await service.logs({...period,role:'PLANNER',actionType:'VEHICLE_FORMALLY_ADDED'})).total,1)
  assert.equal((await service.logs({...period,role:'PLANNER',actionType:'CHIEF_REVIEW_APPROVED'})).total,1)

  console.log('PASS: 月度日志私有/公开隔离、事务回滚、倒序分页、审批及发布摘要正确')
}finally{
  await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await db.close()
}
