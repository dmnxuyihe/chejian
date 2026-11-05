import { pageHeader, statCard } from '../../../shared/templates.js'
import { escapeHtml, openModal } from '../../../core/ui.js'

const esc = escapeHtml
const currentYear = () => String(new Date().getFullYear())
const demoYear = '2026'
const pad = value => String(value).padStart(2, '0')
const demoNotice = () => ''
const view = { year: currentYear(), depots: [], modelIds: [], programId: '', detailKeyword: '', detailMonth: 'all', annualHidden: new Set(), loading: true, loadedKey: '', data: null, lookups: { models: [], programs: [] }, error: '' }
const colors = ['#2563eb', '#0f9f6e', '#f59e0b', '#8b5cf6', '#ef4444', '#0891b2', '#65a30d']
let requestToken = 0

async function loadLookups() {
  const response = await fetch('/api/planning/lookups', { cache: 'no-store' })
  if (!response.ok) throw new Error('无法读取计划字典')
  return response.json()
}

function mockSummary(rows, year) {
  const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`)
  const groups = new Map()
  for (const row of rows) {
    const key = `${row.modelName}\0${row.repairProgramName}`
    const summary = groups.get(key) || { modelName: row.modelName, repairProgramName: row.repairProgramName, values: Array(12).fill(0), total: 0 }
    const index = months.indexOf(row.entryDate.slice(0, 7))
    if (index >= 0) summary.values[index] += 1
    summary.total += 1
    groups.set(key, summary)
  }
  return { months, rows: [...groups.values()] }
}

function mockStats(rows, year) {
  const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`)
  const depots = [...new Set(rows.map(row => row.ownerDepot))]
  const series = depots.map(depot => ({ depot, values: months.map(month => rows.filter(row => row.ownerDepot === depot && row.verificationDate.startsWith(month)).length), total: rows.filter(row => row.ownerDepot === depot).length }))
  const details = []
  for (const month of months) for (const depot of depots) {
    const matches = rows.filter(row => row.ownerDepot === depot && row.verificationDate.startsWith(month))
    if (matches.length) details.push({ month, depot, count: matches.length, locomotives: matches.map(row => row.locomotiveNo) })
  }
  return { months, depots, series, details }
}

function mockAnnualData(year) {
  const selectedModel = view.lookups.models.find(row => view.modelIds.includes(String(row.id))) || view.lookups.models[0]
  const selectedProgram = view.lookups.programs.find(row => String(row.id) === String(view.programId)) || view.lookups.programs.find(row => !selectedModel || row.modelId === selectedModel.id) || view.lookups.programs[0]
  const modelName = selectedModel?.name || 'HXD1C'
  const programName = selectedProgram?.name || 'HXD1C高级修'
  const depots = ['模拟一段', '模拟二段', '模拟三段']
  const samples = [
    ['001', '01', '02', 1], ['002', '02', '03', 2], ['003', '03', '05', 1],
    ['004', '05', '07', 2], ['005', '08', '09', 3], ['006', '10', '11', 1],
  ]
  const allRows = samples.map(([suffix, entryMonth, exitMonth, depotIndex], index) => {
    const depot = depots[(depotIndex - 1) % depots.length]
    return { id: 900001 + index, locomotiveNo: `年度计划${suffix}`, modelId: selectedModel?.id || 0, modelName, repairProgramId: selectedProgram?.id || 0, repairProgramName: programName, repairSequence: index % 3 + 1, ownerDepot: depot, ownerBureau: '铁路局', entryDate: `${year}-${entryMonth}-0${(index % 8) + 1}`, plannedEntryAt: `${year}-${entryMonth}-0${(index % 8) + 1}T08:00:00`, verificationDate: `${year}-${exitMonth}-${String((index % 8) + 10).padStart(2, '0')}`, verificationSource: 'PLANNED', plannedExitDate: `${year}-${exitMonth}-${String((index % 8) + 10).padStart(2, '0')}`, actualExitDate: null, status: 'SCHEDULED', approvalStatus: 'DRAFT', planSource: 'ANNUAL', remark: '' }
  })
  const rows = allRows.filter(row => (!view.depots.length || view.depots.includes(row.ownerDepot)) && (!view.modelIds.length || view.modelIds.includes(String(row.modelId))))
  return { year: Number(year), demo: true, rows, depots, summary: mockSummary(rows, year), stats: mockStats(rows, year) }
}

