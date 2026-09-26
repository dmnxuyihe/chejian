import { pageHeader, statCard } from '../../../shared/templates.js'
import { fmtFullDateTime, employeeLoad } from '../../../core/derived.js'
import { runAutoSchedule, publishSchedule } from '../../../core/actions.js'
import { toast } from '../../../core/ui.js'

export const dashboardPage = {
  render({ state }) {
    const vehicle = state.vehicleRepairs[0]
    const version = state.scheduleVersions.find(v => v.id === vehicle.currentVersionId)
    const loads = state.employees.map(e=>({e, min:employeeLoad(state,e.id)})).sort((a,b)=>b.min-a.min)
    const avg = loads.length ? Math.round(loads.reduce((s,x)=>s+x.min,0)/loads.length) : 0
    const assignedComponents = new Set(state.componentAssignments.filter(a=>a.status!=='CANCELLED').map(a=>a.componentInstanceId)).size
    return `${pageHeader('智能排程驾驶台','第一版核心：在FS、工位、人员、设备和配件约束下排到具体人员，再由工班长做现场微调。',
      `<button class="btn" data-publish ${state.published?'disabled':''}>${state.published?'已发布':'发布当前排程'}</button><button class="btn btn-primary" data-run-schedule>重新智能排程</button>`)}
      <div class="grid grid-5" style="margin-bottom:16px">
        ${statCard('当前车辆',vehicle.locomotiveNo,'HXD1C高级修')}
        ${statCard('排程版本',`V${version?.versionNo||1}`,state.published?'已发布':'草稿','metric-indigo')}
        ${statCard('任务数量',state.schedules.length,'构架4 · 轮驱16')}
        ${statCard('平均人员负荷',`${avg} 分钟`,'按当前任务累计','metric-green')}
        ${statCard('排程异常',state.exceptions.length,'硬约束冲突','metric-red')}
      </div>
      <div class="grid grid-2" style="margin-bottom:16px">
        <section class="card">
          <div class="card-title-row"><div><div class="card-title">当前排程摘要</div><div class="card-subtitle">计划时间、资源占用与发布状态</div></div></div>
          <div class="detail-grid">
            <div><span>计划进场</span><strong>${fmtFullDateTime(vehicle.plannedEntryAt)}</strong></div>
            <div><span>计划交车</span><strong>${fmtFullDateTime(vehicle.plannedExitAt)}</strong></div>
            <div><span>人员分配</span><strong>${state.employeeAssignments.filter(a=>a.status!=='CANCELLED').length} 条</strong></div>
            <div><span>设备分配</span><strong>${state.equipmentAssignments.length} 条</strong></div>
            <div><span>配件绑定</span><strong>${assignedComponents} 件</strong></div>
            <div><span>48小时工艺等待</span><strong>轮对压装 → 反压</strong></div>
          </div>
          <div class="notice notice-info" style="margin-top:16px"><span>i</span><div>系统自动排到具体人员；算法优先选择当前累计负荷较低且时间可用的同班组人员。现场人员变化由工班长页面微调。</div></div>
        </section>
        <section class="card">
          <div class="card-title-row"><div><div class="card-title">近期排程活动</div><div class="card-subtitle">仅保留与第一版主链相关的操作</div></div></div>
          <div class="timeline">${state.activityLog.slice(0,6).map(x=>`<div class="timeline-item"><strong>${x.type} · ${x.time}</strong><p>${x.text}</p></div>`).join('')}</div>
        </section>
      </div>
      <section class="card">
        <div class="card-title-row"><div><div class="card-title">排程硬约束</div><div class="card-subtitle">第一版优先保证可执行，不擅自增加工艺节点</div></div></div>
        <div class="constraint-grid">
          ${['FS前后置依赖','工位容量不冲突','人员时间不冲突','班组人数满足','设备不重复占用','配件实例可用','48小时反压等待'].map((x,i)=>`<div class="constraint-item"><span class="constraint-ok">✓</span><div><strong>${x}</strong><p>${i===6?'来自原冻结数据库依赖 lag=2880 分钟':'纳入本地智能排程校验'}</p></div></div>`).join('')}
        </div>
      </section>`
  },
  mount(ctx) {
    document.querySelector('[data-run-schedule]')?.addEventListener('click',()=>{
      const result = runAutoSchedule(ctx.state)
      toast('智能排程完成',`生成 V${result.versionNo}，硬冲突 ${result.exceptionCount} 项`, result.exceptionCount?'warning':'success')
      ctx.rerender()
    })
    document.querySelector('[data-publish]')?.addEventListener('click',()=>{
      publishSchedule(ctx.state); toast('排程已发布','工班长和作业人员可查看最终任务'); ctx.rerender()
    })
  }
}
