import {escapeHtml as esc,openModal,toast,openModalChild} from '../core/ui.js'
import {toolTableData,tableColumns,filterToolTable} from './tool-table.js'
import {returnableQuantity} from './tool-ledger.js'
import {countLossRemaining} from '../core/tool-management.js'
import {openToolRecords} from './tool-records.js'
import {persistToolView,countDrafts,writeCountOutbox,clearCountOutbox} from './tool-table-state.js'

const name=(rows,id)=>rows.find(r=>r.id===id)?.name||'—'
const btn=(key,label)=>`<button class="btn" type="button" data-base-action="${key}">${label}</button>`
let countSaveTimer=null
const draftFor=(v,line)=>v.countDraft?.[line.assetId]||{verified:line.counted!==null&&line.counted!==undefined,present:Number(line.counted)>0,counted:line.counted??0}
function countStatus(v){
 const el=document.querySelector('[data-count-save-status]');if(!el)return
 el.textContent=v.countSaveState==='error'?`保存未完成：${v.countSaveError}。${v.countLocalDurable?'修改已留在本机，请重试或读取数据库进度复核。':'本机暂存不可用，请保持此页并重试保存。'}`:v.countSaveState==='saving'?'正在保存进度…':v.countSaveState==='pending'?'修改已暂存本机，等待同步…':v.countSavedAt?`已保存 ${new Date(v.countSavedAt).toLocaleTimeString('zh-CN')}`:'尚未修改'
 el.classList.toggle('is-error',v.countSaveState==='error')
 document.querySelector('[data-tool-table-action="count-retry"]')?.toggleAttribute('hidden',v.countSaveState!=='error')
}
function scheduleCountProgress(ctx,v,id,value){
 const count=ctx.state.toolManagement?.counts.find(row=>row.id===v.countId)
 if(!count||count.status!=='OPEN')return
 v.countOutbox||={progressRevision:count.progressRevision||0,changes:{},requestId:crypto.randomUUID()}
 v.countOutbox.changes[id]=value
 // Each newly edited payload needs a new idempotency key. An in-flight snapshot
 // keeps its own key and is acknowledged independently below.
 v.countOutbox.requestId=crypto.randomUUID();v.countSaveState='pending'
 try{writeCountOutbox(count,v.countOutbox);v.countLocalDurable=true}catch{v.countLocalDurable=false;v.countSaveState='error';v.countSaveError='本机暂存不可用，请等待数据库保存后再离开'}
 countStatus(v)
 clearTimeout(countSaveTimer)
 countSaveTimer=setTimeout(()=>saveCountProgress(ctx,v),250)
}
export async function saveCountProgress(ctx,v){
 clearTimeout(countSaveTimer)
 if(v.countSaving){await v.countSaving;return v.countOutbox?saveCountProgress(ctx,v):v.countSaveState!=='error'}
 const count=ctx.state.toolManagement?.counts.find(row=>row.id===v.countId),outbox=v.countOutbox
 if(!count||!outbox)return true
 const sent=structuredClone(outbox);v.countSaveState='saving';countStatus(v)
 v.countSaving=(async()=>{
  try{
   const ok=await ctx._toolCommand('COUNT_PROGRESS',{id:count.id,progressRevision:sent.progressRevision,lines:Object.entries(sent.changes).map(([id,counted])=>({assetId:Number(id),counted}))},count.actor||'盘点人',sent.requestId)
   if(ok===false)throw Error('数据库正在办理其他操作，请重试')
   const current=ctx.state.toolManagement.counts.find(r=>r.id===count.id)
   for(const [id,value] of Object.entries(sent.changes))if(v.countOutbox?.changes[id]===value)delete v.countOutbox.changes[id]
   v.countSavedAt=current.updatedAt
   if(Object.keys(v.countOutbox?.changes||{}).length){v.countOutbox.progressRevision=current.progressRevision;v.countOutbox.requestId=crypto.randomUUID();writeCountOutbox(count,v.countOutbox);v.countSaveState='pending'}
   else{v.countOutbox=null;clearCountOutbox(count);v.countSaveState='saved'}
   return true
  }catch(error){v.countSaveState='error';v.countSaveError=error.message;return false}
  finally{v.countSaving=null;countStatus(v)}
 })()
 const ok=await v.countSaving
 if(ok&&v.countOutbox)countSaveTimer=setTimeout(()=>saveCountProgress(ctx,v),0)
 return ok
}
export function mountToolTable(ctx,v,deps){
 const scroller=document.querySelector('.tool-table-scroll'),scrollKey=v.countId?`count:${v.countId}`:'ledger'
 v.tableScroll||={}
 if(scroller){const position=v.tableScroll[scrollKey];if(position){scroller.scrollTop=position.top;scroller.scrollLeft=position.left}scroller.addEventListener('scroll',()=>{if(!scroller.isConnected)return;v.tableScroll[scrollKey]={top:scroller.scrollTop,left:scroller.scrollLeft};persistToolView(v)},{passive:true})}
 const render=(focus,resetScroll=false)=>{if(scroller)v.tableScroll[scrollKey]=resetScroll?{top:0,left:0}:{top:scroller.scrollTop,left:scroller.scrollLeft};persistToolView(v);ctx.rerender(false);if(focus)document.querySelector(focus)?.focus({preventScroll:true})}
 document.querySelector('[data-tool-query]')?.addEventListener('submit',e=>{
  e.preventDefault();Object.assign(v,Object.fromEntries(new FormData(e.currentTarget)))
  if(v.scanMode){const code=v.query.trim();const rows=filterToolTable(toolTableData(ctx.state),{...v,query:''}),matches=rows.filter(r=>r.code===code||r.asset?.tag===code)
   if(matches.length!==1)v.scanMessage=matches.length?'标签对应多项，请按编号核对':'当前查询范围未找到此编号或标签，请核对条码与筛选条件'
   else if(v.selectedKeys.includes(matches[0].key))v.scanMessage=`${matches[0].code} 已在所选清单，未重复添加`
   else{v.selectedKeys.push(matches[0].key);v.scanMessage=`已加入 ${matches[0].code} · ${matches[0].values.state}`}
   v.query=''
  }
  render('[data-tool-query] input',true)
 })
 document.querySelector('[data-tool-scan-mode]')?.addEventListener('change',e=>{v.scanMode=e.target.checked;v.scanMessage='扫码用于连续选择工具；数量在办理表单中确认。';render('[data-tool-query] input')})
 const reset=()=>{Object.assign(v,{query:'',warehouse:'',queryStatus:'',serviceQuery:'',borrowType:'',columnFilters:{},sortKey:'',sortDirection:'asc'});render(undefined,true)}
 document.querySelector('[data-tool-reset-query]')?.addEventListener('click',reset)
 document.querySelector('[data-tool-clear-filters]')?.addEventListener('click',()=>{v.columnFilters={};render()})
 const toggle=(key,checked)=>{v.selectedKeys=checked?[...new Set([...v.selectedKeys,key])]:v.selectedKeys.filter(k=>k!==key);render(`[data-tool-check="${key}"]`)}
 document.querySelectorAll('[data-tool-check]').forEach(el=>el.addEventListener('change',()=>toggle(el.dataset.toolCheck,el.checked)))
 document.querySelectorAll('[data-tool-toggle]').forEach(el=>el.addEventListener('click',()=>toggle(el.dataset.toolToggle,!v.selectedKeys.includes(el.dataset.toolToggle))))
 document.querySelectorAll('[data-tool-detail]').forEach(el=>el.addEventListener('click',()=>openEntryDetail(ctx,v,deps,el.dataset.toolDetail)))
 document.querySelectorAll('[data-tool-remove-selection]').forEach(el=>el.addEventListener('click',()=>toggle(el.dataset.toolRemoveSelection,false)))
 document.querySelector('[data-tool-clear-selection]')?.addEventListener('click',()=>{v.selectedKeys=[];render()})
 document.querySelectorAll('[data-tool-stat]').forEach(el=>el.addEventListener('click',()=>{const key=el.dataset.toolStat;if(key==='warning')return tableAction(ctx,v,'warnings',deps);Object.assign(v,{queryStatus:key==='borrowed'?'借出':key==='service'?'送检 / 送修':key==='pending'?'待审核':'待完善登记',query:'',warehouse:'',serviceQuery:'',borrowType:'',columnFilters:{},selectedKeys:[]});render(undefined,true)}))
 document.querySelectorAll('[data-tool-sort]').forEach(el=>el.addEventListener('click',()=>{v.sortDirection=v.sortKey===el.dataset.toolSort&&v.sortDirection==='asc'?'desc':'asc';v.sortKey=el.dataset.toolSort;render(`[data-tool-sort="${v.sortKey}"]`,true)}))
 const allBox=document.querySelector('[data-tool-select-all]'),boxes=[...document.querySelectorAll('[data-tool-check]')]
 if(allBox){allBox.indeterminate=boxes.some(e=>e.checked)&&!boxes.every(e=>e.checked);allBox.addEventListener('change',()=>{const keys=boxes.map(el=>el.dataset.toolCheck);v.selectedKeys=allBox.checked?[...new Set([...v.selectedKeys,...keys])]:v.selectedKeys.filter(k=>!keys.includes(k));render('[data-tool-select-all]')})}
 document.querySelectorAll('[data-tool-filter-open]').forEach(el=>el.addEventListener('click',()=>openFilter(ctx,v,el.dataset.toolFilterOpen)))
 document.querySelectorAll('[data-tool-table-action]').forEach(el=>el.addEventListener('click',async()=>{try{await tableAction(ctx,v,el.dataset.toolTableAction,deps)}catch(error){toast('未办理',error.message,'warning')}}))
 document.querySelectorAll('[data-tool-receipt-group]').forEach(el=>el.addEventListener('click',()=>{const group=v.lastReceipt?.groups?.[Number(el.dataset.toolReceiptGroup)];if(group)openToolRecords(ctx,deps,group.kind,{ids:group.ids})}))
 document.querySelectorAll('[data-count-present]').forEach(el=>el.addEventListener('change',()=>{const id=Number(el.dataset.countPresent),row=ctx.state.toolManagement.counts.find(c=>c.id===v.countId)?.lines.find(l=>l.assetId===id);if(!row)return;v.countDraft[id]={verified:el.checked,present:el.checked,counted:el.checked?Math.max(1,row.expected):null};scheduleCountProgress(ctx,v,id,v.countDraft[id].counted);render(`[data-count-present="${id}"]`)}))
 document.querySelectorAll('[data-count-verified]').forEach(el=>el.addEventListener('change',()=>{const id=Number(el.dataset.countVerified),row=ctx.state.toolManagement.counts.find(c=>c.id===v.countId)?.lines.find(l=>l.assetId===id);if(!row)return;const value=el.value;v.countDraft[id]={verified:value!=='UNVERIFIED',present:value==='FOUND',counted:value==='UNVERIFIED'?null:value==='FOUND'?Math.max(1,row.expected):0};scheduleCountProgress(ctx,v,id,v.countDraft[id].counted);render(`[data-count-verified="${id}"]`)}))
 document.querySelectorAll('[data-count-actual]').forEach(el=>el.addEventListener('input',()=>{const draft=v.countDraft[el.dataset.countActual]||{};draft.counted=el.value===''?null:Number(el.value);draft.verified=draft.counted!==null;draft.present=draft.counted>0;v.countDraft[el.dataset.countActual]=draft;scheduleCountProgress(ctx,v,el.dataset.countActual,draft.counted)}))
 if(v.countId){const c=ctx.state.toolManagement.counts.find(c=>c.id===v.countId);if(c){countDrafts(v,c);countStatus(v);if(v.countOutbox&&v.countSaveState==='pending'&&!v.countSaving){clearTimeout(countSaveTimer);countSaveTimer=setTimeout(()=>saveCountProgress(ctx,v),250)}}}
 const panel=document.querySelector('[data-tool-bottom].has-selection')
 v.panelObserver?.disconnect()
 if(panel&&scroller){const size=()=>{scroller.style.scrollPaddingBottom='20px';const workspace=document.querySelector('[data-tool-workspace]');if(workspace)workspace.style.paddingBottom=`${panel.offsetHeight+20}px`};size();v.panelObserver=new ResizeObserver(size);v.panelObserver.observe(panel)}
}
function openEntryDetail(ctx,v,d,key){const previous=v.selectedKeys;v.selectedKeys=[key];try{tableAction(ctx,v,'details',d)}finally{v.selectedKeys=previous}}
function openFilter(ctx,v,key){
 const label=tableColumns.find(c=>c[0]===key)[1],values=[...new Set(toolTableData(ctx.state).map(e=>e.values[key]))].sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true})),selected=v.columnFilters?.[key]
 const wrap=openModal({title:`筛选${label}`,body:`<label class="tool-field"><span>搜索筛选值</span><input class="input" data-filter-value-search type="search"></label><label class="tool-filter-all"><input type="checkbox" data-filter-all ${!selected?'checked':''}>全选显示的值</label><div class="tool-filter-options">${values.map((value,i)=>`<label data-filter-label><input type="checkbox" data-filter-option="${i}" ${!selected||selected.includes(value)?'checked':''}><span>${esc(value)}</span></label>`).join('')}</div><p class="pc-help">可同时勾选多个值；保留其他列的筛选条件。</p>`,confirmText:'应用筛选',onConfirm(){const picked=[...wrap.querySelectorAll('[data-filter-option]:checked')].map(el=>values[Number(el.dataset.filterOption)]);v.columnFilters||={};if(picked.length===values.length)delete v.columnFilters[key];else v.columnFilters[key]=picked;ctx.rerender(false)}})
 const sync=()=>{const fields=[...wrap.querySelectorAll('[data-filter-label]:not([hidden]) input')],all=wrap.querySelector('[data-filter-all]');all.checked=fields.length>0&&fields.every(el=>el.checked);all.indeterminate=fields.some(el=>el.checked)&&!all.checked}
 wrap.querySelector('[data-filter-value-search]').addEventListener('input',e=>{wrap.querySelectorAll('[data-filter-label]').forEach(label=>label.hidden=!label.textContent.toLowerCase().includes(e.target.value.toLowerCase()));sync()})
 wrap.querySelector('[data-filter-all]').addEventListener('change',e=>wrap.querySelectorAll('[data-filter-label]:not([hidden]) input').forEach(el=>el.checked=e.target.checked))
 wrap.querySelectorAll('[data-filter-option]').forEach(el=>el.addEventListener('change',sync));sync()
}
export async function tableAction(ctx,v,action,d){
 const {input,num,select,choice,table,handle}=d,s=ctx.state,m=s.toolManagement,all=toolTableData(s),selected=all.filter(e=>v.selectedKeys.includes(e.key))
 const required={adopt:['warehouseId','receivedAt'],borrow:['borrower','dueAt'],return:['returner'],inspection:['provider','reason'],repair:['provider','reason'],lost:['reason'],scrap:['reason'],'service-finish':['result','certificate'],'transfer-finish':['decision'],'disposal-review':['decision','opinion']}[action]||[]
 const form=(ctx,title,type,body,transform)=>d.form(ctx,title,type,body,transform,required)
 const one=()=>{if(selected.length!==1)throw Error('请只选择一项');return selected[0]}
 if(action==='receipt')return openToolRecords(ctx,d,v.lastReceipt?.kind||'audit',{ids:v.lastReceipt?.ids})
 if(['records','warnings','events'].includes(action))return openToolRecords(ctx,d,{records:'loans',warnings:'warnings',events:'events'}[action])
 if(action==='export-history')return handle(ctx,'export',0)
 if(['asset-config','check-use','bind-task'].includes(action)){
  const e=one()
  if(action==='bind-task'){const id=e.asset?.toolId||e.tool?.id;if(!id)throw Error('工序绑定请选择具体工具或工具品种');return handle(ctx,action,id)}
  if(!e.asset)throw Error('请选择具体实物工具')
  return handle(ctx,action,e.id)
 }
 if(action==='asset-new'||action==='kit-new'){handle(ctx,action==='kit-new'?'kit':'asset-new',0);return}
 if(action==='reset-selection'){v.selectedKeys=[];ctx.rerender(false);return}
 const basicTables={dictionary:'tools',categories:'categories',devices:'devices'}
 if(action==='tool-data')return openBasicTable(ctx,v,d,'tools')
 if(basicTables[action])return openBasicTable(ctx,v,d,basicTables[action])
 if(action==='export')return downloadCsv('工具台账.csv',[tableColumns.map(([,label])=>label),...(selected.length?selected:filterToolTable(all,v)).map(e=>tableColumns.map(([key])=>e.values[key]))])
 if(action==='adopt'){
  if(selected.length===1)return handle(ctx,'adopt',one().id)
  if(!selected.length||selected.some(e=>e.type!=='LEGACY'))throw Error('请选择待完善登记的库存')
  return form(ctx,'批量完善库存登记','BATCH',`<div class="tool-wide">${table(['工具名称','原库存数量','独立编号（可选）'],selected.map(e=>[esc(e.title),e.tool.quantity,`<input class="input" data-register-code="${e.id}" aria-label="${esc(e.title)}独立编号" placeholder="不填按数量登记">`]))}</div>`+select('warehouseId','工具库',m.warehouses,v.warehouse)+input('receivedAt','入库时间',new Date().toLocaleString('sv-SE').slice(0,16).replace(' ','T'),'datetime-local'),(p,modal)=>({commands:selected.map(e=>{const code=modal.querySelector(`[data-register-code="${e.id}"]`).value.trim();return {type:'ADOPT_LEGACY',payload:{toolId:e.id,warehouseId:p.warehouseId,mode:code?'NUMBERED':'BULK',code:code||`BULK-${Date.now()}-${e.id}`,receivedAt:p.receivedAt}}})}))
 }
 if(action==='edit'){
  if(selected.length===1){const e=one();return handle(ctx,e.type==='KIT'?'kit-edit':e.type==='LEGACY'?'tool-edit':'asset-edit',e.id)}
  if(!selected.length||selected.some(e=>!e.asset))throw Error('批量修改请选择实物工具；套装组成及待登记品种请分别修改')
  return form(ctx,'批量修改工具信息','BATCH',`<div class="tool-wide">${table(['工具名称','编号','条形码 / RFID（可选）','入库时间（可选）','最后检修时间（可选）'],selected.map(e=>[esc(e.title),`<input class="input" required data-edit-code="${e.id}" aria-label="${esc(e.code)}编号" value="${esc(e.code)}">`,`<input class="input" data-edit-tag="${e.id}" aria-label="${esc(e.code)}条形码" value="${esc(e.asset.tag)}">`,`<input class="input" type="datetime-local" data-edit-received="${e.id}" value="${esc(e.asset.receivedAt?.slice(0,16)||'')}">`,`<input class="input" type="date" data-edit-repair="${e.id}" value="${esc(e.asset.lastRepairAt?.slice(0,10)||'')}">`]))}</div>`,(p,modal)=>({commands:selected.map(e=>({type:'ASSET_EDIT',payload:{assetId:e.id,code:modal.querySelector(`[data-edit-code="${e.id}"]`).value,tag:modal.querySelector(`[data-edit-tag="${e.id}"]`).value,receivedAt:modal.querySelector(`[data-edit-received="${e.id}"]`).value,lastRepairAt:modal.querySelector(`[data-edit-repair="${e.id}"]`).value}}))}))
 }
 if(action==='details'){const e=one();if(e.asset)return handle(ctx,'detail',e.id);if(e.kit)return openModal({title:e.title,wide:true,body:table(['成员工具','编号','组成数量','状态'],e.members.map(({entry,line})=>[esc(entry.title),esc(entry.code),line.quantity,esc(entry.balance.states.join(' · '))])),confirmText:'关闭'});return openModal({title:`${e.title} · 原库存`,body:`<p>品种编号：${esc(e.code)}</p><p>当前状态：待完善登记；原库存 ${e.tool.quantity} 件。登记后可查看实物档案并办理借还。</p>`,confirmText:'关闭'})}
 if(action==='count-new')return form(ctx,'开始仓库盘点','COUNT_CREATE',select('warehouseId','盘点工具库',m.warehouses,v.warehouse))
 if(action==='count-history')return openCountHistory(ctx,v,d)
 if(action==='count-retry'){const loaded=await ctx.demoPersistence?.load();if(loaded?.ok===false)throw Error(loaded.message);return saveCountProgress(ctx,v)}
 if(action==='count-reload'){
  if(v.countOutbox&&!window.confirm('读取数据库进度将放弃本机尚未同步的勾选，是否继续？'))return
  const c=m.counts.find(c=>c.id===v.countId)
  const loaded=await ctx.demoPersistence?.load();if(loaded?.ok===false)throw Error(loaded.message)
  if(c)clearCountOutbox(c)
  v.countDraftId=null;v.countOutbox=null;ctx.rerender(false);return
 }
 if(action==='count-exit'){if(v.countOutbox&&!await saveCountProgress(ctx,v))throw Error('进度尚未同步，修改已留在本机。请重试保存后返回');v.countId=null;v.countDraft={};v.countDraftId=null;ctx.rerender(false);return}
 const count=m.counts.find(c=>c.id===v.countId)
 if(action==='count-confirm'){
  if(!count||count.status!=='OPEN')throw Error('盘点已完成或不存在')
  if(v.countOutbox&&!await saveCountProgress(ctx,v))throw Error('请先完成进度保存，再确认清点')
  const lines=count.lines.map(l=>{const draft=draftFor(v,l);return {assetId:l.assetId,counted:draft.verified?draft.counted:null}})
  if(lines.some(l=>l.counted===null))throw Error(`还有 ${lines.filter(l=>l.counted===null).length} 项未核对，请标记“已找到”或“已核对未找到”`)
  if(lines.some(l=>!Number.isSafeInteger(l.counted)||l.counted<0))throw Error('请填写有效实盘数量')
  const progressRevision=ctx.state.toolManagement.counts.find(c=>c.id===count.id).progressRevision||0
  return form(ctx,'确认清点完成','COUNT_FINISH',`<p class="tool-wide">${esc(name(m.warehouses,count.warehouseId))}：应有 ${count.lines.reduce((n,l)=>n+l.expected,0)} 件，已核对 ${lines.length} 项，实盘 ${lines.reduce((n,l)=>n+l.counted,0)} 件。盘点只记录现场事实；遗失或报废需另走申请审核。</p>`+input('reason','盘点结论 / 差异说明'),p=>({...p,id:count.id,lines,progressRevision}))
 }
 if(action==='count-loss'){
  const rows=count?.status==='CLOSED'?count.lines.map(line=>({...line,remaining:countLossRemaining(m,count,line)})).filter(l=>l.remaining>0):[]
  if(!rows.length)throw Error('没有尚未处理的盘亏项')
  return form(ctx,`盘点 #${count.id} · 遗失申请`,'BATCH',`<div class="tool-wide">${table(['选择','工具编号','尚待处理盘亏','申请数量'],rows.map(l=>[`<input type="checkbox" checked data-count-loss="${l.assetId}" aria-label="选择盘亏工具">`,esc(all.find(e=>e.asset?.id===l.assetId)?.code),l.remaining,`<input class="input" type="number" min="1" max="${l.remaining}" required value="${l.remaining}" data-count-loss-quantity="${l.assetId}" aria-label="盘亏申请数量">`]))}</div>`+input('reason','申请原因',count.reason),(p,modal)=>({commands:[...modal.querySelectorAll('[data-count-loss]:checked')].map(el=>({type:'DISPOSAL_REQUEST',payload:{countId:count.id,assetId:Number(el.dataset.countLoss),quantity:Number(modal.querySelector(`[data-count-loss-quantity="${el.dataset.countLoss}"]`).value),kind:'LOST',reason:p.reason}}))}))
 }
 if(action==='count-cancel-current')return form(ctx,'取消本次盘点','COUNT_CANCEL','<p class="tool-wide">本次未完成的盘点保留为已取消，不调整库存。</p>',p=>({...p,id:count.id}))
 if(action==='count-export'){
  if(!count)throw Error('请选择盘点单')
  return downloadCsv(`盘点状态_${count.id}.csv`,[['工具库','工具名称','编号','条形码 / RFID','应有数量','实际数量','差异','盘点状态','经办人','确认时间'],...count.lines.map(line=>{const e=all.find(e=>e.asset?.id===line.assetId),draft=draftFor(v,line),actual=count.status==='CLOSED'?line.counted:draft.verified?draft.counted:'';return [name(m.warehouses,count.warehouseId),e?.title,e?.code,e?.asset?.tag,line.expected,count.status==='CANCELLED'?'未确认':actual,count.status==='CANCELLED'||actual===''?'':actual-line.expected,count.status==='CLOSED'?'清点完成':count.status==='CANCELLED'?'已取消（未调整库存）':draft.verified?(draft.present?'已找到':'已核对未找到'):'未核对',count.confirmedBy||count.actor,count.finishedAt||'']})])
 }
 if(!selected.length)throw Error('请先勾选需要操作的工具')
 if(action==='delete'){
  if(selected.some(e=>e.type==='LEGACY'))throw Error('待完善登记的记录仍有原库存，请先完善登记，再通过报废等业务处置库存')
  const commands=selected.map(e=>({type:e.type==='KIT'?'KIT_DELETE':e.type==='LEGACY'?'TOOL_DELETE':'ASSET_DELETE',payload:e.asset?{assetId:e.id}:{id:e.id}}))
  return form(ctx,'删除所选记录','BATCH',`<p class="tool-wide">确认删除 ${selected.length} 项？已被业务引用的记录不允许删除，系统会整体拒绝本次操作并保留数据。</p>`,()=>({commands}))
 }
 if(selected.some(e=>e.type==='LEGACY'))throw Error('所选项包含待完善登记的原库存，请先完善登记')
 if(['service-finish','transfer-finish','disposal-review'].includes(action))return finishBatch(ctx,v,action,selected,{...d,form})
 if(action==='return')return returnBatch(ctx,selected,{...d,form})
 const assets=selected.filter(e=>e.asset)
 if(action!=='borrow'&&selected.some(e=>e.kit))throw Error('套装的调拨、检修和遗失报废需选择具体成员，避免重复处理成员库存')
 const used=new Set()
 for(const e of selected)for(const id of e.asset?[e.id]:e.kit.lines.map(l=>l.assetId)){if(used.has(id))throw Error('所选套装与工具包含重复成员，请取消重复勾选');used.add(id)}
 const titles={borrow:'批量借出',transfer:'两库之间调拨',inspection:'批量送检',repair:'批量送修',lost:'批量遗失申请',scrap:'批量报废申请'}
 if(!titles[action])throw Error('暂不支持该操作')
 const rows=selected.map(e=>[esc(e.title),esc(e.code),e.kit?'整套':`<input class="input" type="number" min="1" step="1" value="1" required data-batch-quantity="${e.key}" aria-label="${esc(e.code)}办理数量" ${e.asset.mode==='NUMBERED'?'max="1" readonly':''}>`,esc(e.values.state),['lost','scrap'].includes(action)?`<select class="select" data-batch-source="${e.key}" aria-label="${esc(e.code)}申请来源"><option value="">在库工具</option>${e.balance.loans.map(l=>`<option value="${l.id}" ${e.balance.stock<=0?'selected':''}>#${l.id} ${esc(l.borrower)}</option>`).join('')}</select>`:''])
 let body=`<div class="tool-wide">${table(['工具名称','编号','数量','当前状态','申请来源'],rows)}</div>`
 if(action==='borrow')body+=input('borrower','领用人')+input('borrowType','借用类型','检修使用')+input('dueAt','预计归还时间','','datetime-local')+select('scheduleTaskId','关联作业任务（可选，用于防错）',s.schedules.filter(row=>!['CANCELLED','COMPLETED'].includes(row.status)&&s.vehicleRepairs.some(v=>v.id===row.vehicleRepairId&&v.currentVersionId===row.versionId)&&s.scheduleVersions.some(v=>v.id===row.versionId&&v.status==='PUBLISHED')),'',r=>`${r.id} · ${s.tasks.find(t=>t.id===r.taskId)?.name||''}`)
 if(action==='transfer')body+=`<p class="tool-wide">调拨方向由每项当前所属库自动确定：检修工具库 → 整备工具库；整备工具库 → 检修工具库。</p>`
 if(['inspection','repair'].includes(action))body+=input('provider','检定 / 维修单位')+input('reason','原因说明')
 if(['lost','scrap'].includes(action))body+=input('reason','申请原因')
 return form(ctx,titles[action],'BATCH',body,(p,modal)=>({commands:selected.map(e=>{
  const quantity=e.kit?undefined:Number(modal.querySelector(`[data-batch-quantity="${e.key}"]`).value),base={...p,...(e.kit?{kitId:e.id}:{assetId:e.id,quantity})}
  if(action==='borrow')return {type:'BORROW',payload:base}
  if(action==='transfer'){const target=m.warehouses.find(w=>w.id!==e.warehouseId);if(!target)throw Error('缺少调入工具库');return {type:'TRANSFER',payload:{...base,toWarehouseId:target.id}}}
  if(['inspection','repair'].includes(action))return {type:'SERVICE_SEND',payload:{...base,kind:action==='inspection'?'INSPECTION':'REPAIR'}}
  return {type:'DISPOSAL_REQUEST',payload:{...base,kind:action==='lost'?'LOST':'SCRAPPED',loanId:modal.querySelector(`[data-batch-source="${e.key}"]`).value||null}}
 })}))
}
function returnBatch(ctx,selected,d){
 const {form,input,table}=d,m=ctx.state.toolManagement,ids=new Set(selected.filter(e=>e.asset).map(e=>e.id)),kits=new Set(selected.filter(e=>e.kit).map(e=>e.id))
 const lines=m.loans.flatMap(loan=>loan.status==='OPEN'?loan.lines.filter(line=>(kits.has(loan.kitId)||ids.has(line.assetId))&&returnableQuantity(m,loan,line)>0).map(line=>({loan,line,n:returnableQuantity(m,loan,line)})):[])
 if(!lines.length)throw Error('所选工具没有可归还数量')
 return form(ctx,'归还所选工具','BATCH',`<div class="tool-wide">${table(['借用单','领用人','工具 / 编号','可归还','本次归还'],lines.map(({loan,line,n},i)=>{const a=m.assets.find(a=>a.id===line.assetId);return [loan.id,esc(loan.borrower),esc(name(ctx.state.tools,a.toolId))+' · '+esc(a.code),n,`<input class="input" type="number" min="0" max="${n}" step="1" value="${n}" required data-return-line="${i}" aria-label="${esc(a.code)}归还数量">`]}))}</div>`+input('returner','归还人'),(p,modal)=>({commands:lines.flatMap(({loan,line},i)=>{const value=modal.querySelector(`[data-return-line="${i}"]`).value;if(value==='')throw Error('请填写归还数量');const n=Number(value);if(!Number.isSafeInteger(n)||n<0)throw Error('归还数量必须为非负整数');return n?[{type:'RETURN',payload:{loanId:loan.id,assetId:line.assetId,quantity:n,returner:p.returner}}]:[]})}))
}
function finishBatch(ctx,v,action,selected,d){
 const {form,input,choice,table}=d,m=ctx.state.toolManagement,ids=new Set(selected.flatMap(e=>e.asset?[e.id]:e.kit.lines.map(l=>l.assetId)))
 const rows=(action==='service-finish'?m.services:action==='transfer-finish'?m.transfers:m.disposals).filter(r=>ids.has(r.assetId)&&r.status===(action==='service-finish'?'OPEN':'PENDING'))
 if(!rows.length)throw Error('所选工具没有对应的待办理记录')
 const review=action==='disposal-review'
 const source=r=>[r.countId&&`盘点 #${r.countId}`,r.loanId&&`借用单 #${r.loanId}`,r.serviceId&&`检修单 #${r.serviceId}`].filter(Boolean).join(' · ')||'在库工具申请'
 let body=`<p class="tool-wide tool-batch-scope" data-tool-batch-scope role="status"></p><div class="tool-wide">${table(review?['选择办理','申请单 / 工具编号','申请人 / 时间','类型 / 数量','原因 / 来源','账面 → 仅本单批准后']:['选择办理','单号','工具编号','数量','业务信息'],rows.map(r=>{const a=m.assets.find(a=>a.id===r.assetId);return review?[`<input type="checkbox" data-finish-id="${r.id}" checked aria-label="办理单据${r.id}">`,`#${r.id} · ${esc(a.code)}`,`${esc(r.actor)}<br>${esc(r.at.replace('T',' ').slice(0,16))}`,`${r.kind==='LOST'?'遗失':'报废'} · ${r.quantity} 件`,`${esc(r.reason)}<br><small>${esc(source(r))}</small>`,`${a.quantity} → ${a.quantity-r.quantity} 件`]:[`<input type="checkbox" data-finish-id="${r.id}" checked aria-label="办理单据${r.id}">`,r.id,esc(a.code),r.quantity,esc(r.provider||r.reason||name(m.warehouses,r.toWarehouseId))]}))}</div>`
 if(review)body+='<p class="tool-wide pc-help">仅审核勾选的申请。批准后扣减对应数量；驳回不扣账，检修不合格件仍保持停用。申请人不能审核自己的申请。</p>'
 if(action==='service-finish')body+=choice('result','检定 / 维修结果',[['','请选择校验结果'],['PASS','合格回库'],['FAIL','不合格转报废审核']],'')+input('certificate','检定证书 / 维修结论')
 if(action==='transfer-finish')body+=choice('decision','处理结果',[['RECEIVED','接收入库'],['CANCELLED','取消调拨']],'RECEIVED')
 if(action==='disposal-review')body+=choice('decision','审核结果',[['APPROVED','批准'],['REJECTED','驳回']],'APPROVED')+input('opinion','审核意见')
 const modal=form(ctx,action==='service-finish'?'登记检修结果':action==='transfer-finish'?'接收调拨':'审核申请','BATCH',body,(p,modal)=>({commands:[...modal.querySelectorAll('[data-finish-id]:checked')].map(el=>({type:action==='service-finish'?'SERVICE_FINISH':action==='transfer-finish'?'TRANSFER_FINISH':'DISPOSAL_REVIEW',payload:{...p,id:Number(el.dataset.finishId)}}))}))
 const confirm=modal.querySelector('[data-modal-confirm]'),label=confirm.textContent
 const sync=()=>{const ids=new Set([...modal.querySelectorAll('[data-finish-id]:checked')].map(el=>Number(el.dataset.finishId))),chosen=rows.filter(r=>ids.has(r.id)),total=chosen.reduce((n,r)=>n+r.quantity,0),account=[...new Set(chosen.map(r=>r.assetId))].reduce((n,id)=>n+m.assets.find(a=>a.id===id).quantity,0),impact=review&&ids.size?(modal.querySelector('[data-f="decision"]').value==='APPROVED'?` 批准所选申请后，所涉工具账面合计 ${account} → ${account-total} 件。`:' 驳回不扣减账面数量。'):'';modal.querySelector('[data-tool-batch-scope]').textContent=`本次办理 ${ids.size} 张单 · ${total} 件；未勾选单据保持原状态。${impact}`;confirm.disabled=!ids.size;confirm.textContent=`${label}（${ids.size}单）`}
 modal.querySelectorAll('[data-finish-id],[data-f="decision"]').forEach(el=>el.addEventListener('change',sync));sync();return modal
}
function openCountHistory(ctx,v,d){
 const m=ctx.state.toolManagement
 const modal=openModal({title:'盘点记录',wide:true,confirmText:'打开所选盘点',body:`<div class="table-wrap">${d.table(['选择','单号','工具库','状态','创建时间'],m.counts.slice().reverse().map(c=>[`<input type="radio" name="count-history" value="${c.id}" aria-label="盘点单${c.id}">`,c.id,esc(name(m.warehouses,c.warehouseId)),c.status==='OPEN'?'盘点中':c.status==='CLOSED'?'清点完成':'已取消',esc(c.at)]))}</div>`,onConfirm(){const field=modal.querySelector('[name="count-history"]:checked');if(!field){toast('请选择盘点单','','warning');return false}const count=ctx.state.toolManagement.counts.find(c=>c.id===Number(field.value));v.countId=count.id;v.countDraftId=null;countDrafts(v,count);ctx.rerender(false)}})
}
function openBasicTable(ctx,v,d,kind){
 let s=ctx.state,m=s.toolManagement,selectedId=null
 const config={kits:{title:'工具套装',rows:m.kits,add:'kit',edit:'kit-edit',remove:'KIT_DELETE'},tools:{title:'工具字典',rows:s.tools,add:'tool-new',edit:'tool-edit',remove:'TOOL_DELETE'},categories:{title:'工具分类',rows:m.categories,add:'category',edit:'category-edit',remove:'CATEGORY_DELETE'},devices:{title:'智能设施',rows:m.devices,add:'device-new',edit:'device-edit',remove:'DEVICE_DELETE'}}
 const modal=openModal({title:'工具资料',wide:true,confirmText:'关闭',body:`<nav class="tool-detail-tabs" aria-label="工具资料分类">${[['tools','工具字典'],['categories','工具分类'],['kits','工具套装'],['devices','智能设施']].map(([key,title])=>`<button type="button" data-base-tab="${key}" aria-pressed="${key===kind}" class="${key===kind?'active':''}">${title}</button>`).join('')}</nav><p>工具库：${m.warehouses.map(w=>esc(w.name)).join('、')}。</p><div data-base-table></div><div class="tool-bottom-buttons">${btn('add','新增')}${btn('edit','修改')}${btn('delete','删除')}${btn('bind','工序绑定')}${btn('event','设施联调')}</div><p class="pc-help" data-base-device-help>模拟事件办理库存业务，但不会将设施标记为在线。真实设备接口：POST /api/tools/device-events；门禁通行只记录已发生事件，不远程开锁。</p>`})
 const show=()=>{const c=config[kind],device=kind==='devices';modal.querySelector('[data-base-table]').innerHTML=d.table(device?['选择','编码','名称','类型 / 工具库','连接 / 最近通信']:kind==='kits'?['选择','编号','名称','套装组成','工具库']:kind==='categories'?['选择','编码','名称','说明','备注']:['选择','编码','名称','规格 / 状态','低储阈值'],c.rows.map(r=>[`<input type="radio" name="base-record" value="${r.id}" aria-label="选择${esc(r.name)}">`,esc(r.code),esc(r.name),device?esc(`${r.kind==='CABINET'?'智能工具柜':'无人工具室'} · ${name(m.warehouses,r.warehouseId)}`):kind==='kits'?esc(r.lines.map(l=>`${m.assets.find(a=>a.id===l.assetId)?.code||'—'} × ${l.quantity}`).join('；')):esc([r.specification,({AVAILABLE:'可用',MAINTENANCE:'检修中',DISABLED:'停用'})[r.status]].filter(Boolean).join(' · ')),device?esc(`${!r.enabled?'停用':r.lastSeenAt&&Date.now()-new Date(r.lastSeenAt)<120000?'在线':'未连接 / 离线'} · ${r.lastSeenAt?String(r.lastSeenAt).replace('T',' ').slice(0,16):'未通信'}`):kind==='kits'?esc(name(m.warehouses,m.assets.find(a=>a.id===r.lines[0]?.assetId)?.warehouseId)):esc(r.lowStock==null?'—':`全库 ${r.lowStock} 件${Object.entries(r.warehouseLowStock||{}).map(([id,n])=>`；${name(m.warehouses,Number(id))} ${n} 件`).join('')}`)]));modal.querySelector('[data-base-action="event"]').hidden=!device;modal.querySelector('[data-base-action="bind"]').hidden=kind!=='tools';modal.querySelector('[data-base-device-help]').hidden=!device;modal.querySelectorAll('[data-base-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.baseTab===kind);b.setAttribute('aria-pressed',String(b.dataset.baseTab===kind))})}
 modal.querySelectorAll('[data-base-tab]').forEach(b=>b.addEventListener('click',()=>{kind=b.dataset.baseTab;show()}))
 show()
 modal.querySelectorAll('[data-base-action]').forEach(b=>b.addEventListener('click',()=>{
  const op=b.dataset.baseAction,c=config[kind],id=Number(modal.querySelector('[name="base-record"]:checked')?.value)
  if(op!=='add'&&!id){toast('请选择一条记录','','warning');return}
  selectedId=id
  openModalChild(modal,()=>op==='delete'?d.form(ctx,`删除${c.title}` ,c.remove,`<p class="tool-wide">确认删除“${esc(c.rows.find(r=>r.id===id).name)}”？已有业务引用时将拒绝删除并保留记录。</p>`,()=>({id})):d.handle(ctx,op==='add'?c.add:op==='event'?'device-event':op==='bind'?'bind-task':c.edit,id),()=>{
   s=ctx.state;m=s.toolManagement;for(const [key,value] of Object.entries(config))value.rows=key==='tools'?s.tools:m[key]
   show();if(selectedId)modal.querySelector(`[name="base-record"][value="${selectedId}"]`)?.setAttribute('checked','')
  })
 }))
}
export function downloadCsv(filename,rows){
 const cell=v=>{let value=String(v??'');if(/^[=+\-@\t\r]/.test(value))value="'"+value;return '"'+value.replaceAll('"','""')+'"'}
 const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}

