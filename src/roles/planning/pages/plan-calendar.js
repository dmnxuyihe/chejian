import { pageHeader } from '../../../shared/templates.js'
import { escapeHtml } from '../../../core/ui.js'

const esc = escapeHtml
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const pad = value => String(value).padStart(2, '0')
const dateAdd = (value, offset) => {
  const [y, m, d] = value.split('-').map(Number)
  const result = new Date(Date.UTC(y, m - 1, d + offset))
  return `${result.getUTCFullYear()}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())}`
}
const monthEnd = month => {
  const [y, m] = month.split('-').map(Number)
  return `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`
}
const view = { month: today().slice(0, 7), day: today(), importType: 'MONTHLY', filter: { modelId: '', programId: '', locomotiveNo: '' }, loading: true, loadedMode: '', rows: [], planRows: [], lookups: { models: [], programs: [] }, busy: false, preview: null, previewFilter: 'all', detail: null, error: '', result: null, manualOpen: false }

async function api(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } })
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    if (!response.ok) throw new Error(`请求失败（${response.status}）`)
    return response
  }
  const body = await response.json()
  if (!response.ok && response.status !== 409) throw new Error(body.message || `请求失败（${response.status}）`)
  return { ...body, httpStatus: response.status }
}

function monthBounds(month) {
  const first = `${month}-01`
  const weekday = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7
  const start = dateAdd(first, -weekday)
  return { from: start, to: dateAdd(start, 41) }
}

function entriesForDay(day) {
  const events = []
  for (const vehicle of view.rows) {
    if (vehicle.entryDate === day) events.push({ type: 'entry', vehicle, label: `计划入段 · ${vehicle.locomotiveNo}` })
    if (vehicle.confirmedExitDate === day) events.push({ type: 'exit', vehicle, label: `预计出段 · ${vehicle.locomotiveNo}` })
  }
  return events
}

function calendarHtml() {
  const { from } = monthBounds(view.month)
  const weekdays = ['一', '二', '三', '四', '五', '六', '日']
  return `<div class="pc-plan-calendar" role="grid" aria-label="${esc(view.month)}检修计划日历">
    ${weekdays.map(day => `<div class="pc-plan-weekday" role="columnheader">周${day}</div>`).join('')}
    ${Array.from({ length: 42 }, (_, index) => {
      const day = dateAdd(from, index), events = entriesForDay(day), visible = events.slice(0, 3)
      return `<div class="pc-plan-day ${day.startsWith(view.month) ? '' : 'is-outside'} ${view.day === day ? 'is-selected' : ''}" role="gridcell" data-calendar-day="${day}" tabindex="0" aria-label="查看${day}，${events.length}个事件" aria-pressed="${view.day === day}">
        <button type="button" class="pc-plan-day-number" data-select-day="${day}" aria-label="查看${day}，${events.length}个事件" aria-pressed="${view.day === day}">${Number(day.slice(-2))}<span>${events.length ? `${events.length}项` : ''}</span></button>
        <div class="pc-plan-day-events">${visible.map(event => `<button type="button" class="pc-plan-event ${event.type === 'entry' ? 'is-entry' : 'is-exit'}" data-open-vehicle="${event.vehicle.id}" data-event-day="${day}" title="${esc(event.label)}">${esc(event.label)}</button>`).join('')}${events.length > 3 ? `<button type="button" class="pc-plan-more" data-select-day="${day}">还有${events.length - 3}条</button>` : ''}</div>
      </div>`
    }).join('')}
  </div>`
}

function statusLabel(vehicle) {
  const names = { UNSCHEDULED: '未排程', SCHEDULED: '已排程', IN_PROGRESS: '检修中', COMPLETED: '已完成', CANCELLED: '已取消', CANCELED: '已取消' }
  return names[vehicle.status] || vehicle.status || '未填写'
}

