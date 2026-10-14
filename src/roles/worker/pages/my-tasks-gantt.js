import { pageHeader, statCard } from '../../../shared/templates.js'
import { employeeOf, employeeTasks, fmtFullDateTime, taskStatusLabel, statusBadge, assignmentsForSchedule, componentOf, componentsForSchedule, workstationOf } from '../../../core/derived.js'
import { startTask, completeTask } from '../../../core/actions.js'
import { badge, toast } from '../../../core/ui.js'
import { ensureGanttRange, renderGantt, renderGanttToolbar, resetGanttRange, rowsInGanttRange, updateGanttRange } from '../../../shared/gantt.js'

export const myTasksPage={
  render({state}) {
    const emp=employeeOf(state,state.selectedWorkerId)||state.employees[0]
    const vehicleId=state.selectedVehicleRepairId||state.vehicleRepairs[0]?.id
    const vehicle=state.vehicleRepairs.find(v=>v.id===vehicleId)||state.vehicleRepairs[0]
    const allTasks=employeeTasks(state,emp.id,vehicleId)
    const filterKey=`worker-${vehicleId}-${emp.id}`
    const range=ensureGanttRange(state,filterKey,allTasks.map(x=>x.schedule),vehicle?.plannedEntryAt,vehicle?.plannedExitAt)
    const visibleIds=new Set(rowsInGanttRange(allTasks.map(x=>x.schedule),range).map(s=>s.id))
    const rows=allTasks.filter(x=>visibleIds.has(x.schedule.id))
    const done=rows.filter(x=>x.schedule.status==='COMPLETED').length
    const active=rows.filter(x=>x.schedule.status==='IN_PROGRESS').length
    const headerActions=`<select class="select" style="width:175px" data-worker-vehicle>${state.vehicleRepairs.map(v=>`<option value="${v.id}" ${v.id===vehicleId?'selected':''}>${v.locomotiveNo}</option>`).join('')}</select><select class="select" style="width:170px" data-worker-select>${state.employees.map(e=>`<option value="${e.id}" ${e.id===emp.id?'selected':''}>${e.name} · ${e.teamName}</option>`).join('')}</select>`
    return `${pageHeader('我的检修任务',`当前人员：${emp.name}（${emp.teamName}）。无需账号登录，可直接切换人员查看不同任务。`,headerActions)}
      <div class="grid grid-4" style="margin-bottom:16px">${statCard('范围内任务',rows.length,vehicle?.locomotiveNo||'当前车辆')}${statCard('进行中',active,'正在执行','metric-indigo')}${statCard('已完成',done,'进入质量待检','metric-green')}${statCard('当前班组',emp.teamName,emp.no)}</div>
      <section class="card" style="margin-bottom:16px">
        ${renderGanttToolbar({range,count:rows.length,label:'个人任务'})}
        <div class="legend-row"><span><i class="legend-box status-not-started"></i>未开始</span><span><i class="legend-box status-in-progress"></i>进行中</span><span><i class="legend-box status-completed"></i>已完成</span><span>点击甘特条定位任务卡片</span></div>
        ${renderGantt({rows:rows.map(x=>x.schedule),range,labelFor:s=>state.tasks.find(t=>t.id===s.taskId)?.name||'任务',metaFor:s=>`${workstationOf(state,s.workstationId)?.name||'未分配工位'} · ${taskStatusLabel(s.status)}`,barClassFor:s=>`status-${s.status.toLowerCase().replaceAll('_','-')}`,attributesFor:s=>`data-worker-gantt="${s.id}"`,emptyText:'当前日期范围内没有分配给该人员的任务'})}
      </section>
      <div class="task-card-list">${rows.map(({schedule,task})=>{
        const coworkers=assignmentsForSchedule(state,schedule.id).map(a=>employeeOf(state,a.employeeId)?.name).filter(n=>n&&n!==emp.name)
        const comps=componentsForSchedule(state,schedule.id).map(a=>componentOf(state,a.componentInstanceId)?.serialNo).filter(Boolean)
        return `<section class="card task-card" id="worker-task-${schedule.id}"><div class="task-main"><div><div class="task-process">${task.process}</div><h3>${task.name}</h3><p>${fmtFullDateTime(schedule.plannedStartAt)} → ${fmtFullDateTime(schedule.plannedEndAt)}</p><div class="tag-row">${badge(taskStatusLabel(schedule.status),statusBadge(schedule.status))}<span class="badge badge-slate">工位：${workstationOf(state,schedule.workstationId)?.name||'—'}</span><span class="badge badge-slate">同组：${coworkers.join('、')||'无'}</span>${comps.length?`<span class="badge badge-purple">配件：${comps.join('、')}</span>`:''}</div></div><div class="task-actions">${schedule.status==='NOT_STARTED'?`<button class="btn btn-primary" data-start-task="${schedule.id}">开始作业</button>`:''}${schedule.status==='IN_PROGRESS'?`<button class="btn btn-success" data-complete-task="${schedule.id}">完成作业</button>`:''}${schedule.status==='COMPLETED'?'<span class="badge badge-green">已完成</span>':''}</div></div></section>`
      }).join('')||'<div class="empty"><strong>当前范围内暂无个人任务</strong><span>请选择其他车辆、人员或日期范围。</span></div>'}</div>`
  },
  mount(ctx) {
    const vehicleId=ctx.state.selectedVehicleRepairId||ctx.state.vehicleRepairs[0]?.id
    const filterKey=`worker-${vehicleId}-${ctx.state.selectedWorkerId}`
    document.querySelector('[data-worker-vehicle]')?.addEventListener('change',e=>{ctx.state.selectedVehicleRepairId=Number(e.target.value);ctx.rerender()})
    document.querySelector('[data-worker-select]')?.addEventListener('change',e=>{ctx.state.selectedWorkerId=Number(e.target.value);ctx.rerender()})
    document.querySelectorAll('[data-gantt-range]').forEach(input=>input.addEventListener('change',()=>{updateGanttRange(ctx.state,filterKey,input.dataset.ganttRange,input.value);ctx.rerender()}))
    document.querySelector('[data-gantt-reset]')?.addEventListener('click',()=>{resetGanttRange(ctx.state,filterKey);ctx.rerender()})
    document.querySelectorAll('[data-worker-gantt]').forEach(bar=>bar.addEventListener('click',()=>document.querySelector(`#worker-task-${bar.dataset.workerGantt}`)?.scrollIntoView({behavior:'smooth',block:'center'})))
    document.querySelectorAll('[data-start-task]').forEach(button=>button.addEventListener('click',()=>{const result=startTask(ctx.state,button.dataset.startTask,ctx.state.selectedWorkerId);toast(result.ok?'已开始':'无法开始',result.message,result.ok?'success':'warning');ctx.rerender()}))
    document.querySelectorAll('[data-complete-task]').forEach(button=>button.addEventListener('click',()=>{const result=completeTask(ctx.state,button.dataset.completeTask,ctx.state.selectedWorkerId);toast(result.ok?'已完成':'无法完成',result.message,result.ok?'success':'warning');ctx.rerender()}))
  }
}
