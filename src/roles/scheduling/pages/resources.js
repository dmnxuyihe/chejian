import { pageHeader } from '../../../shared/templates.js'
import { fmtDateTime, taskOf, workstationOf } from '../../../core/derived.js'
import { badge } from '../../../core/ui.js'

export const resourcesPage = {
  render({ state }) {
    const vehicleId=state.selectedVehicleRepairId || state.vehicleRepairs[0]?.id
    return `${pageHeader('工位与资源占用','第一版以两个真实工位为主，设备与配件仅展示排程需要的占用结果。')}
      <div class="grid grid-2" style="margin-bottom:16px">${state.workstations.map(w=>{
        const rows=state.schedules.filter(s=>s.vehicleRepairId===vehicleId&&s.workstationId===w.id)
        return `<section class="card"><div class="card-title-row"><div><div class="card-title">${w.name}</div><div class="card-subtitle">容量 ${w.capacity} · ${w.line}</div></div>${badge(w.status,'badge-green')}</div><div class="compact-list">${rows.slice(0,6).map(s=>`<div class="compact-item"><div><strong>${taskOf(state,s.taskId)?.name}</strong><span>${fmtDateTime(s.plannedStartAt)} → ${fmtDateTime(s.plannedEndAt)}</span></div></div>`).join('')}</div></section>`}).join('')}</div>
      <section class="card"><div class="card-title-row"><div><div class="card-title">设备与配件排程占用</div><div class="card-subtitle">不展开采购 / 仓储，只展示是否被任务锁定</div></div></div><div class="table-wrap"><table><thead><tr><th>类型</th><th>资源</th><th>任务</th><th>时间 / 动作</th><th>状态</th></tr></thead><tbody>
      ${state.equipmentAssignments.filter(a=>state.schedules.find(x=>x.id===a.scheduleTaskId)?.vehicleRepairId===vehicleId).slice(0,12).map(a=>{const s=state.schedules.find(x=>x.id===a.scheduleTaskId);const eq=state.equipment.find(x=>x.id===a.equipmentId);return `<tr><td>设备</td><td>${eq?.name}</td><td>${taskOf(state,s?.taskId)?.name}</td><td>${fmtDateTime(a.startAt)} - ${fmtDateTime(a.endAt)}</td><td>${badge(a.status,'badge-indigo')}</td></tr>`}).join('')}
      ${state.componentAssignments.filter(a=>state.schedules.find(x=>x.id===a.scheduleTaskId)?.vehicleRepairId===vehicleId).slice(0,12).map(a=>{const s=state.schedules.find(x=>x.id===a.scheduleTaskId);const c=state.componentInstances.find(x=>x.id===a.componentInstanceId);return `<tr><td>配件</td><td class="mono">${c?.serialNo}</td><td>${taskOf(state,s?.taskId)?.name}</td><td>${a.action}</td><td>${badge(a.status,'badge-indigo')}</td></tr>`}).join('')}
      </tbody></table></div></section>`
  }, mount(){}
}
