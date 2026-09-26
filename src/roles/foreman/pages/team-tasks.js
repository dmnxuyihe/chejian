import { pageHeader, statCard } from '../../../shared/templates.js'
import { assignmentsForSchedule, employeeOf, fmtDateTime, taskOf } from '../../../core/derived.js'
import { addEmployeeToTask, swapEmployee } from '../../../core/actions.js'
import { openModal, toast } from '../../../core/ui.js'

export const teamTasksPage = {
  render({ state }) {
    const team=state.teams.find(t=>t.id===state.selectedTeamId)||state.teams[0]
    const ids=new Set(state.employees.filter(e=>e.teamId===team.id).map(e=>e.id))
    const rows=state.schedules.filter(s=>assignmentsForSchedule(state,s.id).some(a=>ids.has(a.employeeId)))
    const adjustments=state.employeeAssignments.filter(a=>a.source==='FOREMAN'&&a.status!=='CANCELLED').length
    return `${pageHeader('班组任务与现场微调','系统先完成精确到人的初排；工班长只做同班组换人、增员等小范围调整。',`<select class="select" style="width:150px" data-team-select>${state.teams.map(t=>`<option value="${t.id}" ${t.id===team.id?'selected':''}>${t.name}</option>`).join('')}</select>`)}
      <div class="grid grid-4" style="margin-bottom:16px">${statCard('班组人数',state.employees.filter(e=>e.teamId===team.id).length,team.name)}${statCard('相关任务',rows.length,'当前排程')}${statCard('现场微调',adjustments,'已保存调整','metric-indigo')}${statCard('策略','系统初排','工班长确认 / 微调','metric-green')}</div>
      <section class="card"><div class="card-title-row"><div><div class="card-title">${team.name}任务</div><div class="card-subtitle">点击“微调人员”处理现场变化</div></div></div><div class="table-wrap"><table><thead><tr><th>任务</th><th>计划时间</th><th>系统/当前人员</th><th>来源</th><th>操作</th></tr></thead><tbody>
      ${rows.map(s=>{const as=assignmentsForSchedule(state,s.id).filter(a=>ids.has(a.employeeId));return `<tr><td>${taskOf(state,s.taskId)?.name}</td><td>${fmtDateTime(s.plannedStartAt)} - ${fmtDateTime(s.plannedEndAt)}</td><td>${as.map(a=>employeeOf(state,a.employeeId)?.name).join('、')}</td><td>${as.some(a=>a.source==='FOREMAN')?'<span class="badge badge-amber">现场调整</span>':'<span class="badge badge-indigo">系统初排</span>'}</td><td><button class="btn btn-sm" data-fine-tune="${s.id}">微调人员</button></td></tr>`}).join('')}
      </tbody></table></div></section>`
  },
  mount(ctx) {
    document.querySelector('[data-team-select]')?.addEventListener('change',e=>{ctx.state.selectedTeamId=Number(e.target.value);ctx.rerender()})
    document.querySelectorAll('[data-fine-tune]').forEach(btn=>btn.addEventListener('click',()=>{
      const sid=Number(btn.dataset.fineTune), team=ctx.state.teams.find(t=>t.id===ctx.state.selectedTeamId)
      const current=assignmentsForSchedule(ctx.state,sid).filter(a=>employeeOf(ctx.state,a.employeeId)?.teamId===team.id)
      const candidates=ctx.state.employees.filter(e=>e.teamId===team.id)
      openModal({title:`微调人员 · ${taskOf(ctx.state,ctx.state.schedules.find(s=>s.id===sid)?.taskId)?.name}`,wide:true,
        body:`<div class="field"><label>替换当前人员</label><div class="grid grid-2"><select class="select" data-old>${current.map(a=>`<option value="${a.employeeId}">${employeeOf(ctx.state,a.employeeId)?.name}</option>`).join('')}</select><select class="select" data-new>${candidates.map(e=>`<option value="${e.id}">${e.name}</option>`).join('')}</select></div></div><div class="field" style="margin-top:14px"><label>调整原因</label><input class="input" data-reason value="现场实际情况微调"></div><div class="notice notice-info" style="margin-top:14px"><span>i</span><div>只允许同班组换人，并自动校验目标人员在该时间段是否已有其他任务。</div></div>`,
        confirmText:'确认换人',onConfirm(modal){const r=swapEmployee(ctx.state,sid,modal.querySelector('[data-old]').value,modal.querySelector('[data-new]').value,9001,modal.querySelector('[data-reason]').value);toast(r.ok?'微调成功':'无法调整',r.message,r.ok?'success':'warning');if(r.ok)ctx.rerender();return r.ok}}
      )
      const modal=document.querySelector('.modal-backdrop');
      if(modal){ const actions=modal.querySelector('.modal-actions'); const add=document.createElement('button');add.className='btn';add.textContent='现场增员';add.dataset.addMember=''; actions.prepend(add);add.addEventListener('click',()=>{const eid=modal.querySelector('[data-new]').value;const r=addEmployeeToTask(ctx.state,sid,eid,9001);toast(r.ok?'增员成功':'无法增员',r.message,r.ok?'success':'warning');if(r.ok){modal.remove();ctx.rerender()}})}
    }))
  }
}
