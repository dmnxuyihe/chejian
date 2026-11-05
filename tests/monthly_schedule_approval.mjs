import assert from 'node:assert/strict'
import { createState } from '../src/core/state.js'
import { commitImport, parseCsv, templateCsv } from '../src/core/plan-import.js'
import { simulatePc1, confirmPc1Preview } from '../src/core/pc1-simulation.js'
import { processPlanFlow } from '../src/core/planning-json-workflow.js'
import { requestMonthlyPlanRevision } from '../src/core/planning-json-workflow.js'

const state=createState()
const {ids}=commitImport(state,parseCsv(templateCsv))
const simulated=simulatePc1(state,ids,'2026-11-15T18:00:00')
assert.equal(simulated.ok,true,simulated.issues?.join('\n'))
state.pc1SchedulePreview=simulated.preview
const confirmed=confirmPc1Preview(state)
assert.equal(confirmed.ok,true)
assert.equal(confirmed.approvalFlows,2)
assert.equal(confirmed.dispatches,0,'确认排程不能提前下发班组')
for(const id of ids){
  const vehicle=state.vehicleRepairs.find(row=>row.id===id)
  const version=state.scheduleVersions.find(row=>row.id===vehicle.currentVersionId)
  const flow=state.planApprovalFlows.find(row=>row.entityType==='MONTHLY'&&row.entityId===id&&row.status==='SUBMITTED')
  assert.equal(vehicle.approvalStatus,'SUBMITTED')
  assert.equal(version.status,'DRAFT')
  assert.ok(flow,'确认排程后应自动生成月度计划审批记录')
  assert.equal(processPlanFlow(state,flow.id,'REVIEW','主管科长审核通过').ok,true)
  assert.equal(vehicle.approvalStatus,'REVIEWED')
  assert.equal(version.status,'DRAFT','审核阶段仍不能发布排程')
  assert.equal(processPlanFlow(state,flow.id,'PUBLISH','主管副段长审批发布').ok,true)
  assert.equal(vehicle.approvalStatus,'PUBLISHED')
  assert.equal(version.status,'PUBLISHED')
  assert.ok(state.pc1Dispatches.some(row=>row.vehicleRepairId===id&&row.versionId===version.id),'审批发布后应生成班组任务')
}
console.log('PASS: 模拟完成 → 确认排程 → 自动提报 → 科长审核 → 副段长审批发布 → 班组下发')

{
  const editState=createState(),{ids:editIds}=commitImport(editState,parseCsv(templateCsv)),id=editIds[0]
  const preview=simulatePc1(editState,[id],'2026-11-15T18:00:00');editState.pc1SchedulePreview=preview.preview;confirmPc1Preview(editState,{planName:'修改流程测试',note:'首次提报'})
  assert.equal(simulatePc1(editState,[id],'2026-11-15T18:00:00').ok,false,'待审核计划必须只读')
  assert.equal(requestMonthlyPlanRevision(editState,id,'调整上台时间').ok,true)
  assert.equal(editState.vehicleRepairs.find(row=>row.id===id).approvalStatus,'REVISING')
  const rerun=simulatePc1(editState,[id],'2026-11-15T18:00:00');assert.equal(rerun.ok,true);editState.pc1SchedulePreview=rerun.preview;confirmPc1Preview(editState,{planName:'修改流程测试第2版',note:'修改后重新提报'})
  const flows=editState.planApprovalFlows.filter(row=>row.entityType==='MONTHLY'&&row.entityId===id)
  assert.deepEqual(flows.map(row=>row.status),['REJECTED','SUBMITTED'])
}
console.log('PASS: 待审核只读 → 确认修改 → 待修改 → 新版本重新提报，原审批历史保留')
