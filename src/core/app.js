import { createState } from './state.js'
import { openModal, toast, closeRouteModals } from './ui.js'
import { functionHomePage, renderFunctionShell, mountFunctionShell } from '../functions/index.js'
import { functionForSource, functionPath, presentationViews } from '../functions/catalog.js'
import { resolveFunctionRoute, defaultFunctionEntry } from '../functions/routes.js'
import { roles } from '../roles/index.js'
import { workspaceArt } from '../shared/workspace-art.js'
import { createDemoPersistence } from './demo-persistence.js'
import { createDatabasePersistence } from './database-persistence.js'
import { demoPath, renderDemoShell } from '../demo/index.js'

export const state = createState()
// Access can fail in restricted/private browser contexts. Keep the page usable and
// expose actual save errors instead of silently claiming that data was saved.
let demoPersistence, initialized = false
function updateSaveStatus(status) {
  const el = document.querySelector('.pc-save-row [role="status"], [data-pc-query-status], [data-pc1-save-status]')
  if (el) { el.textContent = `${status.message}${status.savedAt && status.ok ? ` · ${new Date(status.savedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}`; el.classList.toggle('pc-error-text', !status.ok) }
}
async function initialize() {
  app.innerHTML = `<div class="empty illustrated-empty" role="status">${workspaceArt('vehicle')}<strong>正在加载检修计划数据…</strong></div>`
  try {
    const response = await fetch('/api/config', { cache: 'no-store' })
    if (!response.ok) throw new Error('无法读取后端配置')
    const config = await response.json()
    if (config.storage === 'postgresql') {
      demoPersistence = createDatabasePersistence(state, { onStatus: updateSaveStatus, onRemote: () => render(false) })
      const result = await demoPersistence.load()
      if (!result.ok) throw new Error(result.message)
      setInterval(() => { if (!document.hidden && !document.querySelector('.modal-backdrop, .pc-data-confirm, [data-pc1-dragging]')) demoPersistence.poll() }, 3000)
    } else if (config.storage === 'local') {
      demoPersistence = createDemoPersistence(state, { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) })
      demoPersistence.load()
    } else throw new Error('后端存储配置无效')
    initialized = true
    if (!location.hash) location.hash = location.pathname.endsWith('/demo.html') ? '#/demo/calendar' : `#/${functionPath(defaultFunctionEntry)}`
    else render()
  } catch (error) {
    app.innerHTML = `<div class="empty illustrated-empty">${workspaceArt('record')}<strong>无法加载数据库</strong><p data-load-error></p><button class="btn" data-load-retry>重试连接</button></div>`
    document.querySelector('[data-load-error]').textContent = error.message
    document.querySelector('[data-load-retry]').addEventListener('click', () => location.reload())
  }
}
let currentRoleId = null
let currentPageId = null

const app = document.querySelector('#app')

function parseRoute() {
  return resolveFunctionRoute(location.hash)
}

function go(path) {
  const hash = `#/${path}`
  if (location.hash === hash) render()
  else location.hash = hash
}

export function enterRole(roleId, pageId=null) {
  const role = roles[roleId]
  if (!role) return go('functions')
  const entry=functionForSource(roleId,pageId || role.defaultPage)
  go(entry ? functionPath(entry) : 'functions')
}

export function openWorkerPicker() {
  openModal({
    title:'选择作业查询对象',
    wide:true,
    body:`<div class="notice notice-info" style="margin-bottom:14px"><span>i</span><div>选择需要查看检修任务的人员。此项仅筛选作业数据。</div></div><div class="person-picker">${state.employees.map(e=>`<button class="person-pill ${e.id===state.selectedWorkerId?'active':''}" type="button" data-pick-worker="${e.id}">${e.name} · ${e.teamName}</button>`).join('')}</div><input type="hidden" data-worker-id value="${state.selectedWorkerId}">`,
    confirmText:'查看检修任务',
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

function roleContext(role,page,demo = null) {
  const navigateRole = demo ? (roleId,pageId) => go(demoPath(roleId,pageId || roles[roleId]?.defaultPage)) : enterRole
  return {
    state, role, page, demoPersistence, demo: Boolean(demo), demoPage: demo?.id,
    enterRole: navigateRole, openWorkerPicker,
    navigate(pageId){ navigateRole(role.id,pageId) },
    rerender(persist = true){ render(persist) },
  }
}

function bindShell(role = null) {
  mountFunctionShell()
  document.querySelector('[data-skip-content]')?.addEventListener('click', event => { event.preventDefault(); document.querySelector('#main-content')?.focus() })
  if (role) document.querySelectorAll('[data-nav]').forEach(btn=>btn.addEventListener('click',()=>enterRole(role.id,btn.dataset.nav)))
  document.querySelectorAll('[data-switch-role]').forEach(btn=>btn.addEventListener('click',()=>go('functions')))
  document.querySelectorAll('[data-theme-toggle]').forEach(btn=>btn.addEventListener('click',()=>{
    document.documentElement.classList.toggle('dark')
    localStorage.setItem('scheduler-theme',document.documentElement.classList.contains('dark')?'dark':'light')
    localStorage.setItem('scheduler-ui-theme-v2',document.documentElement.classList.contains('dark')?'dark':'light')
    localStorage.setItem('scheduler-workspace-theme-v3',document.documentElement.classList.contains('dark')?'dark':'light')
    localStorage.setItem('scheduler-workspace-theme-v4',document.documentElement.classList.contains('dark')?'dark':'light')
    toast('主题已切换',document.documentElement.classList.contains('dark')?'深色模式':'浅色模式')
  }))
}

let renderedHash=null
export function render(persist = true) {
  if (!initialized) return
  if(renderedHash!==null&&renderedHash!==location.hash&&!closeRouteModals()){location.hash=renderedHash;return}
  renderedHash=location.hash
  if (persist !== false) demoPersistence.save()
  const route=parseRoute()
  document.documentElement.toggleAttribute('data-demo-mode',route.type==='demo')
  document.documentElement.toggleAttribute('data-current-ui',route.type!=='demo')
  if (route.type==='demo') {
    const entry=route.demo,role=roles[entry.role],page=role.pages[entry.page]
    currentRoleId='demo'; currentPageId=entry.id
    const ctx=roleContext(role,entry.page,entry)
    app.innerHTML=renderDemoShell({id:entry.id,pageHtml:page.render(ctx)})
    bindShell()
    page.mount?.(ctx)
    document.title=`${document.querySelector('.demo-nav [aria-current] .demo-nav-copy strong')?.textContent.trim() || '功能演示'} · PC1智能检修`
    return
  }
  if (route.type==='catalog') {
    if(location.hash!=='#/functions/catalog') history.replaceState(null,'','#/functions/catalog')
    currentRoleId=null; currentPageId=null
    app.innerHTML=functionHomePage.render()
    bindShell()
    functionHomePage.mount()
    document.title='全部功能 · 智能检修'
    return
  }
  const entry=route.entry,role=roles[entry.role]
  const pageId=entry.page
  const canonical=`#/${functionPath(entry)}`
  if(location.hash!==canonical) history.replaceState(null,'',canonical)
  const page=role.pages[pageId]
  currentRoleId=role.id; currentPageId=pageId
  const ctx=roleContext(role,pageId)
  if(presentationViews[entry.id]) { ctx.demo=true; ctx.demoPage=presentationViews[entry.id] }
  const pageHtml=page.render(ctx)
  app.innerHTML=renderFunctionShell({entry,pageHtml})
  bindShell()
  page.mount?.(ctx)
  document.title=`${entry.label} · 智能检修`
}

window.addEventListener('hashchange',render)
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || document.querySelector('.modal-backdrop')) return
  const details = event.target.closest?.('.workspace-menu[open], .pc1-row-options[open]')
  if (details) { details.open = false; details.querySelector('summary')?.focus(); return }
  if (document.querySelector('.app-shell.nav-open')) document.querySelector('[data-nav-close]')?.click()
})
document.addEventListener('click', event => {
  document.querySelectorAll('.workspace-menu[open], .pc1-row-options[open]').forEach(details => { if (!details.contains(event.target)) details.open = false })
})
window.addEventListener('pagehide', () => demoPersistence?.save())
window.addEventListener('DOMContentLoaded',()=>{
  try { document.documentElement.classList.toggle('dark', localStorage.getItem('scheduler-workspace-theme-v4') !== 'light') } catch { document.documentElement.classList.add('dark') }
  initialize()
})

window.__APP_STATE__=state
window.__APP_DEBUG__={render,enterRole,openWorkerPicker,getRoute:()=>({role:currentRoleId,page:currentPageId}),getPersistence:()=>demoPersistence}
