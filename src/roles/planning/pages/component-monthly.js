import { pageHeader, statCard } from '../../../shared/templates.js'
import { escapeHtml as esc, toast } from '../../../core/ui.js'
import { buildComponentDownPlan, buildComponentUpPlan, adjustInstalledComponent } from '../../../core/component-monthly-plan.js'
import { saveVehicleOperation } from '../../../shared/vehicle-details.js'

const now = new Date()
const initialMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const view = { month: initialMonth, vehicleId: '', typeId: '', initialized: false }

function ensureMonth(state) {
  if (view.initialized) return
  view.initialized = true
  const months = (state.vehicleRepairs || []).filter(row => row.planSource !== 'ANNUAL').map(row => String(row.plannedEntryAt || '').slice(0, 7)).filter(value => /^\d{4}-\d{2}$/.test(value)).sort()
  if (!months.includes(view.month) && months.length) view.month = months.at(-1)
}

function filters(state, vehicles) {
  return `<section class="card pc-component-toolbar"><div class="pc-annual-filterbar">
    <label>计划月份<input class="input" type="month" value="${esc(view.month)}" data-component-month></label>
    <label>机车<select class="select" data-component-vehicle><option value="">全部机车</option>${vehicles.map(row => `<option value="${row.id}" ${String(view.vehicleId) === String(row.id) ? 'selected' : ''}>${esc(row.locomotiveNo)}</option>`).join('')}</select></label>
    <label>配件类型<select class="select" data-component-type><option value="">全部配件</option>${(state.componentTypes || []).map(row => `<option value="${row.id}" ${String(view.typeId) === String(row.id) ? 'selected' : ''}>${esc(row.name)}</option>`).join('')}</select></label>
    <button type="button" class="btn btn-primary" data-component-query>查询</button>
  </div><p class="pc-help">数据由现有月度机车计划、工艺配件需求及当前排程实时测算，不新增数据库表。</p></section>`
}

function tabs(active) {
  return `<nav class="plan-view-tabs plan-switch-tabs" aria-label="配件月度检修计划视图"><a class="${active === 'down' ? 'active' : ''}" href="#/functions/plans/component-down-plan" ${active === 'down' ? 'aria-current="page"' : ''}>下车检修计划</a><a class="${active === 'up' ? 'active' : ''}" href="#/functions/plans/component-up-plan" ${active === 'up' ? 'aria-current="page"' : ''}>上车配件计划</a></nav>`
}

function bindFilters(ctx) {
  document.querySelector('[data-component-query]')?.addEventListener('click', () => {
    view.month = document.querySelector('[data-component-month]').value || view.month
    view.vehicleId = document.querySelector('[data-component-vehicle]').value
    view.typeId = document.querySelector('[data-component-type]').value
    ctx.rerender(false)
  })
}

