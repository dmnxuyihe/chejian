import { pageHeader } from '../../../shared/templates.js'
import { icon } from '../../../shared/icons.js'
import { badge, openModal, toast, escapeHtml } from '../../../core/ui.js'
import { statusBadge } from '../../../core/derived.js'
import { createResource, updateResource, deleteResource } from '../../../core/actions.js'

const tabs = {
  employees: { label: '人员', fields: [['no','工号','text'],['name','姓名','text'],['teamId','班组','team'],['status','状态','status']] },
  teams: { label: '班组', fields: [['name','班组名称','text'],['status','状态','status']] },
  workstations: { label: '工位', fields: [['code','编码','text'],['name','名称','text'],['line','产线','text'],['capacity','容量','number'],['status','状态','status']] },
  equipment: { label: '设备', fields: [['code','编码','text'],['name','设备名称','text'],['type','设备类型','text'],['workstationId','所属工位','workstation'],['status','状态','status'],['location','位置','text']] },
  tools: { label: '工具', fields: [['code','工具编码','text'],['name','工具名称','text'],['quantity','可用数量','number'],['manufacturer','厂家','text'],['inspection_cycle_months','检修周期（月）','number'],['last_inspection_at','上次检修时间','text'],['location','位置','text'],['status','状态','status']] },
  materials: { label: '物料', fields: [['code','物料编码','text'],['name','物料名称','text'],['specification','规格型号','text'],['unit','计量单位','text'],['quantity','可用数量','number'],['manufacturer','厂家','text'],['location','位置','text'],['status','状态','status']] },
  spareParts: { label: '备件', fields: [['code','备件编号','text'],['name','备件名称','text'],['specification','规格型号','text'],['quantity','可用数量','number'],['unit','计量单位','text'],['manufacturer','厂家','text'],['manufacture_date','出厂日期','text'],['location','位置','text'],['status','状态','status']] },
}

let activeTab = 'employees'
let activeRole = ''
let query = ''
let statusFilter = ''
const statusLabel = value => ({ACTIVE:'在岗',INACTIVE:'停用',ENABLED:'启用',DISABLED:'停用',AVAILABLE:'可用',MAINTENANCE:'检修中',FAULT:'故障'})[value] || value || '未登记'
const roleResourceView = {
  'material-warehouse': {tab:'materials',title:'物料与仓储台账'},
  'tool-management': {tab:'tools',title:'工具台账'},
  'equipment-management': {tab:'equipment',title:'设备台账'},
}
const val = (row, key) => row?.[key] ?? ''
const esc = (v) => escapeHtml(v)
const rowsFor = (state, key) => Array.isArray(state[key]) ? state[key] : []

function displayValue(state, key, field, value) {
  if (field === 'team') return state.teams.find(x => x.id === Number(value))?.name || value || '—'
  if (field === 'workstation') return state.workstations.find(x => x.id === Number(value))?.name || value || '—'
  return value ?? '—'
}

