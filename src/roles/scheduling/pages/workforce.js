import { pageHeader, statCard } from '../../../shared/templates.js'
import { employeeLoad, employeeTasks, fmtDateTime } from '../../../core/derived.js'

export const workforcePage = {
  render({ state }) {
    const vehicleId=state.selectedVehicleRepairId || state.vehicleRepairs[0]?.id
    const scheduleIds=new Set(state.schedules.filter(s=>s.vehicleRepairId===vehicleId).map(s=>s.id))
    const vehicleAssignments=state.employeeAssignments.filter(a=>scheduleIds.has(a.scheduleTaskId)&&a.status!=='CANCELLED')
    const rows=state.employees.map(e=>({ e, min:employeeLoad(state,e.id,vehicleId), tasks:employeeTasks(state,e.id,vehicleId) })).sort((a,b)=>b.min-a.min)
    const max=Math.max(1,...rows.map(x=>x.min)); const used=rows.filter(x=>x.min>0).length
    return `${pageHeader('人员负荷与排程','排程精确到具体人员；用于查看每个人已排任务、累计负荷和空闲情况。')}
      <div class="grid grid-4" style="margin-bottom:16px">${statCard('人员总数',state.employees.length,'走行班8 · 天车班8')}${statCard('已使用人员',used,'当前排程有任务')}${statCard('最高负荷',`${max} 分钟`,'当前累计计划工时','metric-amber')}${statCard('自动分配占比',`${Math.round(vehicleAssignments.filter(a=>a.source==='AUTO').length/Math.max(1,vehicleAssignments.length)*100)}%`,'其余为工班长微调','metric-indigo')}</div>
      <div class="split"><section class="card"><div class="card-title-row"><div><div class="card-title">人员负荷</div><div class="card-subtitle">同班组内优先均衡已排工时</div></div></div><div class="load-list">${rows.map(x=>`<div class="load-row"><div class="load-name"><strong>${x.e.name}</strong><span>${x.e.teamName} · ${x.e.no}</span></div><div class="progress"><span style="width:${(x.min/max)*100}%"></span></div><div class="load-value">${x.min} min</div></div>`).join('')}</div></section>
      <section class="card sticky-card"><div class="card-title-row"><div><div class="card-title">人员任务明细</div><div class="card-subtitle">用于调度查看具体安排</div></div></div><div class="compact-list">${rows.filter(x=>x.tasks.length).slice(0,6).map(x=>`<div class="compact-item"><div><strong>${x.e.name}</strong><span>${x.tasks.length}个任务</span></div><div>${x.tasks.slice(0,2).map(t=>`<span class="mini-line">${fmtDateTime(t.schedule.plannedStartAt)} ${t.task.name}</span>`).join('')}</div></div>`).join('')}</div></section></div>`
  }, mount(){}
}
