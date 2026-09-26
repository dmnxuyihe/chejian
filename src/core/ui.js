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

export function openModal({ title, body, confirmText='确认', cancelText='取消', onConfirm, wide=false }) {
  const wrap = document.createElement('div')
  wrap.className = 'modal-backdrop'
  wrap.innerHTML = `
    <div class="modal" style="${wide ? 'width:min(780px,100%)' : ''}">
      <div class="modal-head"><h3>${title}</h3><button class="btn btn-icon btn-sm" data-modal-close>×</button></div>
      <div class="modal-body">${body}</div>
      <div class="modal-actions">
        <button class="btn" data-modal-close>${cancelText}</button>
        <button class="btn btn-primary" data-modal-confirm>${confirmText}</button>
      </div>
    </div>`
  document.body.appendChild(wrap)
  const close = () => wrap.remove()
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-modal-close]')) close()
  })
  wrap.querySelector('[data-modal-confirm]')?.addEventListener('click', async () => {
    const result = await onConfirm?.(wrap)
    if (result !== false) close()
  })
  return wrap
}

export function badge(text, cls='badge-slate') {
  return `<span class="badge ${cls}">${escapeHtml(text)}</span>`
}