function vehicleCard(vehicle, event) {
  return `<button type="button" class="pc-plan-vehicle-card" data-open-vehicle="${vehicle.id}" data-event-day="${view.day}">
    <span class="pc-plan-vehicle-card-top"><strong>${esc(vehicle.locomotiveNo)}</strong><span class="pc-plan-status">${esc(statusLabel(vehicle))}</span></span>
    <span>${esc(vehicle.modelName)} · ${esc(vehicle.repairProgramName)}${vehicle.repairSequence ? ` · 第${vehicle.repairSequence}次` : ''}</span>
    <span class="pc-plan-event-hint ${event.type === 'entry' ? 'is-entry' : 'is-exit'}">${event.type === 'entry' ? '计划入段' : '预计出段'}</span>
  </button>`
}

function dayPanel() {
  if (!view.day) return '<div class="pc-plan-empty">选择日期查看当日计划。</div>'
  const events = entriesForDay(view.day)
  const entries = events.filter(event => event.type === 'entry')
  const exits = events.filter(event => event.type === 'exit')
  const vehicleCount = new Set(events.map(event => event.vehicle.id)).size
  return `<div class="pc-plan-day-panel">
    <div class="pc-plan-day-summary"><div><span>当日事件</span><strong>${events.length}</strong></div><div><span>涉及检修</span><strong>${vehicleCount}</strong></div></div>
    ${[['计划入段', entries], ['预计出段', exits]].map(([title, rows]) => `<section class="pc-plan-event-group"><h3>${title}<span>${rows.length}</span></h3>${rows.map(event => vehicleCard(event.vehicle, event)).join('') || `<p class="pc-plan-empty">当日暂无${title}事件</p>`}</section>`).join('')}
    <p class="pc-plan-hint">预计出段仅依据该次检修已关联的 CURRENT 正式排程版本；未排程或草稿不显示。</p>
  </div>`
}

function periodControl() {
  return view.importType === 'ANNUAL'
    ? `<label>年度 <input class="input" type="number" min="1900" max="2199" value="${view.annualYear || view.month.slice(0, 4)}" data-annual-year></label>`
    : `<label>列表月份 <input class="input" type="month" min="1900-01" max="2199-12" value="${view.importMonth || view.month}" data-import-month></label>`
}

function previewPanel() {
  const preview = view.preview
  if (!preview) return ''
  const rows = preview.rows.filter(row => view.previewFilter === 'all' || (view.previewFilter === 'ready' ? row.status === 'ready' : row.status !== 'ready'))
  const period = preview.importType === 'ANNUAL' ? `${preview.period.year}年度` : '月度计划（入段日期不限制月份）'
  const displayValue = (row, label, normalized) => {
    const value = row.status === 'ready' ? normalized : row.raw?.[label]
    return value == null || value === '' ? '未填写' : value
  }
  return `<section class="card pc-plan-preview" aria-labelledby="pc-preview-title">
    <div class="pc-plan-preview-head"><div><h2 id="pc-preview-title">导入预览 · ${esc(preview.filename || '计划文件')}</h2><p role="status">${period} · 共${preview.total}行，可导入${preview.importable}行，错误${preview.errors}行。预览有效期15分钟，确认前不会写入业务数据。</p></div><button type="button" class="btn" data-cancel-preview>取消预览</button></div>
    ${preview.warnings?.length ? `<p class="pc-plan-warning">${preview.warnings.map(esc).join('；')}</p>` : ''}
    <div class="pc-plan-preview-tools"><div class="pc-plan-filters"><button type="button" class="btn btn-sm ${view.previewFilter === 'all' ? 'is-active' : ''}" data-preview-filter="all">全部 ${preview.total}</button><button type="button" class="btn btn-sm ${view.previewFilter === 'ready' ? 'is-active' : ''}" data-preview-filter="ready">可导入 ${preview.importable}</button><button type="button" class="btn btn-sm ${view.previewFilter === 'errors' ? 'is-active' : ''}" data-preview-filter="errors">错误 ${preview.errors}</button></div>${preview.errors ? `<button type="button" class="btn btn-sm" data-download-errors>下载错误明细</button>` : ''}</div>
    <div class="pc-plan-preview-table"><table><thead><tr><th>源行</th><th>机车编号</th><th>机型 / 修程</th><th>修次</th><th>计划入段</th><th>配属局 / 段</th><th>公里数</th><th>备注</th><th>错误字段</th><th>错误原因</th></tr></thead><tbody>${rows.map(row => `<tr class="${row.status === 'ready' ? '' : 'has-error'}"><td>${row.line}</td><td>${esc(displayValue(row, '机车编号', row.data.locomotiveNo))}</td><td>${esc(displayValue(row, '机型', row.data.modelName))} / ${esc(displayValue(row, '修程', row.data.repairProgramName))}</td><td>${esc(displayValue(row, '修次', row.data.repairSequence))}</td><td>${esc(displayValue(row, '计划入段日期', row.data.plannedEntryAt))}</td><td>${esc(displayValue(row, '配属局', row.data.ownerBureau))} / ${esc(displayValue(row, '配属段', row.data.ownerDepot))}</td><td>${esc(displayValue(row, '累计走行公里', row.data.mileageKm))}</td><td>${esc(displayValue(row, '备注', row.data.remark))}</td><td>${row.status === 'ready' ? '—' : esc(row.errors.map(error => error.field).join('；'))}</td><td>${row.status === 'ready' ? '通过' : `${esc(row.errors.map(error => error.message).join('；'))}${row.warnings?.map(warning => `<div class="pc-plan-warning">${esc(warning)}</div>`).join('') || ''}`}</td></tr>`).join('') || '<tr><td colspan="10" class="pc-plan-empty">当前筛选没有记录</td></tr>'}</tbody></table></div>
    <div class="pc-plan-preview-footer"><span>单击确认后仅保存通过校验的完整记录；错误行不会写入。</span><button type="button" class="btn btn-primary" data-confirm-import ${!preview.importable || view.busy ? 'disabled' : ''}>${view.busy ? '正在提交…' : `确认导入${preview.importable}条`}</button></div>
  </section>`
}

