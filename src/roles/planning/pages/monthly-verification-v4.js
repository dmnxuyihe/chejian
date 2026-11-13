import { pageHeader, statCard } from '../../../shared/templates.js'
import { escapeHtml as esc } from '../../../core/ui.js'

const today=new Date()
const view={year:String(today.getFullYear()),month:String(today.getMonth()+1).padStart(2,'0'),depots:[],modelIds:[],programIds:[],keyword:'',repairSequence:'',publicationStatus:'',hidden:new Set(),tableCollapsed:false}
const colors=['#2563eb','#0f9f6e','#f59e0b','#8b5cf6','#ef4444','#0891b2']
const tabs=()=>`<nav class="plan-view-tabs plan-switch-tabs" aria-label="月度计划查看方式"><a href="#/functions/plans/monthly-calendar">计划日历</a><a class="active" aria-current="page">交验统计</a></nav>`
const multi=(name,label,options,selected)=>`<div class="pc-chip-select" data-chip-select="${name}"><button type="button" class="pc-chip-control" data-chip-toggle="${name}"><span class="pc-chip-placeholder">${selected.length?'':`请选择${label}`}</span>${selected.map(value=>{const item=options.find(x=>String(x.value)===String(value));return item?`<span class="pc-filter-chip">${esc(item.label)}<i role="button" aria-label="移除${esc(item.label)}" data-chip-remove="${name}" data-chip-value="${esc(value)}">×</i></span>`:''}).join('')}<b>⌄</b></button><div class="pc-chip-menu" data-chip-menu="${name}" hidden>${options.map(item=>`<label><input type="checkbox" value="${esc(item.value)}" ${selected.includes(String(item.value))?'checked':''}>${esc(item.label)}</label>`).join('')}</div></div>`
const planDate=(state,v)=>String((state.schedules||[]).filter(x=>x.vehicleRepairId===v.id&&x.versionId===v.currentVersionId&&x.status!=='CANCELLED').map(x=>x.plannedEndAt).filter(Boolean).sort().at(-1)||v.plannedExitAt||v.plannedEntryAt||'').slice(0,10)
function source(state){const records=new Map([...(state.monthlyVerificationRecords||[])].sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id).map(x=>[x.vehicleRepairId,x]));const prefix=view.month?`${view.year}-${view.month}`:String(view.year);return(state.vehicleRepairs||[]).filter(v=>v.planSource!=='ANNUAL').map(vehicle=>{const r=records.get(vehicle.id);return{vehicle,date:r?.date||planDate(state,vehicle),depot:r?.depot||vehicle.ownerDepot||'未填写委修段',result:r?.result||'PENDING',isPublished:vehicle.approvalStatus==='PUBLISHED'}}).filter(x=>x.date.startsWith(prefix))}
function curve(points){let d=`M ${points[0][0]} ${points[0][1]}`;for(let i=1;i<points.length;i++){const[a,b]=points[i-1],[c,e]=points[i],m=(a+c)/2;d+=` C ${m} ${b}, ${m} ${e}, ${c} ${e}`}return d}
function chart(rows){if(!rows.length)return'<p class="empty" data-published-count="0">本月暂无已发布的安排交验车辆。</p>';const dayCount=new Date(Number(view.month.slice(0,4)),Number(view.month.slice(5)),0).getDate(),days=Array.from({length:dayCount},(_,i)=>i+1),depots=[...new Set(rows.map(x=>x.depot))],active=depots.filter(x=>!view.hidden.has(x)),n=(d,p)=>rows.filter(x=>Number(x.date.slice(-2))===d&&x.depot===p).length,max=Math.max(1,...days.flatMap(d=>active.map(p=>n(d,p)))),px=d=>48+(d-1)*900/(dayCount-1),py=v=>220-v*170/max;const lines=active.map(p=>{const i=depots.indexOf(p),color=colors[i%colors.length],pts=days.map(d=>[px(d),py(n(d,p))]);return`<path d="${curve(pts)}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"/>${days.map((d,j)=>n(d,p)?`<circle cx="${pts[j][0]}" cy="${pts[j][1]}" r="5" fill="${color}"/>`:'').join('')}`}).join('');return`<div class="pc-delivery-chart" data-published-count="${rows.length}"><div class="pc-delivery-legend">${depots.map((p,i)=>`<button type="button" class="${view.hidden.has(p)?'is-off':''}" data-toggle-depot="${esc(p)}"><i style="background:${colors[i%colors.length]}"></i>${esc(p)}</button>`).join('')}</div><div class="pc-delivery-plot"><svg viewBox="0 0 1000 255" role="img" aria-label="各委修段月度交验趋势"><line x1="48" y1="220" x2="948" y2="220" stroke="var(--line)"/>${[...new Set([1,5,10,15,20,25,dayCount])].map(d=>`<text x="${px(d)}" y="246" text-anchor="middle">${d}日</text>`).join('')}${lines}<line class="pc-chart-hover-line" data-delivery-guide x1="48" y1="18" x2="48" y2="220" hidden/><text class="pc-chart-hover-label" data-delivery-guide-label x="48" y="14" text-anchor="middle" hidden></text>${days.map(d=>`<rect data-trend-day="${d}" data-trend-x="${px(d)}" x="${px(d)-15}" y="18" width="30" height="205" fill="transparent"/>`).join('')}</svg><div class="pc-delivery-tooltip" data-delivery-tooltip hidden></div></div></div>`}
function table(rows,state){return`<div class="plan-record-table table-wrap"><table class="pc-monthly-plan-table pc-monthly-verification-table"><thead><tr><th>机型</th><th>机号</th><th>配属局</th><th>配属段</th><th>修程</th><th>修次</th><th>交验日期</th><th>状态</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(state.locomotiveModels?.find(m=>m.id===state.repairPrograms?.find(p=>p.id===x.vehicle.repairProgramId)?.modelId)?.name||'-')}</td><td><strong class="plan-car-no">${esc(x.vehicle.locomotiveNo)}</strong></td><td>${esc(x.vehicle.ownerBureau||'-')}</td><td>${esc(x.depot)}</td><td>${esc(state.repairPrograms?.find(p=>p.id===x.vehicle.repairProgramId)?.name||'-')}</td><td>第${esc(x.vehicle.repairSequence||1)}次</td><td class="date-cell">${esc(x.date)}</td><td><span class="plan-status ${x.isPublished?'is-published':'is-pending'}">${x.isPublished?'已发布':'未发布'}</span></td></tr>`).join('')||'<tr><td colspan="8" class="empty">无记录</td></tr>'}</tbody></table></div>`}
function annualAwareChart(rows) {
  const annual = !view.month
  const count = annual ? 12 : new Date(Number(view.year), Number(view.month), 0).getDate()
  const points = Array.from({ length: count }, (_, index) => index + 1)
  const depots = [...new Set(rows.map(row => row.depot))]
  const active = depots.filter(depot => !view.hidden.has(depot))
  const periodValue = row => annual ? Number(row.date.slice(5, 7)) : Number(row.date.slice(-2))
  const number = (point, depot) => rows.filter(row => periodValue(row) === point && row.depot === depot).length
  const max = Math.max(1, ...points.flatMap(point => active.map(depot => number(point, depot))))
  const x = point => 48 + (point - 1) * 900 / Math.max(1, count - 1)
  const y = value => 220 - value * 170 / max
  const label = point => annual ? `${point}月` : `${point}日`
  if (!rows.length) return `<p class="empty" data-published-count="0">${annual ? '本年度' : '本月'}暂无已发布的安排交验车辆。</p>`
  const lines = active.map(depot => {
    const index = depots.indexOf(depot)
    const color = colors[index % colors.length]
    const values = points.map(point => [x(point), y(number(point, depot))])
    return `<path d="${curve(values)}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"/>${points.map((point, pointIndex) => number(point, depot) ? `<circle cx="${values[pointIndex][0]}" cy="${values[pointIndex][1]}" r="5" fill="${color}"/>` : '').join('')}`
  }).join('')
  const tickPoints = annual ? points : [...new Set([1, 5, 10, 15, 20, 25, count])].filter(point => point <= count)
  return `<div class="pc-delivery-chart" data-published-count="${rows.length}"><div class="pc-delivery-legend">${depots.map((depot, index) => `<button type="button" class="${view.hidden.has(depot) ? 'is-off' : ''}" data-toggle-depot="${esc(depot)}"><i style="background:${colors[index % colors.length]}"></i>${esc(depot)}</button>`).join('')}</div><div class="pc-delivery-plot"><svg viewBox="0 0 1000 255" role="img" aria-label="各委修段${annual ? '年度' : '月度'}交验趋势"><line x1="48" y1="220" x2="948" y2="220" stroke="var(--line)"/>${tickPoints.map(point => `<text x="${x(point)}" y="246" text-anchor="middle">${label(point)}</text>`).join('')}${lines}<line class="pc-chart-hover-line" data-delivery-guide x1="48" y1="18" x2="48" y2="220" hidden/><text class="pc-chart-hover-label" data-delivery-guide-label x="48" y="14" text-anchor="middle" hidden/>${points.map(point => `<rect ${annual ? 'data-trend-month' : 'data-trend-day'}="${point}" data-trend-x="${x(point)}" x="${x(point) - 15}" y="18" width="30" height="205" fill="transparent"/>`).join('')}</svg><div class="pc-delivery-tooltip" data-delivery-tooltip hidden></div></div></div>`
}

function annualAwareTable(rows, state) {
  return `<div class="plan-record-table table-wrap"><table class="pc-monthly-plan-table pc-monthly-verification-table"><thead><tr><th>计划月份</th><th>机型</th><th>机号</th><th>配属局</th><th>配属段</th><th>修程</th><th>修次</th><th>交验日期</th><th>状态</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(row.date.slice(0, 7))}</td><td>${esc(state.locomotiveModels?.find(model => model.id === state.repairPrograms?.find(program => program.id === row.vehicle.repairProgramId)?.modelId)?.name || '-')}</td><td><strong class="plan-car-no">${esc(row.vehicle.locomotiveNo)}</strong></td><td>${esc(row.vehicle.ownerBureau || '-')}</td><td>${esc(row.depot)}</td><td>${esc(state.repairPrograms?.find(program => program.id === row.vehicle.repairProgramId)?.name || '-')}</td><td>第${esc(row.vehicle.repairSequence || 1)}次</td><td class="date-cell">${esc(row.date)}</td><td><span class="plan-status ${row.isPublished ? 'is-published' : 'is-pending'}">${row.isPublished ? '已发布' : '未发布'}</span></td></tr>`).join('') || '<tr><td colspan="9" class="empty">无记录</td></tr>'}</tbody></table></div>`
}

