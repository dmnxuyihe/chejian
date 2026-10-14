import { pageHeader } from '../../../shared/templates.js'
import { assignmentsForSchedule, componentsForSchedule, componentOf, employeeOf, fmtFullDateTime, taskOf, workstationOf } from '../../../core/derived.js'
import { toggleTaskLock } from '../../../core/actions.js'
import { openModal, toast } from '../../../core/ui.js'
import { ensureGanttRange, renderGantt, renderGanttToolbar, resetGanttRange, rowsInGanttRange, updateGanttRange } from '../../../shared/gantt.js'

export const ganttPage = {
  render({ state }) {
    const vehicle = state.vehicleRepairs.find(v=>v.id===state.selectedVehicleRepairId) || state.vehicleRepairs[0]
    const rows = state.schedules.filter(s=>s.vehicleRepairId===vehicle.id)
    const filterKey=`scheduling-${vehicle.id}`
    const range=ensureGanttRange(state,filterKey,rows,vehicle.plannedEntryAt,vehicle.plannedExitAt)
    const visibleRows=rowsInGanttRange(rows,range)
    const pressEnd=rows.find(x=>x.taskId===2014)?.plannedEndAt
    return `${pageHeader('车辆任务甘特图','严格展示构架4项、轮驱16项原流程；轮对压装到反压保留48小时FS等待。',`<select class="select" style="width:190px" data-gantt-vehicle>${state.vehicleRepairs.map(v=>`<option value="${v.id}" ${v.id===vehicle.id?'selected':''}>${v.locomotiveNo}</option>`).join('')}</select>`)}
      <section class="card">
        ${renderGanttToolbar({range,count:visibleRows.length})}
        <div class="legend-row"><span><i class="legend-box frame"></i>构架</span><span><i class="legend-box wheel"></i>轮驱</span><span><i class="legend-line"></i>48小时工艺等待</span><span>点击任务查看资源并可锁定</span></div>
        ${renderGantt({rows:visibleRows,range,labelFor:s=>taskOf(state,s.taskId)?.name||'任务',metaFor:s=>`${workstationOf(state,s.workstationId)?.name||'未分配工位'} · ${taskOf(state,s.taskId)?.duration||0}分钟`,barClassFor:s=>`${taskOf(state,s.taskId)?.process==='构架'?'frame':''} ${s.isLocked?'locked':''}`,attributesFor:s=>`data-gantt-task="${s.id}"`,overlayFor:(s,{pct})=>taskOf(state,s.taskId)?.id===2015&&pressEnd?`<span class="gantt-wait" style="left:${pct(pressEnd)}%;width:${Math.max(0,pct(s.plannedStartAt)-pct(pressEnd))}%"></span>`:''})}
      </section>`
  },
  mount(ctx) {
    const vehicle=ctx.state.vehicleRepairs.find(v=>v.id===ctx.state.selectedVehicleRepairId)||ctx.state.vehicleRepairs[0]
    const filterKey=`scheduling-${vehicle.id}`
    document.querySelector('[data-gantt-vehicle]')?.addEventListener('change',e=>{ctx.state.selectedVehicleRepairId=Number(e.target.value);ctx.rerender()})
    document.querySelectorAll('[data-gantt-range]').forEach(input=>input.addEventListener('change',()=>{updateGanttRange(ctx.state,filterKey,input.dataset.ganttRange,input.value);ctx.rerender()}))
    document.querySelector('[data-gantt-reset]')?.addEventListener('click',()=>{resetGanttRange(ctx.state,filterKey);ctx.rerender()})
    document.querySelectorAll('[data-gantt-task]').forEach(btn=>btn.addEventListener('click',()=>{
      const s=ctx.state.schedules.find(x=>x.id===Number(btn.dataset.ganttTask)); const task=taskOf(ctx.state,s.taskId)
      const people=assignmentsForSchedule(ctx.state,s.id).map(a=>employeeOf(ctx.state,a.employeeId)?.name).filter(Boolean)
      const comps=componentsForSchedule(ctx.state,s.id).map(a=>`${componentOf(ctx.state,a.componentInstanceId)?.serialNo}（${a.action}）`).filter(Boolean)
      openModal({
        title:`${task.name} · 排程详情`, wide:true,
        body:`<div class="detail-grid"><div><span>流程</span><strong>${task.process}</strong></div><div><span>工位</span><strong>${workstationOf(ctx.state,s.workstationId)?.name}</strong></div><div><span>计划开始</span><strong>${fmtFullDateTime(s.plannedStartAt)}</strong></div><div><span>计划结束</span><strong>${fmtFullDateTime(s.plannedEndAt)}</strong></div><div><span>安排人员</span><strong>${people.join('、')||'—'}</strong></div><div><span>配件实例</span><strong>${comps.join('、')||'无需绑定'}</strong></div></div><div class="notice notice-info" style="margin-top:14px"><span>i</span><div>${ctx.state.taskStepHints[task.id]?.join(' → ')||'以原流程说明为准'}</div></div>`,
        confirmText:s.isLocked?'解锁任务':'锁定任务',
        onConfirm(){ const locked=toggleTaskLock(ctx.state,s.id); toast(locked?'任务已锁定':'任务已解锁',task.name); ctx.rerender() }
      })
    }))
  }
}
