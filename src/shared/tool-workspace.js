import {toolDateTime,toolDateInput} from './tool-dates.js'
import {escapeHtml as esc,openModal,openModalChild} from '../core/ui.js'
import {toolLedgerEntries} from './tool-ledger.js'
import {renderToolTableWorkspace} from './tool-table.js'
import {assetStock,assetHeld,toolDueAt,toolLabels,assetBusinessHistory} from '../core/tool-management.js'

const name=(rows,id)=>rows.find(row=>row.id===id)?.name||'—'
const date=value=>esc(toolDateTime(value))
const words={...toolLabels,ONLINE:'在线',OFFLINE:'未连接 / 离线',MAINTENANCE:'检修中'}
const stateText=(value,kind)=>value==='PENDING'&&kind==='transfers'?'待接收':value==='OPEN'&&kind==='loans'?'未归还':value==='OPEN'&&kind==='inspection'?'检定中':value==='OPEN'&&kind==='repair'?'维修中':words[value]||value||'—'
export const toolState=(value,kind)=>`<span class="tool-state is-${esc(value.toLowerCase())}">${esc(stateText(value,kind))}</span>`
const empty=(title,body='调整查询条件，或使用右上角操作开始办理。')=>`<div class="tool-empty"><strong>${esc(title)}</strong><p>${esc(body)}</p></div>`
const table=(heads,rows,emptyText='暂无记录')=>rows.length?`<div class="table-wrap tool-data-wrap"><table class="tool-data-table"><thead><tr>${heads.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(cells=>`<tr>${cells.map((cell,i)=>`<td data-label="${esc(heads[i])}">${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:empty(emptyText)
const due=a=>{const value=toolDueAt(a);return value==='MISSING'?'未登记合格检定':value?toolDateInput(value):'无需定期检定'}
const dueValid=(a,at)=>{const d=toolDueAt(a);return !d||(d!=='MISSING'&&new Date(d)>new Date(at))}
const managedAvailable=(s,a)=>s.tools.find(t=>t.id===a.toolId)?.status==='AVAILABLE'&&dueValid(a,new Date())?assetStock(s.toolManagement,a):0
const fact=(label,value)=>`<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`
const facts=items=>`<dl class="tool-facts">${items.map(([k,v])=>fact(k,v)).join('')}</dl>`
const text=v=>esc(v||'—')
const assetName=(s,id)=>{const a=s.toolManagement.assets.find(a=>a.id===id);return a?`${name(s.tools,a.toolId)} · ${a.code}`:'—'}

export function toolDestination(view,tab,section,status=''){Object.assign(view,{tab,section:section||'loans',status,query:''})}
export function renderToolWorkspace(ctx,v){return renderToolTableWorkspace(ctx,v)}
export function disposalContext(s,r){
  const m=s.toolManagement,a=m.assets.find(a=>a.id===r.assetId)
  return `<div class="tool-review-context">${facts([['申请单',`#${r.id}`],['工具',text(assetName(s,r.assetId))],['所属工具库',text(name(m.warehouses,a?.warehouseId))],['类型 / 数量',`${text(words[r.kind])} · ${r.quantity} 件`],['申请人 / 时间',`${text(r.actor)}<small>${date(r.at)}</small>`],['申请原因',text(r.reason)]])}<ol class="tool-flow"><li class="is-complete"><strong>已提交申请</strong><span>${date(r.at)}</span></li><li class="${r.status==='PENDING'?'is-current':'is-complete'}"><strong>${r.status==='PENDING'?'等待审核':r.status==='APPROVED'?'审核批准':'审核驳回'}</strong><span>${text(r.reviewer||'待指定审核人')}${r.reviewedAt?` · ${date(r.reviewedAt)}`:''}</span></li><li><strong>${r.status==='APPROVED'?'已处置库存':r.status==='REJECTED'?'保留原库存':'审核后处置库存'}</strong><span>${text(r.opinion||'审核结果及意见将在此保留')}</span></li></ol>${r.loanId?`<p class="pc-help">关联借用单 #${r.loanId}；批准后结清对应未还数量。</p>`:''}</div>`
}
export function openToolDetails(ctx,a,initial='summary',onAction,options={}){
  let s=ctx.state,m=s.toolManagement,loans=m.loans.filter(l=>l.lines.some(r=>r.assetId===a.id)),services=assetBusinessHistory(m,a.id,'services'),disposals=m.disposals.filter(r=>r.assetId===a.id),transfers=assetBusinessHistory(m,a.id,'transfers')
  let activePane=initial
  const panes={summary:'工具概况',circulation:'流转历史',service:'检定与维修',approval:'审批记录'}
  const summary=()=>facts([['工具名称',text(name(s.tools,a.toolId))],['实物 / 批次编号',text(a.code)],['当前位置',text(name(m.warehouses,a.warehouseId))],['当前情况',text(toolLedgerEntries(s).entries.find(e=>e.key===`asset:${a.id}`)?.balance.states.join(' · '))],['账面 / 可领用',`${a.quantity} / ${managedAvailable(s,a)} 件`],['流转占用',`${assetHeld(m,a.id)} 件`],['来源台账',text(a.parentAssetId?assetName(s,a.parentAssetId):'原始登记')],['标签',text(a.tag||'未绑定')],['入库时间',date(a.receivedAt)],['最后检修时间',date(a.lastRepairAt)],['最近合格检定',date(a.lastInspectionAt)],['检定有效期',text(due(a))]])+`<h4>当前借用</h4>${loans.filter(l=>l.status==='OPEN').map(l=>{const line=l.lines.find(r=>r.assetId===a.id),remaining=line.quantity-line.returned-(line.disposed||0);return remaining?`<div class="tool-current-loan"><strong>${text(l.borrower)}</strong><span>未还 ${remaining} 件 · 应于 ${date(l.dueAt)} 归还</span></div>`:''}).join('')||'<p class="pc-help">当前没有未归还借用。</p>'}`
  const render=key=>key==='summary'?summary():key==='circulation'?table(['业务','时间','人员 / 数量','状态 / 结果'],[...loans.flatMap(l=>[[`领用 #${l.id}`,date(l.at),`${text(l.borrower)} · ${l.lines.find(r=>r.assetId===a.id).quantity} 件`,toolState(l.status,'loans')],...l.returns.filter(r=>r.assetId===a.id).map(r=>[`归还 #${l.id}`,date(r.at),`${text(r.returner)} · ${r.quantity} 件`,'已归还'])]),...transfers.map(r=>[`调拨 #${r.id}`,date(r.at),`${text(name(m.warehouses,r.fromWarehouseId))} → ${text(name(m.warehouses,r.toWarehouseId))} · ${r.quantity} 件`,toolState(r.status,'transfers')])]):key==='service'?table(['业务 / 数量','单位 / 原因','办理 / 完成时间','结果'],services.map(r=>[`${text(words[r.kind])} #${r.id} · ${r.quantity} 件`,`${text(r.provider)}<small>${text(r.reason)}</small>`,`${date(r.at)}<small>${date(r.finishedAt)}</small>`,`${toolState(r.status)}<small>${text(r.certificate)}</small>`])):disposals.map(r=>`<section class="tool-approval-item"><h4>${text(words[r.kind])}申请 #${r.id} ${toolState(r.status)}</h4>${disposalContext(s,r)}</section>`).join('')||empty('暂无审批记录')
  const wrap=openModal({title:`${a.code} · ${name(s.tools,a.toolId)}`,wide:true,confirmText:'关闭',cancelText:'返回',body:`<nav class="tool-detail-tabs" aria-label="工具详情分类">${Object.entries(panes).map(([key,label])=>`<button type="button" data-tool-detail-tab="${key}" class="${initial===key?'active':''}" aria-pressed="${initial===key}">${label}</button>`).join('')}</nav><div data-tool-detail-content>${render(initial)}</div>${onAction?`<div class="tool-bottom-buttons">${[['asset-config','标签与状态'],['bind-task','工序绑定'],['check-use','作业工具核验']].map(([key,title])=>`<button type="button" class="btn" data-tool-detail-action="${key}">${title}</button>`).join('')}</div>`:''}`})
  wrap.querySelectorAll('[data-tool-detail-action]').forEach(button=>button.addEventListener('click',()=>openModalChild(wrap,()=>onAction(button.dataset.toolDetailAction),()=>{s=ctx.state;m=s.toolManagement;a=m.assets.find(row=>row.id===a.id)||a;loans=m.loans.filter(l=>l.lines.some(r=>r.assetId===a.id));services=assetBusinessHistory(m,a.id,'services');disposals=m.disposals.filter(r=>r.assetId===a.id);transfers=assetBusinessHistory(m,a.id,'transfers');wrap.querySelector('[data-tool-detail-content]').innerHTML=render(activePane)})))
  wrap.querySelectorAll('[data-tool-detail-tab]').forEach(button=>button.addEventListener('click',()=>{wrap.querySelectorAll('[data-tool-detail-tab]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button))});activePane=button.dataset.toolDetailTab;wrap.querySelector('[data-tool-detail-content]').innerHTML=render(activePane)}))
  if(options.loanId){
    wrap.querySelector('h3').textContent=`借用单 #${options.loanId} · ${a.code}`
    const loan=m.loans.find(l=>l.id===options.loanId),info=document.createElement('p');info.className='tool-current-transaction';info.dataset.currentLoanInfo=String(options.loanId);info.textContent=`当前查看借用单 #${options.loanId} · ${loan?.borrower||'—'}${loan?.kitId?' · 套装 '+(m.kits.find(k=>k.id===loan.kitId)?.name||'—'):''}。下方保留该工具全部流转，当前单据已标记。`;wrap.querySelector('.modal-body').prepend(info)
    const locate=()=>{wrap.querySelectorAll('[data-tool-detail-content] tbody tr').forEach(row=>{if(row.querySelector('td')?.textContent.trim()===`领用 #${options.loanId}`||row.querySelector('td')?.textContent.trim()===`归还 #${options.loanId}`){row.classList.add('is-selected');row.setAttribute('aria-current','true');row.dataset.currentLoan=String(options.loanId)}});wrap.querySelector('[data-current-loan]')?.scrollIntoView({block:'nearest'})}
    wrap.querySelectorAll('[data-tool-detail-tab]').forEach(b=>b.addEventListener('click',locate));locate()
  }
  return wrap
}