function detailDrawer() {
  const vehicle = view.detail
  if (!vehicle && view.detailLoading) return `<div class="pc-plan-drawer-backdrop"><aside class="pc-plan-drawer" role="dialog" aria-modal="true" aria-labelledby="pc-vehicle-detail-title"><div class="pc-plan-drawer-head"><div><span>车辆检修详情</span><h2 id="pc-vehicle-detail-title">正在加载…</h2></div></div><p role="status">正在从数据库加载车辆详情…</p></aside></div>`
  if (!vehicle) return ''
  const value = item => item == null || item === '' ? '未填写' : esc(item)
  const source = vehicle.planSource === 'ANNUAL' ? '年度计划' : vehicle.planSource === 'MONTHLY' ? '月度计划' : value(vehicle.planSource)
  return `<div class="pc-plan-drawer-backdrop" data-close-drawer><aside class="pc-plan-drawer" role="dialog" aria-modal="true" aria-labelledby="pc-vehicle-detail-title"><div class="pc-plan-drawer-head"><div><span>车辆检修详情</span><h2 id="pc-vehicle-detail-title">${esc(vehicle.locomotiveNo)}</h2></div><button type="button" class="btn" data-close-detail aria-label="关闭车辆详情">关闭</button></div><dl>
    <div><dt>机型</dt><dd>${value(vehicle.modelName)}</dd></div><div><dt>修程</dt><dd>${value(vehicle.repairProgramName)}</dd></div><div><dt>修次</dt><dd>${vehicle.repairSequence == null ? '未填写' : esc(vehicle.repairSequence)}</dd></div><div><dt>状态</dt><dd>${esc(statusLabel(vehicle))}</dd></div><div><dt>配属局</dt><dd>${value(vehicle.ownerBureau)}</dd></div><div><dt>配属段</dt><dd>${value(vehicle.ownerDepot)}</dd></div><div><dt>累计走行公里</dt><dd>${vehicle.mileageKm == null ? '未填写' : `${esc(vehicle.mileageKm)} km`}</dd></div><div><dt>计划入段</dt><dd>${value(vehicle.entryDate)}</dd></div><div><dt>预计出段</dt><dd>${vehicle.confirmedExitDate ? esc(vehicle.confirmedExitDate) : vehicle.versionStatus === 'CURRENT' ? '暂无预计出段' : '尚未正式排程'}</dd></div><div><dt>计划来源</dt><dd>${source}</dd></div><div class="is-wide"><dt>备注</dt><dd>${value(vehicle.remark)}</dd></div>
    </dl></aside></div>`
}