async function loadAnnual(ctx) {
  const key = `${view.year}|${view.depots.join(',')}|${view.modelIds.join(',')}|${view.programId}`
  if (view.loadedKey === key && view.data) return
  const token = ++requestToken
  view.loading = true
  view.error = ''
  try {
    if (!view.lookups.models.length) view.lookups = await loadLookups()
    const params = new URLSearchParams({ year: view.year })
    if (view.programId) params.set('programId', view.programId)
    const response = await fetch(`/api/planning/annual?${params}`, { cache: 'no-store' })
    const body = await response.json()
    if (!response.ok) throw new Error(body.message || '年度计划查询失败')
    if (token !== requestToken) return
    const base = Array.isArray(body.rows) && body.rows.length ? body : String(view.year) === demoYear ? mockAnnualData(view.year) : body
    const rows = (base.rows || []).filter(row => (!view.depots.length || view.depots.includes(row.ownerDepot)) && (!view.modelIds.length || view.modelIds.includes(String(row.modelId))))
    view.data = { ...base, rows, summary:mockSummary(rows,view.year), stats:mockStats(rows,view.year) }
    view.loadedKey = key
  } catch (error) {
    if (token === requestToken) {
      view.data = String(view.year) === demoYear ? mockAnnualData(view.year) : { year:Number(view.year), rows:[], depots:[], summary:mockSummary([],view.year), stats:mockStats([],view.year) }
      view.loadedKey = key
      view.error = ''
    }
  } finally {
    if (token === requestToken) { view.loading = false; ctx.rerender(false) }
  }
}

function tabs(active) {
  return `<nav class="plan-view-tabs plan-switch-tabs" aria-label="年度检修计划视图"><a class="${active === 'plans' ? 'active' : ''}" href="#/functions/plans/annual-plan" ${active === 'plans' ? 'aria-current="page"' : ''}>年度计划</a><a class="${active === 'stats' ? 'active' : ''}" href="#/functions/plans/annual-stats" ${active === 'stats' ? 'aria-current="page"' : ''}>交验统计</a></nav>`
}

function multi(name, label, options, selected) {
  return `<div class="pc-chip-select" data-chip-select="${name}"><button type="button" class="pc-chip-control" data-chip-toggle="${name}"><span class="pc-chip-placeholder">${selected.length ? '' : `请选择${label}`}</span>${selected.map(value => { const item=options.find(option=>String(option.value)===String(value)); return item ? `<span class="pc-filter-chip">${esc(item.label)}<i role="button" aria-label="移除${esc(item.label)}" data-chip-remove="${name}" data-chip-value="${esc(value)}">×</i></span>` : '' }).join('')}<b>⌄</b></button><div class="pc-chip-menu" data-chip-menu="${name}" hidden>${options.map(item => `<label><input type="checkbox" value="${esc(item.value)}" ${selected.includes(String(item.value)) ? 'checked' : ''}>${esc(item.label)}</label>`).join('')}</div></div>`
}

function filters() {
  const programs = view.lookups.programs.filter(row => !view.modelIds.length || view.modelIds.includes(String(row.modelId)))
  return `<section class="card pc-annual-toolbar"><div class="pc-annual-filterbar">
    <label>年度<input class="input" type="number" min="1900" max="2199" value="${esc(view.year)}" data-annual-year></label>
    ${multi('annual-depot','配属段',(view.data?.depots||[]).map(depot=>({value:depot,label:depot})),view.depots)}
    ${multi('annual-model','机型',view.lookups.models.map(row=>({value:String(row.id),label:row.name})),view.modelIds)}
    <label>修程<select class="select" data-annual-program><option value="">全部修程</option>${programs.map(row => `<option value="${row.id}" ${String(view.programId) === String(row.id) ? 'selected' : ''}>${esc(row.name)}</option>`).join('')}</select></label>
    <button type="button" class="btn btn-primary" data-annual-refresh>查询</button>
  </div><p class="pc-help">当前页面查询年度来源为“年度计划”的记录，不改变计划数据。</p></section>`
}

