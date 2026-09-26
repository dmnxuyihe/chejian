const roles = [
  ['system-admin','系统管理员','系','维护班组、人员、休假、工位、设备、配件等排程基础数据。'],
  ['planning','计划管理人员','计','建立车辆检修计划，指定进场、交车时间与优先级后提交排程。'],
  ['scheduling','生产排程 / 调度人员','排','运行智能排程，查看甘特、人员负荷、工位负荷、资源约束和异常。'],
  ['foreman','工班长 / 组长','班','查看系统已排人员，在现场进行同班组换人、增员等小范围微调。'],
  ['worker','作业人员','作','选择具体人员后查看个人任务，执行开始与完成操作。'],
  ['quality','质量人员','质','对已完成任务进行简化专检 / 验收，记录通过或不通过。'],
  ['technical','技术人员','技','只读查看修程任务、FS关系和资源要求，不擅自增删流程。'],
]

export const roleSelectionPage = {
  render() {
    return `
    <section class="role-select-page" data-test="role-select-page">
      <div class="role-select-shell">
        <div class="role-hero">
          <div class="logo">智</div>
          <h1>高级修车间智能排程</h1>
          <p>第一版 · 请选择当前使用角色，无需账号登录</p>
        </div>
        <div class="role-grid" data-test="role-grid">
          ${roles.map(([id,label,short,desc])=>`
            <button class="role-card" data-role-card="${id}" data-test="role-${id}">
              <div class="role-card-icon">${short}</div>
              <h3>${label}</h3>
              <p>${desc}</p>
              <div class="role-entry">进入角色页面 →</div>
            </button>`).join('')}
        </div>
        <div class="notice notice-info" style="margin:18px auto 0;max-width:780px">
          <span>i</span><div>流程节点来自现有构架 / 轮驱检修流程；数据库展示以现有冻结结构为基础，仅补充排程需要的配件类型、实例、需求和占用信息。</div>
        </div>
      </div>
    </section>`
  },
  mount(ctx) {
    document.querySelectorAll('[data-role-card]').forEach(btn=>btn.addEventListener('click',()=>{
      const role = btn.dataset.roleCard
      if (role === 'worker') {
        ctx.openWorkerPicker()
      } else {
        ctx.enterRole(role)
      }
    }))
  }
}
