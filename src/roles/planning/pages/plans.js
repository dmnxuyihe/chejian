import { pageHeader, statCard } from '../../../shared/templates.js'
import { badge, openModal, toast } from '../../../core/ui.js'
import { fmtFullDateTime, statusBadge } from '../../../core/derived.js'
import { addPlan, submitPlan } from '../../../core/actions.js'

export const plansPage = {
  render({ state }) {
    const scheduled = state.vehicleRepairs.filter(v=>v.status==='SCHEDULED').length
    const drafts = state.vehicleRepairs.filter(v=>v.status==='DRAFT').length
    return `${pageHeader('车辆检修计划','第一版将计划编制、审核、审批合并到一个用户；计划保存后可直接提交排程。','<button class="btn btn-primary" data-add-plan>新增检修计划</button>')}
      <div class="grid grid-4" style="margin-bottom:16px">
        ${statCard('计划总数',state.vehicleRepairs.length,'当前演示数据')}
        ${statCard('待排程 / 已排程',scheduled,'已提交排程','metric-indigo')}
        ${statCard('草稿',drafts,'尚未提交','metric-amber')}
        ${statCard('最高优先级',Math.max(...state.vehicleRepairs.map(v=>v.priority),0),'数值越高越优先')}
      </div>
      <section class="card">
        <div class="card-title-row"><div><div class="card-title">检修计划列表</div><div class="card-subtitle">不实现复杂审批流，只保留第一版排程入口</div></div></div>
        <div class="table-wrap"><table><thead><tr><th>机车号</th><th>修程</th><th>计划进场</th><th>计划交车</th><th>优先级</th><th>状态</th><th>说明</th><th>操作</th></tr></thead><tbody>
          ${state.vehicleRepairs.map(v=>`<tr><td class="mono">${v.locomotiveNo}</td><td>${state.repairPrograms.find(r=>r.id===v.repairProgramId)?.name||'—'}</td><td>${fmtFullDateTime(v.plannedEntryAt)}</td><td>${fmtFullDateTime(v.plannedExitAt)}</td><td>${v.priority}</td><td>${badge(v.status,statusBadge(v.status))}</td><td>${v.remark||'—'}</td><td><div class="table-actions">${v.status==='DRAFT'?`<button class="btn btn-sm btn-primary" data-submit-plan="${v.id}">提交排程</button>`:'<span class="badge badge-green">已进入排程</span>'}</div></td></tr>`).join('')}
        </tbody></table></div>
      </section>`
  },
  mount(ctx) {
    document.querySelector('[data-add-plan]')?.addEventListener('click',()=>{
      openModal({
        title:'新增检修计划',
        body:`<div class="grid grid-2">
          <div class="field"><label>机车号</label><input class="input" data-f="locomotiveNo" placeholder="HXD1C0002"></div>
          <div class="field"><label>修程</label><select class="select" disabled><option>HXD1C高级修</option></select></div>
          <div class="field"><label>计划进场</label><input class="input" data-f="entry" type="datetime-local" value="2026-10-06T08:00"></div>
          <div class="field"><label>计划交车</label><input class="input" data-f="exit" type="datetime-local" value="2026-10-10T18:00"></div>
          <div class="field"><label>优先级</label><input class="input" data-f="priority" type="number" value="80"></div>
          <div class="field"><label>累计走行公里</label><input class="input" data-f="mileage" type="number" value="480000"></div>
          <div class="field" style="grid-column:1/-1"><label>备注</label><textarea class="textarea" data-f="remark" placeholder="可选"></textarea></div>
        </div>`,
        onConfirm(modal){
          const locomotiveNo=modal.querySelector('[data-f=locomotiveNo]').value.trim()
          const entry=modal.querySelector('[data-f=entry]').value
          const exit=modal.querySelector('[data-f=exit]').value
          if(!locomotiveNo||!entry||!exit){ toast('无法保存','请填写机车号和计划时间','warning'); return false }
          addPlan(ctx.state,{locomotiveNo,plannedEntryAt:`${entry}:00`,plannedExitAt:`${exit}:00`,priority:modal.querySelector('[data-f=priority]').value,mileageKm:modal.querySelector('[data-f=mileage]').value,remark:modal.querySelector('[data-f=remark]').value})
          toast('计划已保存',`${locomotiveNo} 当前为草稿`); ctx.rerender()
        }
      })
    })
    document.querySelectorAll('[data-submit-plan]').forEach(btn=>btn.addEventListener('click',()=>{
      submitPlan(ctx.state,btn.dataset.submitPlan); toast('已提交排程','计划状态已更新'); ctx.rerender()
    }))
  }
}