function csvCell(value) { const text = String(value ?? ''); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text }
function downloadCsv(name, rows) {
  const csv = `\ufeff${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url)
}

export const componentDownPlanPage = {
  render(ctx) {
    const state = ctx.state
    ensureMonth(state)
    const all = buildComponentDownPlan(state, view.month)
    const data = buildComponentDownPlan(state, view.month, view)
    const total = data.rows.reduce((sum, row) => sum + row.calculated, 0)
    const assigned = data.rows.reduce((sum, row) => sum + row.assigned, 0)
    const rows = data.rows.length ? data.rows.map(row => `<tr><td><strong>${esc(row.name)}</strong></td><td>${esc(row.specification)}</td><td>${row.planned} ${esc(row.unit)}</td><td>${row.calculated} ${esc(row.unit)}</td><td>${row.assigned} ${esc(row.unit)}</td><td>${esc(row.vehicles.join('、'))}</td><td><span class="pc-annual-status ${row.assigned >= row.calculated ? 'pc-annual-status-published' : ''}">${row.assigned >= row.calculated ? '已匹配' : '待补充'}</span></td></tr>`).join('') : '<tr><td colspan="7" class="empty">当前筛选条件下暂无可测算的下车检修配件需求</td></tr>'
    return `<section class="pc-planning pc-plan-page pc-component-page" data-component-down-page>${pageHeader('配件计划', '根据月度机车计划和修程工艺，自动测算下车配件检修数量', '<button type="button" class="btn btn-primary" data-component-down-export>导出 CSV</button>')}${tabs('down')}${filters(state, all.vehicles)}<div class="grid grid-4">${statCard('月计划机车', data.vehicles.length, view.month)}${statCard('涉及配件类型', data.rows.length, '下车/检修需求', 'metric-indigo')}${statCard('测算检修数量', total, '按工艺需求汇总', 'metric-green')}${statCard('已匹配数量', assigned, '当前排程配件')}</div><section class="card"><div class="card-title-row"><div><div class="card-title">下车配件数量测算</div><div class="card-subtitle">计划检修数量当前采用工艺测算值；后续数据库提供独立计划单后可区分人工计划值。</div></div><span class="badge badge-blue">${data.rows.length} 类</span></div><div class="table-wrap"><table><thead><tr><th>配件名称</th><th>规格型号</th><th>计划检修数量</th><th>测算检修数量</th><th>已匹配</th><th>涉及机车</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table></div></section></section>`
  },
  mount(ctx) {
    bindFilters(ctx)
    document.querySelector('[data-component-down-export]')?.addEventListener('click', () => {
      const data = buildComponentDownPlan(ctx.state, view.month, view)
      downloadCsv(`${view.month}-配件下车检修计划.csv`, [['配件名称','规格型号','计划检修数量','测算检修数量','已匹配数量','涉及机车'], ...data.rows.map(row => [row.name,row.specification,row.planned,row.calculated,row.assigned,row.vehicles.join('、')])])
    })
  },
}

const statusText = value => ({ QUALIFIED:'检修合格', AVAILABLE:'可用', REPAIRING:'检修中', WAIT_REPAIR:'待修', INSTALLED:'已装车' })[value] || value || '未知'

export const componentUpPlanPage = {
  render(ctx) {
    const state = ctx.state
    ensureMonth(state)
    const all = buildComponentUpPlan(state, view.month)
    const data = buildComponentUpPlan(state, view.month, view)
    const assigned = data.rows.filter(row => row.assigned).length
    const ready = data.rows.filter(row => ['QUALIFIED','AVAILABLE'].includes((row.assigned || row.recommended)?.status)).length
    const rows = data.rows.length ? data.rows.map(row => {
      const chosen = row.assigned || row.recommended
      const basis = chosen?.locomotiveNo === row.vehicle.locomotiveNo ? '原车配件优先' : '可用状态 + 序列号 FIFO'
      return `<tr data-component-up-row><td>${esc(view.month)}</td><td class="mono">${esc(row.vehicle.locomotiveNo)}</td><td>${esc(row.type?.name || '未知配件')} <span class="pc-help">#${row.slot + 1}</span></td><td>${esc(row.task?.name || '装车工序')}</td><td><select class="select select-sm" data-up-component ${row.schedule ? '' : 'disabled'}><option value="">未匹配</option>${row.candidates.map(item => `<option value="${item.id}" ${chosen?.id === item.id ? 'selected' : ''}>${esc(item.serialNo)} · ${esc(statusText(item.status))}</option>`).join('')}</select></td><td><span class="pc-annual-status ${['QUALIFIED','AVAILABLE'].includes(chosen?.status) ? 'pc-annual-status-published' : ''}">${esc(statusText(chosen?.status))}</span></td><td>${esc(basis)}<div class="pc-help">公里匹配：现库无里程字段，待数据库补充</div></td><td><button type="button" class="btn btn-sm" data-save-up data-vehicle-id="${row.vehicle.id}" data-requirement-id="${row.requirement.id}" data-slot="${row.slot}" ${row.schedule ? '' : 'disabled'}>${row.schedule ? '保存调整' : '待排程'}</button></td></tr>`
    }).join('') : '<tr><td colspan="8" class="empty">当前筛选条件下暂无上车配件需求</td></tr>'
    return `<section class="pc-planning pc-plan-page pc-component-page" data-component-up-page>${pageHeader('配件计划', '按可用状态、原车关联和序列号 FIFO 自动推荐上车配件，并支持人工调整', '<button type="button" class="btn btn-primary" data-component-up-export>导出 CSV</button>')}${tabs('up')}${filters(state, all.vehicles)}<div class="grid grid-4">${statCard('月计划机车', data.vehicles.length, view.month)}${statCard('装车需求', data.rows.length, '按工艺数量展开', 'metric-indigo')}${statCard('已分配', assigned, '当前正式排程', 'metric-green')}${statCard('可用/合格', ready, '当前或推荐配件')}</div><section class="notice notice-info"><strong>本阶段范围</strong><span>已实现自动推荐、人工调整和 CSV 导出；确认发布及公里精确匹配需等待配件计划单和配件里程字段。</span></section><section class="card"><div class="card-title-row"><div><div class="card-title">上车配件匹配明细</div><div class="card-subtitle">已有排程的工序可保存调整；未排程需求先展示推荐结果，形成排程后再持久化。</div></div><span class="badge badge-blue">${data.rows.length} 项</span></div><div class="table-wrap"><table><thead><tr><th>计划月份</th><th>机车</th><th>配件/序号</th><th>装车工序</th><th>当前/推荐配件</th><th>状态</th><th>匹配依据</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div></section></section>`
  },
  mount(ctx) {
    bindFilters(ctx)
    document.querySelectorAll('[data-save-up]').forEach(button => button.addEventListener('click', async () => {
      const select = button.closest('[data-component-up-row]').querySelector('[data-up-component]')
      if (!select.value) { toast('请选择上车配件'); return }
      button.disabled = true
      const result = await saveVehicleOperation(ctx, state => adjustInstalledComponent(state, { vehicleId: button.dataset.vehicleId, requirementId: button.dataset.requirementId, slot: button.dataset.slot, componentInstanceId: select.value }))
      if (!result.ok) { button.disabled = false; toast(result.message || '保存失败'); return }
      toast('上车配件调整已保存'); ctx.rerender(false)
    }))
    document.querySelector('[data-component-up-export]')?.addEventListener('click', () => {
      const data = buildComponentUpPlan(ctx.state, view.month, view)
      downloadCsv(`${view.month}-配件上车计划.csv`, [['月份','机车','配件','序号','工序','当前或推荐配件','状态','匹配依据'], ...data.rows.map(row => { const item = row.assigned || row.recommended; return [view.month,row.vehicle.locomotiveNo,row.type?.name,row.slot + 1,row.task?.name,item?.serialNo || '',statusText(item?.status),item?.locomotiveNo === row.vehicle.locomotiveNo ? '原车优先' : '可用状态+序列号FIFO'] })])
    })
  },
}
