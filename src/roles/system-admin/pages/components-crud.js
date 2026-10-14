import { pageHeader, statCard } from '../../../shared/templates.js'
import { componentStats, componentTypeOf, statusBadge } from '../../../core/derived.js'
import { badge, openModal, toast, escapeHtml } from '../../../core/ui.js'
import { createResource, updateResource, deleteResource } from '../../../core/actions.js'

const esc = escapeHtml
function form(ctx, row = null) {
  openModal({
    title: `${row ? '编辑' : '新增'}配件实例`, wide: true,
    body: `<div class="grid grid-2">
      <div class="field"><label>配件类型</label><select class="select" data-f="typeId">${ctx.state.componentTypes.map(t => `<option value="${t.id}" ${Number(row?.typeId)===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></div>
      <div class="field"><label>序列号</label><input class="input" data-f="serialNo" value="${esc(row?.serialNo || '')}"></div>
      <div class="field"><label>内部编码</label><input class="input" data-f="assetCode" value="${esc(row?.assetCode || '')}"></div>
      <div class="field"><label>二维码编码</label><input class="input" data-f="qrCode" value="${esc(row?.qrCode || '')}"></div>
      <div class="field"><label>状态</label><select class="select" data-f="status">${['AVAILABLE','QUALIFIED','WAIT_REPAIR','REPAIRING','INSTALLED','SCRAPPED'].map(s => `<option ${row?.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label>当前位置类型</label><select class="select" data-f="locationType">${['WAREHOUSE','WORKSTATION','VEHICLE','OTHER'].map(s => `<option ${row?.locationType===s?'selected':''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label>当前工位</label><select class="select" data-f="workstationId"><option value="">未分配</option>${ctx.state.workstations.map(w => `<option value="${w.id}" ${Number(row?.workstationId)===w.id?'selected':''}>${esc(w.name)}</option>`).join('')}</select></div>
      <div class="field"><label>位置</label><input class="input" data-f="location" value="${esc(row?.location || '')}"></div>
      <div class="field"><label>关联机车号</label><input class="input" data-f="locomotiveNo" value="${esc(row?.locomotiveNo || '')}"></div>
    </div>`,
    onConfirm(modal) {
      const data = {}
      for (const field of ['typeId','serialNo','assetCode','qrCode','status','locationType','workstationId','location','locomotiveNo']) data[field] = modal.querySelector(`[data-f="${field}"]`).value.trim()
      data.typeId = Number(data.typeId)
      data.workstationId = data.workstationId ? Number(data.workstationId) : null
      if (!data.serialNo || !data.assetCode) { toast('保存失败', '序列号和内部编码不能为空', 'warning'); return false }
      const result = row ? updateResource(ctx.state, 'componentInstances', row.id, data) : createResource(ctx.state, 'componentInstances', data)
      if (!result.ok) { toast('保存失败', result.message, 'warning'); return false }
      toast('保存成功', '配件实例已保存'); ctx.rerender()
    }
  })
}

export const componentsCrudPage = {
  render({ state }) {
    const stats = componentStats(state)
    return `${pageHeader('配件台账', '按实例管理配件状态、编码、位置和关联机车。', '<button class="btn btn-primary" data-add-component>新增配件实例</button>')}
      <div class="grid grid-4" style="margin-bottom:16px">${stats.map(c => statCard(c.name, c.total, `可用 ${c.available} · 检修中 ${c.repairing}`, c.available ? 'metric-indigo' : 'metric-red')).join('')}</div>
      <section class="card"><div class="table-wrap"><table><thead><tr><th>配件类型</th><th>序列号</th><th>内部编码</th><th>状态</th><th>位置</th><th>关联机车</th><th>操作</th></tr></thead><tbody>${state.componentInstances.map(c => `<tr><td>${esc(componentTypeOf(state, c.typeId)?.name || '—')}</td><td class="mono">${esc(c.serialNo)}</td><td class="mono">${esc(c.assetCode)}</td><td>${badge(c.status, statusBadge(c.status))}</td><td>${esc(c.location || '—')}</td><td>${esc(c.locomotiveNo || '—')}</td><td><button class="btn btn-sm" data-edit-component="${c.id}">编辑</button> <button class="btn btn-sm btn-danger" data-delete-component="${c.id}">删除</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">暂无配件实例</td></tr>'}</tbody></table></div></section>`
  },
  mount(ctx) {
    document.querySelector('[data-add-component]')?.addEventListener('click', () => form(ctx))
    document.querySelectorAll('[data-edit-component]').forEach(btn => btn.addEventListener('click', () => { const row = ctx.state.componentInstances.find(c => c.id === Number(btn.dataset.editComponent)); if (row) form(ctx, row) }))
    document.querySelectorAll('[data-delete-component]').forEach(btn => btn.addEventListener('click', () => { const result = deleteResource(ctx.state, 'componentInstances', btn.dataset.deleteComponent); toast(result.ok ? '删除成功' : '删除失败', result.ok ? '配件实例已删除' : result.message, result.ok ? 'success' : 'warning'); if (result.ok) ctx.rerender() }))
  }
}
