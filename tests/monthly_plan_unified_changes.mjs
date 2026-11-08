import assert from 'node:assert/strict'
import { createDatabase } from '../server/database.js'
import { loadConfig } from '../server/config.js'
import { createMonthlyPlanService } from '../server/monthly-plans.js'

const schema=`pc1_test_monthly_unified_${Date.now()}_${process.pid}`
const db=createDatabase({...loadConfig(),schema})
try{
  await db.init()
  const service=createMonthlyPlanService(db)
  const program=(await db.pool.query(`SELECT repair_program_id FROM "${schema}".repair_program ORDER BY repair_program_id LIMIT 1`)).rows[0]
  const firstId=Number((await db.pool.query(`SELECT COALESCE(max(vehicle_repair_id),0)+1 value FROM "${schema}".vehicle_repair`)).rows[0].value)
  const vehicles=[
    {id:firstId,no:'UNIFIED-UPDATE',date:'2198-12-03',approval:'PUBLISHED'},
    {id:firstId+1,no:'UNIFIED-DELETE',date:'2198-12-05',approval:'PUBLISHED'},
    {id:firstId+2,no:'UNIFIED-ADD',date:'2198-12-09',approval:'DRAFT'}
  ]
  for(const vehicle of vehicles) await db.pool.query(`INSERT INTO "${schema}".vehicle_repair(vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,status,approval_status,owner_bureau,owner_depot,plan_source,remark) VALUES($1,$2,$3,$4,'UNSCHEDULED',$5,'测试局','统一测试段','MONTHLY','统一变更测试')`,[vehicle.id,vehicle.no,program.repair_program_id,vehicle.date,vehicle.approval])

  const plan=(await db.pool.query(`INSERT INTO "${schema}".monthly_plan(plan_year,plan_month,plan_title,title_source) VALUES(2198,12,'新增修改删除统一审核测试','MANUAL') RETURNING monthly_plan_id`)).rows[0]
  const published=(await db.pool.query(`INSERT INTO "${schema}".monthly_plan_version(monthly_plan_id,version_no,owner_role,version_status,snapshot_title,published_at) VALUES($1,1,'DEPUTY_DIRECTOR','PUBLISHED','新增修改删除统一审核测试',now()) RETURNING plan_version_id`,[plan.monthly_plan_id])).rows[0]
  const stableKeys=['unified-update','unified-delete']
  for(let index=0;index<2;index+=1) await db.pool.query(`INSERT INTO "${schema}".monthly_plan_item(plan_version_id,stable_item_key,vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,remark,change_type) VALUES($1,$2,$3,$4,$5,$6,'测试局','统一测试段','正式基线','UNCHANGED')`,[published.plan_version_id,stableKeys[index],vehicles[index].id,vehicles[index].no,program.repair_program_id,vehicles[index].date])
  await db.pool.query(`UPDATE "${schema}".monthly_plan SET current_published_version_id=$1 WHERE monthly_plan_id=$2`,[published.plan_version_id,plan.monthly_plan_id])
  const draft=(await db.pool.query(`INSERT INTO "${schema}".monthly_plan_version(monthly_plan_id,version_no,base_version_id,owner_role,version_status,snapshot_title) VALUES($1,2,$2,'PLANNER','DRAFT','新增修改删除统一审核测试') RETURNING plan_version_id`,[plan.monthly_plan_id,published.plan_version_id])).rows[0]
  await db.pool.query(`INSERT INTO "${schema}".monthly_plan_item(plan_version_id,stable_item_key,vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,remark,change_type) SELECT $1,stable_item_key,vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,remark,'UNCHANGED' FROM "${schema}".monthly_plan_item WHERE plan_version_id=$2`,[draft.plan_version_id,published.plan_version_id])
  await db.pool.query(`INSERT INTO "${schema}".monthly_plan_item(plan_version_id,stable_item_key,vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,remark,change_type) VALUES($1,'unified-add',$2,$3,$4,$5,'测试局','统一测试段','新增事项','ADDED')`,[draft.plan_version_id,vehicles[2].id,vehicles[2].no,program.repair_program_id,vehicles[2].date])

  const period={year:2198,month:12}
  const formal=(await service.read({...period,role:'PLANNER'})).items.filter(item=>item.isPublished)
  const updateVehicle=formal.find(item=>item.stableItemKey==='unified-update')
  const deleteVehicle=formal.find(item=>item.stableItemKey==='unified-delete')
  await service.updateItem({...period,role:'PLANNER',vehicleRepairId:updateVehicle.vehicleRepairId,changeReason:'统一申请中的修改',values:{...updateVehicle,plannedEntryAt:'2198-12-13',remark:'修改事项'}})
  await service.deleteItem({...period,role:'PLANNER',vehicleRepairId:updateVehicle.vehicleRepairId})
  assert.ok(!(await service.read({...period,role:'PLANNER'})).draftItems.some(item=>item.stableItemKey==='unified-update'),'未提交修改副本应可取消且不影响正式车辆')
  await service.updateItem({...period,role:'PLANNER',vehicleRepairId:updateVehicle.vehicleRepairId,changeReason:'统一申请中的修改',values:{...updateVehicle,plannedEntryAt:'2198-12-13',remark:'修改事项'}})
  await service.deleteItem({...period,role:'PLANNER',vehicleRepairId:deleteVehicle.vehicleRepairId,changeReason:'统一申请中的删除'})
  await service.deleteItem({...period,role:'PLANNER',vehicleRepairId:deleteVehicle.vehicleRepairId,operation:'CANCEL_DELETE',cancelReason:'提交前取消删除测试'})
  assert.ok(!(await service.read({...period,role:'PLANNER'})).draftItems.some(item=>item.changeType==='DELETE'),'未提交删除标记应可取消并保留历史')
  await service.deleteItem({...period,role:'PLANNER',vehicleRepairId:deleteVehicle.vehicleRepairId,changeReason:'统一申请中的删除'})
  const beforeSubmit=await service.read({...period,role:'PLANNER'})
  assert.deepEqual(beforeSubmit.draftItems.map(item=>item.changeType).sort(),['ADDED','DELETE','MODIFIED'])
  const submitted=await service.submit({...period,role:'PLANNER',selectedItemKeys:beforeSubmit.draftItems.map(item=>item.stableItemKey),note:'新增修改删除统一提交',adjustReason:'统一变更流程测试'})
  assert.equal(submitted.selectedCount,3)
  const types=(await db.pool.query(`SELECT change_type FROM "${schema}".monthly_plan_application_item WHERE application_id=$1 ORDER BY change_type`,[submitted.applicationId])).rows.map(row=>row.change_type)
  assert.deepEqual(types,['ADDED','DELETE','MODIFIED'])
  assert.equal((await db.pool.query(`SELECT planned_entry_at::date::text value FROM "${schema}".vehicle_repair WHERE vehicle_repair_id=$1`,[updateVehicle.vehicleRepairId])).rows[0].value,'2198-12-03')
  assert.notEqual((await db.pool.query(`SELECT status FROM "${schema}".vehicle_repair WHERE vehicle_repair_id=$1`,[deleteVehicle.vehicleRepairId])).rows[0].status,'CANCELLED')

  assert.equal((await service.withdraw({...period,role:'PLANNER'})).status,'WITHDRAWN')
  const restored=await service.read({...period,role:'PLANNER'})
  assert.deepEqual(restored.draftItems.map(item=>item.changeType).sort(),['ADDED','DELETE','MODIFIED'])
  const resubmitted=await service.submit({...period,role:'PLANNER',selectedItemKeys:restored.draftItems.map(item=>item.stableItemKey),note:'撤回后重新统一提交',adjustReason:'统一变更流程测试'})
  assert.equal(resubmitted.selectedCount,3)
  const chiefDeletion=(await service.read({...period,role:'SECTION_CHIEF'})).items.find(item=>item.changeType==='DELETE'&&item.isPending)
  await service.updateDeletion({...period,role:'SECTION_CHIEF',deletionId:chiefDeletion.deletionId,deleteReason:'科长修订后的删除原因',deleteNote:'审核修订说明',changeReason:'补充删除依据'})
  assert.equal((await db.pool.query(`SELECT count(*)::int value FROM "${schema}".monthly_plan_revision_history WHERE application_id=$1`,[resubmitted.applicationId])).rows[0].value,1)

  assert.equal((await service.decide({...period,role:'SECTION_CHIEF',action:'APPROVE'})).status,'REVIEWED')
  const reviewedItems=(await service.read({...period,role:'SECTION_CHIEF'})).items.filter(item=>item.isReviewedPending)
  assert.equal(reviewedItems.length,3)
  assert.equal((await service.requestPublish({...period,role:'SECTION_CHIEF',selectedItemKeys:reviewedItems.map(item=>item.stableItemKey),note:'科长勾选紫色事项申请发布',adjustReason:'统一变更流程测试'})).status,'PENDING_PUBLISH')
  assert.equal((await service.decide({...period,role:'DEPUTY_DIRECTOR',action:'APPROVE',reason:'统一审批发布'})).status,'PUBLISHED')
  const final=await service.read({...period,role:'PLANNER'})
  assert.equal(final.items.find(item=>item.stableItemKey==='unified-update'&&item.isPublished).plannedEntryAt.slice(0,10),'2198-12-13')
  assert.ok(final.items.some(item=>item.stableItemKey==='unified-add'&&item.isPublished))
  assert.ok(!final.items.some(item=>item.stableItemKey==='unified-delete'&&item.isPublished))
  const deletionStatuses=(await db.pool.query(`SELECT delete_status FROM "${schema}".monthly_plan_deletion ORDER BY deletion_id`)).rows.map(row=>row.delete_status)
  assert.deepEqual(deletionStatuses,['CANCELLED','PUBLISHED'],'提交前取消记录与最终发布记录都必须保留')
  console.log('PASS: 新增、修改、删除三类事项统一勾选、统一审核并在最终发布时生效')
}finally{
  await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await db.close()
}
