import { pageHeader, statCard } from '../../../shared/templates.js'
import { badge, openModal, toast, escapeHtml } from '../../../core/ui.js'
import { fmtFullDateTime, statusBadge } from '../../../core/derived.js'
import { addPlan, updatePlan, deletePlan, submitPlan } from '../../../core/actions.js'

const esc = escapeHtml

function form(ctx, row = null) {
  openModal({
    title: `${row ? '编辑' : '新增'}车辆检修计划`,
    wide: true,
    body: `<div class="grid grid-2">
      <div class="field"><label>机车号</label><input class="input" data-f="locomotiveNo" value="${esc(row?.locomotiveNo || '')}" placeholder="HXD1C0002"></div>
      <div class="field"><label>修程</label><input class="input" value="高级修（构架/轮驱）" disabled></div>
      <div class="field"><label>计划进场</label><input class="input" data-f="entry" type="datetime-local" value="${(row?.plannedEntryAt || '2026-10-06T08:00:00').slice(0,16)}"></div>
      <div class="field"><label>计划交车</label><input class="input" data-f="exit" type="datetime-local" value="${(row?.plannedExitAt || '2026-10-10T18:00:00').slice(0,16)}"></div>
      <div class="field"><label>优先级</label><input class="input" data-f="priority" type="number" value="${row?.priority ?? 80}"></div>
      <div class="field"><label>累计走行公里</label><input class="input" data-f="mileage" type="number" value="${row?.mileageKm ?? 480000}"></div>
      <div class="field" style="grid-column:1/-1"><label>备注</label><textarea class="textarea" data-f="remark">${esc(row?.remark || '')}</textarea></div>
    </div>`,
    onConfirm(modal) {
      const data = {
        locomotiveNo: modal.querySelector('[data-f="locomotiveNo"]').value.trim(),
        plannedEntryAt: `${modal.querySelector('[data-f="entry"]').value}:00`,
        plannedExitAt: `${modal.querySelector('[data-f="exit"]').value}:00`,
        priority: modal.querySelector('[data-f="priority"]').value,
        mileageKm: modal.querySelector('[data-f="mileage"]').value,
        remark: modal.querySelector('[data-f="remark"]').value.trim(),
      }
      if (!data.locomotiveNo || data.plannedEntryAt.length < 19 || data.plannedExitAt.length < 19) {
        toast('保存失败', '请填写机车号和计划时间', 'warning'); return false
      }
      const newId = row ? null : addPlan(ctx.state, data)
      const result = row ? updatePlan(ctx.state, row.id, data) : (newId ? { ok:true, id:newId } : { ok:false, message:'计划数据不合法，请检查时间、优先级和里程' })
      if (!result.ok) { toast('保存失败', result.message, 'warning'); return false }
      toast('保存成功', '计划已保存'); ctx.rerender()
    }
  })
}

export const plansCrudPage = {
  render({ state }) {
    const scheduled = state.vehicleRepairs.filter(v => v.status === 'SCHEDULED').length
    const drafts = state.vehicleRepairs.filter(v => v.status === 'DRAFT').length
    return `${pageHeader('车辆检修计划', '维护第一版车辆计划并提交自动排程。已生成排程的计划需要先通过排程页面处理。', '<button class="btn btn-primary" data-add-plan>新增检修计划</button>')}
      <div class="grid grid-4" style="margin-bottom:16px">${statCard('计划总数', state.vehicleRepairs.length, '当前计划')}${statCard('已提交排程', scheduled, '可进入排程', 'metric-indigo')}${statCard('草稿', drafts, '尚未提交', 'metric-amber')}${statCard('最高优先级', Math.max(...state.vehicleRepairs.map(v => v.priority), 0), '数值越高越优先')}</div>
      <section class="card"><div class="table-wrap"><table><thead><tr><th>机车号</th><th>修程</th><th>计划进场</th><th>计划交车</th><th>优先级</th><th>状态</th><th>备注</th><th>操作</th></tr></thead><tbody>${state.vehicleRepairs.map(v => `<tr><td class="mono">${esc(v.locomotiveNo)}</td><td>${esc(state.repairPrograms.find(r => r.id === v.repairProgramId)?.name || '—')}</td><td>${fmtFullDateTime(v.plannedEntryAt)}</td><td>${fmtFullDateTime(v.plannedExitAt)}</td><td>${v.priority}</td><td>${badge(v.status, statusBadge(v.status))}</td><td>${esc(v.remark || '—')}</td><td><div class="table-actions">${v.status === 'DRAFT' ? `<button class="btn btn-sm" data-edit-plan="${v.id}">编辑</button><button class="btn btn-sm btn-danger" data-delete-plan="${v.id}">删除</button><button class="btn btn-sm btn-primary" data-submit-plan="${v.id}">提交排程</button>` : '<span class="badge badge-green">已保护</span>'}</div></td></tr>`).join('') || '<tr><td colspan="8" class="empty">暂无计划</td></tr>'}</tbody></table></div></section>`
  },
  mount(ctx) {
    document.querySelector('[data-add-plan]')?.addEventListener('click', () => form(ctx))
    document.querySelectorAll('[data-edit-plan]').forEach(btn => btn.addEventListener('click', () => {
      const row = ctx.state.vehicleRepairs.find(v => v.id === Number(btn.dataset.editPlan)); if (row) form(ctx, row)
    }))
    document.querySelectorAll('[data-delete-plan]').forEach(btn => btn.addEventListener('click', () => {
      const result = deletePlan(ctx.state, btn.dataset.deletePlan)
      toast(result.ok ? '删除成功' : '删除失败', result.ok ? '计划已删除' : result.message, result.ok ? 'success' : 'warning')
      if (result.ok) ctx.rerender()
    }))
    document.querySelectorAll('[data-submit-plan]').forEach(btn => btn.addEventListener('click', () => {
      const ok = submitPlan(ctx.state, btn.dataset.submitPlan)
      toast(ok ? '已提交排程' : '提交失败', ok ? '已生成并绑定20条待排程任务' : '计划不存在或已经提交', ok ? 'success' : 'warning')
      if (ok) ctx.rerender()
    }))
  }
}