function statusLabel(value) {
  return ({ UNSCHEDULED: '未排程', SCHEDULED: '已排程', IN_PROGRESS: '检修中', COMPLETED: '已完成', CANCELLED: '已取消', CANCELED: '已取消' })[value] || value || '未填写'
}

function verificationLabel(row) {
  return ({ ACTUAL: '实际交车', SCHEDULED: '正式排程结束', PLANNED: '计划交车' })[row.verificationSource] || '未形成交验日期'
}

function planRows() {
  const rows = view.data?.rows || []
  if (!rows.length) return '<tr><td colspan="11" class="empty">当前年度没有年度来源计划，请先导入年度计划。</td></tr>'
  return rows.map(row => `<tr><td class="mono">${esc(row.locomotiveNo)}</td><td>${esc(row.modelName)}</td><td>${esc(row.repairProgramName)}</td><td>${row.repairSequence == null ? '未填写' : esc(row.repairSequence)}</td><td>${esc(row.ownerDepot)}</td><td>${esc(row.entryDate)}</td><td>${esc(row.verificationDate || '未形成')}</td><td>${esc(verificationLabel(row))}</td><td>${esc(statusLabel(row.status))}</td><td>${esc(row.remark || '—')}</td><td><button class="btn btn-sm" data-annual-vehicle-detail="${row.id}">查看详情</button></td></tr>`).join('')
}

function summaryRows() {
  const summary = view.data?.summary
  if (!summary?.rows?.length) return '<tr><td colspan="15" class="empty">当前年度暂无可汇总的年度计划。</td></tr>'
  return summary.rows.map(row => `<tr><td>${esc(row.modelName)}</td><td>${esc(row.repairProgramName)}</td>${row.values.map(value => `<td>${value}</td>`).join('')}<td><strong>${row.total}</strong></td></tr>`).join('')
}

function plansPage() {
  const rows = view.data?.rows || []
  const scheduled = rows.filter(row => row.status === 'SCHEDULED').length
  const verified = rows.filter(row => row.verificationDate?.startsWith(String(view.year))).length
  const depots = new Set(rows.map(row => row.ownerDepot)).size
  return `<section class="pc-planning pc-plan-page pc-annual-page" data-annual-plan-page>${pageHeader('年度计划', '按年度查看年度检修计划、机型机号、修程修次及计划交验情况', `<a class="btn btn-primary" href="#/functions/plans/plan-import" data-annual-import>导入年度计划</a>`)}${tabs('plans')}${filters()}${demoNotice()}${view.error ? `<p class="pc-plan-message is-error" role="alert">${esc(view.error)}</p>` : ''}${view.loading ? '<section class="card pc-plan-loading" role="status">正在加载年度计划…</section>' : `<div class="grid grid-4 pc-annual-stats">${statCard('年度计划机车', rows.length, `${view.year}年年度来源`)}${statCard('已排程', scheduled, '已进入正式排程', 'metric-indigo')}${statCard('形成交验日期', verified, '实际/排程/计划日期', 'metric-green')}${statCard('涉及委修段', depots, '当前查询结果')}</div><section class="card"><div class="card-title-row"><div><div class="card-title">年度进车计划自动汇总</div><div class="card-subtitle">按机型、修程和月份汇总当前年度计划入段数量；年初定计划、季度调整和实际进车对比请在“计划完善与统计”中维护。</div></div><a class="btn btn-sm" href="#/planning/planning-completion">维护季度调整</a></div><div class="table-wrap pc-annual-summary-table"><table><thead><tr><th>机型</th><th>修程</th>${(view.data?.summary?.months || []).map(month => `<th>${Number(month.slice(5))}月</th>`).join('')}<th>合计</th></tr></thead><tbody>${summaryRows()}</tbody></table></div></section><section class="card"><div class="card-title-row"><div><div class="card-title">年度计划明细</div><div class="card-subtitle">支持按年度、委修段、机型和修程查询；点击右侧页签查看月度交验曲线。</div></div><span class="badge badge-blue">${rows.length} 辆</span></div><div class="table-wrap"><table><thead><tr><th>机车号</th><th>机型</th><th>修程</th><th>修次</th><th>委修段</th><th>计划入段</th><th>交验日期</th><th>日期来源</th><th>状态</th><th>备注</th><th>操作</th></tr></thead><tbody>${planRows()}</tbody></table></div></section>`}</section>`
}