function toolbar() {
  return `<div class="pc-plan-toolbar"><div class="pc-plan-month-nav"><button type="button" class="btn" data-month-step="-1" aria-label="上个月">‹</button><input class="input" type="month" min="1900-01" max="2199-12" value="${view.month}" data-calendar-month><button type="button" class="btn" data-month-step="1" aria-label="下个月">›</button><button type="button" class="btn" data-today>回到今天</button></div><div class="pc-plan-filterbar"><label>机型<select class="select" data-filter-model><option value="">全部机型</option>${view.lookups.models.map(model => `<option value="${model.id}" ${String(view.filter.modelId) === String(model.id) ? 'selected' : ''}>${esc(model.name)}</option>`).join('')}</select></label><label>修程<select class="select" data-filter-program><option value="">全部修程</option>${view.lookups.programs.filter(program => !view.filter.modelId || String(program.modelId) === String(view.filter.modelId)).map(program => `<option value="${program.id}" ${String(view.filter.programId) === String(program.id) ? 'selected' : ''}>${esc(program.name)}</option>`).join('')}</select></label><label>车辆编号<input class="input" type="search" maxlength="64" value="${esc(view.filter.locomotiveNo)}" placeholder="输入编号筛选" data-filter-locomotive></label></div></div>`
}

function mainCalendar() {
  if (view.loading) return '<section class="card pc-plan-loading" role="status">正在从数据库加载检修计划…</section>'
  if (view.error) return `<section class="card pc-plan-load-error" role="alert"><strong>数据库查询失败</strong><p>${esc(view.error)}</p><button type="button" class="btn" data-retry>重试</button></section>`
  return `${view.rows.length ? '' : '<p class="pc-plan-empty-notice" role="status">当前日历范围内暂无匹配的检修计划。</p>'}<section class="pc-plan-layout"><div class="card pc-plan-calendar-card"><div class="pc-plan-panel-head"><div><h2>${esc(view.month)} 检修计划</h2><p>计划入段与 CURRENT 正式排程预计出段</p></div><div class="pc-plan-legend"><span><i class="is-entry"></i>蓝色：计划入段</span><span><i class="is-exit"></i>绿色：预计出段</span></div></div>${calendarHtml()}</div><aside class="card pc-plan-day-card"><div class="pc-plan-panel-head"><div><h2>当日详情</h2><p>${esc(view.day || '选择日期')}</p></div></div>${dayPanel()}</aside></section>`
}

function plansList() {
  if (view.loading) return '<section class="card pc-plan-loading" role="status">正在从数据库加载计划…</section>'
  if (view.error) return `<section class="card pc-plan-load-error" role="alert"><strong>数据库查询失败</strong><p>${esc(view.error)}</p><button type="button" class="btn" data-retry>重试</button></section>`
  return `<section class="card pc-plan-records"><div class="pc-plan-panel-head"><div><h2>计划记录</h2><p>${esc(view.importMonth || view.month)} 入段计划，共${view.planRows.length}条</p></div></div><div class="pc-plan-preview-table"><table><thead><tr><th>机车编号</th><th>机型</th><th>修程</th><th>修次</th><th>计划入段</th><th>来源</th><th>状态</th><th>配属局 / 段</th></tr></thead><tbody>${view.planRows.map(row => `<tr><td>${esc(row.locomotiveNo)}</td><td>${esc(row.modelName)}</td><td>${esc(row.repairProgramName)}</td><td>${esc(row.repairSequence ?? '未填写')}</td><td>${esc(row.entryDate || '未填写')}</td><td>${row.planSource === 'ANNUAL' ? '年度计划' : row.planSource === 'MONTHLY' ? '月度计划' : esc(row.planSource || '未填写')}</td><td>${esc(statusLabel(row))}</td><td>${esc([row.ownerBureau,row.ownerDepot].filter(Boolean).join(' / ') || '未填写')}</td></tr>`).join('') || '<tr><td colspan="8" class="pc-plan-empty">当前期间暂无计划记录。</td></tr>'}</tbody></table></div></section>`
}

