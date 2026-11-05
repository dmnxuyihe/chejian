import assert from 'node:assert/strict'
import { createDatabase } from '../server/database.js'
import { createPlanningService } from '../server/planning.js'
import { loadConfig } from '../server/config.js'
import { exportDemoSnapshot } from '../src/core/demo-persistence.js'
import { commitImport, parseCsv, templateCsv } from '../src/core/plan-import.js'
import { simulatePc1, confirmPc1Preview } from '../src/core/pc1-simulation.js'
import { processPlanFlow, requestMonthlyPlanAdjustment, requestMonthlyPlanRevision, saveMonthlyVerification } from '../src/core/planning-json-workflow.js'
import { monthlyVerificationPage } from '../src/roles/planning/pages/monthly-verification-v4.js'

const config=loadConfig(),schema=`pc1_test_monthly_tools_${Date.now()}_${process.pid}`
let db=createDatabase({...config,schema}),sequence=0
const checks=[]
const persist=async data=>{const current=await db.read();await db.save(current.revision,exportDemoSnapshot(data));return (await db.read()).snapshot.data}
const command=async(type,payload,actor='工具经办')=>db.toolCommand({type,payload,actor,requestId:`merge-${++sequence}`,revision:(await db.read()).revision})
try{
  await db.init()
  const warehouse=await command('WAREHOUSE_SAVE',{code:'MERGE',name:'合版工具库'})
  const tool=await command('TOOL_SAVE',{code:'MERGE-TOOL',name:'合版工具',lowStock:1})
  const asset=await command('ASSET_CREATE',{toolId:tool.id,warehouseId:warehouse.id,code:'MERGE-ASSET',mode:'BULK',quantity:5})
  let state=(await db.read()).snapshot.data
  const {ids}=commitImport(state,parseCsv(templateCsv))
  const run=simulatePc1(state,ids,'2026-11-15T18:00:00');assert.equal(run.ok,true)
  state.pc1SchedulePreview=run.preview
  assert.equal(confirmPc1Preview(state,{planName:'合版月度计划',note:'合版审批验证'}).ok,true)
  state=await persist(state)
  const flows=state.planApprovalFlows.filter(f=>ids.includes(f.entityId)&&f.entityType==='MONTHLY')
  assert.equal(flows.length,2)
  assert.ok(flows.every(f=>f.versionId&&f.status==='SUBMITTED'))
  assert.equal(state.pc1Dispatches.filter(d=>ids.includes(d.vehicleRepairId)).length,0)
  assert.equal(simulatePc1(state,ids,'2026-11-15T18:00:00').ok,false)
  checks.push('提交冻结版本，审批前不下发且禁止直接重排')

  const loan=await command('BORROW',{assetId:asset.id,quantity:2,borrower:'合版领用人',dueAt:'2099-01-01T12:00:00'})
  state=(await db.read()).snapshot.data
  for(const flow of state.planApprovalFlows.filter(f=>ids.includes(f.entityId)&&f.entityType==='MONTHLY')){
    assert.equal(processPlanFlow(state,flow.id,'PUBLISH','越级发布').ok,false)
    assert.equal(processPlanFlow(state,flow.id,'REVIEW','审核通过').ok,true)
    assert.equal(processPlanFlow(state,flow.id,'PUBLISH','审批发布').ok,true)
  }
  state=await persist(state)
  assert.ok(state.pc1Dispatches.some(d=>ids.includes(d.vehicleRepairId)))
  assert.equal(state.toolManagement.loans.find(l=>l.id===loan.id).status,'OPEN')
  const planAudit=(await db.pool.query(`SELECT approval_level,approval_status FROM "${schema}".approval_record WHERE business_type='MONTHLY_PLAN' ORDER BY approval_id`)).rows
  assert.equal(planAudit.length,4);assert.ok(planAudit.every(row=>row.approval_status==='APPROVED'))
  checks.push('工具借用与两级月度审批相互保留，发布后生成任务清单')

  const id=ids[0],oldFlow=state.planApprovalFlows.find(f=>f.entityId===id&&f.entityType==='MONTHLY')
  const oldVersion=oldFlow.versionId
  assert.equal(requestMonthlyPlanAdjustment(state,id,'工位时间需要调整').ok,true)
  assert.equal(state.vehicleRepairs.find(v=>v.id===id).approvalStatus,'REVISING')
  const rerun=simulatePc1(state,[id],'2026-11-15T18:00:00');assert.equal(rerun.ok,true)
  state.pc1SchedulePreview=rerun.preview;assert.equal(confirmPc1Preview(state).ok,true)
  state=await persist(state)
  assert.equal(state.planApprovalFlows.find(f=>f.id===oldFlow.id).versionId,oldVersion)
  let pending=state.planApprovalFlows.find(f=>f.entityId===id&&f.status==='SUBMITTED')
  assert.notEqual(pending.versionId,oldVersion)
  assert.equal(requestMonthlyPlanRevision(state,id,'撤回再修改').ok,true)
  assert.equal(state.planApprovalFlows.find(f=>f.id===pending.id).status,'REJECTED')
  state=await persist(state)
  checks.push('申请调整后才允许重排，旧版本与撤回审批历史保留')

  const disposal=await command('DISPOSAL_REQUEST',{assetId:asset.id,loanId:loan.id,quantity:1,kind:'LOST',reason:'合版遗失审核'})
  await command('DISPOSAL_REVIEW',{id:disposal.id,decision:'APPROVED',opinion:'独立审核确认'},'工具审核人')
  const approval=(await db.pool.query(`SELECT approval_status,approval_opinion FROM "${schema}".approval_record WHERE business_type='TOOL_DISPOSAL' AND business_id=$1`,[disposal.id])).rows[0]
  assert.equal(approval.approval_status,'APPROVED');assert.equal(approval.approval_opinion,'独立审核确认')
  await command('RETURN',{loanId:loan.id,assetId:asset.id,quantity:1,returner:'合版归还人'})
  checks.push('借出遗失审核物理入表，剩余工具归还结清')

  const planning=createPlanningService(db)
  const csv='\uFEFF机车编号,机型,修程,修次,计划入段日期,配属局,配属段,累计走行公里,备注\r\nMERGE-IMPORT,HXD1C,HXD1C高级修,1,2027-01-31,测试局,测试段,100,原备注\r\n'
  let preview=await planning.preview({sessionId:'merge-session',importType:'MONTHLY',month:'2027-01',filename:'merge.csv',contentBase64:Buffer.from(csv).toString('base64')})
  const line=preview.rows[0].line
  preview=await planning.updatePreviewRow('merge-session',preview.id,line,{mileageKm:'200'})
  assert.equal(preview.importable,1);assert.equal(preview.rows[0].data.remark,'原备注')
  assert.equal(preview.rows[0].data.locomotiveNo,'MERGE-IMPORT')
  preview=await planning.updatePreviewRow('merge-session',preview.id,line,{remark:'修改后备注',plannedEntryAt:'2027-02-30'})
  assert.equal(preview.importable,0)
  preview=await planning.updatePreviewRow('merge-session',preview.id,line,{plannedEntryAt:'2027-01-31'})
  assert.equal(preview.importable,1)
  assert.equal((await planning.confirm('merge-session',preview.id)).imported,1)
  const imported=(await db.pool.query(`SELECT remark,mileage_km FROM "${schema}".vehicle_repair WHERE locomotive_no='MERGE-IMPORT'`)).rows[0]
  assert.equal(imported.remark,'修改后备注');assert.equal(Number(imported.mileage_km),200)
  checks.push('导入部分字段编辑不丢其他字段，日期重新校验，备注原样保存')

  state=(await db.read()).snapshot.data
  const month=`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`
  const dayCount=new Date(new Date().getFullYear(),new Date().getMonth()+1,0).getDate()
  assert.equal(saveMonthlyVerification(state,{vehicleRepairId:ids[1],date:`${month}-${dayCount}`,result:'PASSED',depot:'合版交验段'}).ok,true)
  state=await persist(state)
  assert.match(monthlyVerificationPage.render({state}),new RegExp(`data-trend-day="${dayCount}"`))
  const beforeClose=await db.read()
  await db.close();db=createDatabase({...config,schema});await db.init()
  const reopened=await db.read()
  for(const collection of ['planApprovalFlows','monthlyPlanAdjustmentHistory','monthlyVerificationRecords','toolManagement','approvalRecords'])assert.deepEqual(reopened.snapshot.data[collection],beforeClose.snapshot.data[collection],collection)
  checks.push('交验月底统计与审批、工具台账均可重连恢复')
  console.log(JSON.stringify({passed:true,checks},null,2))
}finally{
  assert.match(schema,/^pc1_test_monthly_tools_\d+_\d+$/)
  await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await db.close()
}