function chart(data) {
  const allSeries = data?.stats?.series || []
  const series = allSeries.filter(row => !view.annualHidden.has(row.depot))
  if (!allSeries.length || !allSeries.some(row => row.values.some(value => value > 0))) return '<div class="pc-annual-empty">当前年度暂无已形成交验日期的年度计划，导入年度计划并完成排程或填写交车日期后，此处将显示曲线。</div>'
  const width = 960, height = 320, left = 54, right = 26, top = 24, bottom = 48, plotWidth = width - left - right, plotHeight = height - top - bottom
  const max = Math.max(1, ...series.flatMap(row => row.values))
  const x = index => left + index * plotWidth / 11
  const y = value => top + plotHeight - value * plotHeight / max
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = Math.round(max * (4 - index) / 4)
    const yy = top + plotHeight * index / 4
    return `<line x1="${left}" y1="${yy}" x2="${width - right}" y2="${yy}" class="pc-annual-grid-line"/><text x="${left - 10}" y="${yy + 4}" text-anchor="end" class="pc-annual-axis-label">${value}</text>`
  }).join('')
  const labels = data.stats.months.map((month, index) => `<text x="${x(index)}" y="${height - 18}" text-anchor="middle" class="pc-annual-axis-label">${Number(month.slice(5))}月</text>`).join('')
  const smoothPath = points => points.map((point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`
    const previous = points[index - 1]
    const next = points[index + 1] || point
    const control = Math.min((point.x - previous.x) * 0.35, (next.x - previous.x) * 0.18)
    return `C ${previous.x + control} ${previous.y}, ${point.x - control} ${point.y}, ${point.x} ${point.y}`
  }).join(' ')
  const lines = series.map((row, seriesIndex) => {
    const color = colors[seriesIndex % colors.length]
    const points = row.values.map((value, index) => ({ x: x(index), y: y(value), value, month: data.stats.months[index] }))
    return `<path class="pc-annual-chart-path" d="${smoothPath(points)}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><g class="pc-annual-series-points">${points.map(point => `<circle class="pc-annual-chart-point" cx="${point.x}" cy="${point.y}" r="4" fill="${color}" tabindex="0" data-chart-depot="${esc(row.depot)}" data-chart-month="${esc(point.month)}" data-chart-value="${point.value}" aria-label="${esc(row.depot)} ${esc(point.month)} ${point.value}辆"><title>${esc(row.depot)} ${esc(point.month)}：${point.value}辆</title></circle>`).join('')}</g>`
  }).join('')
  const zones = data.stats.months.map((month, index) => {
    const center = x(index), previous = index ? x(index - 1) : left, next = index < 11 ? x(index + 1) : width - right
    const zoneLeft = index ? (previous + center) / 2 : left
    const zoneRight = index < 11 ? (center + next) / 2 : width - right
    return `<rect class="pc-annual-chart-zone" x="${zoneLeft}" y="${top}" width="${zoneRight - zoneLeft}" height="${plotHeight}" fill="transparent" tabindex="0" data-chart-month-index="${index}" data-chart-month="${esc(month)}" aria-label="查看${esc(month)}全部委修段交验数量"/>`
  }).join('')
  return `<div class="pc-annual-chart-wrap"><div class="pc-delivery-legend">${allSeries.map((row,index)=>`<button type="button" class="${view.annualHidden.has(row.depot)?'is-off':''}" data-annual-toggle-depot="${esc(row.depot)}"><i style="background:${colors[index%colors.length]}"></i>${esc(row.depot)}（${row.total}辆）</button>`).join('')}</div><svg class="pc-annual-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(String(data.year))}年按委修段月度交验机车曲线图">${grid}${labels}${lines}<line class="pc-chart-hover-line" data-annual-guide x1="${left}" y1="${top}" x2="${left}" y2="${top+plotHeight}" hidden/><text class="pc-chart-hover-label" data-annual-guide-label x="${left}" y="${top-7}" text-anchor="middle" hidden></text><g class="pc-annual-chart-zones">${zones}</g></svg><div class="pc-delivery-tooltip pc-annual-chart-tooltip" role="status" aria-live="polite" hidden></div></div>`
}

