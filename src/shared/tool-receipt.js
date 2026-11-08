// Resolve receipts from each committed command, including mixed batches.
export function toolCommandReceipt(state,type,payload,result,actor,at=new Date().toISOString()){
 const commands=type==='BATCH'?payload.commands:[{type,payload}],results=type==='BATCH'?result.results:[result],groups=[]
 const kinds={BORROW:'loans',RETURN:'loans',KIT_RETURN:'loans',TRANSFER:'transfers',TRANSFER_FINISH:'transfers',DISPOSAL_REQUEST:'disposals',DISPOSAL_REVIEW:'disposals',DEVICE_EVENT:'events',EVENT_RESOLVE:'events',CHECK_USE:'events'}
 for(const [i,command] of commands.entries()){
  const p=command.payload||{},r=results?.[i]||{},id=r.id||p.id||p.loanId
  const service=state.toolManagement.services.find(s=>s.id===id)
  const kind=['SERVICE_SEND','SERVICE_FINISH'].includes(command.type)?((service?.kind||p.kind)==='REPAIR'?'repair':'inspection'):kinds[command.type]||'audit'
  const recordId=kind==='audit'?state.toolManagement.audit.filter(a=>a.action===command.type&&a.actor===actor&&a.detail===JSON.stringify(p)).at(-1)?.id:id
  let group=groups.find(g=>g.kind===kind);if(!group){group={kind,ids:[]};groups.push(group)}
  if(recordId&&!group.ids.includes(recordId))group.ids.push(recordId)
 }
 return {actor,at,title:`${commands.length} 项办理已完成`,kind:groups[0]?.kind||'audit',ids:groups[0]?.ids||[],groups}
}