function manualForm() {
  if (!view.manualOpen) return ''
  return `<section class="card pc-plan-manual"><div class="pc-plan-panel-head"><div><h2>手动新建计划</h2><p>保存前仍会经过与文件导入相同的校验和确认。</p></div><button type="button" class="btn" data-close-manual>收起</button></div><div class="pc-plan-manual-grid">
    <label>机车编号<input class="input" maxlength="64" data-manual-loco></label>
    <label>机型<select class="select" data-manual-model><option value="">请选择机型</option>${view.lookups.models.map(row=>`<option value="${esc(row.name)}">${esc(row.name)}</option>`).join('')}</select></label>
    <label>修程<select class="select" data-manual-program><option value="">请选择修程</option>${view.lookups.programs.map(row=>`<option value="${esc(row.name)}" data-model-id="${row.modelId}">${esc(row.name)}</option>`).join('')}</select></label>
    <label>修次（选填）<input class="input" type="number" min="1" step="1" data-manual-sequence></label>
    <label>计划入段日期<input class="input" type="date" data-manual-date></label>
    <label>配属局（选填）<input class="input" data-manual-bureau></label>
    <label>配属段（选填）<input class="input" data-manual-depot></label>
    <label>累计走行公里（选填）<input class="input" type="number" min="0" step="0.1" data-manual-mileage></label>
    <label class="is-wide">备注（选填）<input class="input" data-manual-remark></label>
  </div><button type="button" class="btn btn-primary" data-manual-preview ${view.busy?'disabled':''}>校验并预览</button></section>`
}

function setMessage(message, kind = 'info') {
  view.message = message ? { text: message, kind } : null
}

async function loadData(mode = 'calendar') {
  view.loading = true; view.error = ''
  try {
    const lookups = await api('/api/planning/lookups')
    view.lookups = lookups
    if (mode === 'calendar') {
      const bounds = monthBounds(view.month), params = new URLSearchParams({ ...bounds, ...view.filter })
      const result = await api(`/api/planning/calendar?${params}`)
      view.rows = result.vehicles
    } else {
      const month = view.importMonth || view.month
      const from = view.importType === 'ANNUAL' ? `${view.annualYear || month.slice(0, 4)}-01-01` : `${month}-01`
      const to = view.importType === 'ANNUAL' ? `${view.annualYear || month.slice(0, 4)}-12-31` : monthEnd(month)
      const params = new URLSearchParams({ from, to, ...view.filter, planSource: view.importType })
      const result = await api(`/api/planning/plans?${params}`)
      view.planRows = result.vehicles
    }
  } catch (error) { view.error = error.message }
  finally { view.loading = false; view.loadedMode = mode }
}

function render(ctx, mode = 'calendar') {
  const isCalendar = mode === 'calendar'
  const actions = isCalendar
    ? ''
    : `<div class="pc-plan-actions"><div class="pc-plan-import-controls"><label>导入类型<select class="select" data-import-type><option value="MONTHLY" ${view.importType === 'MONTHLY' ? 'selected' : ''}>月度计划</option><option value="ANNUAL" ${view.importType === 'ANNUAL' ? 'selected' : ''}>年度计划</option></select></label>${periodControl()}<button type="button" class="btn btn-primary" data-start-import ${view.busy ? 'disabled' : ''}>导入计划文件</button><button type="button" class="btn" data-open-manual>手动新建</button></div><div class="pc-plan-template-controls"><a class="btn" href="/api/planning/import/template.xlsx">下载 XLSX 模板</a><a class="btn" href="/api/planning/import/template.csv">下载 CSV 模板</a><a class="btn" href="/api/planning/import/example.md" target="_blank" rel="noreferrer">查看导入示例</a></div></div>`
  const title = isCalendar ? '月度计划日历查询' : '月度计划同步与编制'
  const description = isCalendar ? '按月查询计划入段与正式排程预计出段，查看当日计划及车辆详情。' : '导入或手动新建年度、月度检修计划，校验后确认新增；本页展示导入期间的计划记录。'
  return `<div class="pc-planning pc-plan-page">${pageHeader(title, description, actions)}
    <input type="file" accept=".xlsx,.xls,.csv" data-plan-file hidden aria-label="选择年度或月度计划文件">
    <p class="pc-plan-message ${view.message?.kind === 'error' ? 'is-error' : view.message?.kind === 'success' ? 'is-success' : ''}" role="status">${esc(view.message?.text || '')}</p>
    ${view.result ? `<section class="card pc-plan-result" role="status"><strong>导入已提交</strong><span>新增${view.result.imported}条，未导入${view.result.notImported}条。</span><button type="button" class="btn btn-sm" data-dismiss-result>关闭结果</button></section>` : ''}
    ${isCalendar ? `${toolbar()}${mainCalendar()}${detailDrawer()}` : `${manualForm()}${previewPanel()}${plansList()}`}</div>`
}

