import { escapeHtml as esc, openModal, toast } from '../../../core/ui.js'
import { applyToolCommand, emptyToolManagement, assetStock, toolLabels as labels } from '../../../core/tool-management.js'

import {renderToolWorkspace,toolDestination,toolSections,openToolDetails,disposalContext} from '../../../shared/tool-workspace.js'

const view={tab:'ledger',section:'',query:'',warehouse:'',status:'',route:null,busy:false}
const routeTab={'g1-p2':'service','g2-p1':'circulation','g3-p1':'service','g4-p1':'alerts','g5-p1':'devices','g5-p2':'devices'}
const label=v=>labels[v]||v||'—'
const name=(rows,id)=>rows.find(r=>r.id===id)?.name||'—'
const dt=v=>v?String(v).replace('T',' ').slice(0,16):'—'
const options=(rows,value,labelFn=r=>r.name)=>rows.map(r=>`<option value="${r.id}" ${String(value)===String(r.id)?'selected':''}>${esc(labelFn(r))}</option>`).join('')
const table=(heads,rows)=>`<div class="table-wrap"><table><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td class="empty" colspan="${heads.length}">暂无记录</td></tr>`}</tbody></table></div>`
const select=(key,title,rows,selected='',fn)=>`<label class="field tool-field"><span>${title}</span><select class="select" data-f="${key}"><option value="">请选择</option>${options(rows,selected,fn)}</select></label>`
const input=(key,title,value='',type='text',extra='')=>`<label class="field tool-field"><span>${title}</span><input class="input" data-f="${key}" type="${type}" value="${esc(value)}" ${extra}></label>`
const num=(key,title,value=1)=>input(key,title,value,'number',`min="${['lowStock','inspectionCycleMonths'].includes(key)?0:1}" step="1"`)
const choice=(key,title,values,value)=>`<label class="field tool-field"><span>${title}</span><select class="select" data-f="${key}">${values.map(([v,t])=>`<option value="${v}" ${value===v?'selected':''}>${t}</option>`).join('')}</select></label>`
const jsonFields=modal=>Object.fromEntries([...modal.querySelectorAll('[data-f]')].filter(el=>!el.disabled).map(el=>[el.dataset.f,el.value]))

async function command(ctx,type,payload,actor,requestId){
  if(view.busy)return false
  view.busy=true
  try{
    let result
    if(ctx.demoPersistence?.status?.storage==='postgresql'){
      const saved=await ctx.demoPersistence.save();if(!saved.ok)throw Error(saved.message)
      const response=await fetch('/api/tools/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,payload,actor,requestId,revision:ctx.demoPersistence.revision})})
      result=await response.json();if(!response.ok)throw Error(result.message)
      const loaded=await ctx.demoPersistence.load();if(!loaded.ok)throw Error('操作已提交，但刷新失败。请重试连接，勿重复办理。')
    }else{result=applyToolCommand(ctx.state,{type,payload,actor,requestId});await ctx.demoPersistence?.save()}
    toast(result.eventStatus==='ERROR'?'已记录异常':'办理成功',result.duplicate?'该操作已办理，未重复扣减库存':result.eventStatus==='ERROR'?'请在盘点与预警中查看并处理':'数据已保存',result.eventStatus==='ERROR'?'warning':'success')
    afterCommand(type,payload,result);ctx.rerender(false);return true
  }finally{view.busy=false}
}
const requiredFields={WAREHOUSE_SAVE:['code','name'],CATEGORY_SAVE:['code','name'],TOOL_SAVE:['code','name'],REQUIREMENT_SAVE:['taskId','quantity'],ASSET_CREATE:['toolId','warehouseId','code','mode','quantity'],ADOPT_LEGACY:['toolId','warehouseId','code'],KIT_SAVE:['code','name'],BORROW:['assetId','quantity','borrower','dueAt'],RETURN:['assetId','quantity','returner'],TRANSFER:['assetId','quantity','toWarehouseId'],SERVICE_SEND:['assetId','quantity','provider','reason'],SERVICE_FINISH:['result','certificate'],DISPOSAL_REQUEST:['assetId','quantity','kind','reason'],DISPOSAL_REVIEW:['decision','opinion'],COUNT_CREATE:['warehouseId'],COUNT_FINISH:['reason'],DEVICE_SAVE:['code','name','warehouseId','kind'],EVENT_RESOLVE:['resolution'],CHECK_USE:['quantity']}
function focusTab(ctx,selector){ctx.rerender(false);const target=document.querySelector(selector);target?.focus({preventScroll:true});target?.scrollIntoView?.({block:'nearest',inline:'nearest'})}
function afterCommand(type,p,result){
  const dest=(tab,section,status='')=>toolDestination(view,tab,section,status)
  if(['ASSET_CREATE','ADOPT_LEGACY'].includes(type))dest('ledger')
  if(type==='BORROW')dest('circulation','loans','OPEN')
  if(type==='TRANSFER')dest('circulation','transfers','PENDING')
  if(type==='TRANSFER_FINISH')dest('circulation','transfers')
  if(type==='SERVICE_SEND')dest('service',p.kind==='REPAIR'?'repair':'inspection','OPEN')
  if(type==='SERVICE_FINISH')dest('service',result.disposalId?'disposals':view.section,result.disposalId?'PENDING':'')
  if(type==='DISPOSAL_REQUEST')dest('service','disposals','PENDING')
  if(type==='DISPOSAL_REVIEW')dest('service','disposals')
  if(type.startsWith('COUNT_'))dest('alerts','counts')
  if(type==='DEVICE_EVENT')dest('devices','events')
}
let formId=0
function form(ctx,title,type,body,transform=x=>x){
  const requestId=crypto.randomUUID(),id=++formId
  const wrap=openModal({title,wide:true,body:`<div class="tool-form">${body}${input('actor','经办人','','text','list="tool-actor-options" required')}<datalist id="tool-actor-options">${ctx.state.employees.map(e=>`<option value="${esc(e.name)}"></option>`).join('')}</datalist><p class="pc-help">带 * 的项目必填。确认后保存业务记录并更新库存。</p><p role="alert" class="tool-form-error" data-tool-form-error></p></div>`,confirmText:type==='DISPOSAL_REVIEW'?'确认审核':'确认办理',async onConfirm(modal){
    modal.querySelector('[data-tool-form-error]').textContent=''
    modal.querySelectorAll('[data-f]').forEach(el=>{el.removeAttribute('aria-invalid');modal.querySelector(`[data-field-error="${el.dataset.f}"]`).textContent=''})
    const showError=(message,field)=>{
      const element=field?modal.querySelector(`[data-f="${field}"]`):null
      modal.querySelector('[data-tool-form-error]').textContent=message
      if(element){element.setAttribute('aria-invalid','true');modal.querySelector(`[data-field-error="${field}"]`).textContent=message;const group=element.closest('details');if(group)group.open=true;element.focus()}
      return false
    }
    for(const el of modal.querySelectorAll('[data-f]')){
      if(el.disabled)continue
      if(el.required&&!String(el.value).trim())return showError(`请填写${el.closest('label')?.querySelector('span')?.textContent.replace(' *','')||'必填项目'}`,el.dataset.f)
      if(!el.checkValidity())return showError(el.validationMessage,el.dataset.f)
    }
    const values=jsonFields(modal),actor=values.actor;delete values.actor
    if(Number(values.inspectionCycleMonths)>0&&!values.lastInspectionAt&&['ASSET_CREATE','ADOPT_LEGACY'].includes(type)){
      const hint=modal.querySelector('[data-tool-form-error]');hint.textContent='尚未登记最近合格检定日期，保存后会显示为“未登记检定”，在完成送检前不能领用。';
    }
    try{return await command(ctx,type,transform(values,modal),actor,requestId)}catch(error){
      const field=error.toolField||[['经办人','actor'],['工具库','warehouseId'],['品种','toolId'],['编码','code'],['编号','code'],['数量','quantity'],['归还时间','dueAt'],['标签','tag'],['审核意见','opinion'],['申请人与审核人','actor']].find(([word,key])=>error.message.includes(word)&&modal.querySelector(`[data-f="${key}"]`))?.[1]
      return showError(error.message,field)
    }
  }})
  const required=new Set([...(requiredFields[type]||[]),'actor'])
  if(type==='BORROW'&&!wrap.querySelector('[data-f="assetId"]')){required.delete('assetId');required.delete('quantity')}
  wrap.querySelectorAll('[data-f]').forEach(el=>{
    const key=el.dataset.f;el.id=`tool-form-${id}-${key}`
    const error=document.createElement('span');error.className='tool-field-error';error.dataset.fieldError=key;error.id=el.id+'-error';el.closest('label')?.append(error);el.setAttribute('aria-describedby',error.id)
    if(required.has(key)){el.required=true;const label=el.closest('label')?.querySelector('span');if(label)label.textContent+=' *'}
    if(el.type==='text'){el.maxLength=({actor:80,code:64,name:80,tag:100,provider:120,borrower:80,returner:80,borrowType:40,reason:500,opinion:500,certificate:500,resolution:500})[key]||160}
  })
  const get=key=>wrap.querySelector(`[data-f="${key}"]`)
  if(type==='ASSET_CREATE'){
    const mode=get('mode'),quantity=get('quantity')
    const syncMode=()=>{quantity.readOnly=mode.value==='NUMBERED';quantity.min='1';if(quantity.readOnly)quantity.value='1'}
    mode.addEventListener('change',syncMode);syncMode()
  }
  if(type==='DEVICE_EVENT'){
    const syncEvent=()=>{
      const kind=get('eventType').value
      wrap.querySelectorAll('[data-event-kinds]').forEach(group=>{const visible=group.dataset.eventKinds.split(' ').includes(kind);group.hidden=!visible;group.querySelectorAll('[data-f]').forEach(el=>{el.disabled=!visible;el.required=visible&&el.dataset.f!=='scheduleTaskId'&&!(kind==='INVENTORY'&&el.dataset.f==='tags');const label=el.closest('label')?.querySelector('span');if(label)label.textContent=label.textContent.replace(/ \*$/,'')+(el.required?' *':'')})})
    }
    get('eventType').addEventListener('change',syncEvent);syncEvent()
  }
  return wrap
}

export const toolsPage={
  render(ctx){
    ctx.state.toolManagement ||= emptyToolManagement()
    const route=ctx.role.id+'/'+ctx.page
    if(view.route!==route){view.route=route;toolDestination(view,routeTab[ctx.page]||'ledger');view.warehouse=''}
    return renderToolWorkspace(ctx,view)
  },
  mount(ctx){
    document.querySelectorAll('[data-tool-tab]').forEach(b=>b.addEventListener('click',()=>{const tab=b.dataset.toolTab,section=Object.keys(toolSections[tab]||{})[0];toolDestination(view,tab,section,tab==='circulation'||tab==='service'?'OPEN':'');focusTab(ctx,`[data-tool-tab="${tab}"]`)}))
    document.querySelectorAll('[data-tool-section]').forEach(b=>b.addEventListener('click',()=>{const section=b.dataset.toolSection;toolDestination(view,view.tab,section,['loans','inspection','repair','all-services'].includes(section)?'OPEN':['transfers','disposals'].includes(section)?'PENDING':'');focusTab(ctx,`[data-tool-section="${section}"]`)}))
    document.querySelectorAll('[data-tool-jump]').forEach(b=>b.addEventListener('click',()=>{
      const destinations={loans:['circulation','loans','OPEN'],services:['service','all-services','OPEN'],disposals:['service','disposals','PENDING'],warnings:['alerts','warnings','']}
      toolDestination(view,...destinations[b.dataset.toolJump]);focusTab(ctx,'[data-tool-results] h2');document.querySelector('[data-tool-results]')?.scrollIntoView?.({block:'nearest'})
    }))
    document.querySelector('[data-tool-search]')?.addEventListener('submit',e=>{e.preventDefault();view.query=e.currentTarget.querySelector('[data-f="query"]').value.trim();focusTab(ctx,'[data-tool-search] input')})
    document.querySelector('[data-tool-warehouse]')?.addEventListener('change',e=>{view.warehouse=e.target.value;focusTab(ctx,'[data-tool-warehouse]')})
    document.querySelector('[data-tool-status]')?.addEventListener('change',e=>{view.status=e.target.value;focusTab(ctx,'[data-tool-status]')})
    document.querySelectorAll('[data-tool-action]').forEach(b=>b.addEventListener('click',()=>handle(ctx,b.dataset.toolAction,Number(b.dataset.id))))
  }
}

const activeTasks=s=>s.schedules.filter(row=>!['CANCELLED','COMPLETED'].includes(row.status)&&s.vehicleRepairs.some(v=>v.id===row.vehicleRepairId&&v.currentVersionId===row.versionId)&&s.scheduleVersions.some(v=>v.id===row.versionId&&v.status==='PUBLISHED'))
function handle(ctx,action,id){
  const s=ctx.state,m=s.toolManagement,a=m.assets.find(a=>a.id===id),byAsset=()=>select('assetId','工具实物',m.assets,id,r=>`${r.code} · ${name(s.tools,r.toolId)} · 可领用${assetStock(m,r)}`),byWarehouse=(key='warehouseId',title='所属工具库')=>select(key,title,m.warehouses)
  if(action==='detail')return openToolDetails(ctx,a)
  if(action==='loan-detail'){const loan=m.loans.find(r=>r.id===id);const first=m.assets.find(a=>a.id===loan?.lines[0]?.assetId);if(first)return openToolDetails(ctx,first,'circulation')}
  if(action==='disposal-detail'){const row=m.disposals.find(r=>r.id===id);return openModal({title:`申请详情 #${id}`,wide:true,body:disposalContext(s,row),confirmText:'关闭',cancelText:'返回'})}
  if(action==='export'){
    const actionNames={WAREHOUSE_SAVE:'维护工具库',CATEGORY_SAVE:'维护分类',TOOL_SAVE:'维护工具品种',ASSET_CREATE:'新增实物',ADOPT_LEGACY:'接管库存',BORROW:'领用',RETURN:'归还',TRANSFER:'申请调拨',TRANSFER_FINISH:'处理调拨',SERVICE_SEND:'送检送修',SERVICE_FINISH:'登记检定维修结果',DISPOSAL_REQUEST:'遗失报废申请',DISPOSAL_REVIEW:'遗失报废审核',COUNT_CREATE:'创建盘点',COUNT_FINISH:'确认盘点',DEVICE_EVENT:'设施事件'}
    const readable=entry=>{let p;try{p=JSON.parse(entry.detail)}catch{return entry.detail}const items=[p.assetId&&`工具：${m.assets.find(a=>a.id===Number(p.assetId))?.code||p.assetId}`,p.quantity&&`数量：${p.quantity}`,p.borrower&&`领用人：${p.borrower}`,p.returner&&`归还人：${p.returner}`,p.reason&&`原因：${p.reason}`,p.opinion&&`意见：${p.opinion}`,p.decision&&`处理：${label(p.decision)}`,p.result&&`结论：${p.result==='PASS'?'合格':'不合格'}`,p.name&&`名称：${p.name}`,p.code&&`编码：${p.code}`];return items.filter(Boolean).join('；')||'业务记录已保存'}
    const data=[['类型','编号','时间','内容'],...m.assets.map(a=>['台账',a.code,'',`${name(s.tools,a.toolId)}；${name(m.warehouses,a.warehouseId)}；账面${a.quantity}；在库${assetStock(m,a)}；标签${a.tag}`]),...m.audit.map(a=>['业务记录',a.id,dt(a.at),`${a.actor} · ${actionNames[a.action]||a.action} · ${readable(a)}`])]
    const safe=v=>{const t=String(v??'');return '"'+(/^[=+\-@\t\r]/.test(t)?"'":'')+t.replaceAll('"','""')+'"'}
    const url=URL.createObjectURL(new Blob(['\uFEFF'+data.map(r=>r.map(safe).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='工具台账与业务记录.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return
  }
  if(['warehouse','warehouse-edit','category','category-edit'].includes(action)){const category=action.startsWith('category'),r=(category?m.categories:m.warehouses).find(r=>r.id===id);return form(ctx,category?'工具分类':'工具库',category?'CATEGORY_SAVE':'WAREHOUSE_SAVE',input('code','编码',r?.code||'')+input('name','名称',r?.name||''),p=>({...p,id:r?.id}))}
  if(['tool-new','tool-edit'].includes(action)){const t=s.tools.find(t=>t.id===id);return form(ctx,'工具品种与预警阈值','TOOL_SAVE',input('code','品种编码',t?.code||'')+input('name','名称',t?.name||'')+input('specification','规格型号',t?.specification||'')+input('manufacturer','厂家',t?.manufacturer||'')+select('categoryId','工具分类',m.categories,t?.categoryId)+select('lowStockWarehouseId','阈值适用库（不选为全库汇总）',m.warehouses)+num('lowStock','低储阈值（件）',t?.lowStock||0)+choice('status','使用状态',[['AVAILABLE','可用'],['MAINTENANCE','检修中'],['DISABLED','停用']],t?.status||'AVAILABLE'),p=>({...p,id:t?.id}))}
  if(action==='bind-task')return form(ctx,'工序工具需求绑定','REQUIREMENT_SAVE',select('taskId','工序',s.tasks,'',r=>`${r.process} · ${r.name}`)+num('quantity','该工序需要数量')+`<p>当前绑定：${s.toolRequirements.filter(r=>r.toolId===id).map(r=>`${esc(s.tasks.find(t=>t.id===r.taskId)?.name)} × ${r.quantity}`).join('、')||'无'}</p>`,p=>({...p,toolId:id}))
  if(['asset-new','adopt','adopt-new'].includes(action)&&!m.warehouses.length)return handle(ctx,'warehouse',0)
  if(action==='asset-new'&&!s.tools.length)return handle(ctx,'tool-new',0)
  if(['asset-new','adopt','adopt-new'].includes(action))return form(ctx,action!=='asset-new'?'接管原库存':'新增工具实物',action!=='asset-new'?'ADOPT_LEGACY':'ASSET_CREATE',select('toolId','工具品种',s.tools.filter(t=>action==='asset-new'?(m.assets.some(a=>a.toolId===t.id)||!Number(t.quantity)):!m.assets.some(a=>a.toolId===t.id)&&Number(t.quantity)>0),id)+byWarehouse()+input('code','唯一实物 / 批次编号')+(action!=='asset-new'?'<p class="pc-help">原库存数量直接转为数量工具台账，不增加库存。</p>':choice('mode','管理方式',[['NUMBERED','单件编号'],['BULK','按数量管理']],'NUMBERED')+num('quantity','数量'))+'<details class="tool-form-advanced"><summary>标签与检定配置（可选）</summary><div class="tool-form-advanced-body">'+input('tag','条形码 / 二维码 / RFID标签（可选）')+num('inspectionCycleMonths','检定周期（月，0为不定检）',0)+input('lastInspectionAt','最近合格检定日期','','date')+'</div></details>')
  if(action==='asset-config')return form(ctx,'标签与使用状态','ASSET_CONFIG',input('tag','条形码 / RFID标签',a.tag)+choice('status','状态',[['AVAILABLE','可用'],['DISABLED','停用']],a.status)+num('inspectionCycleMonths','检定周期（月）',a.inspectionCycleMonths),p=>({...p,assetId:id}))
  if(action==='kit'||action==='kit-edit'){
    const k=m.kits.find(k=>k.id===id)
    return form(ctx,'套装组成','KIT_SAVE',input('code','套装编号',k?.code||'')+input('name','套装名称',k?.name||'')+`<div class="tool-wide"><p>选择同一工具库中的成员。整套领用时会同时检查并占用所有成员。</p>${m.assets.map(a=>{const l=k?.lines.find(l=>l.assetId===a.id);return `<label class="tool-kit-line"><input type="checkbox" data-kit-asset="${a.id}" ${l?'checked':''}><span>${esc(a.code)} · ${esc(name(s.tools,a.toolId))}</span><input class="input" type="number" min="1" step="1" aria-label="${esc(a.code)}的套装数量" data-kit-quantity="${a.id}" value="${l?.quantity||1}"></label>`}).join('')}</div>`,(p,modal)=>({...p,id:k?.id,lines:[...modal.querySelectorAll('[data-kit-asset]:checked')].map(el=>({assetId:Number(el.dataset.kitAsset),quantity:Number(modal.querySelector(`[data-kit-quantity="${el.dataset.kitAsset}"]`).value)}))}))
  }
  if(['borrow','borrow-new','kit-borrow'].includes(action))return form(ctx,'工具领用','BORROW',(action==='kit-borrow'?`<p>整套领用：${esc(m.kits.find(k=>k.id===id)?.name)}</p>`:byAsset()+num('quantity','领用数量'))+input('borrower','领用人')+input('borrowType','借用类型','检修使用')+input('dueAt','预计归还时间','','datetime-local')+select('scheduleTaskId','关联作业任务（可选，用于防错）',activeTasks(s),'',r=>`${r.id} · ${s.tasks.find(t=>t.id===r.taskId)?.name||''}`),p=>({...p,...(action==='kit-borrow'?{kitId:id}:{})}))
  if(action==='return'){const l=m.loans.find(l=>l.id===id);return form(ctx,`归还借用单 ${id}`,'RETURN',select('assetId','归还工具',l.lines.filter(r=>r.quantity>r.returned+(r.disposed||0)).map(r=>({id:r.assetId,name:`${m.assets.find(a=>a.id===r.assetId)?.code} · 未还${r.quantity-r.returned-(r.disposed||0)}件` })))+num('quantity','本次归还数量')+input('returner','归还人'),p=>({...p,loanId:id}))}
  if(['transfer','transfer-new'].includes(action))return form(ctx,'工具调拨','TRANSFER',byAsset()+byWarehouse('toWarehouseId','调入工具库')+num('quantity','调拨数量'))
  if(action==='transfer-finish')return form(ctx,'调拨接收 / 取消','TRANSFER_FINISH',choice('decision','处理结果',[['RECEIVED','确认接收入库'],['CANCELLED','取消，释放占用']],'RECEIVED'),p=>({...p,id}))
  if(['service','service-new'].includes(action))return form(ctx,'送检 / 送修','SERVICE_SEND',byAsset()+choice('kind','业务类型',[['INSPECTION','送检校验'],['REPAIR','损坏送修']],view.section==='repair'?'REPAIR':'INSPECTION')+num('quantity','数量')+input('provider','检定 / 维修单位')+input('reason','原因说明'))
  if(action==='service-finish')return form(ctx,'登记校验结果','SERVICE_FINISH',choice('result','校验结果',[['PASS','合格，回库'],['FAIL','不合格，转报废审核']],'PASS')+input('certificate','检定证书编号 / 维修结论'),p=>({...p,id}))
  if(action==='disposal')return form(ctx,'遗失 / 报废申请','DISPOSAL_REQUEST',byAsset()+choice('kind','申请类型',[['LOST','遗失'],['SCRAPPED','报废']],'SCRAPPED')+num('quantity','数量')+input('loanId','关联借用单号（借出后遗失/损坏时填写）','','number')+input('reason','申请原因'))
  if(action==='disposal-review')return form(ctx,'遗失 / 报废审核','DISPOSAL_REVIEW',disposalContext(s,m.disposals.find(r=>r.id===id))+choice('decision','审核结果',[['APPROVED','批准'],['REJECTED','驳回']],'APPROVED')+input('opinion','审核意见')+'<p class="pc-help">经办人为本次审核人，须与申请人不同。批准后保留历史并扣减账面数量。</p>',p=>({...p,id}))
  if(action==='count-new')return form(ctx,'新建工具库盘点','COUNT_CREATE',byWarehouse())
  if(action==='count-finish'){
    const row=m.counts.find(r=>r.id===id)
    return form(ctx,'实物盘点确认','COUNT_FINISH',`<div class="tool-wide">${table(['工具','账面在库','实盘数量'],row.lines.map(l=>[esc(m.assets.find(a=>a.id===l.assetId)?.code),String(l.expected),`<input class="input" type="number" min="0" step="1" data-counted="${l.assetId}" aria-label="${esc(m.assets.find(a=>a.id===l.assetId)?.code)}实盘数量" placeholder="填写实盘" value="">`]))}</div>`+input('reason','差异说明 / 盘点结论')+'<p class="pc-help">确认会按差异调整账面数量并保留记录。盘点期间发生库存变化时必须重新盘点。</p>',(p,modal)=>{const fields=[...modal.querySelectorAll('[data-counted]')];if(fields.some(el=>el.value===''))throw Error('请填写每项实盘数量');return {...p,id,lines:fields.map(el=>({assetId:Number(el.dataset.counted),counted:Number(el.value)}))}})
  }
  if(action==='count-cancel')return form(ctx,'取消盘点','COUNT_CANCEL','<p>取消这张尚未完成的盘点单，保留历史，不调整库存。</p>',p=>({...p,id}))
  if(action==='count-detail'){const r=m.counts.find(r=>r.id===id);return openModal({title:`盘点单 ${id}`,wide:true,confirmText:'关闭',body:`<p>${esc(r.reason||'已取消')}</p>${table(['工具','账面在库','实盘','差异'],r.lines.map(l=>[esc(m.assets.find(a=>a.id===l.assetId)?.code),String(l.expected),String(l.counted??'—'),String(l.counted==null?'—':l.counted-l.expected)]))}`})}
  if(action==='device-new'||action==='device-edit'){const d=m.devices.find(d=>d.id===id);return form(ctx,'智能工具设施','DEVICE_SAVE',input('code','设备唯一编码',d?.code||'')+input('name','设施名称',d?.name||'')+select('warehouseId','所属工具库',m.warehouses,d?.warehouseId)+choice('kind','类型',[['CABINET','智能工具柜'],['ROOM','无人工具室']],d?.kind||'CABINET')+choice('enabled','使用状态',[['true','启用'],['false','停用']],String(d?.enabled??true)),p=>({...p,id:d?.id,enabled:p.enabled==='true'}))}
  const eventGroup=(kinds,body)=>`<div class="tool-event-fields" data-event-kinds="${kinds}">${body}</div>`
  if(action==='device-event')return form(ctx,'模拟设施事件','DEVICE_EVENT',choice('eventType','事件类型',[['HEARTBEAT','心跳'],['ENTRY','门禁通行记录'],['CHECKOUT','标签领用'],['RETURN','标签归还'],['INVENTORY','标签盘点']],'HEARTBEAT')+eventGroup('CHECKOUT RETURN',input('tag','工具标签'))+eventGroup('ENTRY CHECKOUT RETURN',select('employeeId','人员',s.employees.filter(e=>e.status==='ACTIVE')))+eventGroup('CHECKOUT RETURN',num('quantity','数量'))+eventGroup('CHECKOUT',input('dueAt','预计归还时间','','datetime-local'))+eventGroup('RETURN',input('loanId','借用单号','','number'))+eventGroup('INVENTORY',input('tags','识别标签（英文逗号分隔，可为空）'))+eventGroup('CHECKOUT',input('scheduleTaskId','作业任务号（可选）','','number'))+'<p class="pc-help">这是软件联调模拟，会办理真实库存记录，但不会将设施标记为已连接。</p>',p=>({...p,deviceId:id,eventId:crypto.randomUUID(),tags:(p.tags||'').split(',').map(t=>t.trim()).filter(Boolean)}))
  if(action==='resolve')return form(ctx,'异常处置记录','EVENT_RESOLVE',input('resolution','处置说明'),p=>({...p,id}))
  if(action==='check-use')return form(ctx,'作业工具防错核验','CHECK_USE',select('scheduleTaskId','作业任务',activeTasks(s),'',r=>`${r.id} · ${s.tasks.find(t=>t.id===r.taskId)?.name}`)+num('quantity','核验数量'),p=>({...p,assetId:id}))
}

export function openToolTaskCheck(ctx,scheduleTaskId){
  return form(ctx,'作业工具核验','CHECK_USE',input('tag','扫描或输入条形码 / 二维码 / RFID标签')+num('quantity','核验数量')+'<p class="pc-help">逐项核验已纳入实物台账的工序工具。未绑定、检定失效、工具不匹配会记录异常并阻止开始作业。核验24小时内有效。</p>',p=>({...p,scheduleTaskId}))
}
