// Shared domain rules for the tool workspace and authenticated device gateway.
const lists=['warehouses','categories','assets','kits','loans','transfers','services','disposals','counts','devices','events','audit','commands']
export const emptyToolManagement=()=>Object.fromEntries([['version',1],['countAvailabilityVersion',1],...lists.map(key=>[key,[]])])
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
const approvedCountLoss=(m,id)=>m.disposals.filter(r=>r.assetId===id&&r.countId&&r.status==='APPROVED').reduce((n,r)=>n+r.quantity,0)
const pendingCountLoss=(m,id)=>m.disposals.filter(r=>r.assetId===id&&r.countId&&r.status==='PENDING').reduce((n,r)=>n+r.quantity,0)
const countDeficit=(m,line)=>Math.max(0,line.expected-line.counted-Math.max(0,approvedCountLoss(m,line.assetId)-(line.lossAdjusted||0)))
function latestCountLine(m,id){
  return m.counts.filter(c=>c.status==='CLOSED'&&c.lines.some(l=>l.assetId===id)).sort((a,b)=>String(a.finishedAt||a.at).localeCompare(String(b.finishedAt||b.at))||(a.finishedAuditId||0)-(b.finishedAuditId||0)||a.id-b.id).at(-1)?.lines.find(l=>l.assetId===id)
}
// Count shortages freeze physical availability without writing off the account.
// A later count supersedes the observation; approved losses offset every older
// baseline, so changing count numbers cannot apply the same loss twice.
export function countLossRemaining(m,count,line){
  if(count?.status!=='CLOSED'||!line)return 0
  const latest=latestCountLine(m,line.assetId)
  return Math.max(0,Math.min(countDeficit(m,line),latest?countDeficit(m,latest):0)-pendingCountLoss(m,line.assetId))
}
export function assetCountShortage(m,id){
  const line=latestCountLine(m,id)
  return line?Math.max(0,countDeficit(m,line)-pendingCountLoss(m,id)):0
}
export const assetPhysicalAvailable=(m,a)=>Math.max(0,assetInStock(m,a)-assetCountShortage(m,a.id))
export const assetStock=(m,a)=>a.status==='AVAILABLE'?assetPhysicalAvailable(m,a):0
// Store exact ancestry records on a split. Do not inherit the parent's later,
// unrelated transactions. Legacy -S/-T batches remain traceable when unambiguous.
export function assetBusinessHistory(m,id,kind){
  const a=m.assets.find(a=>a.id===id),ids=new Set(Array.isArray(a?.sourceRecordIds?.[kind])?a.sourceRecordIds[kind]:[])
  if(a&&!a.sourceRecordIds){const match=a.code.match(/-([ST])(\d+)$/);if(match&&(match[1]==='S'?'services':'transfers')===kind){const row=m[kind].find(r=>r.id===Number(match[2]));const parent=m.assets.find(p=>p.id===row?.assetId);if(parent&&a.code===`${parent.code.slice(0,45)}-${match[1]}${row.id}`&&row.status!=='OPEN'&&row.status!=='PENDING')ids.add(row.id)}}
  return m[kind].filter(r=>r.assetId===id||r.resultingAssetId===id||ids.has(r.id))
}
function splitAsset(m,a,n,suffix,sourceKind,sourceId,changes={}){
  const id=next(m.assets),base=`${a.code.slice(0,45)}-${suffix}`,code=m.assets.some(r=>r.code.toLowerCase()===base.toLowerCase())?`${base}-${id}`:base
  const sourceRecordIds=Object.fromEntries(['services','transfers'].map(kind=>[kind,assetBusinessHistory(m,a.id,kind).filter(r=>['CLOSED','RECEIVED'].includes(r.status)&&(!r.resultingAssetId||r.resultingAssetId===a.id)).map(r=>r.id)]))
  if(!sourceRecordIds[sourceKind].includes(sourceId))sourceRecordIds[sourceKind].push(sourceId)
  a.quantity-=n
  const child={...a,id,code,tag:'',quantity:n,parentAssetId:a.id,sourceRecordIds,...changes}
  m.assets.push(child);return child
}
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
export function upgradeToolCountAvailability(state){
  const m=state.toolManagement
  if(!m||m.countAvailabilityVersion!==undefined||!['assets','counts','disposals','loans','services','transfers'].every(k=>Array.isArray(m[k]))||!Array.isArray(state.tools))return
  // Upgrade the derived available quantity only. Accounting asset quantities
  // and historical approvals are never rewritten by a backup compatibility pass.
  for(const c of m.counts)for(const l of c.lines||[])if(l.lossAdjusted===undefined)l.lossAdjusted=m.disposals.filter(r=>r.countId&&r.assetId===l.assetId&&r.status==='APPROVED'&&r.reviewedAt&&r.reviewedAt<c.at).reduce((n,r)=>n+r.quantity,0)
  synchronize(state);m.countAvailabilityVersion=1
}
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
const available=(m,a,n,now,inspection=true)=>{if((inspection?assetStock(m,a):assetPhysicalAvailable(m,a))<n)fail('在库可用数量不足、存在盘亏待处理或工具已停用');if(inspection&&!validAt(a,now))fail('工具检定已到期或缺少检定日期，不能领用或调拨')}
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
  upgradeToolCountAvailability(copy)
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
  const audit=(action,detail)=>m.audit.push({id:next(m.audit),at:now,actor,actorEmployeeId:employeeIdByName(copy,actor),action,detail})
  switch(type){
    case 'BATCH':{
      if(!Array.isArray(p.commands)||!p.commands.length||p.commands.length>100)fail('请选择1至100项办理')
      const allowed=['BORROW','RETURN','KIT_RETURN','TRANSFER','TRANSFER_FINISH','SERVICE_SEND','SERVICE_FINISH','DISPOSAL_REQUEST','DISPOSAL_REVIEW','ASSET_EDIT','ADOPT_LEGACY','ASSET_DELETE','KIT_DELETE']
      result.results=[]
      for(const [i,c] of p.commands.entries()){
        if(!c||!allowed.includes(c.type))fail('不支持的批量操作')
        result.results.push(applyToolCommand(copy,{type:c.type,payload:c.payload,actor,requestId:`${requestId}:${i}`},{now,hardware:false}))
      }
      Object.assign(m,copy.toolManagement);break
    }
    case 'WAREHOUSE_STANDARDIZE':{
      if(m.warehousePolicy==='FIXED_TWO')break
      const old=structuredClone(m.warehouses)
      const maintenance=old.find(w=>w.name==='检修工具库')||old.find(w=>!w.name.includes('整备'))
      const preparation=old.find(w=>w.name==='整备工具库')||old.find(w=>w.name.includes('整备'))
      const a=maintenance?.id||next(old),b=preparation?.id||(Math.max(a,...old.map(w=>w.id))+1)
      const mapping=new Map(old.map(w=>[w.id,w.id===preparation?.id?b:a]))
      for(const r of [...m.assets,...m.devices,...m.counts])r.warehouseId=mapping.get(r.warehouseId)||a
      for(const l of m.loans)for(const line of l.lines)line.warehouseId=mapping.get(line.warehouseId)||a
      for(const t of m.transfers){t.fromWarehouseId=mapping.get(t.fromWarehouseId)||a;t.toWarehouseId=mapping.get(t.toWarehouseId)||b;if(t.fromWarehouseId===t.toWarehouseId)fail('历史调拨涉及多个库，需先明确库位映射，未修改数据')}
      for(const t of copy.tools)if(t.warehouseLowStock){const thresholds={};for(const [id,n] of Object.entries(t.warehouseLowStock)){const key=mapping.get(Number(id))||a;thresholds[key]=Math.max(thresholds[key]||0,n)}t.warehouseLowStock=thresholds}
      m.warehouses=[{id:a,code:'MAINTENANCE',name:'检修工具库'},{id:b,code:'PREPARATION',name:'整备工具库'}]
      m.warehousePolicy='FIXED_TWO';result.previousWarehouses=old;break
    }
    case 'CATEGORY_DELETE':{
      const r=get(m.categories,p.id,'分类');if(copy.tools.some(t=>t.categoryId===r.id))fail('分类被工具引用，请先修改工具分类后删除')
      m.categories=m.categories.filter(t=>t.id!==r.id);break
    }
    case 'TOOL_DELETE':{
      const t=get(copy.tools,p.id,'工具品种');if(m.assets.some(a=>a.toolId===t.id)||copy.toolRequirements.some(r=>r.toolId===t.id))fail('工具品种已被台账或工序引用，不能删除')
      if(Number(t.quantity)>0)fail('仍有原库存，请先登记并通过业务处置库存')
      copy.tools=copy.tools.filter(r=>r.id!==t.id);break
    }
    case 'KIT_DELETE':{
      const k=get(m.kits,p.id,'套装');if(m.loans.some(l=>l.kitId===k.id))fail('套装有借还历史，不能删除历史引用；可修改未借出套装的组成')
      m.kits=m.kits.filter(r=>r.id!==k.id);break
    }
    case 'DEVICE_DELETE':{
      const d=get(m.devices,p.id,'设施');if(m.events.some(e=>e.deviceId===d.id))fail('设施存在事件记录，不能删除历史引用，请停用')
      m.devices=m.devices.filter(r=>r.id!==d.id);break
    }
    case 'ASSET_DELETE':{
      const a=asset()
      if(a.parentAssetId||a.sourceRecordIds||assetHeld(m,a.id)||m.kits.some(k=>k.lines.some(l=>l.assetId===a.id))||m.loans.some(l=>l.lines.some(r=>r.assetId===a.id))||['services','transfers','disposals'].some(key=>m[key].some(r=>r.assetId===a.id||r.resultingAssetId===a.id))||m.counts.some(c=>c.lines.some(r=>r.assetId===a.id))||m.events.some(e=>e.assetId===a.id))fail('工具存在套装引用或业务记录，不能删除；请通过报废流程处置')
      if(m.assets.filter(r=>r.toolId===a.toolId).length===1)get(copy.tools,a.toolId,'品种').quantity=0
      m.assets=m.assets.filter(r=>r.id!==a.id);break
    }
    case 'ASSET_EDIT':{
      const a=asset();if(assetHeld(m,a.id))fail('工具正在办理业务，不能修改基础信息')
      const code=text(p.code,'工具编号',64)
      if(m.assets.some(r=>r.id!==a.id&&r.code.toLowerCase()===code.toLowerCase()))fail('工具编号重复')
      a.code=code
      for(const key of ['receivedAt','lastRepairAt','lastInspectionAt'])if(p[key]!==undefined){if(p[key]&&new Date(date(p[key],key))>new Date(now))fail('日期不能在未来');a[key]=p[key]||null}
      if(p.tag!==undefined){const tag=String(p.tag).trim();if(tag.length>100||tag&&m.assets.some(r=>r.id!==a.id&&r.tag===tag))fail('条形码重复或过长');a.tag=tag}
      if(p.inspectionCycleMonths!==undefined)a.inspectionCycleMonths=qty(p.inspectionCycleMonths,'检定周期',true)
      break
    }
    case 'WAREHOUSE_SAVE':case 'CATEGORY_SAVE':{
      if(type==='WAREHOUSE_SAVE'&&m.warehousePolicy==='FIXED_TWO')fail('仅使用检修工具库和整备工具库，不可新增或修改工具库')
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
      const mode=type==='ADOPT_LEGACY'?(p.mode||'BULK'):p.mode
      if(!['BULK','NUMBERED'].includes(mode)||mode==='NUMBERED'&&count!==1&&type!=='ADOPT_LEGACY')fail('单件工具数量必须为1')
      const row={id:next(m.assets),toolId:t.id,warehouseId:w.id,code:text(p.code,'实物/批次编号',64),mode,quantity:mode==='NUMBERED'?1:count,status:'AVAILABLE',tag:String(p.tag||'').trim().slice(0,100),inspectionCycleMonths:qty(p.inspectionCycleMonths??t.inspectionCycleMonths??0,'检定周期',true),lastInspectionAt:p.lastInspectionAt?date(p.lastInspectionAt,'最近合格检定日期'):null,receivedAt:p.receivedAt?date(p.receivedAt,'入库时间'):now,lastRepairAt:p.lastRepairAt?date(p.lastRepairAt,'最后检修时间'):null,createdAt:now}
      if(row.lastInspectionAt&&new Date(row.lastInspectionAt)>new Date(now))fail('最近合格检定日期不能在未来')
      if(new Date(row.receivedAt)>new Date(now)||row.lastRepairAt&&new Date(row.lastRepairAt)>new Date(now))fail('入库或检修时间不能在未来')
      const pieces=mode==='NUMBERED'&&type==='ADOPT_LEGACY'?count:1
      if(pieces+m.assets.length>50000)fail('登记后工具台账数量超过5万条上限')
      if(pieces>1&&row.tag)fail('多件编号工具请在登记后分别绑定标签')
      const created=Array.from({length:pieces},(_,i)=>({...row,id:row.id+i,code:pieces>1?`${row.code.slice(0,50)}-${String(i+1).padStart(3,'0')}`:row.code}))
      if(created.some(r=>m.assets.some(a=>a.code.toLowerCase()===r.code.toLowerCase()||r.tag&&a.tag===r.tag)))fail('实物编号或标签重复')
      m.assets.push(...created);result.id=row.id;result.assetIds=created.map(r=>r.id);break
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
    case 'RETURN':case 'KIT_RETURN':{
      const l=get(m.loans,p.loanId,'借用单');if(!open(l))fail('借用单已归还完毕')
      const pending=line=>m.disposals.filter(r=>r.loanId===l.id&&r.assetId===line.assetId&&r.status==='PENDING').reduce((s,r)=>s+r.quantity,0)
      if(type==='KIT_RETURN'&&!l.kitId)fail('该借用单不属于工具套装')
      const lines=type==='RETURN'?[{assetId:Number(p.assetId),quantity:p.quantity}]:p.lines??l.lines.map(line=>({assetId:line.assetId,quantity:outstanding(line)-pending(line)})).filter(line=>line.quantity>0)
      if(!Array.isArray(lines)||!lines.length||new Set(lines.map(r=>Number(r.assetId))).size!==lines.length)fail('请选择可归还成员，不能重复')
      const returner=text(p.returner,'归还人',80)
      for(const item of lines){
        const line=l.lines.find(r=>r.assetId===Number(item.assetId));if(!line)fail('该工具不在借用单中')
        const n=qty(item.quantity);if(n>outstanding(line)-pending(line))fail('归还数量超过未还数量或已有遗失报废待审核')
        line.returned+=n;l.returns.push({assetId:line.assetId,quantity:n,returner,at:now,actor})
      }
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
        if(row.quantity===a.quantity){a.warehouseId=row.toWarehouseId;row.resultingAssetId=a.id}
        else{row.resultingAssetId=splitAsset(m,a,row.quantity,`T${row.id}`,'transfers',row.id,{warehouseId:row.toWarehouseId}).id}
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
        if(row.quantity===a.quantity){a.lastInspectionAt=now;if(row.kind==='REPAIR')a.lastRepairAt=now;a.status='AVAILABLE';row.resultingAssetId=a.id}
        else{row.resultingAssetId=splitAsset(m,a,row.quantity,`S${row.id}`,'services',row.id,{lastInspectionAt:now,...(row.kind==='REPAIR'?{lastRepairAt:now}:{}),status:'AVAILABLE'}).id}
      }else{
        const failed=row.quantity===a.quantity?a:splitAsset(m,a,row.quantity,`S${row.id}`,'services',row.id,{status:'DISABLED'})
        failed.status='DISABLED';row.resultingAssetId=failed.id
        const disposal={id:next(m.disposals),assetId:failed.id,quantity:row.quantity,kind:'SCRAPPED',reason:`${row.kind==='REPAIR'?'维修':'检定'}不合格：${certificate}`,status:'PENDING',at:now,actor,serviceId:row.id};m.disposals.push(disposal);createToolApproval(copy,disposal,now);result.disposalId=disposal.id
      }
      result.resultingAssetId=row.resultingAssetId||a.id
      break
    }
    case 'DISPOSAL_REQUEST':{
      const a=asset(),n=qty(p.quantity)
      if(p.countId){
        if(p.loanId)fail('盘亏申请不能关联借用单，请按盘点在库差异办理')
        const count=get(m.counts,p.countId,'盘点单'),line=count.lines.find(l=>l.assetId===a.id)
        if(count.status!=='CLOSED'||!line||p.kind!=='LOST')fail('请选择已完成盘点中的盘亏工具')
        if(n>countLossRemaining(m,count,line))fail('申请数量超过尚未处理的盘亏数量；同一差异可能已由其他盘点申请处理，或已被后续盘点复核')
      }
      if(p.loanId){
        const loan=get(m.loans,p.loanId,'借用单'),line=loan.lines.find(l=>l.assetId===a.id)
        const pending=m.disposals.filter(r=>r.loanId===loan.id&&r.assetId===a.id&&r.status==='PENDING').reduce((s,r)=>s+r.quantity,0)
        if(!open(loan)||!line||n>outstanding(line)-pending)fail('借用单未还数量不足或已有待审核申请')
      }else if(p.countId){if(assetInStock(m,a)<n)fail('账面可处置数量不足，请复核盘点及占用记录')}
      else available(m,a,n,now,false)
      if(!['LOST','SCRAPPED'].includes(p.kind))fail('申请类型无效')
      const row={id:next(m.disposals),assetId:a.id,quantity:n,kind:p.kind,reason:text(p.reason,'申请原因',500),status:'PENDING',at:now,actor,loanId:p.loanId?Number(p.loanId):null,...(p.countId?{countId:Number(p.countId)}:{})};m.disposals.push(row);createToolApproval(copy,row,now);result.id=row.id;break
    }
    case 'DISPOSAL_REVIEW':{
      const row=get(m.disposals,p.id,'遗失报废申请');if(row.status!=='PENDING')fail('申请已经审核')
      if(!['APPROVED','REJECTED'].includes(p.decision))fail('审核结果无效')
      if(actor===row.actor)fail('申请人与审核人不能相同')
      if(p.decision==='APPROVED'&&row.countId){
        const count=get(m.counts,row.countId,'盘点单'),line=count.lines.find(l=>l.assetId===row.assetId),latest=latestCountLine(m,row.assetId)
        if(!line||!latest||Math.min(countDeficit(m,line),countDeficit(m,latest))<pendingCountLoss(m,row.assetId))fail('盘亏基准已变化或差异已处理，请驳回后根据最新盘点重新申请')
      }
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
      const w=warehouse(p.warehouseId),lines=m.assets.filter(a=>a.warehouseId===w.id&&['AVAILABLE','DISABLED'].includes(a.status)).map(a=>({assetId:a.id,expected:assetInStock(m,a)+pendingCountLoss(m,a.id),stockKey:stockKey(m,a),lossAdjusted:approvedCountLoss(m,a.id),counted:null}))
      if(!lines.length)fail('该工具库没有可盘点工具')
      const row={id:next(m.counts),warehouseId:w.id,at:now,actor,status:'OPEN',lines};m.counts.push(row);result.id=row.id;break
    }
    case 'COUNT_PROGRESS':{
      const row=get(m.counts,p.id,'盘点单');if(!open(row))fail('盘点已完成或不存在')
      if(p.progressRevision!==undefined&&p.progressRevision!==(row.progressRevision||0))fail('其他页面已更新盘点进度，请读取数据库进度后复核，未覆盖他人记录')
      if(!Array.isArray(p.lines)||p.lines.length>row.lines.length)fail('盘点进度格式无效')
      const ids=new Set(row.lines.map(line=>line.assetId))
      for(const observed of p.lines){
        if(!ids.has(Number(observed.assetId)))fail('盘点工具不属于该盘点单')
        const line=row.lines.find(item=>item.assetId===Number(observed.assetId)),a=get(m.assets,line.assetId,'盘点工具')
        if(stockKey(m,a)!==line.stockKey)fail('盘点期间库存已变化，请取消后重新盘点')
        if(observed.counted===null||observed.counted===undefined){line.counted=null;continue}
        line.counted=qty(observed.counted,'实盘数量',true)
        if(a.mode==='NUMBERED'&&line.counted>1)fail('单件工具实盘数量只能为0或1')
      }
      row.progressRevision=(row.progressRevision||0)+1;row.updatedAt=now;row.updatedBy=actor
      result.id=row.id;result.savedLines=p.lines.length;break
    }
    case 'COUNT_FINISH':{
      const row=get(m.counts,p.id,'盘点单');if(!open(row))fail('盘点单已处理')
      if(p.progressRevision!==undefined&&p.progressRevision!==(row.progressRevision||0))fail('其他页面已更新盘点进度，请读取数据库进度后复核')
      row.reason=text(p.reason,'差异说明/盘点结论',500)
      if(!Array.isArray(p.lines)||p.lines.length!==row.lines.length||new Set(p.lines.map(l=>l.assetId)).size!==row.lines.length)fail('请填写每项实盘数量，不得重复')
      for(const line of row.lines){const a=get(m.assets,line.assetId,'工具实物');if(stockKey(m,a)!==line.stockKey)fail('盘点期间库存已变化，请取消后重新盘点')
        const observed=p.lines.find(l=>l.assetId===line.assetId);if(!observed||observed.counted===null||observed.counted===undefined)fail('还有工具未完成核对，请标记“已找到”或“已核对未找到”');line.counted=qty(observed.counted,'实盘数量',true)
        if(a.mode==='NUMBERED'&&line.counted>1)fail('单件工具实盘数量只能为0或1')
        // A count records physical facts. It must not silently turn a discrepancy
        // into a lost/scrapped asset; that decision follows the existing application
        // and approval workflow.
        line.difference=line.counted-line.expected
      }
      row.status='CLOSED';row.finishedAt=now;row.finishedAuditId=next(m.audit);row.confirmedBy=actor;break
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
          const quantity=qty(p.quantity??1)
          const payload=p.eventType==='CHECKOUT'?{assetId:a.id,quantity,borrower:person.name,borrowType:'智能设施领用',dueAt:p.dueAt,scheduleTaskId:p.scheduleTaskId}:{loanId:p.loanId,assetId:a.id,quantity,returner:person.name}
          const sub=applyToolCommand(copy,{requestId:`event:${device.id}:${event.externalId}`,type:p.eventType==='CHECKOUT'?'BORROW':'RETURN',actor,payload},{now})
          if(p.eventType==='CHECKOUT'&&p.scheduleTaskId)applyToolCommand(copy,{requestId:`check:${device.id}:${event.externalId}`,type:'CHECK_USE',actor,payload:{assetId:a.id,scheduleTaskId:p.scheduleTaskId,quantity}},{now,hardware})
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
  if(m.countAvailabilityVersion!==undefined&&m.countAvailabilityVersion!==1)fail('盘点可用量版本无效')
  if(m.warehousePolicy==='FIXED_TWO'&&(m.warehouses.length!==2||!['检修工具库','整备工具库'].every(name=>m.warehouses.some(w=>w.name===name))))fail('工具库必须固定为检修工具库和整备工具库')
  if(!Array.isArray(state.approvalRecords))fail('审核记录集合无效')
  for(const approval of state.approvalRecords){
    const allowedApprovalStatuses=approval.businessType==='MONTHLY_PLAN_APPLICATION'?['PENDING','APPROVED','REJECTED','WITHDRAWN']:['PENDING','APPROVED','REJECTED']
    if(!Number.isSafeInteger(approval.id)||approval.id<1||typeof approval.businessType!=='string'||!Number.isSafeInteger(approval.businessId)||approval.businessId<1||!allowedApprovalStatuses.includes(approval.approvalStatus))fail('审核记录格式无效')
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
  for(const a of m.assets)for(const key of ['receivedAt','lastRepairAt','createdAt'])if(a[key])date(a[key],key)
  for(const a of m.assets){if(typeof a.tag!=='string'||a.tag.length>100||['LOST','SCRAPPED'].includes(a.status)&&a.quantity!==0)fail('实物标签或退出状态无效')}
  for(const a of m.assets){
    if(a.parentAssetId){const parent=get(m.assets,a.parentAssetId,'来源台账');if(parent.id>=a.id||parent.toolId!==a.toolId)fail('来源台账关联无效')}
    if(a.sourceRecordIds){if(typeof a.sourceRecordIds!=='object'||Array.isArray(a.sourceRecordIds))fail('来源履历格式无效');for(const kind of ['services','transfers']){const ids=a.sourceRecordIds[kind];if(!Array.isArray(ids)||new Set(ids).size!==ids.length)fail('来源履历格式无效');for(const id of ids)get(m[kind],id,'来源业务单')}}
  }
  for(const t of state.tools){if(t.categoryId)get(m.categories,t.categoryId,'工具分类');if(t.lowStock!=null)qty(t.lowStock,'低储阈值',true);if(t.warehouseLowStock){if(typeof t.warehouseLowStock!=='object'||Array.isArray(t.warehouseLowStock))fail('分库低储阈值格式无效');for(const [id,value] of Object.entries(t.warehouseLowStock)){get(m.warehouses,id,'阈值所属工具库');qty(value,'分库低储阈值',true)}}}
  for(const k of m.kits){if(!Array.isArray(k.lines)||!k.lines.length||new Set(k.lines.map(l=>l.assetId)).size!==k.lines.length)fail('套装组成无效');for(const l of k.lines){get(m.assets,l.assetId,'套装成员');qty(l.quantity)}}
  for(const l of m.loans){if(!['OPEN','CLOSED'].includes(l.status)||!Array.isArray(l.lines)||!l.lines.length||new Set(l.lines.map(line=>line.assetId)).size!==l.lines.length)fail('借用单格式无效');date(l.dueAt,'归还期限');if(l.kitId)get(m.kits,l.kitId,'套装');for(const line of l.lines){get(m.assets,line.assetId,'借用工具');qty(line.quantity);qty(line.returned,'已还数量',true);qty(line.disposed||0,'遗失报废数量',true);if(outstanding(line)<0)fail('已还及报废数量超过借用数量')}if((l.lines.every(r=>outstanding(r)===0))!==(l.status==='CLOSED'))fail('借用单状态与未还数量不一致')}
  for(const key of ['transfers','services','disposals'])for(const r of m[key]){get(m.assets,r.assetId,'流转工具');qty(r.quantity);if(!({transfers:['PENDING','RECEIVED','CANCELLED'],services:['OPEN','CLOSED'],disposals:['PENDING','APPROVED','REJECTED']})[key].includes(r.status))fail('工具单据状态无效')}
  for(const r of [...m.transfers,...m.services])if(r.resultingAssetId){const target=get(m.assets,r.resultingAssetId,'接收台账'),source=get(m.assets,r.assetId,'来源台账');if(target.toolId!==source.toolId)fail('来源业务与接收工具不符')}
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