async function refresh(ctx, mode = 'calendar') { await loadData(mode); ctx.rerender(false) }

function selectCalendarDay(ctx, day) {
  view.day = day
  view.detail = null
  if (!day.startsWith(view.month)) {
    view.month = day.slice(0, 7)
    view.loading = true
    view.error = ''
    ctx.rerender(false)
    return
  }
  document.querySelectorAll('.pc-plan-day.is-selected').forEach(cell => cell.classList.remove('is-selected'))
  document.querySelectorAll('.pc-plan-day-number').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.selectDay === day)))
  document.querySelectorAll('.pc-plan-day[data-calendar-day]').forEach(cell => cell.setAttribute('aria-pressed', String(cell.dataset.calendarDay === day)))
  document.querySelector(`.pc-plan-day-number[data-select-day="${day}"]`)?.closest('.pc-plan-day')?.classList.add('is-selected')
  const heading = document.querySelector('.pc-plan-day-card .pc-plan-panel-head p')
  if (heading) heading.textContent = day
  const panel = document.querySelector('.pc-plan-day-panel')
  if (panel) panel.outerHTML = dayPanel()
}

async function openVehicle(ctx, id, day) {
  if (day) {
    view.day = day
    if (!day.startsWith(view.month)) { view.month = day.slice(0, 7); view.loading = true; view.error = '' }
  }
  view.detailLoading = true; view.detail = null
  ctx.rerender(false)
  try { view.detail = await api(`/api/planning/vehicles/${encodeURIComponent(id)}`) }
  catch (error) { setMessage(error.message, 'error') }
  finally { view.detailLoading = false; ctx.rerender(false) }
}

