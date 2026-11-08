import assert from 'node:assert/strict'
import { createDatabase } from '../server/database.js'
import { loadConfig } from '../server/config.js'
import { createMonthlyPlanService } from '../server/monthly-plans.js'

const schema=`pc1_test_monthly_selection_${Date.now()}_${process.pid}`
const db=createDatabase({...loadConfig(),schema})
try{
  await db.init()
  const service=createMonthlyPlanService(db)
  const source=(await db.pool.query(`SELECT repair_program_id FROM "${schema}".vehicle_repair WHERE repair_program_id IS NOT NULL ORDER BY vehicle_repair_id LIMIT 1`)).rows[0]
  const nextId=Number((await db.pool.query(`SELECT COALESCE(max(vehicle_repair_id),0)+1 value FROM "${schema}".vehicle_repair`)).rows[0].value)
  await db.pool.query(`INSERT INTO "${schema}".vehicle_repair(vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,status,approval_status,owner_bureau,owner_depot,plan_source,remark) VALUES($1,'SELECT-TEST',$2,'2199-01-01','UNSCHEDULED','DRAFT','测试局','测试段','MONTHLY','选择提交测试')`,[nextId,source.repair_program_id])
  await db.pool.query(`INSERT INTO "${schema}".vehicle_repair(vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,status,approval_status,owner_bureau,owner_depot,plan_source,remark) VALUES($1,'SELECT-TEST-2',$2,'2199-01-01','UNSCHEDULED','DRAFT','测试局','测试段','MONTHLY','选择提交测试')`,[nextId+1,source.repair_program_id])
  const base=[{vehicle_repair_id:nextId,repair_program_id:source.repair_program_id,locomotive_no:'SELECT-TEST',owner_bureau:'测试局',owner_depot:'测试段',repair_sequence:null,mileage_km:null,remark:'选择提交测试'},{vehicle_repair_id:nextId+1,repair_program_id:source.repair_program_id,locomotive_no:'SELECT-TEST-2',owner_bureau:'测试局',owner_depot:'测试段',repair_sequence:null,mileage_km:null,remark:'选择提交测试'}]
  const plan=(await db.pool.query(`INSERT INTO "${schema}".monthly_plan(plan_year,plan_month,plan_title,title_source) VALUES(2199,1,'选择提交测试','MANUAL') RETURNING monthly_plan_id`)).rows[0]
  const version=(await db.pool.query(`INSERT INTO "${schema}".monthly_plan_version(monthly_plan_id,version_no,owner_role,version_status,snapshot_title) VALUES($1,1,'PLANNER','DRAFT','选择提交测试') RETURNING plan_version_id`,[plan.monthly_plan_id])).rows[0]
  for(const [index,row] of base.entries()) await db.pool.query(`INSERT INTO "${schema}".monthly_plan_item(plan_version_id,stable_item_key,vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,repair_sequence,mileage_km,remark,change_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ADDED')`,[version.plan_version_id,`selection-${index}`,row.vehicle_repair_id,row.locomotive_no,row.repair_program_id,'2199-01-0'+(index+1),row.owner_bureau,row.owner_depot,row.repair_sequence,row.mileage_km,row.remark])
  const input={year:2199,month:1}
  const before=await service.read({...input,role:'PLANNER'}), selected=before.draftItems[0].stableItemKey
  assert.equal(before.draftItems.length,2)
  await assert.rejects(()=>service.submit({...input,role:'PLANNER',note:'禁止默认提交全部'}),/必须明确选择/)
  const submitted=await service.submit({...input,role:'PLANNER',selectedItemKeys:[selected],note:'只提交一辆'})
  assert.equal(submitted.selectedCount,1)
  const planner=await service.read({...input,role:'PLANNER'})
  assert.equal(planner.application.selectedCount,1)
  assert.equal(planner.items.filter(item=>item.isPending).length,1)
  assert.equal(planner.items.filter(item=>item.isDraft).length,1)
  const remaining=planner.items.find(item=>item.isDraft)
  await service.updateItem({...input,role:'PLANNER',vehicleRepairId:remaining.vehicleRepairId,values:{...remaining,plannedEntryAt:'2199-01-04',remark:'未提交草稿仍可编辑'}})
  const chief=await service.read({...input,role:'SECTION_CHIEF'})
  const pending=chief.items.find(item=>item.isPending)
  assert.equal(pending.canReviewEdit,true)
  await service.updateItem({...input,role:'SECTION_CHIEF',vehicleRepairId:pending.vehicleRepairId,changeReason:'科长调整入段日期',values:{...pending,plannedEntryAt:'2199-01-03',repairSequence:2}})
  assert.equal((await db.pool.query(`SELECT count(*)::int value FROM "${schema}".monthly_plan_revision_history`)).rows[0].value,1)
  const reviewed=await service.decide({...input,role:'SECTION_CHIEF',action:'APPROVE'})
  assert.equal(reviewed.status,'REVIEWED')
  const reviewedKeys=(await service.read({...input,role:'SECTION_CHIEF'})).items.filter(item=>item.isReviewedPending).map(item=>item.stableItemKey)
  await service.requestPublish({...input,role:'SECTION_CHIEF',selectedItemKeys:reviewedKeys,note:'科长申请发布',adjustReason:'选择申请发布测试'})
  assert.equal((await service.read({...input,role:'DEPUTY_DIRECTOR'})).application.status,'PENDING_PUBLISH')
  await service.decide({...input,role:'DEPUTY_DIRECTOR',action:'APPROVE'})
  const published=await service.read({...input,role:'PLANNER'})
  assert.equal(published.status,'已发布')
  assert.equal(published.items.filter(item=>item.isPublished).length,1)
  assert.equal(published.items.filter(item=>item.isDraft).length,1)
  const formal=published.items.find(item=>item.isPublished)
  await service.updateItem({...input,role:'SECTION_CHIEF',vehicleRepairId:formal.vehicleRepairId,changeReason:'chief-only-draft',values:{...formal,plannedEntryAt:'2199-01-06'}})
  const chiefDraftOnly=(await service.read({...input,role:'SECTION_CHIEF'})).draftItems.find(item=>item.vehicleRepairId===formal.vehicleRepairId)
  assert.ok(chiefDraftOnly,'chief own draft should be visible')
  await service.requestPublish({...input,role:'SECTION_CHIEF',selectedItemKeys:[chiefDraftOnly.stableItemKey],note:'科长直接申请发布自己的草稿',adjustReason:'chief-only-draft-publish-test'})
  assert.equal((await service.read({...input,role:'DEPUTY_DIRECTOR'})).application.status,'PENDING_PUBLISH')
  await service.decide({...input,role:'DEPUTY_DIRECTOR',action:'APPROVE'})
  const itemCountBeforeDelete=Number((await db.pool.query(`SELECT count(*) value FROM "${schema}".monthly_plan_item`)).rows[0].value)
  await service.deleteItem({...input,role:'PLANNER',vehicleRepairId:formal.vehicleRepairId,changeReason:'取消申请测试'})
  assert.equal(Number((await db.pool.query(`SELECT count(*) value FROM "${schema}".monthly_plan_item`)).rows[0].value),itemCountBeforeDelete,'删除申请不得复制车辆快照行')
  const deletionRead=await service.read({...input,role:'PLANNER'})
  const cancellation=deletionRead.draftItems.find(item=>item.changeType==='DELETE')
  assert.ok(cancellation?.selectableDraft&&cancellation.isDeletionMarker,'独立删除事项必须可见、可勾选提交')
  await service.submit({...input,role:'PLANNER',selectedItemKeys:[cancellation.stableItemKey],note:'只提交删除事项',adjustReason:'删除正式车辆测试'})
  assert.ok((await service.read({...input,role:'SECTION_CHIEF'})).items.some(item=>item.isPending&&item.changeType==='DELETE'),'科长必须能看到删除事项')
  await service.decide({...input,role:'SECTION_CHIEF',action:'REJECT',reason:'取消申请驳回测试'})
  const afterReject=await service.read({...input,role:'PLANNER'})
  assert.ok(afterReject.items.some(item=>item.isPublished&&item.vehicleRepairId===formal.vehicleRepairId),'驳回取消申请不得影响原正式车辆')
  assert.ok(afterReject.draftItems.some(item=>item.changeType==='DELETE'),'驳回后删除事项应恢复给申请人')
  const remainingAfterReject=afterReject.draftItems.find(item=>item.changeType!=='DELETE')
  await service.submit({...input,role:'PLANNER',selectedItemKeys:[remainingAfterReject.stableItemKey],note:'接管流程测试',adjustReason:'追加一辆正式车辆'})
  await service.takeover({...input,role:'DEPUTY_DIRECTOR',reason:'科长不在岗，由副段长接管'})
  assert.equal((await service.read({...input,role:'DEPUTY_DIRECTOR'})).application.status,'PENDING_PUBLISH')
  await service.decide({...input,role:'DEPUTY_DIRECTOR',action:'APPROVE',reason:'接管后审批发布'})
  assert.ok((await service.read({...input,role:'PLANNER'})).items.some(item=>item.isPublished&&item.stableItemKey===remainingAfterReject.stableItemKey),'接管发布必须只应用该申请选中的草稿')
  const deputy=await service.read({...input,role:'DEPUTY_DIRECTOR'})
  const deputyDraft=(await db.pool.query(`SELECT plan_version_id FROM "${schema}".monthly_plan_version WHERE monthly_plan_id=$1 AND owner_role='DEPUTY_DIRECTOR' AND version_status='DRAFT'`,[plan.monthly_plan_id])).rows[0]
  await db.pool.query(`INSERT INTO "${schema}".vehicle_repair(vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,status,approval_status,owner_bureau,owner_depot,plan_source,remark) VALUES($1,'DIRECT-TEST',$2,'2199-01-05','UNSCHEDULED','DRAFT','测试局','测试段','MONTHLY','副段长直接发布')`,[nextId+2,source.repair_program_id])
  await db.pool.query(`INSERT INTO "${schema}".monthly_plan_item(plan_version_id,stable_item_key,vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,remark,change_type) VALUES($1,'direct-test',$2,'DIRECT-TEST',$3,'2199-01-05','测试局','测试段','副段长直接发布','ADDED')`,[deputyDraft.plan_version_id,nextId+2,source.repair_program_id])
  await service.directPublish({...input,role:'DEPUTY_DIRECTOR',selectedItemKeys:['direct-test'],note:'直接发布测试'})
  assert.equal((await db.pool.query(`SELECT count(*)::int value FROM "${schema}".monthly_plan_publication_history WHERE publish_method='DIRECT_PUBLISH'`)).rows[0].value,1)
  console.log('PASS: 勾选车辆提交、剩余草稿保留、科长审核修订历史和副段长发布')
}finally{
  await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await db.close()
}
