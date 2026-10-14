import { escapeHtml } from '../core/ui.js'

const DAY = 24 * 60 * 60 * 1000

function dateValue(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function dateTime(value, endOfDay=false) {
  const d = new Date(`${value}T00:00:00`)
  if (endOfDay) d.setDate(d.getDate()+1)
  return d.getTime()
}

export function ensureGanttRange(state, key, rows, fallbackStart, fallbackEnd) {
  state.ganttFilters ||= {}
  if (!state.ganttFilters[key]) {
    const starts=rows.map(x=>new Date(x.plannedStartAt).getTime()).filter(Number.isFinite)
    const ends=rows.map(x=>new Date(x.plannedEndAt).getTime()).filter(Number.isFinite)
    const first=starts.length ? Math.min(...starts) : new Date(fallbackStart || state.demoClock).getTime()
    const last=ends.length ? Math.max(...ends) : new Date(fallbackEnd || fallbackStart || state.demoClock).getTime()
    state.ganttFilters[key]={start:dateValue(first),end:dateValue(last)}
  }
  return state.ganttFilters[key]
}

export function updateGanttRange(state, key, field, value) {
  const current=state.ganttFilters?.[key]
  if (!current || !value) return
  current[field]=value
  if (current.start>current.end) {
    if (field==='start') current.end=value
    else current.start=value
  }
}

export function resetGanttRange(state, key) {
  if (state.ganttFilters) delete state.ganttFilters[key]
}

export function rowsInGanttRange(rows, range) {
  const start=dateTime(range.start)
  const end=dateTime(range.end,true)
  return rows.filter(row=>new Date(row.plannedEndAt).getTime()>start&&new Date(row.plannedStartAt).getTime()<end)
}

function ticksFor(start, end) {
  const days=Math.max(1,Math.ceil((end-start)/DAY))
  const count=Math.min(8,days)
  return Array.from({length:count},(_,index)=>{
    const at=start+(index/count)*(end-start)
    const d=new Date(at)
    return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`
  })
}

export function renderGanttToolbar({range,count,label='范围内任务'}) {
  return `<div class="gantt-toolbar">
    <div class="gantt-date-fields">
      <div class="field field-compact"><label>开始日期</label><input class="input" type="date" value="${range.start}" data-gantt-range="start"></div>
      <div class="field field-compact"><label>结束日期</label><input class="input" type="date" value="${range.end}" data-gantt-range="end"></div>
      <button class="btn btn-sm" data-gantt-reset>恢复全部范围</button>
    </div>
    <div class="gantt-range-summary"><strong>${count}</strong><span>${escapeHtml(label)}</span></div>
  </div>`
}

export function renderGantt({rows,range,labelFor,metaFor,barClassFor=()=>'',attributesFor=()=>'',overlayFor=()=>'',emptyText='当前日期范围内没有任务'}) {
  const start=dateTime(range.start)
  const end=Math.max(start+DAY,dateTime(range.end,true))
  const span=end-start
  const pct=value=>Math.max(0,Math.min(100,((new Date(value).getTime()-start)/span)*100))
  const ticks=ticksFor(start,end)
  const sorted=[...rows].sort((a,b)=>new Date(a.plannedStartAt)-new Date(b.plannedStartAt)||a.id-b.id)
  if(!sorted.length) return `<div class="empty"><strong>${escapeHtml(emptyText)}</strong><span>请调整日期范围或切换车辆。</span></div>`
  return `<div class="gantt" data-test="gantt">
    <div class="gantt-head"><div class="gantt-label-head">任务 / 时间</div><div class="gantt-scale" style="grid-template-columns:repeat(${ticks.length},1fr)">${ticks.map(t=>`<div>${t}</div>`).join('')}</div></div>
    ${sorted.map(row=>{
      const left=pct(row.plannedStartAt),right=pct(row.plannedEndAt),width=Math.max(.7,right-left)
      return `<div class="gantt-row"><div class="gantt-task-label"><strong>${escapeHtml(labelFor(row))}</strong><span>${escapeHtml(metaFor(row))}</span></div><div class="gantt-track" style="background-size:${100/ticks.length}% 100%">${overlayFor(row,{pct,start,end})}<button class="gantt-bar ${barClassFor(row)}" style="left:${left}%;width:${width}%" ${attributesFor(row)} title="${escapeHtml(labelFor(row))}">${escapeHtml(labelFor(row))}</button></div></div>`
    }).join('')}
  </div>`
}

