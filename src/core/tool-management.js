// Shared domain rules for the tool workspace and authenticated device gateway.
const lists=['warehouses','categories','assets','kits','loans','transfers','services','disposals','counts','devices','events','audit','commands']
export const emptyToolManagement=()=>Object.fromEntries([['version',1],...lists.map(key=>[key,[]])])
const fail=message=>{throw Object.assign(new Error(message),{status:400})}
const text=(v,label,max=160)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(`${label}不能为空且不得超过${max}字`);return v.trim()}
const qty=(v,label='数量',zero=false)=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<(zero?0:1)||n>1000000)fail(`${label}必须为${zero?'非负':'正'}整数且不超过100万`);return n}
const date=(v,label)=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(v)||!Number.isFinite(new Date(v).getTime()))fail(`${label}无效`);return v}
const next=rows=>Math.max(0,...rows.map(r=>r.id))+1
const get=(rows,id,label)=>rows.find(r=>r.id===Number(id))||fail(`${label}不存在`)
const open=row=>row.status==='OPEN'
const outstanding=line=>line.quantity-line.returned-(line.disposed||0)
export const toolLabels={AVAILABLE:'在库',DISABLED:'停用',LOST:'遗失',SCRAPPED:'报废',OPEN:'办理中',CLOSED:'已完成',PENDING:'待审核',APPROVED:'已批准',REJECTED:'已驳回',RECEIVED:'已接收',CANCELLED:'已取消',INSPECTION:'送检',REPAIR:'送修',NUMBERED:'单件',BULK:'数量',CABINET:'智能工具柜',ROOM:'无人工具室',SIMULATED:'模拟',HARDWARE:'设备',ACCEPTED:'已接收',ERROR:'异常',HEARTBEAT:'心跳',CHECKOUT:'领用',RETURN:'归还',INVENTORY:'盘点',ENTRY:'通行',CHECK_USE:'工具核验'}
export function toolDueAt(asset){
  if(!Number(asset.inspectionCycleMonths))return null
  if(!asset.lastInspectionAt)return 'MISSING'
  const d=new Date(asset.lastInspectionAt),day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+Number(asset.inspectionCycleMonths));const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(day,last));return d.toISOString()
}
const validAt=(asset,at)=>{const due=toolDueAt(asset);return !due||(due!=='MISSING'&&new Date(due)>new Date(at))}
export function assetHeld(m,id){
  return m.loans.flatMap(l=>l.lines).filter(l=>l.assetId===id).reduce((s,l)=>s+outstanding(l),0)
    +m.transfers.filter(r=>r.assetId===id&&r.status==='PENDING').reduce((s,r)=>s+r.quantity,0)
    +m.services.filter(r=>r.assetId===id&&open(r)).reduce((s,r)=>s+r.quantity,0)
    +m.disposals.filter(r=>r.assetId===id&&r.status==='PENDING'&&!r.loanId).reduce((s,r)=>s+r.quantity,0)
}
export const assetInStock=(m,a)=>['AVAILABLE','DISABLED'].includes(a.status)?a.quantity-assetHeld(m,a.id):0
export const assetStock=(m,a)=>a.status==='AVAILABLE'?assetInStock(m,a):0
export function toolAvailableQuantity(state,toolId,at=new Date()){
  const t=state.tools.find(t=>t.id===toolId),m=state.toolManagement
  if(!t||t.status!=='AVAILABLE')return 0
  const assets=m?.assets.filter(a=>a.toolId===toolId)
  if(!assets?.length)return Number(t.quantity)||0
  return assets.filter(a=>validAt(a,at)).reduce((n,a)=>n+assetStock(m,a),0)
}
export function toolAlerts(state,at=new Date()){
  const m=state.toolManagement||emptyToolManagement(),now=new Date(at).getTime(),result=[]
  for(const t of state.tools){if(t.lowStock!=null&&toolAvailableQuantity(state,t.id,at)<=Number(t.lowStock))result.push({type:'LOW_STOCK',name:t.name,message:`可用${toolAvailableQuantity(state,t.id,at)}件，低储阈值${t.lowStock}件`,toolId:t.id})}
  for(const t of state.tools)for(const [id,minimum] of Object.entries(t.warehouseLowStock||{})){
    const available=t.status==='AVAILABLE'?m.assets.filter(a=>a.toolId===t.id&&a.warehouseId===Number(id)&&validAt(a,at)).reduce((n,a)=>n+assetStock(m,a),0):0
    if(available<=minimum)result.push({type:'WAREHOUSE_LOW_STOCK',name:`${nameOf(m.warehouses,Number(id))} · ${t.name}`,message:`本库可用${available}件，低储阈值${minimum}件`,toolId:t.id,warehouseId:Number(id)})
  }
  for(const a of m.assets){if(a.status!=='AVAILABLE'||!a.quantity)continue;const due=toolDueAt(a)
    if(due==='MISSING')result.push({type:'INSPECTION_MISSING',name:a.code,message:'已设置检定周期，尚未登记合格检定日期',assetId:a.id})
    else if(due&&new Date(due).getTime()<=now+7*86400000)result.push({type:'INSPECTION_DUE',name:a.code,message:`${new Date(due).getTime()<=now?'已到期':'7天内到期'}：${due.slice(0,10)}`,assetId:a.id})
  }
  for(const l of m.loans.filter(open))if(new Date(l.dueAt).getTime()<now)result.push({type:'OVERDUE',name:`借用单 ${l.id}`,message:`${l.borrower}应于${l.dueAt.replace('T',' ')}归还`,loanId:l.id})
  for(const e of m.events.filter(e=>e.status==='ERROR'&&!e.resolvedAt))result.push({type:'DEVICE_ERROR',name:e.deviceName||'作业工具核验',message:e.message,eventId:e.id})
  return result
}
const synchronize=state=>{for(const t of state.tools){const assets=state.toolManagement.assets.filter(a=>a.toolId===t.id);if(assets.length)t.quantity=assets.reduce((n,a)=>n+assetStock(state.toolManagement,a),0)}}
const nameOf=(rows,id)=>rows.find(r=>r.id===id)?.name||'工具库'
const employeeIdByName=(state,value)=>state.employees.find(e=>e.name===value)?.id||null
function createToolApproval(state,disposal,now){
  state.approvalRecords ||= []
  state.approvalRecords.push({id:next(state.approvalRecords),businessType:'TOOL_DISPOSAL',businessId:disposal.id,approvalLevel:1,approvalRole:'工具遗失/报废审核',approverId:null,approvalStatus:'PENDING',approvalOpinion:'',approvedAt:null,createdAt:now})
}
function updateToolApproval(state,disposal,decision,opinion,actor,now){
  state.approvalRecords ||= []
  const approval=state.approvalRecords.find(r=>r.businessType==='TOOL_DISPOSAL'&&r.businessId===disposal.id&&r.approvalStatus==='PENDING')
  if(!approval)fail('未找到对应的工具审核记录')
  approval.approvalStatus=decision;approval.approvalOpinion=opinion;approval.approverId=employeeIdByName(state,actor);approval.approvedAt=now
}
const available=(m,a,n,now,inspection=true)=>{if((inspection?assetStock(m,a):assetInStock(m,a))<n)fail('在库可用数量不足或工具已停用');if(inspection&&!validAt(a,now))fail('工具检定已到期或缺少检定日期，不能领用或调拨')}
const stockKey=(m,a)=>JSON.stringify([a.quantity,a.status,a.warehouseId,assetHeld(m,a.id)])
function useCheck(state,asset,scheduleId){
  if(!scheduleId)return
  const row=get(state.schedules,scheduleId,'作业任务')
  if(!state.toolRequirements.some(r=>r.taskId===row.taskId&&r.toolId===asset.toolId))fail('工具与作业工序不匹配，请核对后领用')
}
export function taskToolCheck(state,scheduleTaskId,at=new Date()){
  const m=state.toolManagement||emptyToolManagement(),task=state.schedules.find(t=>t.id===Number(scheduleTaskId))
  if(!task)return {ok:false,message:'作业任务不存在'}
  const requirements=state.toolRequirements.filter(r=>r.taskId===task.taskId&&m.assets.some(a=>a.toolId===r.toolId))
  const latest=m.events.filter(e=>e.type==='CHECK_USE'&&e.scheduleTaskId===task.id).at(-1)
  if(requirements.length&&latest?.status==='ERROR')return {ok:false,message:`工具核验异常：${latest.message}`}
  for(const req of requirements){
    const assets=m.assets.filter(a=>a.toolId===req.toolId&&a.status==='AVAILABLE'&&validAt(a,at))
    let checked=0
    for(const a of assets){
      const event=m.events.filter(e=>e.type==='CHECK_USE'&&e.scheduleTaskId===task.id&&e.assetId===a.id).at(-1)
      const own=m.loans.filter(l=>l.scheduleTaskId===task.id).flatMap(l=>l.lines).filter(l=>l.assetId===a.id).reduce((n,l)=>n+outstanding(l),0)
      if(event?.status==='ACCEPTED'&&new Date(at)-new Date(event.at)<=86400000&&get(state.tools,a.toolId,'工具品种').status==='AVAILABLE')checked+=Math.min(event.quantity||1,assetStock(m,a)+own)
    }
    if(checked<req.quantity)return {ok:false,message:`请先核验本工序的${nameOf(state.tools,req.toolId)}，已核验${checked}/${req.quantity}件`}
  }
  return {ok:true}
}

