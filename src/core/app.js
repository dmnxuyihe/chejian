import { createState } from './state.js'
import { renderShell } from './layout.js'
import { openModal, toast } from './ui.js'
import { roleSelectionPage } from '../role-selection/index.js'
import { roles } from '../roles/index.js'
import { createDemoPersistence } from './demo-persistence.js'
import { createDatabasePersistence } from './database-persistence.js'

export const state = createState()
// Access can fail in restricted/private browser contexts. Keep the page usable and
// expose actual save errors instead of silently claiming that data was saved.
let demoPersistence, initialized = false
function updateSaveStatus(status) {
  const el = document.querySelector('.pc-save-row [role="status"], [data-pc-query-status]')
  if (el) { el.textContent = `${status.message}${status.savedAt && status.ok ? ` · ${new Date(status.savedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}`; el.classList.toggle('pc-error-text', !status.ok) }
}
async function initialize() {
  app.innerHTML = '<div class="empty" role="status">正在加载检修计划数据…</div>'
  try {
    const response = await fetch('/api/config', { cache: 'no-store' })
    if (!response.ok) throw new Error('无法读取后端配置')
    const config = await response.json()
    if (config.storage === 'postgresql') {
      demoPersistence = createDatabasePersistence(state, { onStatus: updateSaveStatus, onRemote: () => render(false) })
      const result = await demoPersistence.load()
      if (!result.ok) throw new Error(result.message)
      setInterval(() => { if (!document.hidden && !document.querySelector('.modal-backdrop, .pc-data-confirm')) demoPersistence.poll() }, 3000)
    } else if (config.storage === 'local') {
      demoPersistence = createDemoPersistence(state, { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) })
      demoPersistence.load()
    } else throw new Error('后端存储配置无效')
    initialized = true
    if (!location.hash) location.hash = '#/select'
    else render()
  } catch (error) {
    app.innerHTML = '<div class="empty"><strong>无法加载数据库</strong><p data-load-error></p><button class="btn" data-load-retry>重试连接</button></div>'
    document.querySelector('[data-load-error]').textContent = error.message
    document.querySelector('[data-load-retry]').addEventListener('click', () => location.reload())
  }
}
let currentRoleId = null
let currentPageId = null

const app = document.querySelector('#app')

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '')
  if (!raw || raw === 'select') return { type:'select' }
  const [roleId,pageId] = raw.split('/')
  if (!roles[roleId]) return { type:'select' }
  return { type:'role', roleId, pageId: pageId || roles[roleId].defaultPage }
}

function go(path) {
  const hash = `#/${path}`
  if (location.hash === hash) render()
  else location.hash = hash
}

export function enterRole(roleId, pageId=null) {
  const role = roles[roleId]
  if (!role) return go('select')
  go(`${roleId}/${pageId || role.defaultPage}`)
}

export function openWorkerPicker() {
  openModal({
    title:'选择作业人员',
    wide:true,
    body:`<div class="notice notice-info" style="margin-bottom:14px"><span>i</span><div>第一版不做账号登录，直接选择人员进入“我的任务”。进入后仍可切换人员。</div></div><div class="person-picker">${state.employees.map(e=>`<button class="person-pill ${e.id===state.selectedWorkerId?'active':''}" type="button" data-pick-worker="${e.id}">${e.name} · ${e.teamName}</button>`).join('')}</div><input type="hidden" data-worker-id value="${state.selectedWorkerId}">`,
    confirmText:'进入我的任务',
    onConfirm(modal){
      const id=Number(modal.querySelector('[data-worker-id]').value)
      state.selectedWorkerId=id
      enterRole('worker')
    }
  })
  const modal=document.querySelector('.modal-backdrop')
  modal?.querySelectorAll('[data-pick-worker]').forEach(btn=>btn.addEventListener('click',()=>{
    modal.querySelectorAll('[data-pick-worker]').forEach(x=>x.classList.remove('active'))
    btn.classList.add('active'); modal.querySelector('[data-worker-id]').value=btn.dataset.pickWorker
  }))
}

function roleContext(role,page) {
  return {
    state, role, page, demoPersistence,
    enterRole, openWorkerPicker,
    navigate(pageId){ enterRole(role.id,pageId) },
    rerender(){ render() },
  }
}

function bindShell(role) {
  document.querySelectorAll('[data-nav]').forEach(btn=>btn.addEventListener('click',()=>enterRole(role.id,btn.dataset.nav)))
  document.querySelectorAll('[data-switch-role]').forEach(btn=>btn.addEventListener('click',()=>go('select')))
  document.querySelectorAll('[data-theme-toggle]').forEach(btn=>btn.addEventListener('click',()=>{
    document.documentElement.classList.toggle('dark')
    localStorage.setItem('scheduler-theme',document.documentElement.classList.contains('dark')?'dark':'light')
    toast('主题已切换',document.documentElement.classList.contains('dark')?'深色模式':'浅色模式')
  }))
}

export function render(persist = true) {
  if (!initialized) return
  if (persist !== false) demoPersistence.save()
  const route=parseRoute()
  if (route.type==='select') {
    currentRoleId=null; currentPageId=null
    app.innerHTML=roleSelectionPage.render()
    roleSelectionPage.mount({ state, enterRole, openWorkerPicker })
    document.title='选择角色 · 高级修智能排程'
    return
  }
  const role=roles[route.roleId]
  const pageId=role.pages[route.pageId] ? route.pageId : role.defaultPage
  const page=role.pages[pageId]
  currentRoleId=role.id; currentPageId=pageId
  const ctx=roleContext(role,pageId)
  const pageHtml=page.render(ctx)
  const worker=role.id==='worker'?state.employees.find(e=>e.id===state.selectedWorkerId):null
  app.innerHTML=renderShell({role,page:pageId,pageHtml,selectedWorkerName:worker?.name||''})
  bindShell(role)
  page.mount?.(ctx)
  document.title=`${role.nav.find(n=>n.id===pageId)?.label||role.label} · 高级修智能排程`
}

window.addEventListener('hashchange',render)
window.addEventListener('pagehide', () => demoPersistence?.save())
window.addEventListener('DOMContentLoaded',()=>{
  try { if (localStorage.getItem('scheduler-theme')==='dark') document.documentElement.classList.add('dark') } catch {}
  initialize()
})

window.__APP_STATE__=state
window.__APP_DEBUG__={render,enterRole,openWorkerPicker,getRoute:()=>({role:currentRoleId,page:currentPageId}),getPersistence:()=>demoPersistence}
