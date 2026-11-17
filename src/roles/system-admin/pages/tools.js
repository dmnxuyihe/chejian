import {toolDateTime,toolDateTimeInput,toolDateInput,toolTimeValue,toolDayValue} from '../../../shared/tool-dates.js'
import { escapeHtml as esc, openModal, openModalChild, toast } from '../../../core/ui.js'
import { applyToolCommand, emptyToolManagement, assetStock, toolLabels as labels,expectedToolObjects,assertToolObjects,compactToolBatch } from '../../../core/tool-management.js'

import {renderToolWorkspace,toolDestination,openToolDetails,disposalContext} from '../../../shared/tool-workspace.js'
import {returnableQuantity,assetBalance} from '../../../shared/tool-ledger.js'
import {mountToolTable,downloadCsv,openBasicTable,tableAction} from '../../../shared/tool-table-controller.js'
import {toolRecordData,recordKinds,openToolRecords,openToolAuditDetails} from '../../../shared/tool-records.js'
import {renderToolPage} from '../../../shared/tool-pages.js'
import {mountToolWarnings} from '../../../shared/tool-overview.js'
import {toolCommandReceipt} from '../../../shared/tool-receipt.js'
import {restoreToolView,clearCountOutbox} from '../../../shared/tool-table-state.js'
import {currentUser,authenticatedUser} from '../../../core/auth.js'

const view={tab:'ledger',section:'loans',query:'',warehouse:'',status:'',ledgerStatus:'',assetId:null,selectedKey:null,ledgerType:'ALL',borrowType:'',recordsOpen:false,settingsOpen:false,recordQuery:'',quickFilter:'',listScroll:0,route:null,busy:false,selectedKeys:[],columnFilters:{},countId:null,countDraft:{},queryStatus:'',serviceQuery:''}
const initialView=structuredClone(view),pageViews=new Map()
const contextFields=[...Object.keys(initialView).filter(key=>!['route','busy'].includes(key)),'ledgerScope','assetIds','exactAssetId','selectionIdentities','queryDraft','tableScroll','sortKey','sortDirection','toolId','excludeKits','availableOnly','serviceOnly','countDraftId','countOutbox','countSaving','countSaveState','countSaveError','countLocalDurable','countSavedAt','inventorySelected','recordsView','warningKind','warningQuery','warningStage','warningSelected','dataKind']
function switchToolContext(route,ctx,params){
 if(view.route)pageViews.set(view.route,Object.fromEntries(contextFields.map(key=>[key,view[key]])))
 const cached=pageViews.get(route)
 for(const key of contextFields)delete view[key]
 Object.assign(view,structuredClone(initialView),cached||{}, {route})
 if(!cached){toolDestination(view,routeTab[ctx.page]||'ledger');view.recordsOpen=!!routeTab[ctx.page]}
 if(view.pageMode==='ledger'&&!params.size&&!cached&&!view.preferencesLoaded)restoreToolView(view)
 return !!cached
}
const routeTab={'g1-p2':'service','g2-p1':'circulation','g3-p1':'service','g4-p1':'alerts','g5-p1':'devices','g5-p2':'devices'}
const label=v=>labels[v]||v||'—'
const name=(rows,id)=>rows.find(r=>r.id===id)?.name||'—'
const dt=toolDateTime
const options=(rows,value,labelFn=r=>r.name)=>rows.map(r=>`<option value="${r.id}" ${String(value)===String(r.id)?'selected':''}>${esc(labelFn(r))}</option>`).join('')
const table=(heads,rows)=>`<div class="table-wrap"><table><thead><tr>${heads.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(cells=>`<tr>${cells.map(cell=>`<td>${cell}</td>`).join('')}</tr>`).join('')||`<tr><td class="empty" colspan="${heads.length}">暂无记录</td></tr>`}</tbody></table></div>`
const select=(key,title,rows,selected='',fn)=>`<label class="field tool-field"><span>${title}</span><select class="select" data-f="${key}"><option value="">请选择</option>${options(rows,selected,fn)}</select></label>`
const input=(key,title,value='',type='text',extra='')=>`<label class="field tool-field"><span>${title}</span><input class="input" data-f="${key}" type="${type}" value="${esc(value)}" ${extra}></label>`
const num=(key,title,value=1)=>input(key,title,value,'number',`min="${['lowStock','inspectionCycleMonths'].includes(key)?0:1}" step="1"`)
const choice=(key,title,values,value)=>`<label class="field tool-field"><span>${title}</span><select class="select" data-f="${key}">${values.map(([v,t])=>`<option value="${v}" ${value===v?'selected':''}>${t}</option>`).join('')}</select></label>`
const jsonFields=modal=>Object.fromEntries([...modal.querySelectorAll('[data-f]')].filter(el=>!el.disabled).map(el=>[el.dataset.f,el.type==='datetime-local'?toolTimeValue(el.value):el.value]))

