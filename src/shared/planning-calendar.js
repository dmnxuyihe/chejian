import { escapeHtml as esc } from '../core/ui.js'
import { dateKey, monthDays, tasksOnDay } from '../core/planning-view.js'
import { fmtDateTime, taskOf, taskStatusLabel } from '../core/derived.js'

export const kindLabel = { formal: '正式', draft: '待确认', preview: '模拟' }

export function calendarGrid({ month, selectedDay = '', eventsForDay }) {
  return `<div class="pc-calendar-scroll"><div class="pc-calendar" aria-label="${esc(month)}检修日历">
    ${['一', '二', '三', '四', '五', '六', '日'].map(d => `<div class="pc-weekday">周${d}</div>`).join('')}
    ${monthDays(month).map(day => {
      const events = eventsForDay(day)
      return `<div class="pc-day ${day.startsWith(month) ? '' : 'pc-outside'} ${selectedDay === day ? 'pc-selected-day' : ''}">
        <button class="pc-day-number" data-pc-day="${day}" aria-label="查看${day}，${events.length}项" aria-pressed="${selectedDay === day}">${Number(day.slice(-2))}<span>${events.length ? `${events.length}项` : ''}</span></button>
        <div class="pc-day-events">${events.slice(0, 3).map(e => `<button class="pc-event pc-${e.kind}" data-pc-vehicle="${e.vehicleId}" title="${esc(e.label)}">${esc(e.label)}</button>`).join('')}
        ${events.length > 3 ? `<button class="pc-more" data-pc-day="${day}">另${events.length - 3}项 · 查看全部</button>` : ''}</div>
      </div>`
    }).join('')}
  </div></div>`
}

export function taskEvents(state, rows, day) {
  return tasksOnDay(rows, day).map(s => ({
    kind: s.planKind, vehicleId: s.vehicleRepairId,
    label: `${kindLabel[s.planKind]} · ${state.vehicleRepairs.find(v => v.id === s.vehicleRepairId)?.locomotiveNo || '车辆'} · ${taskOf(state, s.taskId)?.name || '任务'}`,
  }))
}

export function taskTable(state, rows) {
  return `<div class="table-wrap"><table class="pc-task-table"><thead><tr><th>车辆 / 工序</th><th>开始</th><th>结束</th><th>排程</th><th>进度</th></tr></thead><tbody>${rows.map(s => `<tr>
    <td><button class="pc-link" data-pc-vehicle="${s.vehicleRepairId}">${esc(state.vehicleRepairs.find(v => v.id === s.vehicleRepairId)?.locomotiveNo || '')}</button><br>${esc(taskOf(state, s.taskId)?.name || '任务')}</td>
    <td>${fmtDateTime(s.plannedStartAt)}</td><td>${fmtDateTime(s.plannedEndAt)}</td>
    <td><span class="badge ${s.planKind === 'formal' ? 'badge-green' : 'badge-amber'}">${kindLabel[s.planKind]}${s.isLocked ? ' · 锁定' : ''}</span></td>
    <td>${esc(taskStatusLabel(s.status))}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">当日暂无检修任务</td></tr>'}</tbody></table></div>`
}

export function monthlyEvents(state, vehicles, exitFor, day) {
  return vehicles.flatMap(v => {
    const events = []
    if (dateKey(v.plannedEntryAt) === day) events.push({ kind: 'entry', vehicleId: v.id, label: `入段 · ${v.locomotiveNo}` })
    if (dateKey(exitFor(state, v.id)) === day) events.push({ kind: 'exit', vehicleId: v.id, label: `已排出段 · ${v.locomotiveNo}` })
    return events
  })
}
