import { pageHeader, statCard } from '../../../shared/templates.js'
import { badge, openModal, toast, escapeHtml } from '../../../core/ui.js'
import { fmtFullDateTime, statusBadge } from '../../../core/derived.js'
import { addPlan, updatePlan, deletePlan, submitPlan, validatePlan } from '../../../core/actions.js'
import { dateKey, ensurePlanningView } from '../../../core/planning-view.js'

const esc = escapeHtml

function form(ctx, row = null) {
  const view = ensurePlanningView(ctx.state)
  const today = dateKey(new Date())
  const entryDate = view.day?.startsWith(view.month) ? view.day : today.startsWith(view.month) ? today : `${view.month}-01`
  const deadline = new Date(`${entryDate}T18:00:00`); deadline.setDate(deadline.getDate() + 14)
  openModal({
    title: `${row ? '编辑' : '新增'}车辆检修计划`,
    wide: true,
    body: `<div class="grid grid-2">
      <div class="field"><label for="plan-car">机车号（必填）</label><input id="plan-car" class="input" data-f="locomotiveNo" required maxlength="80" value="${esc(row?.locomotiveNo || '')}" placeholder="HXD1C0002"></div>
      <div class="field"><label for="plan-program">修程</label><input id="plan-program" class="input" value="C5 构架 / 轮驱" disabled></div>
      <div class="field"><label for="plan-entry">计划入段（必填）</label><input id="plan-entry" class="input" data-f="entry" required type="datetime-local" value="${(row?.plannedEntryAt || `${entryDate}T08:00:00`).slice(0,16)}"></div>
      <div class="field"><label for="plan-exit">要求完成（必填）</label><input id="plan-exit" class="input" data-f="exit" required type="datetime-local" value="${(row?.plannedExitAt || `${dateKey(deadline)}T18:00:00`).slice(0,16)}"></div>
      <div class="field"><label for="plan-priority">优先级</label><input id="plan-priority" class="input" data-f="priority" type="number" min="0" value="${row?.priority ?? 80}"></div>
      <div class="field"><label for="plan-mileage">累计走行公里</label><input id="plan-mileage" class="input" data-f="mileage" type="number" min="0" value="${row?.mileageKm ?? 480000}"></div>
      <div class="field" style="grid-column:1/-1"><label for="plan-remark">备注</label><textarea id="plan-remark" class="textarea" data-f="remark">${esc(row?.remark || '')}</textarea></div>
      <p data-plan-error role="alert" class="pc-error-text" style="grid-column:1/-1;margin:0"></p>
    </div>`,
    async onConfirm(modal) {
      const invalid = [...modal.querySelectorAll('input')].find(input => !input.validity.valid)
      if (invalid) { invalid.reportValidity(); return false }
      const data = {
        locomotiveNo: modal.querySelector('[data-f="locomotiveNo"]').value.trim(),
        plannedEntryAt: `${modal.querySelector('[data-f="entry"]').value}:00`,
        plannedExitAt: `${modal.querySelector('[data-f="exit"]').value}:00`,
        priority: modal.querySelector('[data-f="priority"]').value,
        mileageKm: modal.querySelector('[data-f="mileage"]').value,
        remark: modal.querySelector('[data-f="remark"]').value.trim(),
      }
      const validation = validatePlan(ctx.state, data, row?.id)
      if (!validation.ok) { modal.querySelector('[data-plan-error]').textContent = validation.message; return false }
      const newId = row ? null : addPlan(ctx.state, data)
      const result = row ? updatePlan(ctx.state, row.id, data) : (newId ? { ok:true, id:newId } : { ok:false, message:'计划数据不合法，请检查时间、优先级和里程' })
      if (!result.ok) { modal.querySelector('[data-plan-error]').textContent = result.message; return false }
      view.month = data.plannedEntryAt.slice(0,7); view.day = data.plannedEntryAt.slice(0,10); view.vehicleFilter = ''; view.tab = 'monthly'
      ctx.rerender()
      const saved = await ctx.demoPersistence?.save()
      toast(saved && !saved.ok ? '尚未保存' : '保存成功', saved && !saved.ok ? '修改保留在当前页面，请查看保存状态并重试' : '计划已保存', saved && !saved.ok ? 'warning' : 'success')
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
    document.querySelectorAll('[data-delete-plan]').forEach(btn => btn.addEventListener('click', async () => {
      const row = ctx.state.vehicleRepairs.find(v => v.id === Number(btn.dataset.deletePlan))
      if (!row) return
      openModal({ title: '删除草稿计划', body: `<p>确认删除 ${esc(row.locomotiveNo)} 的 ${esc(row.plannedEntryAt.slice(0,10))} 入段计划？</p>`, confirmText: '删除计划', async onConfirm() {
        const result = deletePlan(ctx.state, row.id)
        if (result.ok) {
          ctx.rerender()
          const saved = await ctx.demoPersistence?.save()
          toast(saved && !saved.ok ? '删除尚未保存' : '删除成功', saved && !saved.ok ? '请查看保存状态并重试' : '计划已删除', saved && !saved.ok ? 'warning' : 'success')
        } else { toast('删除失败', result.message, 'warning'); return false }
      } })
    }))
    document.querySelectorAll('[data-submit-plan]').forEach(btn => btn.addEventListener('click', () => {
      const ok = submitPlan(ctx.state, btn.dataset.submitPlan)
      toast(ok ? '已提交排程' : '提交失败', ok ? '已生成并绑定20条待排程任务' : '计划不存在或已经提交', ok ? 'success' : 'warning')
      if (ok) ctx.rerender()
    }))
  }
}
