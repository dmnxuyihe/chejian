import { pageHeader, statCard } from '../../../shared/templates.js'
import { componentStats, statusBadge } from '../../../core/derived.js'
import { badge } from '../../../core/ui.js'

export const dashboardPage = {
  render({ state }) {
    const comps = componentStats(state)
    const unavailable = state.equipment.filter(e=>e.status!=='AVAILABLE').length
    return `
      ${pageHeader('基础资源总览','维护排程计算所需的人员、工位、设备和配件基础数据。')}
      <div class="grid grid-5" style="margin-bottom:16px">
        ${statCard('班组',state.teams.length,'当前初始化班组')}
        ${statCard('人员',state.employees.length,'走行 + 天车','metric-indigo')}
        ${statCard('工位',state.workstations.length,'构架 / 轮驱')}
        ${statCard('设备',state.equipment.length, unavailable ? `${unavailable} 台不可用` : '全部可用','metric-green')}
        ${statCard('配件实例',state.componentInstances.length,'按一件一条补充','metric-amber')}
      </div>
      <div class="grid grid-2">
        <section class="card">
          <div class="card-title-row"><div><div class="card-title">排程资源状态</div><div class="card-subtitle">只展示与第一版排程直接相关的数据</div></div></div>
          <div class="table-wrap"><table><thead><tr><th>资源</th><th>数量</th><th>状态</th></tr></thead><tbody>
            <tr><td>走行班人员</td><td>${state.employees.filter(e=>e.teamId===1).length}</td><td>${badge('正常','badge-green')}</td></tr>
            <tr><td>天车班人员</td><td>${state.employees.filter(e=>e.teamId===2).length}</td><td>${badge('正常','badge-green')}</td></tr>
            <tr><td>检修工位</td><td>${state.workstations.length}</td><td>${badge('可排程','badge-indigo')}</td></tr>
            <tr><td>设备</td><td>${state.equipment.length}</td><td>${badge(unavailable?'存在不可用':'全部可用',unavailable?'badge-amber':'badge-green')}</td></tr>
            <tr><td>配件类型</td><td>${state.componentTypes.length}</td><td>${badge('已补充','badge-purple')}</td></tr>
          </tbody></table></div>
        </section>
        <section class="card">
          <div class="card-title-row"><div><div class="card-title">配件可用情况</div><div class="card-subtitle">库存数量由具体配件实例聚合</div></div></div>
          <div class="load-list">
            ${comps.map(c=>`<div class="load-row"><div class="load-name"><strong>${c.name}</strong><span>${c.code}</span></div><div class="progress"><span style="width:${c.total?Math.round(c.available/c.total*100):0}%"></span></div><div class="load-value">${c.available}/${c.total}</div></div>`).join('')}
          </div>
        </section>
      </div>`
  },
  mount() {}
}
