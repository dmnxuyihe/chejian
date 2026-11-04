import { escapeHtml as esc, openModal } from '../core/ui.js'
import { fmtFullDateTime, taskStatusLabel } from '../core/derived.js'

const number = n => new Intl.NumberFormat('zh-CN',{maximumFractionDigits:3}).format(n)
const hours = minutes => `${number(minutes/60)} 小时`
const table = (head,rows,empty) => `<div class="table-wrap"><table><thead><tr>${head.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="empty">${empty}</td></tr>`}</tbody></table></div>`

export function renderTaskDetails(state, row, { compact = false, showIdentity = true } = {}) {
  const task = state.tasks.find(t=>t.id===row.taskId)
  const vehicle = state.vehicleRepairs.find(v=>v.id===row.vehicleRepairId)
  const station = state.workstations.find(w=>w.id===row.workstationId)
  const preview = row.planKind==='preview'
  const assignments = preview ? state.pc1SchedulePreview?.employeeAssignments : state.employeeAssignments
  const people = [...new Set((assignments || []).filter(a=>a.scheduleTaskId===row.id && a.status!=='CANCELLED' && (a.vehicleRepairId==null || a.vehicleRepairId===row.vehicleRepairId)).map(a=>a.employeeId))].map(id=>state.employees.find(e=>e.id===id)).filter(Boolean)
  const minutes = (new Date(row.plannedEndAt)-new Date(row.plannedStartAt))/60000
  const requirements = (state.teamRequirements || []).filter(r=>r.taskId===row.taskId)
  const teamRows = requirements.map(req => {
    const team = state.teams.find(t=>t.id===req.teamId)
    const assigned = people.filter(p=>p.teamId===req.teamId).length
    return `<tr><td>${esc(team?.name || '未登记班组')}</td><td>${req.headcount} 人 / ${assigned} 人</td><td>${hours(req.workDurationMin ?? minutes)}</td></tr>`
  })
  const personRows = people.map(person=>{
    const req = requirements.find(r=>r.teamId===person.teamId)
    return `<tr><td>${esc(person.name)}<small>${esc(state.teams.find(t=>t.id===person.teamId)?.name || '未登记班组')}</small></td><td>${hours(req?.workDurationMin ?? minutes)}</td></tr>`
  })
  const supplies = (kind, collection, field) => (state[collection] || []).filter(r=>r.taskId===row.taskId).map(req=>{
    const resource=state[kind].find(r=>r.id===req[field])
    const basis = ({process:'工艺表用量',demo:'演示用量',manual:'已核对用量'})[req.quantityBasis] || '用量待核对'
    return `<tr><td>${esc(resource?.name || '未登记资源')}</td><td>${number(req.quantity)} ${esc(kind==='tools'?'件':resource?.unit || '单位待确认')}</td><td>${basis}</td></tr>`
  })
  const predecessors = (state.dependencies || []).filter(d=>d.childTaskId===row.taskId).map(d=>state.tasks.find(t=>t.id===d.parentTaskId)?.name).filter(Boolean)
  const requiredMinutes = requirements.reduce((n,r)=>n+r.headcount*(r.workDurationMin ?? minutes),0)
  return `<div class="task-detail-content ${compact?'is-compact':''}" data-task-detail-content data-task-detail-id="${row.id}">
    ${showIdentity?`<div class="task-detail-identity"><span>${esc(vehicle?.locomotiveNo)}</span><strong>${esc(task?.name || '检修任务')}</strong><span>${preview?'模拟方案':row.planKind==='draft'?'待确认方案':'正式排程'} · ${esc(taskStatusLabel(row.status || 'NOT_STARTED'))}${row.isLocked?' · 时间锁定':''}</span></div>`:''}
    <dl class="task-detail-facts"><div><dt>计划开始</dt><dd>${esc(fmtFullDateTime(row.plannedStartAt))}</dd></div><div><dt>计划结束</dt><dd>${esc(fmtFullDateTime(row.plannedEndAt))}</dd></div><div><dt>工序历时</dt><dd>${hours(minutes)}</dd></div><div><dt>工位</dt><dd>${esc(station?.name || '未分配')}</dd></div>${row.actualStartAt?`<div><dt>实际开始</dt><dd>${esc(fmtFullDateTime(row.actualStartAt))}</dd></div>`:''}${row.actualEndAt?`<div><dt>实际结束</dt><dd>${esc(fmtFullDateTime(row.actualEndAt))}</dd></div>`:''}</dl>
    ${preview && state.pc1SchedulePreview?.needsRecompute?'<p class="task-detail-note" role="status">时间已调整，人员安排需重新模拟校验。</p>':''}
    <section><h4>班组与工时 <span>计划 ${hours(requiredMinutes)}</span></h4>${table(['班组','需求 / 已派','每人工时'],teamRows,'暂无班组需求记录')}</section>
    <section><h4>人员安排 <span>${people.length} 人</span></h4>${table(['人员 / 班组','计划工作时长'],personRows,'尚未分配到具体人员')}<p class="task-detail-note">计划作业时段见上方起止时间；每人工时依据班组需求，未记作实际工时。</p></section>
    <details ${compact?'':'open'}><summary>工具清单</summary>${table(['工具','需求数量','用量依据'],supplies('tools','toolRequirements','toolId'),'暂无工具需求记录')}</details>
    <details ${compact?'':'open'}><summary>物料清单</summary>${table(['物料','需求数量','用量依据'],supplies('materials','materialRequirements','materialId'),'暂无物料需求记录')}</details>
    ${predecessors.length?`<p class="task-detail-note">前置工序：${esc(predecessors.join('、'))}</p>`:''}
  </div>`
}

export function openTaskDetails(state, row) {
  const task=state.tasks.find(t=>t.id===row.taskId)
  openModal({title:`任务详情 · ${task?.name || '检修任务'}`,wide:true,body:renderTaskDetails(state,row),confirmText:'关闭',cancelText:'返回'})
}
