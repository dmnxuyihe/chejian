import { createState } from './state.js'
import { renderShell } from './layout.js'
import { openModal, toast } from './ui.js'
import { roleSelectionPage } from '../role-selection/index.js'
import { roles } from '../roles/index.js'

export const state = createState()
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
    state, role, page,
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

export function render() {
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
window.addEventListener('DOMContentLoaded',()=>{
  if (localStorage.getItem('scheduler-theme')==='dark') document.documentElement.classList.add('dark')
  if (!location.hash) location.hash='#/select'
  else render()
})

window.__APP_STATE__=state
window.__APP_DEBUG__={render,enterRole,openWorkerPicker,getRoute:()=>({role:currentRoleId,page:currentPageId})}
