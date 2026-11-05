// Monthly plans and tool disposals use the same physical approval_record table.
// businessId identifies the flow, keeping each resubmitted version independent.
export function recordMonthlyApproval(state,flow,action,at,opinion=''){
  if(flow.entityType!=='MONTHLY')return
  state.approvalRecords||=[]
  const rows=state.approvalRecords
  const stage=level=>{
    let row=rows.find(r=>r.businessType==='MONTHLY_PLAN'&&r.businessId===flow.id&&r.approvalLevel===level)
    if(!row){row={id:Math.max(0,...rows.map(r=>r.id))+1,businessType:'MONTHLY_PLAN',businessId:flow.id,vehicleRepairId:flow.entityId,versionId:flow.versionId??null,approvalLevel:level,approvalRole:level===1?'主管科长审核':'主管副段长审批发布',approverId:null,approvalStatus:'PENDING',approvalOpinion:'',approvedAt:null,createdAt:at};rows.push(row)}
    return row
  }
  const finish=(row,status)=>Object.assign(row,{approvalStatus:status,approvalOpinion:opinion,approvedAt:at})
  if(action==='SUBMIT'){stage(1);return}
  if(action==='REVIEW'){finish(stage(1),'APPROVED');stage(2);return}
  if(action==='PUBLISH'){finish(stage(2),'APPROVED');return}
  if(action==='REJECT')finish(stage(flow.status==='REVIEWED'?2:1),'REJECTED')
}
