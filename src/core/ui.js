import { contextIcon } from '../shared/workspace-art.js'
import { icon } from '../shared/icons.js'

export function escapeHtml(value='') {
  return String(value)
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#039;')
}

export function toast(title, message='', type='success') {
  let stack = document.querySelector('.toast-stack')
  if (!stack) {
    stack = document.createElement('div')
    stack.className = 'toast-stack'
    document.body.appendChild(stack)
  }
  const el = document.createElement('div')
  el.className = `toast ${type}`
  el.innerHTML = `<strong>${escapeHtml(title)}</strong><div>${escapeHtml(message)}</div>`
  stack.appendChild(el)
  setTimeout(()=>el.remove(), 2600)
}

let modalSequence = 0
const suspendedModals=new Set()
let closingRoute=false
export function openModalChild(parent,open,onReturn){
  const scroll=parent.querySelector('.modal-body')?.scrollTop||0,focus=document.activeElement
  suspendedModals.add(parent);parent.remove()
  let result
  try{result=open()}catch(error){suspendedModals.delete(parent);document.body.append(parent);throw error}
  const child=result?.classList?.contains('modal-backdrop')?result:document.querySelector('.modal-backdrop:last-of-type')
  const restore=()=>{suspendedModals.delete(parent);if(closingRoute)return;if(onReturn?.()===false)return;document.body.append(parent);const body=parent.querySelector('.modal-body');if(body)body.scrollTop=scroll;if(focus?.isConnected)focus.focus({preventScroll:true})}
  if(child)child.addEventListener('modal:closed',restore,{once:true});else restore()
  return result
}
export function closeRouteModals(){
  closingRoute=true
  const dialogs=[...document.querySelectorAll('.modal-backdrop')].reverse()
  if(dialogs.some(w=>w.closeModal?.('route')===false)){closingRoute=false;return false}
  suspendedModals.clear();closingRoute=false;return true
}
export function openModal({ title, body, confirmText='确认', cancelText='取消', onConfirm, beforeClose, wide=false }) {
  const opener = document.activeElement
  const titleId = `modal-title-${++modalSequence}`
  let busy = false
  const wrap = document.createElement('div')
  wrap.className = 'modal-backdrop'
  wrap.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}" style="${wide ? `width:min(${wide === 'extra' ? '1080px' : '780px'},calc(100vw - 44px))` : ''}">
      <div class="modal-head"><div class="modal-title-line"><span class="modal-title-icon">${contextIcon(title,22)}</span><h3 id="${titleId}">${escapeHtml(title)}</h3></div><button class="btn btn-icon btn-sm" data-modal-close aria-label="关闭对话框">${icon('close',16)}</button></div>
      <div class="modal-body">${body}</div>
      <div class="modal-actions">
        ${cancelText == null ? '' : `<button class="btn" data-modal-close data-modal-cancel>${cancelText}</button>`}
        <button class="btn btn-primary" data-modal-confirm>${confirmText}</button>
      </div>
    </div>`
  document.body.appendChild(wrap)
  const close = (reason='close',force=false) => {
    if (busy) return false
    if (!force && beforeClose && beforeClose(wrap) === false) return false
    wrap.remove()
    wrap.dispatchEvent(new CustomEvent('modal:closed',{detail:{reason}}))
    if (opener?.isConnected) opener.focus({ preventScroll: true })
    else document.querySelector('[data-add-plan], [data-pc-data-tools], #main-content')?.focus({ preventScroll: true })
    return true
  }
  wrap.closeModal=close
  const focusable = () => [...wrap.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length)
  wrap.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); close() }
    if (e.key === 'Tab') {
      const items = focusable(), first = items[0], last = items.at(-1)
      if (!first) return
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  })
  if (wrap.isConnected) (wrap.querySelector('input:not(:disabled):not([type="hidden"])') || focusable()[0])?.focus()
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close()
    else if (e.target.closest('[data-modal-cancel]')) close('cancel',true)
    else if (e.target.closest('[data-modal-close]')) close()
  })
  wrap.querySelector('[data-modal-confirm]')?.addEventListener('click', async e => {
    if (busy) return
    busy = true; e.currentTarget.disabled = true
    wrap.querySelector('[role="dialog"]').setAttribute('aria-busy', 'true')
    let result = false
    try { result = await onConfirm?.(wrap) }
    catch (error) { toast('操作未完成', error.message || '请重试', 'warning') }
    finally {
      busy = false
      wrap.querySelector('[data-modal-confirm]').disabled = !!wrap.confirmBlocked
      wrap.querySelector('[role="dialog"]').removeAttribute('aria-busy')
    }
    if (result !== false) close('confirmed')
  })
  return wrap
}

export function badge(text, cls='badge-slate') {
  return `<span class="badge ${cls}">${escapeHtml(text)}</span>`
}