function renderMount(ctx, mode = 'calendar') {
  const isCalendar = mode === 'calendar'
  document.querySelector('[data-open-manual]')?.addEventListener('click', () => { view.manualOpen = true; ctx.rerender(false) })
  document.querySelector('[data-close-manual]')?.addEventListener('click', () => { view.manualOpen = false; ctx.rerender(false) })
  document.querySelector('[data-manual-model]')?.addEventListener('change', event => {
    const modelId = view.lookups.models.find(row => row.name === event.target.value)?.id
    const select = document.querySelector('[data-manual-program]')
    if (!select) return
    select.value = ''
    for (const option of select.options) if (option.value) option.hidden = modelId != null && Number(option.dataset.modelId) !== Number(modelId)
  })
  document.querySelector('[data-manual-preview]')?.addEventListener('click', async () => {
    const value = selector => document.querySelector(selector)?.value || ''
    const row = [value('[data-manual-loco]'), value('[data-manual-model]'), value('[data-manual-program]'), value('[data-manual-sequence]'), value('[data-manual-date]'), value('[data-manual-bureau]'), value('[data-manual-depot]'), value('[data-manual-mileage]'), value('[data-manual-remark]')]
    const fields = ['机车编号','机型','修程','修次','计划入段日期','配属局','配属段','累计走行公里','备注']
    const csv = `\uFEFF${[fields,row].map(items=>items.map(item=>`"${String(item).replaceAll('"','""')}"`).join(',')).join('\r\n')}\r\n`
    const bytes = new TextEncoder().encode(csv); let binary = ''
    for (let offset=0; offset<bytes.length; offset+=0x8000) binary += String.fromCharCode(...bytes.subarray(offset,offset+0x8000))
    view.busy = true; setMessage('正在校验手动录入内容…'); ctx.rerender(false)
    try {
      const preview = await api('/api/planning/import/preview', { method:'POST', body:JSON.stringify({ filename:'手动新建计划.csv', contentBase64:btoa(binary), importType:view.importType, year:document.querySelector('[data-annual-year]')?.value || view.annualYear || view.month.slice(0,4), month:document.querySelector('[data-import-month]')?.value || view.importMonth || view.month }) })
      preview.filename = '手动新建计划'
      view.preview = preview; view.previewFilter = 'all'; setMessage('已生成手动录入预览；确认前不会写入数据库。')
    } catch (error) { setMessage(error.message, 'error') }
    finally { view.busy = false; ctx.rerender(false) }
  })
  document.querySelector('[data-import-type]')?.addEventListener('change', event => {
    view.importType = event.target.value
    if (view.importType === 'ANNUAL') view.annualYear ||= view.month.slice(0, 4)
    else view.importMonth ||= view.month
    ctx.rerender(false)
  })
  document.querySelector('[data-annual-year]')?.addEventListener('change', event => { view.annualYear = event.target.value })
  document.querySelector('[data-import-month]')?.addEventListener('change', event => { view.importMonth = event.target.value })
  document.querySelector('[data-start-import]')?.addEventListener('click', () => document.querySelector('[data-plan-file]').click())
  document.querySelector('[data-plan-file]')?.addEventListener('change', async event => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    view.busy = true; view.preview = null; setMessage(`正在上传并校验 ${file.name}…`); ctx.rerender(false)
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('文件不得超过5MB')
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
      const preview = await api('/api/planning/import/preview', { method: 'POST', body: JSON.stringify({ filename: file.name, contentBase64: btoa(binary), importType: view.importType, year: document.querySelector('[data-annual-year]')?.value || view.annualYear, month: document.querySelector('[data-import-month]')?.value || view.importMonth || view.month }) })
      preview.filename = file.name
      view.preview = preview; view.previewFilter = 'all'; setMessage('文件已校验；当前仍为预览，尚未写入数据库。')
    } catch (error) { setMessage(error.message, 'error') }
    finally { view.busy = false; if (input.isConnected) input.value = ''; ctx.rerender(false) }
  })
  document.querySelector('[data-import-month]')?.addEventListener('change', event => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) { view.importMonth = event.target.value; refresh(ctx, 'plans') } })
  document.querySelector('[data-annual-year]')?.addEventListener('change', event => { if (/^\d{4}$/.test(event.target.value)) { view.annualYear = event.target.value; view.importMonth = `${event.target.value}-01`; refresh(ctx, 'plans') } })
  if (!isCalendar) {
    document.querySelector('[data-retry]')?.addEventListener('click', () => refresh(ctx, 'plans'))
  }
  document.querySelector('[data-calendar-month]')?.addEventListener('change', event => {
    if (!event.target.validity.valid || !/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) return
    view.month = event.target.value; view.day = `${view.month}-01`; refresh(ctx, 'calendar')
  })
  document.querySelectorAll('[data-month-step]').forEach(button => button.addEventListener('click', () => {
    const [year, month] = view.month.split('-').map(Number), moved = new Date(Date.UTC(year, month - 1 + Number(button.dataset.monthStep), 1))
    const value = `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}`
    if (value >= '1900-01' && value <= '2199-12') { view.month = value; view.day = `${value}-01`; refresh(ctx, 'calendar') }
  }))
  document.querySelector('[data-today]')?.addEventListener('click', () => { view.month = today().slice(0, 7); view.day = today(); refresh(ctx, 'calendar') })
  document.querySelector('[data-filter-model]')?.addEventListener('change', event => { view.filter.modelId = event.target.value; view.filter.programId = ''; refresh(ctx, 'calendar') })
  document.querySelector('[data-filter-program]')?.addEventListener('change', event => { view.filter.programId = event.target.value; refresh(ctx, 'calendar') })
  document.querySelector('[data-filter-locomotive]')?.addEventListener('change', event => { view.filter.locomotiveNo = event.target.value.trim(); refresh(ctx, 'calendar') })
  document.querySelector('.pc-plan-layout')?.addEventListener('click', event => {
    const vehicleButton = event.target.closest('[data-open-vehicle]')
    if (vehicleButton) { openVehicle(ctx, vehicleButton.dataset.openVehicle, vehicleButton.dataset.eventDay); return }
    const dayButton = event.target.closest('[data-select-day]')
    if (dayButton) { selectCalendarDay(ctx, dayButton.dataset.selectDay); return }
    const dayCell = event.target.closest('[data-calendar-day]')
    if (dayCell) selectCalendarDay(ctx, dayCell.dataset.calendarDay)
  })
  document.querySelector('.pc-plan-layout')?.addEventListener('keydown', event => {
    const dayCell = event.target.closest('[data-calendar-day]')
    if (dayCell && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      selectCalendarDay(ctx, dayCell.dataset.calendarDay)
    }
  })
  document.querySelector('[data-close-detail]')?.addEventListener('click', () => { view.detail = null; ctx.rerender(false) })
  document.querySelector('[data-close-drawer]')?.addEventListener('click', event => { if (event.target === event.currentTarget) { view.detail = null; ctx.rerender(false) } })
  document.querySelectorAll('[data-preview-filter]').forEach(button => button.addEventListener('click', () => { view.previewFilter = button.dataset.previewFilter; ctx.rerender(false) }))
  document.querySelector('[data-cancel-preview]')?.addEventListener('click', async () => {
    if (!view.preview) return
    try { await api(`/api/planning/import/preview/${encodeURIComponent(view.preview.id)}`, { method: 'DELETE' }) }
    catch (error) { setMessage(error.message, 'error') }
    view.preview = null; ctx.rerender(false)
  })
  document.querySelector('[data-download-errors]')?.addEventListener('click', async () => {
    try {
      const response = await api(`/api/planning/import/${encodeURIComponent(view.preview.id)}/errors.csv`)
      const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = '检修计划导入错误明细.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { setMessage(error.message, 'error'); ctx.rerender(false) }
  })
  document.querySelector('[data-confirm-import]')?.addEventListener('click', async event => {
    if (!view.preview || view.busy || !view.preview.importable) return
    view.busy = true; event.currentTarget.disabled = true
    try {
      const result = await api('/api/planning/import/confirm', { method: 'POST', body: JSON.stringify({ previewId: view.preview.id }) })
      if (result.changed) {
        view.preview = { ...result.preview, filename: view.preview.filename }; setMessage('数据库出现新的计划冲突；数据未写入，请复核更新后的预览。', 'error'); ctx.rerender(false); return
      }
      view.result = result; view.preview = null; setMessage('导入已提交到数据库。', 'success')
      const target = view.importType === 'ANNUAL' ? `${view.annualYear || view.month.slice(0, 4)}-01` : (view.importMonth || view.month)
      view.month = target
      await Promise.all([ctx.demoPersistence?.load?.(), loadData(mode)])
      ctx.rerender(false)
    } catch (error) { setMessage(`提交失败：${error.message}。请核对数据库状态后再重试。`, 'error'); ctx.rerender(false) }
    finally { view.busy = false; ctx.rerender(false) }
  })
  document.querySelector('[data-dismiss-result]')?.addEventListener('click', () => { view.result = null; ctx.rerender(false) })
}

function page(mode) {
  return {
  render: ctx => render(ctx, mode),
  mount(ctx) {
    renderMount(ctx, mode)
    if ((view.loading || view.loadedMode !== mode) && !view.loadingRequest) {
      view.loadingRequest = true
      loadData(mode).then(() => { view.loadingRequest = false; ctx.rerender(false) })
    }
    if (view.preview) {
      const id = view.preview.id
      window.addEventListener('pagehide', () => fetch(`/api/planning/import/preview/${encodeURIComponent(id)}`, { method: 'DELETE', keepalive: true }).catch(() => {}), { once: true })
    }
  },
  }
}
export const plansPage = page('plans')
export const calendarPage = page('calendar')
