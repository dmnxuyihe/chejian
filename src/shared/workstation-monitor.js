import { escapeHtml as esc } from '../core/ui.js'
import { fmtFullDateTime, taskStatusLabel } from '../core/derived.js'
import { formalVehicleTasks, taskTiming } from '../core/vehicle-operations.js'
import { mountMaintenanceRecords } from './maintenance-records.js'
import { completionRing } from './workspace-art.js'

export function durationLabel(minutes) {
  if(minutes==null || !Number.isFinite(minutes))return '未记录'
  const rounded=Math.floor(Math.max(0,minutes))
  return `${Math.floor(rounded/60)}小时${rounded%60}分`
}
export function workstationProgress(state,vehicleId,now=new Date()) {
  const rows=formalVehicleTasks(state,vehicleId)
  return state.workstations.flatMap(station=>{
    const tasks=rows.filter(row=>row.workstationId===station.id)
    if(!tasks.length)return []
    const started=tasks.filter(row=>row.actualStartAt),finished=tasks.every(row=>row.status==='COMPLETED')
    const start=started.length?Math.min(...started.map(row=>new Date(row.actualStartAt).getTime())):null
    const end=finished && tasks.every(row=>row.actualEndAt)?Math.max(...tasks.map(row=>new Date(row.actualEndAt).getTime())):new Date(now).getTime()
    const actual=tasks.map(row=>taskTiming(row,now).workMinutes).filter(value=>value!==null)
    return [{station,tasks,completed:tasks.filter(row=>row.status==='COMPLETED').length,stayMinutes:start==null?null:Math.max(0,(end-start)/60000),workMinutes:actual.length?actual.reduce((a,b)=>a+b,0):null,overdue:tasks.filter(row=>taskTiming(row,now).overdueMinutes>0).length}]
  })
}
export function renderWorkstationMonitor(state,vehicleId,selectedStation='',now=new Date()) {
  const groups=workstationProgress(state,vehicleId,now),current=groups.find(group=>String(group.station.id)===String(selectedStation))||groups[0]
  if(!current)return `<section class="card empty" data-workstation-monitor>本车尚无正式发布任务，确认并发布排程后可查看工位进度。</section>`
  const {station,tasks}=current
  const statusLabel=value=>({AVAILABLE:'可用',MAINTENANCE:'维修中',FAULT:'故障',DISABLED:'停用',BROKEN:'故障'})[value]||value
  const equipment=state.equipment.filter(row=>row.workstationId===station.id && ['MAINTENANCE','FAULT','DISABLED','BROKEN'].includes(row.status))
  return `<section class="station-monitor" data-workstation-monitor><div class="card station-monitor-intro"><div class="card-title-row"><div><h2>工位检修进度</h2><p class="pc-help">仅统计本车当前正式版本。停留从该工位首次实际开工计至全部完工，作业时长按任务累计。刷新进度按当前时间计算。</p></div><button type="button" class="btn btn-sm" data-monitor-refresh>刷新进度</button></div><div class="station-progress-list" aria-label="工位列表">${groups.map(group=>`<button type="button" class="station-progress-choice ${group===current?'is-selected':''}" data-monitor-station="${group.station.id}" aria-pressed="${group===current}"><span class="station-choice-copy"><strong>${esc(group.station.name)}</strong><span>${group.completed} / ${group.tasks.length} 项完成${group.overdue?` · ${group.overdue}项超时`:''}</span></span>${completionRing(group.completed,group.tasks.length)}<progress class="sr-only" max="${group.tasks.length}" value="${group.completed}" aria-label="${esc(group.station.name)}完成进度"></progress></button>`).join('')}</div></div><section class="card"><div class="card-title-row"><h2>${esc(station.name)}</h2><span class="badge ${current.overdue?'badge-amber':'badge-slate'}">${current.overdue?`${current.overdue}项超时未完成`:'无超时未完成任务'}</span></div><dl class="vehicle-facts-grid"><div><dt>当前工位状态</dt><dd>${esc(statusLabel(station.status))}</dd></div><div><dt>本车工位停留时长</dt><dd>${durationLabel(current.stayMinutes)}</dd></div><div><dt>累计实际作业时长</dt><dd>${durationLabel(current.workMinutes)}</dd></div><div><dt>进度统计时间</dt><dd>${fmtFullDateTime(now)}</dd></div></dl>${equipment.length?`<p class="resource-alert" role="status">设备异常：${equipment.map(row=>`${esc(row.name)}（${esc(statusLabel(row.status))}）`).join('、')}</p>`:''}<div class="table-wrap"><table class="station-task-table"><thead><tr><th>任务 / 人员</th><th>状态 / 预警</th><th>计划时间</th><th>实际时间</th><th>实际作业时长</th><th>检修记录</th></tr></thead><tbody>${tasks.map(row=>{
    const timing=taskTiming(row,now),quality=state.qualityRecords.find(item=>item.scheduleTaskId===row.id)
    const people=state.employeeAssignments.filter(item=>item.scheduleTaskId===row.id && item.status!=='CANCELLED').map(item=>state.employees.find(person=>person.id===item.employeeId)?.name).filter(Boolean)
    return `<tr data-monitor-task="${row.id}" class="${timing.overdueMinutes?'is-overdue':''}"><td><strong>${esc(state.tasks.find(task=>task.id===row.taskId)?.name||'任务')}</strong><small class="table-subline">${esc(people.join('、')||'尚未派工')}</small></td><td>${esc(taskStatusLabel(row.status))}${timing.overdueMinutes?`<span class="monitor-alert">超时 ${durationLabel(timing.overdueMinutes)}</span>`:''}${timing.lateMinutes?`<small class="table-subline">完工晚点 ${durationLabel(timing.lateMinutes)}</small>`:''}${quality?.status==='FAILED'?'<span class="monitor-alert">质检未通过，待处理</span>':''}</td><td>${fmtFullDateTime(row.plannedStartAt)}<br>${fmtFullDateTime(row.plannedEndAt)}</td><td>${fmtFullDateTime(row.actualStartAt)}<br>${fmtFullDateTime(row.actualEndAt)}</td><td>${durationLabel(timing.workMinutes)}</td><td>${row.status==='COMPLETED'?`<button type="button" class="btn btn-sm" data-pc1-record-task="${row.id}">查看记录</button>`:'完成后可查看'}</td></tr>`
  }).join('')}</tbody></table></div></section></section>`
}
export function mountWorkstationMonitor(ctx,onSelect) {
  document.querySelectorAll('[data-monitor-station]').forEach(button=>button.addEventListener('click',()=>{onSelect(button.dataset.monitorStation);ctx.rerender(false)}))
  document.querySelector('[data-monitor-refresh]')?.addEventListener('click',()=>ctx.rerender(false))
  mountMaintenanceRecords(ctx)
}
