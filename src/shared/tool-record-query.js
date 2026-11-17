import {escapeHtml as esc} from '../core/ui.js'

// Business records describe committed documents. Stock operations start from
// the ledger, with the relevant objects explicitly located, never auto-submitted.
export function recordQueryActions(s,kind,row){
 if(!row)return '<p class="pc-help">选择一条记录查看详情。</p>'
 const m=s.toolManagement,collection={loans:'loans',transfers:'transfers',inspection:'services',repair:'services',disposals:'disposals'}[kind]
 if(!collection)return (row.actions||[]).filter(([key])=>['audit-detail','resolve','detail'].includes(key)).map(([key,title])=>`<button type="button" class="btn" data-record-action="${key==='detail'?'detail-view':key}" data-record-target="${row.target||row.id}">${esc(title)}</button>`).join('')
 const record=m[collection].find(r=>r.id===row.id),ids=kind==='loans'?(record?.lines||[]).map(l=>l.assetId):[record?.resultingAssetId||record?.assetId]
 const valid=[...new Set(ids.filter(Boolean))],href='#/functions/assets/tool-register?'+new URLSearchParams(valid.length===1?{asset:valid[0]}:{assets:valid.join(',')})
 const key=kind==='loans'?'loan-detail':kind==='disposals'?'disposal-detail':'detail-view',target=kind==='loans'||kind==='disposals'?row.id:valid[0]
 return `${target?`<button type="button" class="btn" data-record-action="${key}" data-record-target="${target}">查看详情</button>`:''}${valid.length?`<a class="btn" data-record-ledger href="${esc(href)}">到工具台账</a>`:'<span class="pc-help">关联工具已不存在，历史信息保留在本记录中。</span>'}`
}

export function businessQueryMarkup(s,{kind,query,status,actor,since,warehouse,borrowType,business}){
 return `<form class="tool-record-query tool-business-query tool-simple-record-query" data-record-form>
 <div class="tool-record-primary-query"><label class="tool-field"><span>业务类型</span><select class="select" data-record-kind>${Object.entries(business).map(([key,title])=>`<option value="${key}" ${key===kind?'selected':''}>${title}</option>`).join('')}</select></label>
 <label class="tool-field"><span>状态</span><select class="select" data-record-status><option value="">全部状态</option><option value="todo">办理中</option><option value="done">已完结</option></select></label>
 <label class="tool-field"><span>单号 / 工具 / 人员 / 单位</span><input class="input" type="search" data-record-query value="${esc(query)}" placeholder="查找业务记录"></label>
 <label class="tool-field"><span>经办人</span><input class="input" data-record-actor value="${esc(actor)}"></label><label class="tool-field"><span>办理时间起</span><input class="input" type="datetime-local" data-record-since value="${esc(since)}"></label>
 <button class="btn btn-primary" type="submit">查询</button><button class="btn" type="button" data-record-reset>重置</button></div>
 <div hidden data-record-loan-filters><select data-record-warehouse><option value="">全部工具库</option>${s.toolManagement.warehouses.map(w=>`<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select><select data-record-borrow-type><option value="">全部借用类型</option>${[...new Set(s.toolManagement.loans.map(l=>l.borrowType))].map(type=>`<option value="${esc(type)}">${esc(type)}</option>`).join('')}</select></div></form>
 <p class="pc-help" role="status" data-record-pending hidden>查询条件尚未应用，请点击查询。</p><p class="pc-help" data-record-applied hidden></p>
 <div class="tool-list-caption"><strong data-record-count></strong><button class="text-action" data-record-audit>操作日志与设施事件</button></div><div data-record-table></div><div class="tool-bottom-buttons" data-record-actions></div><div class="tool-bottom-buttons"><button class="btn" type="button" data-record-export>导出业务记录</button></div>`
}