export function applyToolCommand(state,input,{now=new Date().toISOString(),hardware=false}={}){
  // All changes happen on a copy. A rejected command cannot partly reserve stock.
  const copy=structuredClone(state),m=copy.toolManagement ||= emptyToolManagement()
  if(!input||typeof input!=='object')fail('缺少业务指令')
  const type=text(input.type,'操作类型',40),actor=text(input.actor,'经办人',80),p=input.payload||{}
  if(typeof p!=='object'||Array.isArray(p)||JSON.stringify(p).length>64000)fail('业务明细格式无效或超过64KB')
  const requestId=text(input.requestId,'请求编号',100)
  const prior=m.commands.find(c=>c.requestId===requestId)
  const signature=JSON.stringify({type,actor,payload:p,hardware})
  if(prior){if(prior.signature!==signature)fail('同一请求编号不能用于不同操作');return {...prior.result,duplicate:true}}
  let result={ok:true}
  const asset=()=>get(m.assets,p.assetId,'工具实物')
  const warehouse=id=>get(m.warehouses,id,'工具库')
  const audit=(action,detail)=>m.audit.push({id:next(m.audit),at:now,actor,action,detail})
  switch(type){
    case 'WAREHOUSE_SAVE':case 'CATEGORY_SAVE':{
      const rows=type==='WAREHOUSE_SAVE'?m.warehouses:m.categories
      const row={id:p.id?get(rows,p.id,'基础资料').id:next(rows),code:text(p.code,'编码',64),name:text(p.name,'名称',80)}
      if(rows.some(r=>r.id!==row.id&&r.code.toLowerCase()===row.code.toLowerCase()))fail('编码重复')
      const i=rows.findIndex(r=>r.id===row.id);if(i<0)rows.push(row);else rows[i]=row
      result.id=row.id;break
    }
    case 'TOOL_SAVE':{
      const old=p.id?get(copy.tools,p.id,'工具字典'):null
      const row={...old,id:old?.id||next(copy.tools),code:text(p.code,'工具品种编码',64),name:text(p.name,'工具名称',80),specification:String(p.specification||'').slice(0,160),manufacturer:String(p.manufacturer||'').slice(0,160),status:p.status||'AVAILABLE',quantity:old?.quantity||0,lowStock:qty(p.lowStock??0,'低储阈值',true)}
      if(!['AVAILABLE','MAINTENANCE','DISABLED'].includes(row.status))fail('工具状态无效')
      if(p.lowStockWarehouseId){
        const wid=warehouse(p.lowStockWarehouseId).id
        row.warehouseLowStock={...old?.warehouseLowStock,[wid]:row.lowStock}
        row.lowStock=old?.lowStock??0
      }
      row.categoryId=p.categoryId?get(m.categories,p.categoryId,'工具分类').id:null
      if(copy.tools.some(t=>t.id!==row.id&&t.code?.toLowerCase()===row.code.toLowerCase()))fail('工具品种编码重复')
      if(old)Object.assign(old,row);else copy.tools.push(row);result.id=row.id;break
    }
    case 'REQUIREMENT_SAVE':{
      const tool=get(copy.tools,p.toolId,'工具品种'),task=get(copy.tasks,p.taskId,'工序'),quantity=qty(p.quantity)
      const old=copy.toolRequirements.find(r=>r.toolId===tool.id&&r.taskId===task.id)
      if(old)old.quantity=quantity
      else copy.toolRequirements.push({id:next(copy.toolRequirements),toolId:tool.id,taskId:task.id,quantity,quantityBasis:'manual',sourceSheet:'工具管理'})
      break
    }
    case 'ASSET_CREATE':case 'ADOPT_LEGACY':{
      const t=get(copy.tools,p.toolId,'工具字典'),w=warehouse(p.warehouseId)
      if(type==='ADOPT_LEGACY'&&m.assets.some(a=>a.toolId===t.id))fail('该品种已接管，不能重复接管旧库存')
      if(type==='ASSET_CREATE'&&!m.assets.some(a=>a.toolId===t.id)&&Number(t.quantity)>0)fail('请先接管已有库存，再新增实物，避免覆盖原库存')
      const count=type==='ADOPT_LEGACY'?qty(t.quantity):qty(p.quantity)
      const mode=type==='ADOPT_LEGACY'?'BULK':p.mode
      if(!['BULK','NUMBERED'].includes(mode)||mode==='NUMBERED'&&count!==1)fail('单件工具数量必须为1')
      const row={id:next(m.assets),toolId:t.id,warehouseId:w.id,code:text(p.code,'实物/批次编号',64),mode,quantity:count,status:'AVAILABLE',tag:String(p.tag||'').trim().slice(0,100),inspectionCycleMonths:qty(p.inspectionCycleMonths??t.inspectionCycleMonths??0,'检定周期',true),lastInspectionAt:p.lastInspectionAt?date(p.lastInspectionAt,'最近合格检定日期'):null}
      if(row.lastInspectionAt&&new Date(row.lastInspectionAt)>new Date(now))fail('最近合格检定日期不能在未来')
      if(m.assets.some(a=>a.code.toLowerCase()===row.code.toLowerCase()||row.tag&&a.tag===row.tag))fail('实物编号或标签重复')
      m.assets.push(row);result.id=row.id;break
    }
    case 'ASSET_CONFIG':{
      const a=asset();if(assetHeld(m,a.id))fail('工具正在流转，不能修改标签或检定配置');if(p.tag!=null){const tag=String(p.tag).trim();if(tag.length>100||tag&&m.assets.some(r=>r.id!==a.id&&r.tag===tag))fail('标签重复或过长');a.tag=tag}
      if(p.status){if(!['AVAILABLE','DISABLED'].includes(p.status)||!['AVAILABLE','DISABLED'].includes(a.status))fail('不能通过配置恢复遗失或报废工具');a.status=p.status}
      if(p.inspectionCycleMonths!=null)a.inspectionCycleMonths=qty(p.inspectionCycleMonths,'检定周期',true)
      break
    }
    case 'KIT_SAVE':{
      const lines=(p.lines||[]).map(l=>({assetId:get(m.assets,l.assetId,'套装成员').id,quantity:qty(l.quantity)}))
      if(!lines.length||new Set(lines.map(l=>l.assetId)).size!==lines.length)fail('套装成员不能为空或重复')
      if(lines.some(l=>l.quantity>get(m.assets,l.assetId,'套装成员').quantity))fail('套装成员数量不足')
      if(new Set(lines.map(l=>get(m.assets,l.assetId,'套装成员').warehouseId)).size!==1)fail('套装成员须位于同一工具库')
      if(p.id&&m.loans.some(l=>l.kitId===Number(p.id)&&open(l)))fail('套装借出期间不能修改组成')
      const row={id:p.id?get(m.kits,p.id,'套装').id:next(m.kits),code:text(p.code,'套装编号',64),name:text(p.name,'套装名称',80),lines}
      if(m.kits.some(k=>k.id!==row.id&&k.code.toLowerCase()===row.code.toLowerCase()))fail('套装编号重复')
      const old=m.kits.find(k=>k.id===row.id);if(old)Object.assign(old,row);else m.kits.push(row);result.id=row.id;break
    }
    case 'BORROW':{
      const lines=p.kitId?structuredClone(get(m.kits,p.kitId,'套装').lines):[{assetId:asset().id,quantity:qty(p.quantity)}]
      const dueAt=date(p.dueAt,'预计归还时间');if(new Date(dueAt)<=new Date(now))fail('预计归还时间应晚于办理时间')
      for(const l of lines){const a=get(m.assets,l.assetId,'工具实物');if(get(copy.tools,a.toolId,'工具品种').status!=='AVAILABLE')fail('工具品种已停用或检修中');available(m,a,l.quantity,now);useCheck(copy,a,p.scheduleTaskId);l.returned=0;l.disposed=0;l.warehouseId=a.warehouseId}
      if(new Set(lines.map(l=>l.warehouseId)).size!==1)fail('套装成员不在同一工具库')
      const borrower=text(p.borrower,'领用人',80),loan={id:next(m.loans),borrower,borrowType:text(p.borrowType||'检修使用','借用类型',40),kitId:p.kitId?Number(p.kitId):null,lines,dueAt,at:now,actor,status:'OPEN',returns:[],scheduleTaskId:p.scheduleTaskId?Number(p.scheduleTaskId):null}
      m.loans.push(loan);result.id=loan.id;break
    }
    case 'RETURN':{
      const l=get(m.loans,p.loanId,'借用单');if(!open(l))fail('借用单已归还完毕')
      const line=l.lines.find(r=>r.assetId===Number(p.assetId));if(!line)fail('该工具不在借用单中')
      const pending=m.disposals.filter(r=>r.loanId===l.id&&r.assetId===line.assetId&&r.status==='PENDING').reduce((s,r)=>s+r.quantity,0)
      const n=qty(p.quantity);if(n>outstanding(line)-pending)fail('归还数量超过未还数量或已有遗失报废待审核')
      const returner=text(p.returner,'归还人',80);line.returned+=n;l.returns.push({assetId:line.assetId,quantity:n,returner,at:now,actor})
      if(l.lines.every(r=>outstanding(r)===0))l.status='CLOSED';break
    }
    case 'TRANSFER':{
      const a=asset(),n=qty(p.quantity),to=warehouse(p.toWarehouseId);if(to.id===a.warehouseId)fail('调入和调出工具库不能相同')
      if(m.kits.some(k=>k.lines.some(l=>l.assetId===a.id)))fail('请先调整套装组成，再调拨其成员')
      available(m,a,n,now)
      const row={id:next(m.transfers),assetId:a.id,quantity:n,fromWarehouseId:a.warehouseId,toWarehouseId:to.id,status:'PENDING',actor,at:now};m.transfers.push(row);result.id=row.id;break
    }
    case 'TRANSFER_FINISH':{
      const row=get(m.transfers,p.id,'调拨单');if(row.status!=='PENDING')fail('调拨单已经处理')
      if(!['RECEIVED','CANCELLED'].includes(p.decision))fail('调拨处理结果无效')
      row.remark=String(p.remark||'').slice(0,500)
      const a=get(m.assets,row.assetId,'工具实物');row.status=p.decision;row.finishedAt=now;row.receivedBy=actor
      if(p.decision==='RECEIVED'){
        if(row.quantity===a.quantity){a.warehouseId=row.toWarehouseId}
        else{a.quantity-=row.quantity;m.assets.push({...a,id:next(m.assets),code:`${a.code.slice(0,45)}-T${row.id}`,tag:'',quantity:row.quantity,warehouseId:row.toWarehouseId})}
      }break
    }
    case 'SERVICE_SEND':{
      const a=asset(),n=qty(p.quantity);available(m,a,n,now,false)
      if(!['INSPECTION','REPAIR'].includes(p.kind))fail('请选择送检或送修')
      const row={id:next(m.services),assetId:a.id,quantity:n,kind:p.kind,reason:text(p.reason,'送检/送修说明',500),provider:text(p.provider,'检定/维修单位',120),status:'OPEN',at:now,actor};m.services.push(row);result.id=row.id;break
    }
    case 'SERVICE_FINISH':{
      const row=get(m.services,p.id,'检定维修单');if(!open(row))fail('单据已完成')
      if(!['PASS','FAIL'].includes(p.result))fail('必须填写校验结果')
      const certificate=text(p.certificate,'检定/维修结论或证书编号',500),a=get(m.assets,row.assetId,'工具实物')
      row.status='CLOSED';row.result=p.result;row.certificate=certificate;row.finishedAt=now;row.finishedBy=actor
      if(p.result==='PASS'){
        if(row.quantity===a.quantity){a.lastInspectionAt=now;a.status='AVAILABLE'}
        else{a.quantity-=row.quantity;m.assets.push({...a,id:next(m.assets),code:`${a.code.slice(0,45)}-S${row.id}`,tag:'',quantity:row.quantity,lastInspectionAt:now,status:'AVAILABLE'})}
      }else{const disposal={id:next(m.disposals),assetId:a.id,quantity:row.quantity,kind:'SCRAPPED',reason:`${row.kind==='REPAIR'?'维修':'检定'}不合格：${certificate}`,status:'PENDING',at:now,actor,serviceId:row.id};m.disposals.push(disposal);createToolApproval(copy,disposal,now);result.disposalId=disposal.id}
      break
    }
    case 'DISPOSAL_REQUEST':{
      const a=asset(),n=qty(p.quantity)
      if(p.loanId){
        const loan=get(m.loans,p.loanId,'借用单'),line=loan.lines.find(l=>l.assetId===a.id)
        const pending=m.disposals.filter(r=>r.loanId===loan.id&&r.assetId===a.id&&r.status==='PENDING').reduce((s,r)=>s+r.quantity,0)
        if(!open(loan)||!line||n>outstanding(line)-pending)fail('借用单未还数量不足或已有待审核申请')
      }else available(m,a,n,now,false)
      if(!['LOST','SCRAPPED'].includes(p.kind))fail('申请类型无效')
      const row={id:next(m.disposals),assetId:a.id,quantity:n,kind:p.kind,reason:text(p.reason,'申请原因',500),status:'PENDING',at:now,actor,loanId:p.loanId?Number(p.loanId):null};m.disposals.push(row);createToolApproval(copy,row,now);result.id=row.id;break
    }
    case 'DISPOSAL_REVIEW':{
      const row=get(m.disposals,p.id,'遗失报废申请');if(row.status!=='PENDING')fail('申请已经审核')
      if(!['APPROVED','REJECTED'].includes(p.decision))fail('审核结果无效')
      if(actor===row.actor)fail('申请人与审核人不能相同')
      row.opinion=text(p.opinion,'审核意见',500);row.status=p.decision;row.reviewedAt=now;row.reviewer=actor;updateToolApproval(copy,row,p.decision,row.opinion,actor,now)
      const a=get(m.assets,row.assetId,'工具实物')
      if(p.decision==='APPROVED'){
        if(row.loanId){const loan=get(m.loans,row.loanId,'借用单'),line=loan.lines.find(l=>l.assetId===a.id);line.disposed=(line.disposed||0)+row.quantity;if(loan.lines.every(l=>outstanding(l)===0))loan.status='CLOSED'}
        a.quantity-=row.quantity;if(!a.quantity)a.status=row.kind
      }
      else if(row.serviceId){a.status='DISABLED'}
      break
    }
    case 'COUNT_CREATE':{
      const w=warehouse(p.warehouseId),lines=m.assets.filter(a=>a.warehouseId===w.id&&['AVAILABLE','DISABLED'].includes(a.status)).map(a=>({assetId:a.id,expected:assetInStock(m,a),stockKey:stockKey(m,a),counted:null}))
      if(!lines.length)fail('该工具库没有可盘点工具')
      const row={id:next(m.counts),warehouseId:w.id,at:now,actor,status:'OPEN',lines};m.counts.push(row);result.id=row.id;break
    }
    case 'COUNT_FINISH':{
      const row=get(m.counts,p.id,'盘点单');if(!open(row))fail('盘点单已处理')
      row.reason=text(p.reason,'差异说明/盘点结论',500)
      if(!Array.isArray(p.lines)||p.lines.length!==row.lines.length||new Set(p.lines.map(l=>l.assetId)).size!==row.lines.length)fail('请填写每项实盘数量，不得重复')
      for(const line of row.lines){const a=get(m.assets,line.assetId,'工具实物');if(stockKey(m,a)!==line.stockKey)fail('盘点期间库存已变化，请取消后重新盘点')
        const observed=p.lines.find(l=>l.assetId===line.assetId);if(!observed)fail('缺少实盘数量');line.counted=qty(observed.counted,'实盘数量',true)
        if(a.mode==='NUMBERED'&&line.counted>1)fail('单件工具实盘数量只能为0或1')
        a.quantity+=line.counted-line.expected;if(!a.quantity&&a.mode==='NUMBERED')a.status='LOST'
      }
      row.status='CLOSED';row.finishedAt=now;row.confirmedBy=actor;break
    }
    case 'COUNT_CANCEL':{const row=get(m.counts,p.id,'盘点单');if(!open(row))fail('盘点单已处理');row.status='CANCELLED';row.finishedAt=now;break}
    case 'DEVICE_SAVE':{
      if(!['CABINET','ROOM'].includes(p.kind))fail('设施类型无效')
      const row={id:p.id?get(m.devices,p.id,'设施').id:next(m.devices),code:text(p.code,'设备编码',64),name:text(p.name,'设备名称',80),kind:p.kind,warehouseId:warehouse(p.warehouseId).id,enabled:p.enabled!==false}
      if(m.devices.some(d=>d.id!==row.id&&d.code===row.code))fail('设备编码重复')
      const old=m.devices.find(d=>d.id===row.id);if(old)Object.assign(old,row);else m.devices.push(row);result.id=row.id;break
    }
    case 'DEVICE_EVENT':{
      const device=get(m.devices,p.deviceId,'设施');if(!device.enabled)fail('设备已停用')
      const event={id:next(m.events),deviceId:device.id,deviceName:device.name,externalId:text(p.eventId,'设备事件编号',100),type:p.eventType,source:hardware?'HARDWARE':'SIMULATED',at:now,actor,status:'ACCEPTED',message:''}
      const prev=m.events.find(e=>e.deviceId===device.id&&e.externalId===event.externalId)
      if(prev){if(JSON.stringify(prev.input)!==JSON.stringify(p)||prev.source!==event.source)fail('设备事件编号已被不同内容使用');result={ok:true,id:prev.id,duplicate:true};break}
      event.input=structuredClone(p)
      if(hardware)device.lastSeenAt=now
      try{
        if(!['HEARTBEAT','ENTRY','CHECKOUT','RETURN','INVENTORY'].includes(p.eventType))fail('不支持的设备事件类型')
        if(p.eventType==='ENTRY'){get(copy.employees,p.employeeId,'通行人员');event.message='已记录门禁通行事件'}
        if(['CHECKOUT','RETURN'].includes(p.eventType)){
          const a=m.assets.find(a=>a.tag===p.tag&&a.tag);if(!a)fail('标签未绑定工具');if(a.warehouseId!==device.warehouseId)fail('工具不属于该设施工具库')
          const person=get(copy.employees,p.employeeId,'领还人员');if(person.status!=='ACTIVE')fail('人员已停用')
          const payload=p.eventType==='CHECKOUT'?{assetId:a.id,quantity:p.quantity||1,borrower:person.name,borrowType:'智能设施领用',dueAt:p.dueAt,scheduleTaskId:p.scheduleTaskId}:{loanId:p.loanId,assetId:a.id,quantity:p.quantity||1,returner:person.name}
          const sub=applyToolCommand(copy,{requestId:`event:${device.id}:${event.externalId}`,type:p.eventType==='CHECKOUT'?'BORROW':'RETURN',actor,payload},{now})
          if(p.eventType==='CHECKOUT'&&p.scheduleTaskId)applyToolCommand(copy,{requestId:`check:${device.id}:${event.externalId}`,type:'CHECK_USE',actor,payload:{assetId:a.id,scheduleTaskId:p.scheduleTaskId,quantity:p.quantity||1}},{now,hardware})
          // Nested command commits a copied module, so continue with that module.
          Object.assign(m,copy.toolManagement);if(sub.id)result.loanId=sub.id;event.message=p.eventType==='CHECKOUT'?'工具领用已登记':'工具归还已登记'
        }
        if(p.eventType==='INVENTORY'){
          if(!Array.isArray(p.tags)||new Set(p.tags).size!==p.tags.length)fail('盘点标签须为不重复的列表')
          const expected=m.assets.filter(a=>a.warehouseId===device.warehouseId&&a.tag&&assetInStock(m,a)>0).map(a=>a.tag)
          event.missing=expected.filter(t=>!p.tags.includes(t));event.unexpected=p.tags.filter(t=>!expected.includes(t));event.message=`缺少${event.missing.length}个标签，多出${event.unexpected.length}个标签；需人工盘点确认后调账`
          if(event.missing.length||event.unexpected.length)event.status='ERROR'
        }
      }catch(error){event.status='ERROR';event.message=error.message}
      event.id=next(m.events);m.events.push(event);copy.toolManagement=m;result.eventStatus=event.status;result.id=event.id;break
    }
    case 'CHECK_USE':{
      const a=p.assetId?asset():m.assets.find(a=>a.tag&&a.tag===p.tag),event={id:next(m.events),type:'CHECK_USE',source:hardware?'HARDWARE':'SIMULATED',at:now,actor,status:'ACCEPTED',assetId:a?.id??null,scheduleTaskId:Number(p.scheduleTaskId),quantity:qty(p.quantity??1),message:'工具与工序匹配'}
      if(!p.scheduleTaskId)fail('请选择需要核验的作业任务')
      get(copy.schedules,p.scheduleTaskId,'作业任务')
      try{
        if(!a)fail('标签未绑定工具')
        useCheck(copy,a,p.scheduleTaskId);if(!validAt(a,now))fail('工具检定失效');if(a.status!=='AVAILABLE'||get(copy.tools,a.toolId,'工具品种').status!=='AVAILABLE')fail('工具已停用')
        if(m.services.some(r=>r.assetId===a.id&&open(r))||m.transfers.some(r=>r.assetId===a.id&&r.status==='PENDING')||m.disposals.some(r=>r.assetId===a.id&&r.status==='PENDING'))fail('工具正在送检送修、调拨或待审核，不能用于作业')
        const own=m.loans.filter(l=>l.scheduleTaskId===Number(p.scheduleTaskId)).flatMap(l=>l.lines).filter(l=>l.assetId===a.id).reduce((n,l)=>n+outstanding(l),0)
        if(event.quantity>assetStock(m,a)+own)fail('核验数量超过可用量或工具已借给其他任务')
      }catch(e){event.status='ERROR';event.message=e.message}
      m.events.push(event);result.eventStatus=event.status;result.id=event.id;break
    }
    case 'EVENT_RESOLVE':{const row=get(m.events,p.id,'异常记录');if(row.status!=='ERROR'||row.resolvedAt)fail('异常已处理或不存在');row.resolution=text(p.resolution,'处理说明',500);row.resolvedAt=now;row.resolvedBy=actor;break}
    default:fail('不支持的工具业务操作')
  }
  synchronize(copy);audit(type,JSON.stringify(p));m.commands.push({id:next(m.commands),requestId,signature,result:structuredClone(result),at:now})
  validateToolManagement(copy)
  state.toolManagement=copy.toolManagement;state.tools=copy.tools;state.toolRequirements=copy.toolRequirements;state.approvalRecords=copy.approvalRecords
  return result
}

