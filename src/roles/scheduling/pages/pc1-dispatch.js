import { pageHeader } from '../../../shared/templates.js'
import { escapeHtml as esc, openModal } from '../../../core/ui.js'
import { fmtFullDateTime } from '../../../core/derived.js'
import { pc1PreviewIssues } from '../../../core/pc1-simulation.js'
import { ganttPage } from './gantt.js'
import { saveConfirmedPc1 } from './pc1-planning.js'

export const pc1DispatchPage = {
  render(ctx) {
    const { state } = ctx, preview = state.pc1SchedulePreview
    const issues = preview ? pc1PreviewIssues(state,preview) : []
    const dispatches = (state.pc1Dispatches || []).filter(row => state.vehicleRepairs.find(vehicle => vehicle.id === row.vehicleRepairId)?.currentVersionId === row.versionId)
    return `<div class="pc1-workspace" data-pc1-dispatch>
      ${pageHeader('班组任务清单','按车辆和班组查看本次正式下发的检修任务与备料需求。','<a class="text-action" href="#/scheduling/dashboard">返回排程工作台 ↗</a>')}
      ${preview ? `<section class="card dispatch-pending"><div><h2>待发布模拟方案</h2><p>${preview.vehicleRepairIds.length}辆车 · ${preview.schedules.length}项任务 · 最晚完成 ${fmtFullDateTime(preview.deadline)}</p>${issues.length ? `<div class="resource-alert"><ul>${issues.map(issue => `<li>${esc(issue)}</li>`).join('')}</ul></div>` : '<p class="resource-ok">方案校验通过，可以确认发布。</p>'}</div><button class="btn btn-primary" data-pc1-dispatch-confirm ${issues.length ? 'disabled' : ''}>确认发布模拟方案</button></section>` : ''}
      <section class="card dispatch-card"><div class="desk-panel-head"><h2>正式班组任务 <span class="count-label">${dispatches.length}</span></h2><span class="dispatch-hint">展开一行，查看任务与资源明细</span></div>
      <div class="dispatch-headings"><span>检修车辆 / 班组</span><span>任务数</span><span>作业人员</span><span></span></div>
      <div class="pc1-dispatch-list">${dispatches.map(row => `<details class="pc1-dispatch-item"><summary><div><strong>${esc(state.vehicleRepairs.find(vehicle => vehicle.id === row.vehicleRepairId)?.locomotiveNo)}</strong><small>${esc(state.teams.find(team => team.id === row.teamId)?.name)}</small></div><span>${row.scheduleTaskIds.length} 项</span><span>${row.employeeIds.length} 人</span><span class="dispatch-expand">清单 ⌄</span></summary><div class="dispatch-detail"><p class="dispatch-meta">发布时间 ${fmtFullDateTime(row.publishedAt)}</p><dl><div><dt>作业人员</dt><dd>${row.employeeIds.map(id => esc(state.employees.find(employee => employee.id === id)?.name || '未登记')).join('、')}</dd></div><div><dt>检修任务</dt><dd>${row.scheduleTaskIds.map(id => esc(state.tasks.find(task => task.id === state.schedules.find(schedule => schedule.id === id)?.taskId)?.name || '工序')).join('、')}</dd></div></dl>${[['工具',row.tools,'tools','toolId'],['物料',row.materials,'materials','materialId'],['配件',row.components,'componentTypes','componentTypeId']].map(([label,requirements,collection,field]) => `<h3>${label}清单</h3><div class="table-wrap"><table><thead><tr><th>工序</th><th>资源</th><th>数量</th></tr></thead><tbody>${requirements.map(req => `<tr><td>${esc(state.tasks.find(task => task.id === req.taskId)?.name)}</td><td>${esc(state[collection].find(resource => resource.id === req[field])?.name || '未登记')}</td><td>${req.quantity}</td></tr>`).join('') || '<tr><td colspan="3">该班组任务没有对应需求</td></tr>'}</tbody></table></div>`).join('')}</div></details>`).join('') || '<div class="empty"><strong>尚未发布班组任务</strong><span>在排程工作台确认模拟方案后，清单会显示在这里。</span></div>'}</div></section>
      ${state.vehicleRepairs.length ? `<details class="dispatch-gantt"><summary>查看正式排程甘特图</summary><div class="card">${ganttPage.render({...ctx,compact:true})}</div></details>` : ''}
    </div>`
  },
  mount(ctx) {
    ganttPage.mount(ctx)
    document.querySelector('[data-pc1-dispatch-confirm]')?.addEventListener('click', () => openModal({title:'确认发布模拟方案',body:'<p>发布后各查询页将显示正式任务和预计出段时间。</p>',confirmText:'确认发布',onConfirm:()=>saveConfirmedPc1(ctx)}))
  },
}
