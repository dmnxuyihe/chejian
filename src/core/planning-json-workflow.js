import { recordMonthlyApproval } from './planning-approval-records.js'
import { formatLocalDateTime } from './derived.js'
import { publishApprovedPc1Plan } from './pc1-simulation.js'

const fail=message=>({ok:false,message})
const nextId=rows=>Math.max(0,...rows.map(row=>Number(row.id)||0))+1
const nowText=now=>formatLocalDateTime(now)
const target=(state,type,id)=>type==='MONTHLY'?state.vehicleRepairs.find(row=>row.id===Number(id)):type==='TEMP_VEHICLE'?state.temporaryRepairPlans.find(row=>row.id===Number(id)):type==='TEMP_COMPONENT'?state.componentTemporaryPlans.find(row=>row.id===Number(id)):state.componentMonthlyPlanRecords.find(row=>row.id===Number(id))

export function submitPlanFlow(state,type,id,note='',now=new Date()){
 const row=target(state,type,id);if(!row)return fail('计划不存在')
 if(type==='TEMP_VEHICLE'&&!row.solutionAttachment)return fail('请先上传整车临修方案')
 if(type==='TEMP_COMPONENT'&&!row.solutionAttachment)return fail('请先上传配件临修方案')
 if(state.planApprovalFlows.some(item=>item.entityType===type&&item.entityId===Number(id)&&!['REJECTED','PUBLISHED'].includes(item.status)))return fail('该计划已在审批流程中')
 const at=nowText(now),flow={id:nextId(state.planApprovalFlows),entityType:type,entityId:Number(id),status:'SUBMITTED',submittedAt:at,updatedAt:at,note:String(note||'').trim().slice(0,500),history:[{action:'SUBMIT',at,comment:String(note||'').trim().slice(0,500)}]}
 if(type==='MONTHLY')flow.versionId=row.currentVersionId??null
 recordMonthlyApproval(state,flow,'SUBMIT',at)
 state.planApprovalFlows.push(flow);row.status='SUBMITTED';if(type==='MONTHLY')row.approvalStatus='SUBMITTED';return {ok:true,id:flow.id}
}
export function processPlanFlow(state,flowId,action,comment='',now=new Date()){
 const flow=state.planApprovalFlows.find(row=>row.id===Number(flowId));if(!flow)return fail('审批记录不存在')
 const row=target(state,flow.entityType,flow.entityId);if(!row)return fail('关联计划不存在')
 const at=nowText(now),text=String(comment||'').trim().slice(0,500),previousStatus=flow.status
 if(flow.entityType==='MONTHLY' && ['SUBMITTED','REVIEWED'].includes(flow.status)){
  const versionId=flow.versionId??row.currentVersionId
  if(versionId!==row.currentVersionId||!state.scheduleVersions.some(version=>version.id===versionId&&version.vehicleRepairId===row.id))return fail('审批排程版本已变化，请重新提交审核')
  flow.versionId=versionId
 }
 if(action==='REJECT'){if(!['SUBMITTED','REVIEWED'].includes(flow.status))return fail('当前状态不能驳回');flow.status='REJECTED';row.status=flow.entityType==='MONTHLY'?'SCHEDULED':'DRAFT';if(flow.entityType==='MONTHLY')row.approvalStatus='REJECTED'}
 else if(action==='REVIEW'){if(flow.status!=='SUBMITTED')return fail('仅已提报计划可以审核');if(flow.entityType==='TEMP_COMPONENT'){flow.status='PUBLISHED';row.status='PUBLISHED'}else{flow.status='REVIEWED';if(flow.entityType!=='MONTHLY')row.status='APPROVED'};if(flow.entityType==='MONTHLY')row.approvalStatus=flow.status}
 else if(action==='PUBLISH'){if(flow.status!=='REVIEWED')return fail('计划需先审核通过');if(flow.entityType==='MONTHLY'){const published=publishApprovedPc1Plan(state,row.id,now);if(!published.ok)return published;flow.status='PUBLISHED';row.status='SCHEDULED';row.approvalStatus='PUBLISHED'}else{flow.status='PUBLISHED';row.status='PUBLISHED'}}
 else return fail('审批操作无效')
 recordMonthlyApproval(state,{...flow,status:previousStatus},action,at,text)
 flow.updatedAt=at;flow.history.push({action,at,comment:text});return {ok:true}
}

