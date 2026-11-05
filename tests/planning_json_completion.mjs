import assert from 'node:assert/strict'
import { createState } from '../src/core/state.js'
import { saveAnnualAdjustment,saveComponentMonthlyRecord,saveMonthlyVerification,saveComponentTemporaryPlan,submitPlanFlow,processPlanFlow,requestMonthlyPlanAdjustment } from '../src/core/planning-json-workflow.js'
import { createTemporaryRepairPlan } from '../src/core/temporary-repair-plan.js'
import { exportDemoSnapshot,parseDemoSnapshot } from '../src/core/demo-persistence.js'
import { parseComponentMonthlyFile } from '../server/temporary-repair-import.js'
import { ensurePlanningDemoData } from '../src/data/planning-demo-data.js'

const state=createState(),file={name:'方案.pdf',mimeType:'application/pdf',bytes:4,contentBase64:'JVBERg=='}
assert.equal(saveAnnualAdjustment(state,{year:2026,month:11,modelId:1,programId:1,baseline:5,adjusted:6,actual:4,deliveryDays:20}).ok,true)
assert.equal(saveComponentMonthlyRecord(state,{month:'2026-11',direction:'UP',componentTypeId:3,planned:4,calculated:4,mileageKm:500000}).ok,true)
assert.equal(saveMonthlyVerification(state,{vehicleRepairId:1,date:'2026-11-05',depot:'模拟段',result:'PASSED'}).ok,true)
assert.equal(saveComponentTemporaryPlan(state,{name:'车轴',modelId:1,serialNo:'CT-001',specification:'HXD1C',plannedEntryAt:'2026-11-10T08:00',content:'轴颈临修',solutionAttachment:file}).ok,true)
assert.equal(createTemporaryRepairPlan(state,{ownerDepot:'模拟段',modelId:1,locomotiveNo:'LX-001',plannedEntryAt:'2026-11-10T08:00',plannedPlatformAt:'2026-11-10T10:00',content:'整车临修',solutionAttachment:file}).ok,true)
const componentFlow=submitPlanFlow(state,'TEMP_COMPONENT',1,'技术科提报');assert.equal(componentFlow.ok,true);assert.equal(processPlanFlow(state,componentFlow.id,'REVIEW','审核发布').ok,true);assert.equal(state.componentTemporaryPlans[0].status,'PUBLISHED')
const vehicleFlow=submitPlanFlow(state,'TEMP_VEHICLE',1,'方案提报');assert.equal(processPlanFlow(state,vehicleFlow.id,'REVIEW','技术审核').ok,true);assert.equal(processPlanFlow(state,vehicleFlow.id,'PUBLISH','领导审批').ok,true);assert.equal(state.temporaryRepairPlans[0].status,'PUBLISHED')
const monthlyFlow=submitPlanFlow(state,'MONTHLY',1,'月计划提报');assert.equal(processPlanFlow(state,monthlyFlow.id,'REVIEW','科长审核').ok,true);assert.equal(processPlanFlow(state,monthlyFlow.id,'PUBLISH','副段长发布').ok,true);assert.equal(state.vehicleRepairs[0].approvalStatus,'PUBLISHED')
assert.equal(requestMonthlyPlanAdjustment(state,1,'季度任务变化，需要调整入段日期').ok,true);assert.equal(state.vehicleRepairs[0].approvalStatus,'DRAFT')
const componentCsv='\uFEFF月份,方向,配件名称,计划数量,测算数量,匹配公里\r\n2026-12,上车,车轮,4,4,510000\r\n'
assert.equal(parseComponentMonthlyFile({filename:'配件月计划.csv',contentBase64:Buffer.from(componentCsv).toString('base64')})[0].componentName,'车轮')
const restored=parseDemoSnapshot(JSON.stringify(exportDemoSnapshot(state))).data
assert.equal(restored.planApprovalFlows.length,3);assert.equal(restored.annualPlanAdjustments.length,1);assert.equal(restored.monthlyVerificationRecords.length,1)
const legacy=createState();legacy.planningDemoSeedVersion=1;assert.equal(ensurePlanningDemoData(legacy),true);assert.equal(legacy.temporaryRepairPlans.length,3);assert.ok(legacy.temporaryRepairPlans.some(row=>row.locomotiveNo==='HXD1C6208'&&row.status==='DRAFT'&&row.solutionAttachment));assert.equal(ensurePlanningDemoData(legacy),false)
console.log('PASS: JSON annual adjustment, monthly verification, component plans and approval workflows')
