import { pageHeader, statCard } from '../../../shared/templates.js'
import { componentStats, componentTypeOf, statusBadge } from '../../../core/derived.js'
import { badge, toast } from '../../../core/ui.js'
import { updateComponentStatus } from '../../../core/actions.js'

export const componentsPage = {
  render({ state }) {
    const stats = componentStats(state)
    return `${pageHeader('配件台账','配件为新增排程资源：类型与具体实例分开管理；不替换原有备件。')}
      <div class="grid grid-4" style="margin-bottom:16px">${stats.map(c=>statCard(c.name,c.total,`可用 ${c.available} · 检修中 ${c.repairing}`,c.available?'metric-indigo':'metric-red')).join('')}</div>
      <section class="card">
        <div class="card-title-row"><div><div class="card-title">具体配件实例</div><div class="card-subtitle">一件一条，可用于智能排程绑定具体序列号</div></div></div>
        <div class="table-wrap"><table><thead><tr><th>配件类型</th><th>序列号</th><th>内部编码</th><th>状态</th><th>当前位置</th><th>关联机车</th><th>操作</th></tr></thead><tbody>
        ${state.componentInstances.map(c=>`<tr><td>${componentTypeOf(state,c.typeId)?.name||'—'}</td><td class="mono">${c.serialNo}</td><td class="mono">${c.assetCode}</td><td>${badge(c.status,statusBadge(c.status))}</td><td>${c.location}</td><td>${c.locomotiveNo||'—'}</td><td><select class="select" style="padding:6px 8px;width:130px" data-component-status="${c.id}"><option value="${c.status}">${c.status}</option>${['AVAILABLE','WAIT_REPAIR','REPAIRING','QUALIFIED','INSTALLED','SCRAPPED'].filter(s=>s!==c.status).map(s=>`<option value="${s}">${s}</option>`).join('')}</select></td></tr>`).join('')}
        </tbody></table></div>
      </section>`
  },
  mount(ctx) {
    document.querySelectorAll('[data-component-status]').forEach(sel=>sel.addEventListener('change',()=>{
      updateComponentStatus(ctx.state,sel.dataset.componentStatus,sel.value); toast('配件状态已更新',sel.value); ctx.rerender()
    }))
  }
}