export function saveAnnualAdjustment(state,input){
 const year=Number(input.year),month=Number(input.month),modelId=Number(input.modelId),programId=Number(input.programId),baseline=Number(input.baseline),adjusted=Number(input.adjusted),actual=Number(input.actual),deliveryDays=Number(input.deliveryDays)
 if(!Number.isInteger(year)||year<1900||year>2199||!Number.isInteger(month)||month<1||month>12||![baseline,adjusted,actual,deliveryDays].every(value=>Number.isFinite(value)&&value>=0))return fail('年度调整数据无效')
 if(!state.locomotiveModels.some(row=>row.id===modelId)||!state.repairPrograms.some(row=>row.id===programId&&row.modelId===modelId))return fail('机型或修程无效')
 let row=state.annualPlanAdjustments.find(item=>item.year===year&&item.month===month&&item.modelId===modelId&&item.programId===programId)
 if(row)Object.assign(row,{baseline,adjusted,actual,deliveryDays})
 else{row={id:nextId(state.annualPlanAdjustments),year,month,modelId,programId,baseline,adjusted,actual,deliveryDays};state.annualPlanAdjustments.push(row)}
 return {ok:true,id:row.id}
}

export function saveComponentMonthlyRecord(state,input){
 const month=String(input.month||''),direction=String(input.direction||''),componentTypeId=Number(input.componentTypeId),planned=Number(input.planned),calculated=Number(input.calculated),mileageKm=Number(input.mileageKm||0)
 if(!/^\d{4}-\d{2}$/.test(month)||!['DOWN','UP'].includes(direction)||!state.componentTypes.some(row=>row.id===componentTypeId)||![planned,calculated,mileageKm].every(value=>Number.isFinite(value)&&value>=0))return fail('配件月计划数据无效')
 let row=state.componentMonthlyPlanRecords.find(item=>item.month===month&&item.direction===direction&&item.componentTypeId===componentTypeId)
 if(row)Object.assign(row,{planned,calculated,mileageKm,status:String(input.status||row.status||'DRAFT')})
 else{row={id:nextId(state.componentMonthlyPlanRecords),month,direction,componentTypeId,planned,calculated,mileageKm,status:'DRAFT'};state.componentMonthlyPlanRecords.push(row)}
 return {ok:true,id:row.id}
}
export function deleteComponentMonthlyRecord(state,id){const row=state.componentMonthlyPlanRecords.find(item=>item.id===Number(id));if(!row)return fail('配件月计划不存在');if(row.status!=='DRAFT')return fail('已提报或发布的配件计划不能删除');state.componentMonthlyPlanRecords=state.componentMonthlyPlanRecords.filter(item=>item.id!==row.id);return {ok:true}}