function fieldHtml(state, field, row, collection) {
  const [key, label, type] = field
  const value = val(row, key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())) || val(row, key)
  if (type === 'team') return `<div class="field"><label for="resource-field-${key}">${label}</label><select class="select" id="resource-field-${key}" data-f="${key}">${state.teams.map(t => `<option value="${t.id}" ${Number(value)===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></div>`
  if (type === 'workstation') return `<div class="field"><label for="resource-field-${key}">${label}</label><select class="select" id="resource-field-${key}" data-f="${key}"><option value="">未分配</option>${state.workstations.map(w => `<option value="${w.id}" ${Number(value)===w.id?'selected':''}>${esc(w.name)}</option>`).join('')}</select></div>`
  if (type === 'status') {
    const statuses = ({ teams:['ENABLED','DISABLED'], employees:['ACTIVE','INACTIVE'], workstations:['AVAILABLE','MAINTENANCE','DISABLED'], equipment:['AVAILABLE','MAINTENANCE','FAULT','DISABLED'], tools:['AVAILABLE','MAINTENANCE','DISABLED'], materials:['AVAILABLE','DISABLED'], spareParts:['AVAILABLE','DISABLED'] })[collection] || ['AVAILABLE','DISABLED']
    return `<div class="field"><label for="resource-field-${key}">${label}</label><select class="select" id="resource-field-${key}" data-f="${key}">${statuses.map(status => `<option value="${status}" ${value===status?'selected':''}>${statusLabel(status)}</option>`).join('')}</select></div>`
  }
  return `<div class="field"><label for="resource-field-${key}">${label}</label><input class="input" id="resource-field-${key}" data-f="${key}" type="${type==='number'?'number':'text'}" value="${esc(value)}"></div>`
}

function openResourceForm(ctx, key, row = null) {
  const config = tabs[key]
  openModal({
    title: `${row ? '编辑' : '新增'}${config.label}`,
    wide: true,
    body: `<div class="grid grid-2">${config.fields.map(f => fieldHtml(ctx.state, f, row, key)).join('')}</div>`,
    onConfirm(modal) {
      const data = {}
      for (const [field, , type] of config.fields) {
        const input = modal.querySelector(`[data-f="${field}"]`)
        if (!input) continue
        data[field] = type === 'number' ? Number(input.value || 0) : input.value.trim()
      }
      const name = data.name || data.no || data.code
      if (!name) { toast('保存失败', '名称、工号或编码不能为空', 'warning'); return false }
      const result = row ? updateResource(ctx.state, key, row.id, data) : createResource(ctx.state, key, data)
      if (!result.ok) { toast('保存失败', result.message || '操作失败', 'warning'); return false }
      toast('保存成功', `${config.label}已保存`)
      ctx.rerender()
    }
  })
}

function table(ctx, key, rows) {
  const config = tabs[key]
  const columns = config.fields.slice(0, key === 'employees' ? 4 : config.fields.length)
  return `<div class="table-wrap"><table><thead><tr>${columns.map(([, label]) => `<th>${label}</th>`).join('')}<th>操作</th></tr></thead><tbody>${rows.map(row => `<tr>${columns.map(([field,label,type]) => {
    const value = displayValue(ctx.state, key, type, row[field])
    return `<td>${field === 'status' ? badge(statusLabel(value), statusBadge(value)) : (field === 'code' || field === 'no' ? `<span class="mono">${esc(value)}</span>` : esc(value))}</td>`
  }).join('')}<td class="resource-row-actions"><button class="text-action" data-edit="${row.id}" aria-label="编辑${esc(row.name || row.no || row.code)}">编辑</button><details class="resource-row-menu"><summary aria-label="${esc(row.name || row.no || row.code)}的更多操作">更多</summary><div><button class="btn btn-sm btn-danger" data-delete="${row.id}">删除</button></div></details></td></tr>`).join('') || `<tr><td colspan="${columns.length+1}" class="empty">${query || statusFilter?'没有匹配的记录，请调整搜索或状态筛选。':`暂无${config.label}`}</td></tr>`}</tbody></table></div>`
}

function visibleRows(state) {
  const term=query.trim().toLocaleLowerCase()
  return rowsFor(state,activeTab).filter(row=>(!statusFilter || row.status===statusFilter) && (!term || tabs[activeTab].fields.some(([key,,type])=>String(type==='status'?statusLabel(row[key]):displayValue(state,activeTab,type,row[key])).toLocaleLowerCase().includes(term))))
}

export const resourcesCrudPage = {
  render({ state, role }) {
    const roleId = role?.id || 'system-admin'
    const roleView = roleResourceView[roleId]
    if (activeRole !== roleId) { activeRole = roleId; activeTab = roleView?.tab || 'employees';query='';statusFilter='' }
    const config = tabs[activeTab]
    const allRows=rowsFor(state,activeTab),rows=visibleRows(state)
    return `<div class="resource-workspace">${pageHeader(roleView?.title || '基础资源管理', '', `<button class="btn btn-primary" data-add-resource>${icon('package',16)}新增${config.label}</button>`)}
      <section class="card resource-ledger"><nav class="tabs" aria-label="资源类型">${Object.entries(tabs).map(([key,item]) => `<button class="tab ${key===activeTab?'active':''}" aria-pressed="${key===activeTab}" data-resource-tab="${key}">${item.label}</button>`).join('')}</nav><div class="resource-table-toolbar"><form class="resource-search" data-resource-search-form role="search"><label for="resource-query">搜索${config.label}</label><div>${icon('search',16)}<input class="input" id="resource-query" data-resource-query type="search" value="${esc(query)}" placeholder="名称、编码或班组"><button class="btn btn-sm" type="submit">查询</button></div></form><label class="resource-status-filter">状态<select class="select" data-resource-status><option value="">全部状态</option>${[...new Set(allRows.map(row=>row.status).filter(Boolean))].map(status=>`<option value="${esc(status)}" ${statusFilter===status?'selected':''}>${esc(statusLabel(status))}</option>`).join('')}</select></label><p class="resource-result-count" role="status" data-resource-count>${rows.length} / ${allRows.length} 条记录</p></div><div data-resource-table>${table({state},activeTab,rows)}</div></section></div>`
  },
  mount(ctx) {
    document.querySelectorAll('[data-resource-tab]').forEach(button => button.addEventListener('click', () => { activeTab = button.dataset.resourceTab;query='';statusFilter=''; ctx.rerender(false);document.querySelector(`[data-resource-tab="${activeTab}"]`)?.focus({preventScroll:true}) }))
    const applyFilter=()=>{
      query=document.querySelector('[data-resource-query]').value;statusFilter=document.querySelector('[data-resource-status]').value
      const rows=visibleRows(ctx.state)
      document.querySelector('[data-resource-table]').innerHTML=table(ctx,activeTab,rows)
      document.querySelector('[data-resource-count]').textContent=`${rows.length} / ${rowsFor(ctx.state,activeTab).length} 条记录`
      mountRowActions(ctx)
    }
    document.querySelector('[data-resource-query]')?.addEventListener('input',applyFilter)
    document.querySelector('[data-resource-status]')?.addEventListener('change',applyFilter)
    document.querySelector('[data-resource-search-form]')?.addEventListener('submit',event=>{event.preventDefault();applyFilter()})
    document.querySelector('[data-add-resource]')?.addEventListener('click', () => openResourceForm(ctx, activeTab))
    mountRowActions(ctx)
  }
}

function mountRowActions(ctx) {
    document.querySelectorAll('.resource-row-menu').forEach(menu=>menu.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();menu.open=false;menu.querySelector('summary')?.focus()}
    }))
    document.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => {
      const row = rowsFor(ctx.state, activeTab).find(item => item.id === Number(button.dataset.edit))
      if (row) openResourceForm(ctx, activeTab, row)
    }))
    document.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => {
      const result = deleteResource(ctx.state, activeTab, button.dataset.delete)
      toast(result.ok ? '删除成功' : '删除失败', result.ok ? '记录已删除' : result.message, result.ok ? 'success' : 'warning')
      if (result.ok) {ctx.rerender();document.querySelector('[data-resource-query]')?.focus({preventScroll:true})}
    }))
}
