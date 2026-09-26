import { pageHeader, emptyState } from '../../../shared/templates.js'
import { badge } from '../../../core/ui.js'
import { taskOf } from '../../../core/derived.js'

export const exceptionsPage = {
  render({ state }) {
    return `${pageHeader('排程异常与约束提示','只处理影响排程可执行性的冲突；48小时静置属于正常工艺等待，不作为异常。')}
      <section class="card">${state.exceptions.length ? `<div class="table-wrap"><table><thead><tr><th>级别</th><th>类型</th><th>任务</th><th>说明</th><th>状态</th></tr></thead><tbody>${state.exceptions.map(x=>`<tr><td>${badge(x.severity||'HIGH','badge-red')}</td><td class="mono">${x.type}</td><td>${taskOf(state,x.taskId)?.name||'—'}</td><td>${x.message}</td><td>${badge(x.status,'badge-amber')}</td></tr>`).join('')}</tbody></table></div>` : emptyState('当前无硬约束冲突','人员、工位、设备和配件资源满足当前排程。')}</section>
      <div class="notice notice-warn" style="margin-top:16px"><span>!</span><div><strong>正常工艺等待：</strong>轮对压装完成后至轮对反压开始，保持原数据库 FS + 2880分钟（48小时）约束。</div></div>`
  }, mount(){}
}
