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
export function openModal({ title, body, confirmText='确认', cancelText='取消', onConfirm, wide=false }) {
  const opener = document.activeElement
  const titleId = `modal-title-${++modalSequence}`
  let busy = false
  const wrap = document.createElement('div')
  wrap.className = 'modal-backdrop'
  wrap.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}" style="${wide ? 'width:min(780px,100%)' : ''}">
      <div class="modal-head"><h3 id="${titleId}">${escapeHtml(title)}</h3><button class="btn btn-icon btn-sm" data-modal-close aria-label="关闭对话框">×</button></div>
      <div class="modal-body">${body}</div>
      <div class="modal-actions">
        <button class="btn" data-modal-close>${cancelText}</button>
        <button class="btn btn-primary" data-modal-confirm>${confirmText}</button>
      </div>
    </div>`
  document.body.appendChild(wrap)
  const close = () => {
    if (busy) return
    wrap.remove()
    if (opener?.isConnected) opener.focus({ preventScroll: true })
    else document.querySelector('[data-add-plan], [data-pc-data-tools]')?.focus({ preventScroll: true })
  }
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
  requestAnimationFrame(() => { if (wrap.isConnected) (wrap.querySelector('input:not(:disabled)') || focusable()[0])?.focus() })
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-modal-close]')) close()
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
      wrap.querySelector('[data-modal-confirm]').disabled = false
      wrap.querySelector('[role="dialog"]').removeAttribute('aria-busy')
    }
    if (result !== false) close()
  })
  return wrap
}

export function badge(text, cls='badge-slate') {
  return `<span class="badge ${cls}">${escapeHtml(text)}</span>`
}