function detailRows(data) {
  const keyword = view.detailKeyword.trim().toLocaleLowerCase()
  const rows = (data?.rows || []).filter(row => {
    if (!row.verificationDate?.startsWith(String(view.year))) return false
    if (view.detailMonth !== 'all' && row.verificationDate.slice(5, 7) !== view.detailMonth) return false
    if (row.ownerDepot == null) return false
    if (keyword && !`${row.locomotiveNo} ${row.ownerDepot} ${row.modelName} ${row.repairProgramName}`.toLocaleLowerCase().includes(keyword)) return false
    return true
  }).sort((a, b) => b.verificationDate.localeCompare(a.verificationDate) || a.locomotiveNo.localeCompare(b.locomotiveNo))
  if (!rows.length) return '<tr><td colspan="6" class="empty">暂无符合条件的交验明细</td></tr>'
  return rows.map(row => `<tr><td>${esc(row.verificationDate)}</td><td>${esc(row.ownerDepot)}</td><td class="mono">${esc(row.locomotiveNo)}</td><td>${esc(row.repairProgramName)}</td><td>${row.repairSequence == null ? '未填写' : esc(row.repairSequence)}</td><td><span class="pc-annual-status pc-annual-status-published">✓${esc(row.verificationSource === 'ACTUAL' ? '已交验' : row.verificationSource === 'SCHEDULED' ? '排程交验' : '计划交验')}</span></td></tr>`).join('')
}

function detailQueryBar() {
  return `<div class="pc-annual-detail-bar"><input class="input pc-annual-detail-keyword" type="search" maxlength="64" value="${esc(view.detailKeyword)}" placeholder="机型机号/委修段" data-annual-detail-keyword><select class="select" data-annual-detail-month><option value="all">全年</option>${Array.from({ length: 12 }, (_, index) => `<option value="${pad(index + 1)}" ${view.detailMonth === pad(index + 1) ? 'selected' : ''}>${index + 1}月</option>`).join('')}</select><button type="button" class="btn btn-primary" data-annual-detail-search>查询列表</button></div>`
}

function annualStatsQueryBar() {
  const programs = view.lookups.programs.filter(row => !view.modelIds.length || view.modelIds.includes(String(row.modelId)))
  return `<div class="pc-delivery-query"><input class="input" type="search" maxlength="64" value="${esc(view.detailKeyword)}" placeholder="机型机号/配属段" data-annual-detail-keyword>${multi('annual-depot','配属段',(view.data?.depots||[]).map(depot=>({value:depot,label:depot})),view.depots)}${multi('annual-model','机型',view.lookups.models.map(row=>({value:String(row.id),label:row.name})),view.modelIds)}<select class="select" data-annual-program><option value="">全部修程</option>${programs.map(row=>`<option value="${row.id}" ${String(view.programId)===String(row.id)?'selected':''}>${esc(row.name)}</option>`).join('')}</select><input class="input" type="number" min="1900" max="2199" value="${esc(view.year)}" data-annual-year><select class="select" data-annual-detail-month><option value="all">全年</option>${Array.from({length:12},(_,index)=>`<option value="${pad(index+1)}" ${view.detailMonth===pad(index+1)?'selected':''}>${index+1}月</option>`).join('')}</select><button type="button" class="btn btn-primary" data-annual-refresh>查询列表</button></div>`
}

function statsPage() {
  const rows = view.data?.rows || []
  const verified = rows.filter(row => row.verificationDate?.startsWith(String(view.year))).length
  return `<section class="pc-planning pc-plan-page pc-annual-page" data-annual-stats-page>${pageHeader('年度计划','','')}${tabs('stats')}${demoNotice()}${view.error?`<p class="pc-plan-message is-error" role="alert">${esc(view.error)}</p>`:''}${view.loading?'<section class="card pc-plan-loading" role="status">正在加载交验统计…</section>':`<section class="card pc-delivery-card pc-annual-delivery-card" data-annual-delivery-card><div class="card-title-row"><div class="card-title">各委修段年度交验趋势 &amp; 明细查询</div><button class="btn" data-annual-chart-refresh>刷新图表</button></div>${chart(view.data)}${annualStatsQueryBar()}<div class="table-wrap pc-annual-detail-table"><table><thead><tr><th>交验日期</th><th>委修段</th><th>机型机号</th><th>修程</th><th>修次</th><th>状态</th></tr></thead><tbody>${detailRows(view.data)}</tbody></table></div></section>`}</section>`
}

