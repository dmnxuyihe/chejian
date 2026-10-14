import { pageHeader } from '../../../shared/templates.js'
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
  const value = val(row, key)
  if (type === 'team') return `<div class="field"><label>${label}</label><select class="select" data-f="${key}">${state.teams.map(t => `<option value="${t.id}" ${Number(value)===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></div>`
  if (type === 'workstation') return `<div class="field"><label>${label}</label><select class="select" data-f="${key}"><option value="">未分配</option>${state.workstations.map(w => `<option value="${w.id}" ${Number(value)===w.id?'selected':''}>${esc(w.name)}</option>`).join('')}</select></div>`
  if (type === 'status') {
    const statuses = ({ teams:['ENABLED','DISABLED'], employees:['ACTIVE','INACTIVE'], workstations:['AVAILABLE','MAINTENANCE','DISABLED'], equipment:['AVAILABLE','MAINTENANCE','FAULT','DISABLED'], tools:['AVAILABLE','MAINTENANCE','DISABLED'], materials:['AVAILABLE','DISABLED'], spareParts:['AVAILABLE','DISABLED'] })[collection] || ['AVAILABLE','DISABLED']
    return `<div class="field"><label>${label}</label><select class="select" data-f="${key}">${statuses.map(status => `<option value="${status}" ${value===status?'selected':''}>${status}</option>`).join('')}</select></div>`
  }
  return `<div class="field"><label>${label}</label><input class="input" data-f="${key}" type="${type==='number'?'number':'text'}" value="${esc(value)}"></div>`
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

function table(ctx, key) {
  const config = tabs[key]
  const rows = rowsFor(ctx.state, key)
  const columns = config.fields.slice(0, key === 'employees' ? 4 : config.fields.length)
  return `<div class="table-wrap"><table><thead><tr>${columns.map(([, label]) => `<th>${label}</th>`).join('')}<th>操作</th></tr></thead><tbody>${rows.map(row => `<tr>${columns.map(([field,label,type]) => {
    const value = displayValue(ctx.state, key, type, row[field])
    return `<td>${field === 'status' ? badge(value, statusBadge(value)) : (field === 'code' || field === 'no' ? `<span class="mono">${esc(value)}</span>` : esc(value))}</td>`
  }).join('')}<td><button class="btn btn-sm" data-edit="${row.id}">编辑</button> <button class="btn btn-sm btn-danger" data-delete="${row.id}">删除</button></td></tr>`).join('') || `<tr><td colspan="${columns.length+1}" class="empty">暂无${config.label}</td></tr>`}</tbody></table></div>`
}

export const resourcesCrudPage = {
  render({ state }) {
    const config = tabs[activeTab]
    return `${pageHeader('基础资源管理', '维护人员、班组、工位及非核心资源；删除会校验业务引用。', `<button class="btn btn-primary" data-add-resource>新增${config.label}</button>`)}
      <section class="card"><div class="filter-row" style="margin-bottom:18px"><div class="tabs">${Object.entries(tabs).map(([key,item]) => `<button class="tab ${key===activeTab?'active':''}" data-resource-tab="${key}">${item.label}</button>`).join('')}</div></div>${table({state}, activeTab)}</section>`
  },
  mount(ctx) {
    document.querySelectorAll('[data-resource-tab]').forEach(button => button.addEventListener('click', () => { activeTab = button.dataset.resourceTab; ctx.rerender() }))
    document.querySelector('[data-add-resource]')?.addEventListener('click', () => openResourceForm(ctx, activeTab))
    document.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => {
      const row = rowsFor(ctx.state, activeTab).find(item => item.id === Number(button.dataset.edit))
      if (row) openResourceForm(ctx, activeTab, row)
    }))
    document.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => {
      const result = deleteResource(ctx.state, activeTab, button.dataset.delete)
      toast(result.ok ? '删除成功' : '删除失败', result.ok ? '记录已删除' : result.message, result.ok ? 'success' : 'warning')
      if (result.ok) ctx.rerender()
    }))
  }
}
