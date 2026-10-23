import { roleCatalog } from '../roles/index.js'

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
          ${roleCatalog.map(({id,label,short,description})=>`
            <button class="role-card" data-role-card="${id}" data-test="role-${id}">
              <div class="role-card-icon">${short}</div>
              <h3>${label}</h3>
              <p>${description}</p>
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