function bind(ctx) {
  document.querySelector('[data-annual-chart-refresh]')?.addEventListener('click', () => { view.loadedKey=''; loadAnnual(ctx) })
  document.querySelectorAll('[data-chip-toggle]').forEach(control => control.addEventListener('click', event => {
    if (event.target.closest('[data-chip-remove]')) return
    const menu = document.querySelector(`[data-chip-menu="${control.dataset.chipToggle}"]`)
    menu.hidden = !menu.hidden
  }))
  document.querySelectorAll('[data-chip-remove]').forEach(remove => remove.addEventListener('click', event => {
    event.stopPropagation()
    const key = remove.dataset.chipRemove === 'annual-depot' ? 'depots' : 'modelIds'
    view[key] = view[key].filter(value => value !== remove.dataset.chipValue)
    view.loadedKey = ''
    loadAnnual(ctx)
  }))
  document.querySelector('[data-annual-import]')?.remove()
  document.querySelector('[data-annual-import]')?.addEventListener('click',()=>sessionStorage.setItem('planning-import-context','ANNUAL'))
  document.querySelectorAll('[data-annual-vehicle-detail]').forEach(button => button.addEventListener('click', () => {
    const row = view.data?.rows?.find(item => item.id === Number(button.dataset.annualVehicleDetail))
    if (!row) return
    openModal({ title:`年度计划详情 · ${row.locomotiveNo}`, wide:true, body:`<dl class="vehicle-facts-grid">${[['机型',row.modelName],['机号',row.locomotiveNo],['配属局',row.ownerBureau],['配属段',row.ownerDepot],['修程',row.repairProgramName],['修次',row.repairSequence==null?'未填写':`第${row.repairSequence}次`],['计划入段',row.plannedEntryAt],['计划交车',row.plannedExitDate||'未填写'],['交验日期',row.verificationDate||'未形成'],['累计走行公里',row.mileageKm==null?'未填写':`${row.mileageKm} km`],['计划状态',statusLabel(row.status)],['备注',row.remark||'—']].map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`, confirmText:'知道了', cancelText:'关闭', onConfirm:()=>true })
  }))
  document.querySelectorAll('[data-annual-refresh]').forEach(button => button.addEventListener('click', () => {
    const year = document.querySelector('[data-annual-year]').value.trim()
    if (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > 2199) { view.error = '请输入1900至2199之间的有效年度'; ctx.rerender(false); return }
    view.year = year
    view.depots = [...document.querySelectorAll('[data-chip-menu="annual-depot"] input:checked')].map(option => option.value)
    view.modelIds = [...document.querySelectorAll('[data-chip-menu="annual-model"] input:checked')].map(option => option.value)
    view.programId = document.querySelector('[data-annual-program]').value
    view.detailKeyword = document.querySelector('[data-annual-detail-keyword]')?.value || view.detailKeyword
    view.detailMonth = document.querySelector('[data-annual-detail-month]')?.value || view.detailMonth
    view.loadedKey = ''
    loadAnnual(ctx)
  }))
  document.querySelector('[data-annual-program]')?.addEventListener('change', event => { view.programId = event.target.value; view.loadedKey = ''; loadAnnual(ctx) })
  document.querySelector('[data-annual-detail-search]')?.addEventListener('click', () => {
    view.detailKeyword = document.querySelector('[data-annual-detail-keyword]').value
    view.detailMonth = document.querySelector('[data-annual-detail-month]').value
    ctx.rerender(false)
  })
  const tooltip = document.querySelector('.pc-annual-chart-tooltip')
  const chartWrap = document.querySelector('.pc-annual-chart-wrap')
  const annualGuide = document.querySelector('[data-annual-guide]')
  const annualGuideLabel = document.querySelector('[data-annual-guide-label]')
  document.querySelectorAll('[data-annual-toggle-depot]').forEach(button => button.addEventListener('click', () => {
    const depot = button.dataset.annualToggleDepot
    view.annualHidden.has(depot) ? view.annualHidden.delete(depot) : view.annualHidden.add(depot)
    ctx.rerender(false)
  }))
  document.querySelectorAll('.pc-annual-chart-point').forEach(point => {
    const showTooltip = () => {
      if (!tooltip || !chartWrap) return
      const allSeries=view.data?.stats?.series||[],index=allSeries.findIndex(row=>row.depot===point.dataset.chartDepot)
      tooltip.innerHTML=`<strong>${esc(point.dataset.chartMonth)}</strong><span class="${view.annualHidden.has(point.dataset.chartDepot)?'is-off':''}"><i style="background:${colors[index%colors.length]}"></i>${esc(point.dataset.chartDepot)}<b>${point.dataset.chartValue}辆</b></span>`
      tooltip.hidden = false
      const pointBox = point.getBoundingClientRect(), wrapBox = chartWrap.getBoundingClientRect()
      tooltip.style.left = `${Math.max(8, Math.min(wrapBox.width - tooltip.offsetWidth - 8, pointBox.left - wrapBox.left - tooltip.offsetWidth / 2 + pointBox.width / 2))}px`
      tooltip.style.top = `${Math.max(8, pointBox.top - wrapBox.top - tooltip.offsetHeight - 10)}px`
    }
    const hideTooltip = () => { if (tooltip) tooltip.hidden = true }
    point.addEventListener('pointerenter', showTooltip)
    point.addEventListener('focus', showTooltip)
    point.addEventListener('pointerleave', hideTooltip)
    point.addEventListener('blur', hideTooltip)
  })
  document.querySelectorAll('.pc-annual-chart-zone').forEach(zone => {
    const showMonthTooltip = () => {
      if (!tooltip || !chartWrap) return
      const index = Number(zone.dataset.chartMonthIndex), month = view.data?.stats?.months?.[index]
      tooltip.replaceChildren()
      const title = document.createElement('strong')
      title.textContent = month ? `${month.slice(0, 4)}年${Number(month.slice(5))}月` : zone.dataset.chartMonth
      tooltip.append(title)
      for (const [seriesIndex, series] of (view.data?.stats?.series || []).entries()) {
        const line = document.createElement('span')
        if (view.annualHidden.has(series.depot)) line.className = 'is-off'
        const dot = document.createElement('i')
        dot.style.background = colors[seriesIndex % colors.length]
        const name = document.createTextNode(series.depot)
        const value = document.createElement('b')
        value.textContent = `${series.values[index] || 0}辆`
        line.append(dot, name, value)
        tooltip.append(line)
      }
      tooltip.hidden = false
      const zoneBox = zone.getBoundingClientRect(), wrapBox = chartWrap.getBoundingClientRect()
      const svgBox = chartWrap.querySelector('svg')?.getBoundingClientRect()
      const center = zoneBox.left - svgBox.left + zoneBox.width / 2
      const svgX = center / svgBox.width * 960
      annualGuide?.setAttribute('x1', svgX)
      annualGuide?.setAttribute('x2', svgX)
      if (annualGuide) annualGuide.hidden = false
      annualGuideLabel?.setAttribute('x', svgX)
      if (annualGuideLabel) { annualGuideLabel.textContent = `${index + 1}月`; annualGuideLabel.hidden = false }
      tooltip.style.left = `${Math.max(8, Math.min(wrapBox.width - tooltip.offsetWidth - 8, zoneBox.left - wrapBox.left + zoneBox.width / 2 - tooltip.offsetWidth / 2))}px`
      tooltip.style.top = `${Math.max(8, zoneBox.top - wrapBox.top + 12)}px`
    }
    const hideMonthTooltip = () => { if (tooltip) tooltip.hidden = true; if (annualGuide) annualGuide.hidden = true; if (annualGuideLabel) annualGuideLabel.hidden = true }
    zone.addEventListener('pointerenter', showMonthTooltip)
    zone.addEventListener('focus', showMonthTooltip)
    zone.addEventListener('pointerleave', hideMonthTooltip)
    zone.addEventListener('blur', hideMonthTooltip)
  })
  loadAnnual(ctx)
}

export const annualPlanPage = { render: plansPage, mount: bind }
export const annualStatsPage = { render: statsPage, mount: bind }