export function saveMonthlyVerification(state,input){
 const vehicleRepairId=Number(input.vehicleRepairId),date=String(input.date||''),result=String(input.result||'PASSED'),depot=String(input.depot||'').trim()
 if(!state.vehicleRepairs.some(row=>row.id===vehicleRepairId)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!depot||!['PASSED','FAILED','PENDING'].includes(result))return fail('月度交验记录无效')
 let row=state.monthlyVerificationRecords.find(item=>item.vehicleRepairId===vehicleRepairId&&item.date===date)
 if(row)Object.assign(row,{result,depot});else{row={id:nextId(state.monthlyVerificationRecords),vehicleRepairId,date,result,depot};state.monthlyVerificationRecords.push(row)}return {ok:true,id:row.id}
}
export function requestMonthlyPlanAdjustment(state,vehicleRepairId,reason,now=new Date()){
 const row=state.vehicleRepairs.find(item=>item.id===Number(vehicleRepairId)),text=String(reason||'').trim();if(!row)return fail('月度计划不存在');if(row.approvalStatus!=='PUBLISHED')return fail('只有已发布月度计划需要发起调整');if(!text||text.length>500)return fail('请填写500字以内调整原因')
 state.monthlyPlanAdjustmentHistory.push({id:nextId(state.monthlyPlanAdjustmentHistory),vehicleRepairId:row.id,reason:text,requestedAt:nowText(now),previousApprovalStatus:row.approvalStatus});row.approvalStatus='REVISING';row.status='SCHEDULED';return {ok:true}
}
export function requestMonthlyPlanRevision(state,vehicleRepairId,reason,now=new Date()){
 const row=state.vehicleRepairs.find(item=>item.id===Number(vehicleRepairId)),text=String(reason||'').trim();if(!row)return fail('月度计划不存在');if(!['SUBMITTED','REVIEWED'].includes(row.approvalStatus))return fail('只有待审核或待审批发布计划可以确认修改');if(!text||text.length>500)return fail('请填写500字以内修改原因')
 const flow=[...state.planApprovalFlows].reverse().find(item=>item.entityType==='MONTHLY'&&item.entityId===row.id&&['SUBMITTED','REVIEWED'].includes(item.status));if(!flow)return fail('未找到当前审批记录')
 const at=nowText(now);recordMonthlyApproval(state,flow,'REJECT',at,text);flow.status='REJECTED';flow.updatedAt=at;flow.history.push({action:'WITHDRAW_FOR_REVISION',at,comment:text});state.monthlyPlanAdjustmentHistory.push({id:nextId(state.monthlyPlanAdjustmentHistory),vehicleRepairId:row.id,reason:text,requestedAt:at,previousApprovalStatus:row.approvalStatus});row.approvalStatus='REVISING';row.status='SCHEDULED';return{ok:true}
}

export function saveComponentTemporaryPlan(state,input,id=null,now=new Date()){
 const name=String(input.name||'').trim(),modelId=Number(input.modelId),serialNo=String(input.serialNo||'').trim(),specification=String(input.specification||'').trim(),plannedEntryAt=String(input.plannedEntryAt||''),content=String(input.content||'').trim()
 if(!name||name.length>64||!state.locomotiveModels.some(row=>row.id===modelId)||!serialNo||serialNo.length>64||!specification||specification.length>128||!Number.isFinite(new Date(plannedEntryAt).getTime())||!content||content.length>1000)return fail('请完整填写配件名称、适用机型、序列号、规格、入段时间和临修内容')
 if(state.componentTemporaryPlans.some(row=>row.id!==Number(id)&&row.serialNo===serialNo&&!['REJECTED','CLOSED'].includes(row.status)))return fail('该配件序列号已有未结束临修计划')
 let row=state.componentTemporaryPlans.find(item=>item.id===Number(id));if(row&&row.status!=='DRAFT')return fail('只有草稿可以修改')
 const values={name,modelId,serialNo,specification,plannedEntryAt:formatLocalDateTime(plannedEntryAt),content,solutionAttachment:input.solutionAttachment||row?.solutionAttachment||null,updatedAt:nowText(now)}
 if(row)Object.assign(row,values);else{row={id:nextId(state.componentTemporaryPlans),...values,status:'DRAFT',createdAt:nowText(now)};state.componentTemporaryPlans.push(row)}return {ok:true,id:row.id}
}
export function deleteComponentTemporaryPlan(state,id){const row=state.componentTemporaryPlans.find(item=>item.id===Number(id));if(!row)return fail('计划不存在');if(row.status!=='DRAFT')return fail('已提报计划不能删除');state.componentTemporaryPlans=state.componentTemporaryPlans.filter(item=>item.id!==row.id);return {ok:true}}