chart = annualAwareChart
table = annualAwareTable

export const monthlyVerificationPage = {
  render(ctx) {
    const raw = source(ctx.state)
    const publishedRaw = raw.filter(row => row.isPublished)
    const unpublishedCount = raw.length - publishedRaw.length
    const publishRate = raw.length ? `${Math.round(publishedRaw.length / raw.length * 100)}%` : '0%'
    const depots = [...new Set(raw.map(row => row.depot))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
    const models = [...new Map(raw.map(row => {
      const program = ctx.state.repairPrograms?.find(item => item.id === row.vehicle.repairProgramId)
      const model = ctx.state.locomotiveModels?.find(item => item.id === program?.modelId)
      return [model?.id || 0, model?.name || row.vehicle.locomotiveNo.replace(/\d+$/, '')]
    })).entries()]
    const all = raw.filter(row => {
      const program = ctx.state.repairPrograms?.find(item => item.id === row.vehicle.repairProgramId)
      const programName = program?.name || '-'
      return (!view.depots.length || view.depots.includes(row.depot)) && (!view.modelIds.length || view.modelIds.includes(String(program?.modelId || 0))) && (!view.programIds.length || view.programIds.includes(programName))
    })
    const published = all.filter(row => row.isPublished)
    const keyword = view.keyword.trim().toLowerCase()
    const rows = all.filter(row => (!keyword || row.depot.toLowerCase().includes(keyword) || row.vehicle.locomotiveNo.toLowerCase().includes(keyword)) && (!view.repairSequence || String(row.vehicle.repairSequence || '') === String(view.repairSequence)) && (!view.publicationStatus || (view.publicationStatus === 'PUBLISHED') === row.isPublished)).sort((a, b) => a.date.localeCompare(b.date) || String(a.vehicle.locomotiveNo).localeCompare(String(b.vehicle.locomotiveNo)))
    return `<section class="pc-planning pc-plan-page" data-monthly-verification>
      ${pageHeader('月度计划', '', '')}${tabs()}
      <div class="pc-plan-toolbar pc-verification-period"><div class="pc-verification-period-controls"><label>统计年份<input class="input" type="number" min="2000" max="2100" aria-label="统计年份" data-delivery-year value="${esc(view.year)}"></label><label>统计月份<select class="select" aria-label="统计月份" data-delivery-month><option value="">全年</option>${Array.from({length:12},(_,index)=>{const month=String(index+1).padStart(2,'0');return `<option value="${month}" ${view.month===month?'selected':''}>${index+1}月</option>`}).join('')}</select></label><button type="button" class="btn" data-delivery-today>回到本月</button></div></div>
      <div class="grid grid-4 pc-verification-summary">
        ${statCard(view.month ? '本月车辆总数' : '年度车辆总数', raw.length, view.month ? `${view.year}-${view.month}` : `${view.year}年全年`)}
        ${statCard('已发布车辆', publishedRaw.length, '计入交验趋势', 'metric-green')}
        ${statCard('未发布车辆', unpublishedCount, '不计入交验趋势', 'metric-indigo')}
        ${statCard('计划发布率', publishRate, `${publishedRaw.length}/${raw.length || 0} 辆`)}
      </div>
      <section class="card pc-delivery-card pc-delivery-table-card"><div class="card-title-row"><div class="card-title">交验车辆明细</div><button type="button" class="btn" data-toggle-delivery-table aria-expanded="${!view.tableCollapsed}">${view.tableCollapsed ? '展开表格' : '收起表格'}</button></div><div data-delivery-table-body ${view.tableCollapsed ? 'hidden' : ''}><div class="pc-delivery-query"><input class="input" data-delivery-keyword value="${esc(view.keyword)}" placeholder="机型机号/委修段">${multi('monthly-depot','委修段',depots.map(value=>({value,label:value})),view.depots)}${multi('monthly-model','机型',models.map(([value,label])=>({value:String(value),label})),view.modelIds)}<button class="btn btn-primary" data-delivery-search>查询列表</button></div>${table(rows,ctx.state)}</div></section><section class="card pc-delivery-card pc-delivery-chart-card"><div class="card-title-row"><div class="card-title">各委修段${view.month ? '月度' : '年度'}交验趋势</div><button class="btn" data-refresh-delivery>刷新图表</button></div>${chart(published)}</section>
    </section>`
  },
  mount(ctx) {
    const rerender = () => ctx.rerender(false)
    const setPeriod = (year, month = view.month) => {
      if (!/^\d{4}$/.test(String(year)) || (month && !/^(0[1-9]|1[0-2])$/.test(String(month)))) return
      view.year = String(year)
      view.month = month || ''
      view.depots = []
      view.modelIds = []
      view.programIds = []
      view.hidden.clear()
      rerender()
    }
    document.querySelector('[data-delivery-year]')?.addEventListener('change', event => {
      setPeriod(event.target.value, view.month)
    })
    document.querySelector('[data-delivery-month]')?.addEventListener('change', event => {
      setPeriod(view.year, event.target.value)
    })
    document.querySelector('[data-delivery-today]')?.addEventListener('click', () => {
      const now = new Date()
      setPeriod(now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'))
    })
    document.querySelector('[data-toggle-delivery-table]')?.addEventListener('click', () => {
      view.tableCollapsed = !view.tableCollapsed
      rerender()
    })
    document.querySelectorAll('[data-toggle-depot]').forEach(element => element.addEventListener('click', () => { const depot = element.dataset.toggleDepot; view.hidden.has(depot) ? view.hidden.delete(depot) : view.hidden.add(depot); rerender() }))
    document.querySelectorAll('[data-chip-toggle]').forEach(element => element.addEventListener('click', event => { if (event.target.closest('[data-chip-remove]')) return; const menu = document.querySelector(`[data-chip-menu="${element.dataset.chipToggle}"]`); menu.hidden = !menu.hidden }))
    document.querySelectorAll('[data-chip-remove]').forEach(element => element.addEventListener('click', event => { event.stopPropagation(); const key = element.dataset.chipRemove === 'monthly-depot' ? 'depots' : 'modelIds'; view[key] = view[key].filter(value => value !== element.dataset.chipValue); rerender() }))
    document.querySelector('[data-refresh-delivery]')?.addEventListener('click', rerender)
    document.querySelector('[data-delivery-search]')?.addEventListener('click', () => {
      view.keyword = document.querySelector('[data-delivery-keyword]')?.value || ''
      view.depots = [...document.querySelectorAll('[data-chip-menu="monthly-depot"] input:checked')].map(input => input.value)
      view.modelIds = [...document.querySelectorAll('[data-chip-menu="monthly-model"] input:checked')].map(input => input.value)
      rerender()
    })
    document.querySelector('[data-delivery-keyword]')?.addEventListener('keydown', event => { if (event.key === 'Enter') document.querySelector('[data-delivery-search]')?.click() })
    const tip = document.querySelector('[data-delivery-tooltip]'), plot = document.querySelector('.pc-delivery-plot'), guide = document.querySelector('[data-delivery-guide]'), guideLabel = document.querySelector('[data-delivery-guide-label]')
    const all = source(ctx.state).filter(row => { const program = ctx.state.repairPrograms?.find(item => item.id === row.vehicle.repairProgramId); return row.isPublished && (!view.depots.length || view.depots.includes(row.depot)) && (!view.modelIds.length || view.modelIds.includes(String(program?.modelId || 0))) })
    const depots = [...new Set(all.map(row => row.depot))]
    document.querySelectorAll('[data-trend-day]').forEach(element => {
      element.addEventListener('pointerenter', () => {
        const day = Number(element.dataset.trendDay), x = element.dataset.trendX, items = depots.map((depot, index) => ({ depot, index, count: all.filter(row => Number(row.date.slice(-2)) === day && row.depot === depot).length }))
        guide.setAttribute('x1', x); guide.setAttribute('x2', x); guide.hidden = false
        guideLabel.setAttribute('x', x); guideLabel.textContent = `${day}日`; guideLabel.hidden = false
        tip.innerHTML = `<strong>${esc(`${view.month}-${String(day).padStart(2,'0')}`)}</strong>${items.map(item => `<span class="${view.hidden.has(item.depot)?'is-off':''}"><i style="background:${colors[item.index%colors.length]}"></i>${esc(item.depot)}<b>${item.count}辆</b></span>`).join('')}`
        tip.hidden = false
      })
      element.addEventListener('pointermove', event => { const rect = plot.getBoundingClientRect(); tip.style.left = `${Math.min(event.clientX-rect.left+14,rect.width-210)}px`; tip.style.top = `${Math.max(8,event.clientY-rect.top-30)}px` })
      element.addEventListener('pointerleave', () => { tip.hidden = true; guide.hidden = true; guideLabel.hidden = true })
    })
    document.querySelectorAll('[data-trend-month]').forEach(element => {
      element.addEventListener('pointerenter', () => {
        const month = Number(element.dataset.trendMonth), x = element.dataset.trendX, items = depots.map((depot, index) => ({ depot, index, count: all.filter(row => Number(row.date.slice(5, 7)) === month && row.depot === depot).length }))
        guide.setAttribute('x1', x); guide.setAttribute('x2', x); guide.hidden = false
        guideLabel.setAttribute('x', x); guideLabel.textContent = `${month}月`; guideLabel.hidden = false
        tip.innerHTML = `<strong>${esc(`${view.year}-${String(month).padStart(2, '0')}`)}</strong>${items.map(item => `<span class="${view.hidden.has(item.depot) ? 'is-off' : ''}"><i style="background:${colors[item.index % colors.length]}"></i>${esc(item.depot)}<b>${item.count}辆</b></span>`).join('')}`
        tip.hidden = false
      })
      element.addEventListener('pointermove', event => { const rect = plot.getBoundingClientRect(); tip.style.left = `${Math.min(event.clientX - rect.left + 14, rect.width - 210)}px`; tip.style.top = `${Math.max(8, event.clientY - rect.top - 30)}px` })
      element.addEventListener('pointerleave', () => { tip.hidden = true; guide.hidden = true; guideLabel.hidden = true })
    })
  }
}
function enhanceVerificationFilters() {
  const query = document.querySelector('[data-monthly-verification] .pc-delivery-query')
  if (!query || query.dataset.verificationEnhanced === 'true') return
  query.dataset.verificationEnhanced = 'true'
  query.classList.add('pc-monthly-list-filters')
  const rows = [...document.querySelectorAll('.pc-monthly-verification-table tbody tr')]
    .filter(row => row.cells.length >= 9)
  const programs = [...new Set(rows.map(row => row.cells[5].textContent.trim()))].filter(Boolean)
  const programOptions = programs.map(value => ({ value, label: value }))
  const search = query.querySelector('[data-delivery-search]')
  search?.insertAdjacentHTML('beforebegin', multi('monthly-program', '修程', programOptions, view.programIds))
  search?.insertAdjacentHTML('beforebegin', '<input class="input" type="number" min="1" data-delivery-sequence placeholder="修次" aria-label="修次"><select class="select" data-delivery-publication-status aria-label="发布状态"><option value="">全部状态</option><option value="PUBLISHED">已发布</option><option value="UNPUBLISHED">未发布</option></select>')
  const sequenceInput = query.querySelector('[data-delivery-sequence]')
  const publicationStatus = query.querySelector('[data-delivery-publication-status]')
  if (sequenceInput) sequenceInput.value = view.repairSequence
  if (publicationStatus) publicationStatus.value = view.publicationStatus
  query.insertAdjacentHTML('beforeend', '<button class="btn" data-delivery-reset>重置</button>')
  query.querySelector('[data-chip-toggle="monthly-program"]')?.addEventListener('click', event => {
    if (event.target.closest('[data-chip-remove]')) return
    const menu = query.querySelector('[data-chip-menu="monthly-program"]')
    if (menu) menu.hidden = !menu.hidden
  })
  search?.addEventListener('click', () => {
    view.programIds = [...query.querySelectorAll('[data-chip-menu="monthly-program"] input:checked')].map(input => input.value)
    view.repairSequence = query.querySelector('[data-delivery-sequence]')?.value || ''
    view.publicationStatus = query.querySelector('[data-delivery-publication-status]')?.value || ''
  }, true)
  query.querySelector('[data-delivery-reset]')?.addEventListener('click', () => {
    view.programIds = []
    view.repairSequence = ''
    view.publicationStatus = ''
    query.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = false })
    query.querySelector('[data-delivery-sequence]').value = ''
    query.querySelector('[data-delivery-publication-status]').value = ''
    query.querySelector('[data-delivery-search]')?.click()
  })
  query.querySelectorAll('[data-chip-remove="monthly-program"]').forEach(remove => remove.addEventListener('click', event => {
    event.preventDefault()
    event.stopImmediatePropagation()
    const input = query.querySelector(`[data-chip-menu="monthly-program"] input[value="${CSS.escape(remove.dataset.chipValue)}"]`)
    if (input) input.checked = false
    view.programIds = view.programIds.filter(value => value !== remove.dataset.chipValue)
    query.querySelector('[data-delivery-search]')?.click()
  }, true))
  const applyTableFilter = () => {
    const selectedPrograms = view.programIds
    document.querySelectorAll('.pc-monthly-verification-table tbody tr').forEach(row => {
      if (row.cells.length < 9) return
      const sequence = row.cells[6].textContent.replace(/\D/g, '')
      const publicationStatus = row.cells[8].textContent.trim() === '已发布' ? 'PUBLISHED' : 'UNPUBLISHED'
      const matchesProgram = !selectedPrograms.length || selectedPrograms.includes(row.cells[5].textContent.trim())
      const matchesSequence = !view.repairSequence || sequence === String(view.repairSequence)
      const matchesPublication = !view.publicationStatus || publicationStatus === view.publicationStatus
      row.hidden = !(matchesProgram && matchesSequence && matchesPublication)
    })
  }
  applyTableFilter()
}

if (globalThis.MutationObserver && globalThis.document) {
  const observer = new MutationObserver(() => enhanceVerificationFilters())
  const observe = () => document.body && observer.observe(document.body, { childList: true, subtree: true })
  document.body ? observe() : document.addEventListener('DOMContentLoaded', observe, { once: true })
}
if (globalThis.document) setTimeout(enhanceVerificationFilters, 0)

// verification-page-extension-anchor