let commandTail=Promise.resolve()
function command(ctx,type,payload,actor,requestId){
  const job=commandTail.then(()=>executeCommand(ctx,type,payload,actor,requestId))
  commandTail=job.catch(()=>{});return job
}
async function executeCommand(ctx,type,payload,actor,requestId){
  view.busy=true
  try{
    let result
    assertToolObjects(ctx.state.toolManagement,payload)
    if(ctx.demoPersistence?.status?.storage==='postgresql'){
      const user=await authenticatedUser();if(!user)throw Error('尚未登录，本次未办理');actor=user.name
      const saved=await ctx.demoPersistence.save();if(!saved.ok)throw Error(saved.message)
      const response=await fetch('/api/tools/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,payload,actor,requestId,revision:ctx.demoPersistence.revision})})
      result=await response.json()
      if(!response.ok){
        const quantities=(type==='BATCH'?payload.commands:[{type,payload}]).filter(c=>['BORROW','TRANSFER','SERVICE_SEND'].includes(c.type)&&c.payload.assetId)
        if(response.status===409&&type!=='COUNT_PROGRESS'){
          // No command was submitted. Refresh only the committed state, retain
          // the open form, and require another explicit confirmation.
          const loaded=await ctx.demoPersistence.load()
          if(loaded.ok){
            ctx.rerender(false);assertToolObjects(ctx.state.toolManagement,payload)
            const completed=(type==='BATCH'?payload.commands:[{type,payload}]).flatMap(c=>{
              const config={SERVICE_FINISH:['services','OPEN','inspection'],TRANSFER_FINISH:['transfers','PENDING','transfers'],DISPOSAL_REVIEW:['disposals','PENDING','disposals']}[c.type]
              if(!config)return []
              const [collection,pending,kind]=config,row=ctx.state.toolManagement[collection].find(r=>r.id===Number(c.payload.id))
              return row&&row.status!==pending?[{id:row.id,kind:row.kind==='REPAIR'?'repair':kind,message:`#${row.id} 已${row.status==='CANCELLED'?'取消':row.status==='REJECTED'?'驳回':'办结'} · ${row.finishedBy||row.receivedBy||row.reviewer||row.actor} · ${dt(row.finishedAt||row.reviewedAt||row.at)}${row.certificate?' · '+row.certificate:''}`}]:[]
            })
            if(completed.length)throw Object.assign(Error('单据已由其他操作处理，本次未提交。'+completed.map(r=>r.message).join('；')),{toolBusinessChanged:true,toolRecords:completed})
            for(const c of quantities){const a=ctx.state.toolManagement.assets.find(a=>a.id===Number(c.payload.assetId));if(!a)continue;const b=assetBalance(ctx.state,a),maximum=c.type==='SERVICE_SEND'?b.physicalAvailable:b.available;if(Number(c.payload.quantity)>maximum)throw Object.assign(Error(`${a.code}：库存已被其他操作更新，当前最多可办理 ${maximum} 件；本次未提交，请核对后重新确认`),{toolAssetId:a.id,availableQuantity:maximum})}
            throw Error('其他数据已更新，已读取最新状态；本次未提交，填写内容已保留，请核对后再次确认')
          }
        }
        throw Object.assign(Error(result.message),{toolAssetId:result.toolAssetId,availableQuantity:result.availableQuantity,toolTargetChanged:result.toolTargetChanged,invalidToolObjects:result.invalidToolObjects})
      }
      const loaded=await ctx.demoPersistence.load();if(!loaded.ok)throw Error('操作已提交，但刷新失败。请重试连接，勿重复办理。')
    }else{result=applyToolCommand(ctx.state,{type,payload,actor,requestId});await ctx.demoPersistence?.save()}
    if(type!=='COUNT_PROGRESS'&&view.pageMode!=='ledger')toast(result.eventStatus==='ERROR'?'已记录异常':'办理成功',result.duplicate?'该操作已办理，未重复扣减库存':result.eventStatus==='ERROR'?'请在盘点与预警中查看并处理':'数据已保存',result.eventStatus==='ERROR'?'warning':'success')
    if(type!=='COUNT_PROGRESS'){
      view.lastReceipt=toolCommandReceipt(ctx.state,type,payload,result,actor)
    }
    if(['COUNT_FINISH','COUNT_CANCEL'].includes(type)){const c=ctx.state.toolManagement.counts.find(c=>c.id===payload.id);if(c)clearCountOutbox(c);view.countOutbox=null;view.countSaveState='saved'}
    if(type!=='COUNT_PROGRESS'){afterCommand(type,payload,result);ctx.rerender(false)}return true
  }finally{view.busy=false}
}
const requiredFields={WAREHOUSE_SAVE:['code','name'],CATEGORY_SAVE:['code','name'],TOOL_SAVE:['code','name'],REQUIREMENT_SAVE:['taskId','quantity'],ASSET_CREATE:['toolId','warehouseId','quantity','receivedAt'],ADOPT_LEGACY:['toolId','warehouseId','receivedAt'],ASSET_EDIT:['assetId','code'],KIT_SAVE:['code','name'],BORROW:['assetId','quantity','borrower','dueAt'],RETURN:['assetId','quantity','returner'],KIT_RETURN:['returner'],TRANSFER:['assetId','quantity','toWarehouseId'],SERVICE_SEND:['assetId','quantity','provider','reason'],SERVICE_FINISH:['result','certificate'],DISPOSAL_REQUEST:['assetId','quantity','kind','reason'],DISPOSAL_REVIEW:['decision','opinion'],COUNT_CREATE:['warehouseId'],COUNT_FINISH:['reason'],DEVICE_SAVE:['code','name','warehouseId','kind'],EVENT_RESOLVE:['resolution'],CHECK_USE:['quantity']}
function focusTab(ctx,selector){ctx.rerender(false);const target=document.querySelector(selector);target?.focus({preventScroll:true});target?.scrollIntoView?.({block:'nearest',inline:'nearest'})}
function afterCommand(type,p,result){
  if(p.assetId){view.assetId=Number(p.assetId);view.selectedKey=`asset:${view.assetId}`}
  if(['ASSET_CREATE','ADOPT_LEGACY'].includes(type)){view.assetId=result.id;view.selectedKey=`asset:${result.id}`;view.ledgerType=p.mode||'ALL';view.quickFilter='';view.borrowType='';view.query=''}
  if(type==='KIT_SAVE'||type==='BORROW'&&p.kitId){view.selectedKey=`kit:${p.kitId||result.id}`;view.assetId=null;view.ledgerType='KIT';view.query='';view.quickFilter='';view.borrowType=''}
  const dest=(tab,section='loans',status='')=>Object.assign(view,{tab,section,status})
  if(['ASSET_CREATE','ADOPT_LEGACY'].includes(type))dest('ledger')
  if(type==='BORROW')dest('circulation','loans','OPEN')
  if(type==='TRANSFER')dest('circulation','transfers','PENDING')
  if(type==='TRANSFER_FINISH')dest('circulation','transfers')
  if(type==='SERVICE_SEND')dest('service',p.kind==='REPAIR'?'repair':'inspection','OPEN')
  if(type==='SERVICE_FINISH')dest('service',result.disposalId?'disposals':view.section,result.disposalId?'PENDING':'')
  if(type==='DISPOSAL_REQUEST')dest('service','disposals','PENDING')
  if(type==='DISPOSAL_REVIEW')dest('service','disposals')
  if(type==='COUNT_CREATE'){view.countId=result.id;view.countDraftId=null}
  if(type==='COUNT_CANCEL'){view.countId=null}
  if(type==='COUNT_PROGRESS'){view.countSavePending=false}
  if(type.startsWith('COUNT_'))dest('alerts','counts')
  if(type.startsWith('COUNT_'))view.recordsOpen=true
  if(type==='DEVICE_EVENT')dest('devices','events')
  if(['DEVICE_SAVE','DEVICE_EVENT'].includes(type))view.recordsOpen=true
}
let formId=0
function form(ctx,title,type,body,transform=x=>x,requiredKeys=[]){
  const requestId=crypto.randomUUID(),id=++formId
  const originalObjects=ctx.state.toolManagement
  const guarded=(kind,p)=>kind==='BATCH'?{...p,commands:p.commands.map(c=>({...c,payload:guarded(c.type,c.payload)}))}:{...p,expectedObjects:expectedToolObjects(originalObjects,kind,p)}
  let submitted=false,initialFields='',attemptedPayload
  const fieldState=modal=>JSON.stringify([...modal.querySelectorAll('input,select,textarea')].map(el=>[el.value,el.checked]))
  const confirmLabel=/遗失/.test(title)?'提交遗失申请':/报废/.test(title)?'提交报废申请':/借出/.test(title)?'确认借出':/归还/.test(title)?'确认归还':/送检/.test(title)?'确认送检':/送修/.test(title)?'确认送修':/清点完成/.test(title)?'确认清点完成':/审核/.test(title)?'确认审核':/删除/.test(title)?'确认删除':/调拨/.test(title)?'确认调拨':/结果/.test(title)?'保存检修结果':'保存记录'
  const wrap=openModal({title,wide:true,body:`<div class="tool-form">${body}${input('actor','经办人',currentUser()?.name||'未登录','text','readonly aria-readonly="true" required')}<p class="pc-help">经办人取自当前登录账号，不可修改。确认后保存业务记录并更新库存。</p><p role="alert" class="tool-form-error" data-tool-form-error></p></div>`,confirmText:confirmLabel,beforeClose(modal){
    const dirty=initialFields&&fieldState(modal)!==initialFields
    if(submitted||!dirty)return true
    return window.confirm('表单中有未保存内容，确定放弃并关闭吗？')
  },async onConfirm(modal){
    modal.querySelector('[data-tool-form-error]').textContent=''
    modal.querySelectorAll('[data-f]').forEach(el=>{el.removeAttribute('aria-invalid');modal.querySelector(`[data-field-error="${el.dataset.f}"]`).textContent=''})
    const showError=(message,field)=>{
      const element=field?.nodeType===1?field:field?modal.querySelector(`[data-f="${field}"]`):null
      modal.querySelector('[data-tool-form-error]').textContent=message
      if(element){element.setAttribute('aria-invalid','true');const inline=element.closest('td')?.querySelector('[data-tool-quantity-error]')||modal.querySelector(`[data-field-error="${element.dataset.f}"]`);if(inline)inline.textContent=message;const group=element.closest('details');if(group)group.open=true;element.focus();element.scrollIntoView({block:'nearest'})}
      return false
    }
    for(const el of modal.querySelectorAll('[data-f]')){
      if(el.disabled)continue
      if(el.required&&!String(el.value).trim())return showError(`请填写${el.closest('label')?.querySelector('span')?.textContent.replace(' *','')||'必填项目'}`,el.dataset.f)
      if(!el.checkValidity())return showError(el.validationMessage,el.dataset.f)
    }
    for(const el of modal.querySelectorAll('.tool-form input:not([data-f]), .tool-form select:not([data-f])')){
      el.removeAttribute('aria-invalid')
      if(el.disabled||el.checkValidity())continue
      return showError(`${el.getAttribute('aria-label')||'办理明细'}：${el.validationMessage}`,el)
    }
    const values=jsonFields(modal),actor=values.actor;delete values.actor
    if(Number(values.inspectionCycleMonths)>0&&!values.lastInspectionAt&&['ASSET_CREATE','ADOPT_LEGACY'].includes(type)){
      const hint=modal.querySelector('[data-tool-form-error]');hint.textContent='尚未登记最近合格检定日期，保存后会显示为“未登记检定”，在完成送检前不能领用。';
    }
    modal.querySelectorAll('[data-tool-quantity-error]').forEach(el=>el.textContent='')
    try{
      attemptedPayload=guarded(type,transform(values,modal));if(type==='BATCH')attemptedPayload=compactToolBatch(attemptedPayload)
      if(JSON.stringify(attemptedPayload).length>64000)return showError('本次所选项和填写说明合计过大，请减少所选项或缩短说明；尚未提交')
      const result=await command(ctx,type,attemptedPayload,actor,requestId);if(result!==false)submitted=true;return result
    }catch(error){
      if(error.toolBusinessChanged){
        modal.confirmBlocked=true;modal.querySelector('[data-modal-confirm]').textContent='该单已处理'
        const hint=modal.querySelector('[data-tool-form-error]');hint.textContent=error.message
        if(!modal.querySelector('[data-tool-latest-record]'))for(const kind of new Set(error.toolRecords.map(r=>r.kind))){const b=document.createElement('button');b.type='button';b.className='btn';b.dataset.toolLatestRecord=kind;b.textContent=`查看最新${recordKinds[kind]||'办理记录'}`;b.addEventListener('click',()=>openModalChild(modal,()=>openToolRecords(ctx,{form,input,num,select,choice,table,handle,downloadCsv},kind,{ids:error.toolRecords.filter(r=>r.kind===kind).map(r=>r.id)})));hint.after(b)}
        return false
      }
      if(error.toolTargetChanged){
        modal.confirmBlocked=true;modal.querySelector('[data-modal-confirm]').textContent='请重新选择工具';modal.querySelector('[data-tool-form-error]').textContent=error.message
        modal.querySelector('[data-tool-target-error]')?.remove()
        const banner=document.createElement('div');banner.className='tool-wide tool-target-error';banner.dataset.toolTargetError='';banner.setAttribute('role','alert');banner.tabIndex=-1;banner.textContent=error.message
        if(type==='BATCH'){
          const invalid=attemptedPayload.commands.filter(c=>{try{assertToolObjects(ctx.state.toolManagement,c.payload);return false}catch{return true}})
          const keys=invalid.map(c=>c.payload.kitId?`kit:${c.payload.kitId}`:`asset:${c.payload.assetId}`)
          const rows=keys.map(key=>modal.querySelector(`[data-tool-batch-state="${key}"]`)?.closest('tr'))
          if(keys.length&&rows.every(Boolean)&&keys.length<attemptedPayload.commands.length){
            const b=document.createElement('button');b.type='button';b.className='btn';b.dataset.toolRemoveInvalid='';b.textContent=`移除 ${keys.length} 项失效工具，保留填写内容`
            b.addEventListener('click',()=>{modal.toolRemovedKeys||=new Set();keys.forEach((key,i)=>{modal.toolRemovedKeys.add(key);rows[i].remove()});view.selectedKeys=view.selectedKeys.filter(k=>!keys.includes(k));modal.confirmBlocked=false;modal.querySelector('[data-modal-confirm]').disabled=false;modal.querySelector('[data-modal-confirm]').textContent=confirmLabel;banner.textContent='已移除失效工具，其余数量与填写内容已保留。请核对后再次确认；尚未提交。';modal.querySelector('[data-tool-form-error]').textContent='';ctx.rerender(false)})
            banner.append(document.createElement('br'),b)
          }
        }
        modal.querySelector('.tool-form').prepend(banner);banner.focus();banner.scrollIntoView({block:'nearest'});return false
      }
      const quantity=Number.isSafeInteger(error.toolAssetId)?modal.querySelector(`[data-batch-quantity="asset:${error.toolAssetId}"]`):null
      if(quantity){quantity.max=String(error.availableQuantity);quantity.closest('td').querySelector('[data-tool-quantity-limit]').textContent=`当前最多可办理 ${error.availableQuantity} 件（已更新）`;const a=ctx.state.toolManagement.assets.find(a=>a.id===error.toolAssetId),state=modal.querySelector(`[data-tool-batch-state="asset:${error.toolAssetId}"]`);if(a&&state)state.textContent=assetBalance(ctx.state,a).states.join(' · ');return showError(error.message,quantity)}
      const field=error.toolField||[['经办人','actor'],['工具库','warehouseId'],['品种','toolId'],['编码','code'],['编号','code'],['数量','quantity'],['归还时间','dueAt'],['标签','tag'],['审核意见','opinion'],['申请人与审核人','actor']].find(([word,key])=>error.message.includes(word)&&modal.querySelector(`[data-f="${key}"]`))?.[1]
      return showError(error.message,field)
    }
  }})
  const required=new Set([...(requiredFields[type]||[]),...requiredKeys,'actor'])
  if(type==='BORROW'&&!wrap.querySelector('[data-f="assetId"]')){required.delete('assetId');required.delete('quantity')}
  wrap.querySelectorAll('[data-f]').forEach(el=>{
    const key=el.dataset.f;el.id=`tool-form-${id}-${key}`
    const error=document.createElement('span');error.className='tool-field-error';error.dataset.fieldError=key;error.id=el.id+'-error';el.closest('label')?.append(error);el.setAttribute('aria-describedby',error.id)
    if(required.has(key)){el.required=true;const label=el.closest('label')?.querySelector('span');if(label)label.textContent+=' *'}
    else if(el.type!=='hidden'){const label=el.closest('label')?.querySelector('span');if(label&&!label.textContent.includes('可选'))label.textContent+='（可选）'}
    if(el.type==='text'){el.maxLength=({actor:80,code:64,name:80,tag:100,provider:120,borrower:80,returner:80,borrowType:40,reason:500,opinion:500,certificate:500,resolution:500})[key]||160}
  })
  initialFields=fieldState(wrap)
  const get=key=>wrap.querySelector(`[data-f="${key}"]`)
  if(type==='TOOL_SAVE'){
    const tool=ctx.state.tools.find(t=>t.id===Number(get('code')?.dataset.toolId)),values=new Map([['',tool?.lowStock??0],...ctx.state.toolManagement.warehouses.map(w=>[String(w.id),tool?.warehouseLowStock?.[w.id]??''])])
    let scope=''
    const sync=()=>{values.set(scope,get('lowStock').value);scope=get('lowStockWarehouseId').value;get('lowStock').value=values.get(scope);get('lowStock').placeholder=scope?'未配置，填写后保存':''}
    get('lowStockWarehouseId').addEventListener('change',sync)
  }
  if(type==='KIT_SAVE'){
    const warehouse=get('kitWarehouseId'),sync=()=>{
      wrap.querySelectorAll('[data-kit-asset]').forEach(box=>{const row=box.closest('.tool-kit-line'),same=row.dataset.warehouse===warehouse.value,quantity=row.querySelector('[data-kit-quantity]');box.disabled=!same;quantity.disabled=!same||!box.checked;row.hidden=!same})
    }
    warehouse.addEventListener('change',()=>{wrap.querySelectorAll('[data-kit-asset]').forEach(box=>{if(box.closest('.tool-kit-line').dataset.warehouse!==warehouse.value)box.checked=false});sync()})
    wrap.querySelectorAll('[data-kit-asset]').forEach(box=>box.addEventListener('change',sync));sync()
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
    const params=ctx.functionParams||new URLSearchParams(),route=(ctx.functionEntry?.id||ctx.role.id+'/'+ctx.page)+'?'+params.toString()
    const changed=view.route!==route
    const pageMode=ctx.functionEntry?.toolView||'ledger'
    // Contexts belong to a tool subpage, not to whichever page rendered last.
    if(changed){view.pageMode=pageMode;const cached=switchToolContext(route,ctx,params);view.pageMode=pageMode
     if(!cached){
      if(params.size)view.query=params.get('query')||''
      view.assetIds=params.has('assets')?params.get('assets').split(',').map(Number).filter(n=>Number.isSafeInteger(n)&&n>0):undefined;view.exactAssetId=params.get('asset')||'';view.toolId=params.get('tool')||'';view.excludeKits=params.has('noKits');view.availableOnly=params.has('available');view.serviceOnly=params.has('service')
      if(params.size)view.ledgerScope=params.get('status')==='待完善登记'||view.toolId&&!ctx.state.toolManagement.assets.some(a=>a.toolId===Number(view.toolId))?'legacy':'registered'
      if(params.has('warehouse'))view.warehouse=params.get('warehouse')
      if(params.has('status'))view.queryStatus=params.get('status')
      if(params.has('query'))view.query=params.get('query')
      if(params.has('kind')){view.warningKind=['stock','overdue'].includes(params.get('kind'))?params.get('kind'):'inspection';view.warningQuery='';view.warningSelected=[];view.warningStage=''}
     }
     view.pendingLog=params.get('log')==='audit'?{id:params.get('id')}:null
    }
    return renderToolPage(ctx,view)
  },
  mount(ctx){
    ctx._toolCommand=(type,payload,actor,requestId)=>command(ctx,type,payload,actor,requestId||crypto.randomUUID())
    const deps={form,input,num,select,choice,table,handle,downloadCsv}
    if(view.pageMode==='dashboard')return
    if(view.pageMode==='warnings'){mountToolWarnings(ctx,view,deps,tableAction);return}
    if(view.pageMode==='records'){view.recordsView||={};openToolRecords(ctx,deps,'loans',{container:document.querySelector('[data-tool-records-page]'),view:view.recordsView});if(view.pendingLog){const pending=view.pendingLog;view.pendingLog=null;openToolRecords(ctx,deps,'audit',{ids:pending.id?[Number(pending.id)]:[]})}return}
    if(view.pageMode==='data'){openBasicTable(ctx,view,deps,view.dataKind||'tools',document.querySelector('[data-tool-data-page]'));return}
    mountToolTable(ctx,view,deps)
  }

}

const activeTasks=s=>s.schedules.filter(row=>!['CANCELLED','COMPLETED'].includes(row.status)&&s.vehicleRepairs.some(v=>v.id===row.vehicleRepairId&&v.currentVersionId===row.versionId)&&s.scheduleVersions.some(v=>v.id===row.versionId&&v.status==='PUBLISHED'))
function handle(ctx,action,id,preferredAssetId){
  const s=ctx.state,m=s.toolManagement,a=m.assets.find(a=>a.id===id),byAsset=()=>a?`<label class="field tool-field tool-wide"><span>工具实物</span><input type="hidden" data-f="assetId" value="${a.id}"><strong class="tool-form-asset">${esc(a.code)} · ${esc(name(s.tools,a.toolId))}<small>${esc(name(m.warehouses,a.warehouseId))}</small></strong></label>`:select('assetId','工具实物',m.assets,id,r=>`${r.code} · ${name(s.tools,r.toolId)}`),byWarehouse=(key='warehouseId',title='所属工具库')=>select(key,title,m.warehouses,key==='warehouseId'?view.warehouse:'')
  if(action==='kit-return'){
    const rows=m.loans.filter(l=>l.kitId===id&&l.status==='OPEN'&&l.lines.some(line=>returnableQuantity(m,l,line)>0))
    if(rows.length===1)return handle(ctx,'kit-return-loan',rows[0].id)
    if(!rows.length)return toast('当前没有可归还的套装借用','','warning')
    const modal=openModal({title:'选择套装借用单',body:`<div class="tool-pick-record">${rows.map(l=>`<button class="btn" data-tool-pick="${l.id}">#${l.id} · ${esc(l.borrower)} · 应还 ${dt(l.dueAt)}</button>`).join('')}</div>`,confirmText:'关闭'})
    modal.querySelectorAll('[data-tool-pick]').forEach(b=>b.addEventListener('click',()=>{modal.querySelector('[data-modal-close]').click();handle(ctx,'kit-return-loan',Number(b.dataset.toolPick))}));return
  }
  if(action==='kit-return-loan'){
    const loan=m.loans.find(l=>l.id===id),kit=m.kits.find(k=>k.id===loan.kitId)
    return form(ctx,'归还套装','KIT_RETURN',`<p class="tool-wide">${esc(kit.name)} · 借用人 ${esc(loan.borrower)} · 应还 ${dt(loan.dueAt)}</p><div class="tool-wide">${table(['成员工具','可归还','本次归还'],loan.lines.map(line=>{const n=returnableQuantity(m,loan,line),asset=m.assets.find(a=>a.id===line.assetId);return [esc(asset.code)+' · '+esc(name(s.tools,asset.toolId)),String(n),`<input class="input" type="number" min="0" max="${n}" step="1" value="${n}" data-kit-return="${line.assetId}" aria-label="${esc(asset.code)}本次归还数量" ${n?'':'readonly'}>`]}))}</div>`+input('returner','归还人'),(p,modal)=>({...p,loanId:id,lines:[...modal.querySelectorAll('[data-kit-return]')].map(el=>({assetId:Number(el.dataset.kitReturn),quantity:el.value===''?NaN:Number(el.value)})).filter(line=>line.quantity!==0)}))
  }
  if(action==='return-selected')return handle(ctx,'return',id,view.assetId)
  if(['asset-return','asset-service-finish','asset-transfer-finish','asset-disposal-review'].includes(action)){
    const rows=action==='asset-return'?m.loans.filter(l=>l.status==='OPEN'&&l.lines.some(r=>r.assetId===id&&r.quantity-r.returned-(r.disposed||0)>0)):action==='asset-service-finish'?m.services.filter(r=>r.assetId===id&&r.status==='OPEN'):action==='asset-transfer-finish'?m.transfers.filter(r=>r.assetId===id&&r.status==='PENDING'):m.disposals.filter(r=>r.assetId===id&&r.status==='PENDING')
    const next={'asset-return':'return','asset-service-finish':'service-finish','asset-transfer-finish':'transfer-finish','asset-disposal-review':'disposal-review'}[action]
    if(!rows.length){toast('暂无可办理记录','该工具没有对应的待办理单据','warning');return}
    if(rows.length===1)return handle(ctx,next,rows[0].id,id)
    const modal=openModal({title:'选择待办理单据',body:`<div class="tool-pick-record">${rows.map(r=>`<button type="button" class="btn" data-tool-pick="${r.id}">#${r.id} · ${esc(r.borrower||r.provider||r.actor)} · ${dt(r.at)}${r.dueAt?` · 应还 ${dt(r.dueAt)}`:''}</button>`).join('')}</div>`,confirmText:'关闭'})
    modal.querySelectorAll('[data-tool-pick]').forEach(b=>b.addEventListener('click',()=>{modal.querySelector('[data-modal-close]').click();handle(ctx,next,Number(b.dataset.toolPick),id)}));return
  }
  if(action==='audit-detail')return openToolAuditDetails(s,id)
  if(action==='detail-view')return openToolDetails(ctx,a)
  if(action==='detail')return openToolDetails(ctx,a,'summary',next=>handle(ctx,next,next==='bind-task'?a.toolId:a.id))
  if(action==='loan-detail'){const loan=m.loans.find(r=>r.id===id);const first=m.assets.find(a=>a.id===loan?.lines[0]?.assetId);if(first)return openToolDetails(ctx,first,'circulation',undefined,{loanId:id})}
  if(action==='disposal-detail'){const row=m.disposals.find(r=>r.id===id);return openModal({title:`申请详情 #${id}`,wide:true,body:disposalContext(s,row),confirmText:'关闭',cancelText:'返回'})}
  if(action==='export'){
    const data=[['类型','编号','时间','内容'],...m.assets.map(a=>['台账',a.code,'',`${name(s.tools,a.toolId)}；${name(m.warehouses,a.warehouseId)}；账面${a.quantity}；在库${assetStock(m,a)}；标签${a.tag}`])]
    for(const [kind,title] of Object.entries(recordKinds)){
      const records=toolRecordData(s,kind)
      for(const row of records.rows)data.push([title,row.id,kind==='audit'?row.cells[1]:'',row.cells.map((cell,i)=>`${records.heads[i]}：${cell}`).join('；')])
    }
    return downloadCsv('工具台账与业务记录.csv',data)
  }
  if(['warehouse','warehouse-edit','category','category-edit'].includes(action)){const category=action.startsWith('category'),r=(category?m.categories:m.warehouses).find(r=>r.id===id);return form(ctx,category?'工具分类':'工具库',category?'CATEGORY_SAVE':'WAREHOUSE_SAVE',input('code','编码',r?.code||'')+input('name','名称',r?.name||''),p=>({...p,id:r?.id}))}
  if(['tool-new','tool-edit'].includes(action)){const t=s.tools.find(t=>t.id===id);return form(ctx,'工具品种与预警阈值','TOOL_SAVE',input('code','品种编码',t?.code||'','text',`data-tool-id="${t?.id||''}"`)+input('name','名称',t?.name||'')+input('specification','规格型号（可选）',t?.specification||'')+input('manufacturer','厂家（可选）',t?.manufacturer||'')+select('categoryId','工具分类（可选）',m.categories,t?.categoryId)+select('lowStockWarehouseId','阈值适用库（可选，空为全库）',m.warehouses)+num('lowStock','低储阈值（件）',t?.lowStock||0)+choice('status','使用状态',[['AVAILABLE','可用'],['MAINTENANCE','检修中'],['DISABLED','停用']],t?.status||'AVAILABLE'),p=>{if(p.lowStock==='')delete p.lowStock;return {...p,id:t?.id}})}
  if(action==='bind-task'){
    const requirements=s.toolRequirements.filter(r=>r.toolId===id)
    const modal=form(ctx,'工序工具需求绑定','REQUIREMENT_SAVE',select('taskId','工序',s.tasks,'',r=>`${r.process} · ${r.name}`)+num('quantity','该工序需要数量')+`<div class="tool-wide" data-tool-bindings>${requirements.map(r=>`<p data-tool-binding="${r.id}">${esc(s.tasks.find(t=>t.id===r.taskId)?.name)} × ${r.quantity} <button type="button" class="btn" data-tool-unbind="${r.id}">解除绑定</button></p>`).join('')||'当前无绑定'}</div>`,p=>({...p,toolId:id}))
    modal.querySelector('[data-f=taskId]').addEventListener('change',e=>{modal.querySelector('[data-f=quantity]').value=ctx.state.toolRequirements.find(r=>r.toolId===id&&r.taskId===Number(e.target.value))?.quantity||1})
    modal.querySelectorAll('[data-tool-unbind]').forEach(button=>button.addEventListener('click',()=>{const binding=requirements.find(r=>r.id===Number(button.dataset.toolUnbind));openModalChild(modal,()=>form(ctx,'解除工序工具绑定','REQUIREMENT_DELETE',`<p class="tool-wide">解除 ${esc(s.tasks.find(t=>t.id===binding.taskId)?.name)} 所需的 ${esc(s.tools.find(t=>t.id===id)?.name)} × ${binding.quantity}？只移除这一条绑定，保留工具台账及其他工序。</p>`,()=>({id:binding.id})),()=>{if(!ctx.state.toolRequirements.some(r=>r.id===binding.id)){const group=button.closest('[data-tool-bindings]');button.closest('[data-tool-binding]').remove();if(!group.children.length)group.textContent='当前无绑定'}})}))
    return modal
  }
  if(['asset-new','adopt','adopt-new'].includes(action)&&!m.warehouses.length)return handle(ctx,'warehouse',0)
  if(action==='asset-new'&&!s.tools.length)return handle(ctx,'tool-new',0)
  if(['asset-new','adopt','adopt-new'].includes(action)){
    const legacy=action!=='asset-new',t=s.tools.find(t=>t.id===id)
    return form(ctx,legacy?'完善库存登记':'新增工具',''+(legacy?'ADOPT_LEGACY':'ASSET_CREATE'),select('toolId','工具品种',s.tools.filter(t=>legacy?!m.assets.some(a=>a.toolId===t.id)&&Number(t.quantity)>0:m.assets.some(a=>a.toolId===t.id)||!Number(t.quantity)),id)+byWarehouse()+input('code','工具编号（有独立编号时填写，可选）')+(legacy?`<p class="tool-wide pc-help">原库存${t?' '+t.quantity+' 件':''}，登记不增加库存；填写独立编号时逐件登记，不填写时按数量登记。</p>`:num('quantity','入库数量'))+input('receivedAt','入库时间',new Date().toLocaleString('sv-SE').slice(0,16).replace(' ','T'),'datetime-local')+input('tag','条形码 / RFID（可选）')+num('inspectionCycleMonths','检定周期（月，0为不定检，可选）',0)+input('lastInspectionAt','最近检定时间（可选）','','date')+input('lastRepairAt','最后检修时间（可选）','','date'),p=>{
      const numbered=Boolean(p.code.trim());return {...p,mode:numbered?'NUMBERED':'BULK',code:p.code.trim()||`BULK-${Date.now()}`}
    })
  }
  if(action==='asset-edit')return form(ctx,'修改工具基础信息','ASSET_EDIT',`<div class="tool-wide tool-edit-identity"><strong>${esc(s.tools.find(t=>t.id===a.toolId)?.name||'工具')}</strong><span>${esc(m.warehouses.find(w=>w.id===a.warehouseId)?.name||'—')} · 账面 ${a.quantity} 件</span></div>`+input('code','工具编号 / 批次登记号',a.code)+input('tag','条形码 / RFID（可选）',a.tag)+input('receivedAt','入库时间（可选）',toolDateTimeInput(a.receivedAt),'datetime-local')+input('lastRepairAt','最后检修时间（可选）',toolDateInput(a.lastRepairAt),'date')+input('lastInspectionAt','最近检定时间（可选）',toolDateInput(a.lastInspectionAt),'date')+num('inspectionCycleMonths','检定周期（月，0为不定检，可选）',a.inspectionCycleMonths),p=>({...p,assetId:id,receivedAt:toolTimeValue(toolDateTimeInput(p.receivedAt),a.receivedAt),lastRepairAt:toolDayValue(p.lastRepairAt,a.lastRepairAt),lastInspectionAt:toolDayValue(p.lastInspectionAt,a.lastInspectionAt)}))
  if(action==='asset-config')return form(ctx,'标签与使用状态','ASSET_CONFIG',input('tag','条形码 / RFID标签',a.tag)+choice('status','状态',[['AVAILABLE','可用'],['DISABLED','停用']],a.status)+num('inspectionCycleMonths','检定周期（月）',a.inspectionCycleMonths),p=>({...p,assetId:id}))
  if(action==='kit'||action==='kit-edit'){
    const k=m.kits.find(k=>k.id===id)
    const warehouse=k?m.assets.find(a=>a.id===k.lines[0]?.assetId)?.warehouseId:m.warehouses[0]?.id
    return form(ctx,'套装组成','KIT_SAVE',input('code','套装编号',k?.code||'')+input('name','套装名称',k?.name||'')+select('kitWarehouseId','成员工具库',m.warehouses,warehouse)+`<div class="tool-wide"><p>仅显示所选库的成员；切换工具库会清除异库勾选。整套领用时检查并占用所有成员。</p>${m.assets.map(a=>{const l=k?.lines.find(l=>l.assetId===a.id);return `<label class="tool-kit-line" data-warehouse="${a.warehouseId}"><input type="checkbox" data-kit-asset="${a.id}" ${l?'checked':''}><span>${esc(a.code)} · ${esc(name(s.tools,a.toolId))} · ${esc(name(m.warehouses,a.warehouseId))}</span><input class="input" type="number" min="1" step="1" aria-label="${esc(a.code)}的套装数量" data-kit-quantity="${a.id}" value="${l?.quantity||1}"></label>`}).join('')}</div>`,(p,modal)=>({...p,id:k?.id,lines:[...modal.querySelectorAll('[data-kit-asset]:checked:not(:disabled)')].map(el=>({assetId:Number(el.dataset.kitAsset),quantity:Number(modal.querySelector(`[data-kit-quantity="${el.dataset.kitAsset}"]`).value)}))}))
  }
  if(['borrow','borrow-new','kit-borrow'].includes(action))return form(ctx,action==='kit-borrow'?'套装借出':'工具借出','BORROW',(action==='kit-borrow'?`<p>整套借出：${esc(m.kits.find(k=>k.id===id)?.name)}</p>`:byAsset()+num('quantity','借出数量'))+input('borrower','领用人')+input('borrowType','借用类型','检修使用')+input('dueAt','预计归还时间','','datetime-local')+select('scheduleTaskId','关联作业任务（可选，用于防错）',activeTasks(s),'',r=>`${r.id} · ${s.tasks.find(t=>t.id===r.taskId)?.name||''}`),p=>({...p,...(action==='kit-borrow'?{kitId:id}:{})}))
  if(action==='return'){const l=m.loans.find(l=>l.id===id);return form(ctx,`归还借用单 ${id}`,'RETURN',select('assetId','归还工具',l.lines.filter(r=>r.quantity>r.returned+(r.disposed||0)).map(r=>({id:r.assetId,name:`${m.assets.find(a=>a.id===r.assetId)?.code} · 未还${r.quantity-r.returned-(r.disposed||0)}件` })),preferredAssetId||'')+num('quantity','本次归还数量')+input('returner','归还人'),p=>({...p,loanId:id}))}
  if(['transfer','transfer-new'].includes(action))return form(ctx,'工具调拨','TRANSFER',byAsset()+byWarehouse('toWarehouseId','调入工具库')+num('quantity','调拨数量'))
  if(action==='transfer-finish')return form(ctx,'调拨接收 / 取消','TRANSFER_FINISH',choice('decision','处理结果',[['RECEIVED','确认接收入库'],['CANCELLED','取消，释放占用']],'RECEIVED'),p=>({...p,id}))
  if(['service','service-new','inspection','repair'].includes(action))return form(ctx,action==='repair'?'工具送修':action==='inspection'?'工具送检':'送检 / 送修','SERVICE_SEND',byAsset()+choice('kind','业务类型',action==='inspection'?[['INSPECTION','送检校验']]:action==='repair'?[['REPAIR','损坏送修']]:[['INSPECTION','送检校验'],['REPAIR','损坏送修']],action==='repair'||action==='service-new'&&view.section==='repair'?'REPAIR':'INSPECTION')+num('quantity','数量')+input('provider','检定 / 维修单位')+input('reason','原因说明'))
  if(action==='service-finish'){const row=m.services.find(r=>r.id===id),asset=m.assets.find(r=>r.id===row.assetId);return form(ctx,row.kind==='INSPECTION'?'登记检定结果':'登记维修结果','SERVICE_FINISH',`<p class="tool-wide">${esc(asset.code)} · ${esc(name(s.tools,asset.toolId))} · ${row.quantity} 件 · ${esc(row.provider)}</p>`+choice('result','校验结果',[['','请选择校验结果'],['PASS','合格，回库'],['FAIL','不合格，转报废审核']],'')+input('certificate','检定证书编号 / 维修结论'),p=>({...p,id}))}
  if(['disposal','lost','scrap'].includes(action)){
    const loans=m.loans.filter(l=>l.status==='OPEN'&&l.lines.some(r=>(!a||r.assetId===a.id)&&r.quantity-r.returned-(r.disposed||0)>0))
    const loanChoices=[['','在库工具'],...loans.map(l=>[String(l.id),`借用单 #${l.id} · ${l.borrower}`])]
    return form(ctx,action==='lost'?'遗失申请':action==='scrap'?'报废申请':'遗失 / 报废申请','DISPOSAL_REQUEST',byAsset()+choice('kind','申请类型',action==='lost'?[['LOST','遗失']]:action==='scrap'?[['SCRAPPED','报废']]:[['LOST','遗失'],['SCRAPPED','报废']],action==='lost'?'LOST':'SCRAPPED')+num('quantity','数量')+choice('loanId','申请来源',loanChoices,a&&assetStock(m,a)<=0&&loans.length?String(loans[0].id):'')+input('reason','申请原因'))
  }
  if(action==='disposal-review')return form(ctx,'遗失 / 报废审核','DISPOSAL_REVIEW',disposalContext(s,m.disposals.find(r=>r.id===id))+choice('decision','审核结果',[['APPROVED','批准'],['REJECTED','驳回']],'APPROVED')+input('opinion','审核意见')+'<p class="pc-help">经办人为本次审核人，须与申请人不同。批准后保留历史并扣减账面数量。</p>',p=>({...p,id}))
  if(action==='count-new')return form(ctx,'新建工具库盘点','COUNT_CREATE',byWarehouse())
  if(action==='count-finish'){
    const row=m.counts.find(r=>r.id===id)
    return form(ctx,'实物盘点确认','COUNT_FINISH',`<div class="tool-wide">${table(['工具','账面在库','实盘数量'],row.lines.map(l=>[esc(m.assets.find(a=>a.id===l.assetId)?.code),String(l.expected),`<input class="input" type="number" min="0" step="1" data-counted="${l.assetId}" aria-label="${esc(m.assets.find(a=>a.id===l.assetId)?.code)}实盘数量" placeholder="填写实盘" value="">`]))}</div>`+input('reason','差异说明 / 盘点结论')+'<p class="pc-help">确认只保存实盘差异，遗失报废仍须申请审核后记账。盘点期间库存变化须重新核对。</p>',(p,modal)=>{const fields=[...modal.querySelectorAll('[data-counted]')];if(fields.some(el=>el.value===''))throw Error('请填写每项实盘数量');return {...p,id,lines:fields.map(el=>({assetId:Number(el.dataset.counted),counted:Number(el.value)}))}})
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