export function validateToolManagement(state){
  const m=state.toolManagement
  if(!m||m.version!==1)fail('工具管理数据版本无效')
  if(!Array.isArray(state.approvalRecords))fail('审核记录集合无效')
  for(const approval of state.approvalRecords){
    if(!Number.isSafeInteger(approval.id)||approval.id<1||typeof approval.businessType!=='string'||!Number.isSafeInteger(approval.businessId)||approval.businessId<1||!['PENDING','APPROVED','REJECTED'].includes(approval.approvalStatus))fail('审核记录格式无效')
    if(approval.businessType==='TOOL_DISPOSAL'){
      const disposal=m.disposals.find(r=>r.id===approval.businessId);if(!disposal)fail('工具审核记录缺少业务单据')
      if(disposal.status!==approval.approvalStatus)fail('工具审核状态与遗失报废单不一致')
    }
    if(approval.approvalStatus!=='PENDING'&&!approval.approvedAt)fail('已处理审核记录缺少处理时间')
  }
  for(const key of lists){if(!Array.isArray(m[key])||m[key].length>50000)fail(`工具管理${key}格式无效`);const ids=m[key].map(r=>r?.id);if(ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length)fail(`工具管理${key}编号无效`)}
  for(const key of ['warehouses','categories','kits','devices']){
    for(const row of m[key]){text(row.code,'编码',64);text(row.name,'名称',80)}
    if(new Set(m[key].map(r=>r.code.toLowerCase())).size!==m[key].length)fail('基础资料编码重复')
  }
  for(const a of m.assets){get(state.tools,a.toolId,'工具字典');get(m.warehouses,a.warehouseId,'工具库');qty(a.quantity,'账面数量',true);if(!['NUMBERED','BULK'].includes(a.mode)||a.mode==='NUMBERED'&&a.quantity>1||!['AVAILABLE','DISABLED','LOST','SCRAPPED'].includes(a.status))fail('工具实物类型或状态无效');text(a.code,'实物编号');qty(a.inspectionCycleMonths,'检定周期',true);if(a.lastInspectionAt)date(a.lastInspectionAt,'检定日期')}
  if(new Set(m.assets.map(a=>a.code.toLowerCase())).size!==m.assets.length)fail('实物编号重复')
  const tags=m.assets.filter(a=>a.tag).map(a=>a.tag);if(new Set(tags).size!==tags.length)fail('工具标签重复')
  for(const a of m.assets){if(typeof a.tag!=='string'||a.tag.length>100||['LOST','SCRAPPED'].includes(a.status)&&a.quantity!==0)fail('实物标签或退出状态无效')}
  for(const t of state.tools){if(t.categoryId)get(m.categories,t.categoryId,'工具分类');if(t.lowStock!=null)qty(t.lowStock,'低储阈值',true);if(t.warehouseLowStock){if(typeof t.warehouseLowStock!=='object'||Array.isArray(t.warehouseLowStock))fail('分库低储阈值格式无效');for(const [id,value] of Object.entries(t.warehouseLowStock)){get(m.warehouses,id,'阈值所属工具库');qty(value,'分库低储阈值',true)}}}
  for(const k of m.kits){if(!Array.isArray(k.lines)||!k.lines.length||new Set(k.lines.map(l=>l.assetId)).size!==k.lines.length)fail('套装组成无效');for(const l of k.lines){get(m.assets,l.assetId,'套装成员');qty(l.quantity)}}
  for(const l of m.loans){if(!['OPEN','CLOSED'].includes(l.status)||!Array.isArray(l.lines)||!l.lines.length||new Set(l.lines.map(line=>line.assetId)).size!==l.lines.length)fail('借用单格式无效');date(l.dueAt,'归还期限');if(l.kitId)get(m.kits,l.kitId,'套装');for(const line of l.lines){get(m.assets,line.assetId,'借用工具');qty(line.quantity);qty(line.returned,'已还数量',true);qty(line.disposed||0,'遗失报废数量',true);if(outstanding(line)<0)fail('已还及报废数量超过借用数量')}if((l.lines.every(r=>outstanding(r)===0))!==(l.status==='CLOSED'))fail('借用单状态与未还数量不一致')}
  for(const key of ['transfers','services','disposals'])for(const r of m[key]){get(m.assets,r.assetId,'流转工具');qty(r.quantity);if(!({transfers:['PENDING','RECEIVED','CANCELLED'],services:['OPEN','CLOSED'],disposals:['PENDING','APPROVED','REJECTED']})[key].includes(r.status))fail('工具单据状态无效')}
  for(const r of m.transfers){get(m.warehouses,r.fromWarehouseId,'调出库');get(m.warehouses,r.toWarehouseId,'调入库');if(r.fromWarehouseId===r.toWarehouseId)fail('调拨库不能相同')}
  for(const r of m.services){if(!['INSPECTION','REPAIR'].includes(r.kind)||r.status==='CLOSED'&&!['PASS','FAIL'].includes(r.result))fail('检定维修结果无效')}
  for(const r of m.disposals){if(!['LOST','SCRAPPED'].includes(r.kind))fail('遗失报废类型无效');if(r.status!=='PENDING'&&r.reviewer===r.actor)fail('遗失报废申请与审核人不能相同');if(r.loanId&&!get(m.loans,r.loanId,'关联借用单').lines.some(l=>l.assetId===r.assetId))fail('遗失报废工具与借用单不符')}
  for(const loan of m.loans){
    text(loan.borrower,'领用人',80);text(loan.actor,'借用经办人',80)
    if(!Array.isArray(loan.returns))fail('归还记录无效')
    for(const r of loan.returns){if(!loan.lines.some(l=>l.assetId===r.assetId))fail('归还记录工具无效');qty(r.quantity);text(r.returner,'归还人',80);date(r.at,'归还时间')}
    for(const l of loan.lines){
      if(loan.returns.filter(r=>r.assetId===l.assetId).reduce((s,r)=>s+r.quantity,0)!==l.returned)fail('归还数量与明细不一致')
      if(m.disposals.filter(r=>r.loanId===loan.id&&r.assetId===l.assetId&&r.status==='APPROVED').reduce((s,r)=>s+r.quantity,0)!==(l.disposed||0))fail('借用退出数量与审核单不一致')
      if(m.disposals.filter(r=>r.loanId===loan.id&&r.assetId===l.assetId&&r.status==='PENDING').reduce((s,r)=>s+r.quantity,0)>outstanding(l))fail('借用退出待审核数量过多')
    }
  }
  for(const a of m.assets)if(assetHeld(m,a.id)>a.quantity)fail('工具占用数量超过账面数量')
  for(const t of state.tools){const assets=m.assets.filter(a=>a.toolId===t.id);if(assets.length&&Number(t.quantity)!==assets.reduce((n,a)=>n+assetStock(m,a),0))fail('已接管工具数量必须通过借还、盘点等业务更新')}
  for(const c of m.counts){get(m.warehouses,c.warehouseId,'盘点工具库');if(!['OPEN','CLOSED','CANCELLED'].includes(c.status)||!Array.isArray(c.lines)||new Set(c.lines.map(l=>l.assetId)).size!==c.lines.length)fail('盘点记录无效');for(const l of c.lines){get(m.assets,l.assetId,'盘点工具');qty(l.expected,'账面在库',true);if(c.status==='CLOSED')qty(l.counted,'实盘数量',true)}}
  for(const d of m.devices){get(m.warehouses,d.warehouseId,'设备工具库');if(!['CABINET','ROOM'].includes(d.kind)||typeof d.enabled!=='boolean')fail('设备类型或状态无效');if(d.lastSeenAt)date(d.lastSeenAt,'设备通信时间')}
  for(const e of m.events){if(e.deviceId)get(m.devices,e.deviceId,'事件设备');if(!['HARDWARE','SIMULATED'].includes(e.source)||!['ACCEPTED','ERROR'].includes(e.status))fail('设备事件来源或状态无效');date(e.at,'事件时间')}
  if(new Set(m.commands.map(c=>c.requestId)).size!==m.commands.length)fail('请求编号重复')
  return true
}
