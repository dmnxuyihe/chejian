import { createState } from './state.js'
import { DEMO_STORAGE_KEY, applyDemoData, exportDemoSnapshot, parseDemoSnapshot } from './demo-persistence.js'

const localKeys = ['selectedWorkerId', 'selectedTeamId', 'selectedVehicleRepairId', 'ganttFilters', 'planningView']
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
const domain = state => Object.fromEntries(Object.entries(exportDemoSnapshot(state).data).filter(([k]) => !localKeys.includes(k)))
export const VIEW_STORAGE_KEY = 'rail-maintenance.pc1-view.v1'

export function createDatabasePersistence(state, { fetchImpl = fetch, onStatus = () => {}, onRemote = () => {}, storage, viewStorage } = {}) {
  let revision = null, savedData = '', blocked = false, active = null, pending = false, loaded = false, viewLoaded = false
  const status = { ok: false, savedAt: null, message: '正在连接PostgreSQL…', storage: 'postgresql' }
  const notify = values => { Object.assign(status, values); onStatus(status) }
  function saveView() {
    try {
      const data = exportDemoSnapshot(state).data
      const local = Object.fromEntries(localKeys.filter(k => data[k] !== undefined).map(k => [k, data[k]]))
      ;(viewStorage ?? globalThis.sessionStorage)?.setItem(VIEW_STORAGE_KEY, JSON.stringify(local))
    } catch { /* View preferences do not change whether business records were saved. */ }
  }
  function restoreView() {
    if (viewLoaded) return
    viewLoaded = true
    try {
      const text = (viewStorage ?? globalThis.sessionStorage)?.getItem(VIEW_STORAGE_KEY)
      if (!text) return
      const local = JSON.parse(text)
      const backup = exportDemoSnapshot(state)
      for (const key of localKeys) if (local[key] !== undefined) backup.data[key] = local[key]
      const checked = parseDemoSnapshot(JSON.stringify(backup))
      for (const key of localKeys) if (checked.data[key] !== undefined) state[key] = checked.data[key]
    } catch { /* A bad or unavailable preference cache must not block the database. */ }
  }
  async function request(method = 'GET', payload) {
    const response = await fetchImpl('/api/state', { method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(15000), ...(payload ? { body: JSON.stringify(payload) } : {}) })
    const result = await response.json()
    if (!response.ok) throw Object.assign(new Error(result.message || '数据库请求失败'), { status: response.status })
    return result
  }
  function receive(result, preserveView = true) {
    if (!Number.isSafeInteger(result.revision) || result.revision < 1) throw new Error('数据库响应版本无效')
    const backup = parseDemoSnapshot(JSON.stringify(result.snapshot))
    const local = Object.fromEntries(localKeys.filter(k => state[k] !== undefined).map(k => [k, state[k]]))
    applyDemoData(state, backup.data)
    if (preserveView) Object.assign(state, local)
    restoreView()
    if (!state.vehicleRepairs.some(v => v.id === state.selectedVehicleRepairId)) state.selectedVehicleRepairId = state.vehicleRepairs[0]?.id ?? null
    if (state.planningView?.vehicleFilter && !state.vehicleRepairs.some(v => v.id === Number(state.planningView.vehicleFilter))) state.planningView.vehicleFilter = ''
    revision = result.revision; savedData = stable(domain(state)); loaded = true; blocked = false
    notify({ ok: true, savedAt: backup.savedAt, message: `已连接PostgreSQL · 数据版本${revision}` })
  }
  function failure(error) {
    if (error.status === 409) blocked = true
    notify({ ok: false, message: `${error.status === 409 ? '数据版本冲突' : '数据库未保存'}：${error.message}。当前修改仍保留，可导出备份。` })
    return { ok: false, message: status.message }
  }
  const controller = {
    status,
    async load() {
      try {
        if (active) await active
        const result = await request()
        const oldText = controller.localBackup()
        // Automatic migration is safe only into the untouched, freshly seeded DB.
        // Existing shared data is never replaced merely by opening an old browser.
        if (result.revision === 1 && oldText && stable(domain(result.snapshot.data)) === stable(domain(createState()))) {
          const old = parseDemoSnapshot(oldText)
          if (stable(domain(old.data)) !== stable(domain(createState()))) {
            try {
              const saved = await request('PUT', { revision: 1, snapshot: old })
              receive({ revision: saved.revision, snapshot: { ...old, savedAt: saved.savedAt } }, false)
              notify({ ok: true, message: `已迁移本机旧数据到PostgreSQL · 数据版本${saved.revision}` })
              return { ok: true, restored: true, migrated: true }
            } catch (error) { if (error.status !== 409) throw error; receive(await request()); return { ok: true, restored: true } }
          }
        }
        receive(result); return { ok: true, restored: true }
      }
      catch (error) { loaded = false; return failure(error) }
    },
    save() {
      saveView()
      if (!loaded || blocked) return Promise.resolve({ ok: false, message: status.message })
      pending = true
      if (active) return active
      active = Promise.resolve().then(async () => {
        try {
          while (pending && !blocked) {
            pending = false
            const snapshot = exportDemoSnapshot(state)
            const sentData = stable(domain(state))
            if (sentData === savedData) continue
            notify({ ok: false, message: '正在保存到PostgreSQL…' })
            const result = await request('PUT', { revision, snapshot })
            revision = result.revision; savedData = sentData
            notify({ ok: true, savedAt: result.savedAt, message: `已保存到PostgreSQL · 数据版本${revision}` })
            // An import or adjustment made during the request is saved next,
            // instead of being replaced with the response for the older state.
            if (stable(domain(state)) !== savedData) pending = true
          }
          return { ok: status.ok, message: status.message }
        } catch (error) { pending = false; return failure(error) }
        finally { active = null }
      })
      return active
    },
    async poll() {
      if (!loaded || blocked || active) return
      try {
        if (stable(domain(state)) !== savedData) return
        const result = await request()
        // Check again after the await: local edits may have started meanwhile.
        if (!active && stable(domain(state)) === savedData) {
          if (result.revision !== revision) { receive(result); onRemote() }
          else if (!status.ok) notify({ ok: true, message: `已连接PostgreSQL · 数据版本${revision}` })
        }
      } catch (error) { notify({ ok: false, message: `PostgreSQL连接中断：${error.message}。可重试连接，当前数据保留。` }) }
    },
    async restore(text) {
      if (!loaded) return { ok: false, message: '请先连接数据库再恢复备份' }
      if (blocked) return { ok: false, message: '数据版本已冲突，请先加载数据库最新数据' }
      try {
        const snapshot = parseDemoSnapshot(text)
        if (active) { const saved = await active; if (!saved.ok) return saved }
        const result = await request('PUT', { revision, snapshot })
        receive({ revision: result.revision, snapshot: { ...snapshot, savedAt: result.savedAt } }, false)
        return { ok: true }
      } catch (error) { return failure(error) }
    },
    reset() { return controller.restore(JSON.stringify(exportDemoSnapshot(createState()))) },
    export() { return JSON.stringify(exportDemoSnapshot(state), null, 2) },
    localBackup() { try { const text = (storage ?? globalThis.localStorage)?.getItem(DEMO_STORAGE_KEY); return text ? JSON.stringify(parseDemoSnapshot(text)) : null } catch { return null } },
    hasLocalBackup() { return !!controller.localBackup() },
    get revision() { return revision },
  }
  return controller
}
