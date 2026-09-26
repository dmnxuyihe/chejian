import { pageHeader } from '../../../shared/templates.js'
import { assignmentsForSchedule, componentsForSchedule, componentOf, employeeOf, fmtFullDateTime, taskOf, workstationOf } from '../../../core/derived.js'
import { toggleTaskLock } from '../../../core/actions.js'
import { openModal, toast } from '../../../core/ui.js'

const RANGE_START = new Date('2026-10-01T08:00:00').getTime()
const RANGE_END = new Date('2026-10-05T14:10:00').getTime()
const RANGE = RANGE_END - RANGE_START
const pct = v => Math.max(0, Math.min(100, ((new Date(v).getTime()-RANGE_START)/RANGE)*100))

export const ganttPage = {
  render({ state }) {
    return `${pageHeader('车辆任务甘特图','严格展示构架4项、轮驱16项原流程；轮对压装到反压保留48小时FS等待。')}
      <section class="card">
        <div class="legend-row"><span><i class="legend-box frame"></i>构架</span><span><i class="legend-box wheel"></i>轮驱</span><span><i class="legend-line"></i>48小时工艺等待</span><span>点击任务查看资源并可锁定</span></div>
        <div class="gantt" data-test="gantt">
          <div class="gantt-head"><div class="gantt-label-head">任务 / 工位</div><div class="gantt-scale">${['10/01','10/02','10/03','10/04','10/05'].map(d=>`<div>${d}</div>`).join('')}</div></div>
          ${state.schedules.map(s=>{
            const task=taskOf(state,s.taskId), left=pct(s.plannedStartAt), right=pct(s.plannedEndAt), width=Math.max(0.7,right-left)
            const wait = task.id===2015 ? `<span class="gantt-wait" style="left:${pct('2026-10-03T11:10:00')}%;width:${pct('2026-10-05T11:10:00')-pct('2026-10-03T11:10:00')}%"></span>`:''
            return `<div class="gantt-row"><div class="gantt-task-label"><strong>${task.name}</strong><span>${workstationOf(state,s.workstationId)?.name} · ${task.duration}分钟</span></div><div class="gantt-track">${wait}<button class="gantt-bar ${task.process==='构架'?'frame':''} ${s.isLocked?'locked':''}" style="left:${left}%;width:${width}%" data-gantt-task="${s.id}" title="${task.name}">${task.name}</button></div></div>`
          }).join('')}
        </div>
      </section>`
  },
  mount(ctx) {
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
