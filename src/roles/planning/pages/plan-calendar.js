import { pageHeader } from '../../../shared/templates.js'
import { escapeHtml, openModal } from '../../../core/ui.js'
import { renderVehicleResources, mountResourceLists } from '../../../shared/resource-lists.js'
import { icon, actionIcon } from '../../../shared/icons.js'
import { workspaceArt } from '../../../shared/workspace-art.js'
import { locomotiveDrawing, planFlowDrawing } from '../../../shared/rail-visuals.js'

const esc = escapeHtml
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const pad = value => String(value).padStart(2, '0')
const dateAdd = (value, offset) => {
  const [y, m, d] = value.split('-').map(Number)
  const result = new Date(Date.UTC(y, m - 1, d + offset))
  return `${result.getUTCFullYear()}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())}`
}
const monthEnd = month => {
  const [y, m] = month.split('-').map(Number)
  return `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`
}
const view = { month: today().slice(0, 7), day: today(), dayVehicleId: null, daySelectionCollapsed: false, calendarCollapsed: false, listSort: '', importType: 'MONTHLY', simulatedRole:globalThis.localStorage?.getItem('pc1-monthly-role')||'PLANNER', monthlyPlan:null, selectedDraftKeys:new Set(), draftSelectionMode:null, selectionScope:null, todos:[], dismissedTodos:new Set(), messages:[], filter: { modelIds: [], programIds: [], locomotiveNo: '', ownerDepot: '', repairSequence: '', status: '', approvalStatus: '' }, loading: true, loadedMode: '', rows: [], planRows: [], lookups: { models: [], programs: [] }, busy: false, preview: null, previewFilter: 'all', detail: null, error: '', result: null, manualOpen: false }
let viewRestored = false
let selectionListenerBound = false
function rememberView(ctx) {
  Object.assign(ctx.state.planningView, { month:view.month, day:view.day, importMonth:view.month, importType:view.importType, annualYear:view.annualYear || view.month.slice(0,4) })
}

async function api(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', ...options, headers: { 'X-PC1-Simulated-Role':view.simulatedRole, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } })
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    if (!response.ok) throw new Error(`请求失败（${response.status}）`)
    return response
  }
  const body = await response.json()
  if (!response.ok && response.status !== 409) throw new Error(body.message || `请求失败（${response.status}）`)
  return { ...body, httpStatus: response.status }
}

function monthBounds(month) {
  const first = `${month}-01`
  const weekday = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7
  const start = dateAdd(first, -weekday)
  return { from: start, to: dateAdd(start, 41), cellCount: 42, weekCount: 6 }
}

function entriesForDay(day) {
  const events = []
  for (const vehicle of view.rows.filter(isVehicleVisible)) {
    if (vehicle.entryDate === day) events.push({ type: 'entry', vehicle, label: `计划入段 · ${vehicle.locomotiveNo}` })
    if (vehicle.confirmedExitDate === day) events.push({ type: 'exit', vehicle, label: `预计出段 · ${vehicle.locomotiveNo}` })
  }
  return events
}

function isVehicleVisible(vehicle) {
  return !vehicle.hideFromCalendar
}

const vehicleBrief=vehicle=>`${vehicle.modelName||'机型未填写'} · ${vehicle.locomotiveNo||'机号未填写'} · ${vehicle.repairProgramName||'修程未填写'} · ${vehicle.repairSequence==null?'修次未填写':`第${vehicle.repairSequence}次`}`

function calendarHtml() {
  const { from, cellCount } = monthBounds(view.month)
  const weekdays = ['一', '二', '三', '四', '五', '六', '日']
  return `<div class="pc-plan-calendar" role="grid" aria-label="${esc(view.month)}检修计划日历">
    ${weekdays.map(day => `<div class="pc-plan-weekday" role="columnheader">周${day}</div>`).join('')}
    ${Array.from({ length: cellCount }, (_, index) => {
      const day = dateAdd(from, index), events = entriesForDay(day), visible = events.slice(0, 3)
      return `<div class="pc-plan-day ${day.startsWith(view.month) ? '' : 'is-outside'} ${view.day === day ? 'is-selected' : ''}" role="gridcell" data-calendar-day="${day}" tabindex="0" aria-label="查看${day}，${events.length}个事件" aria-pressed="${view.day === day}">
        <button type="button" class="pc-plan-day-number" data-select-day="${day}" aria-label="查看${day}，${events.length}个事件" aria-pressed="${view.day === day}">${Number(day.slice(-2))}<span>${events.length ? `${events.length}项` : ''}</span></button>
        <div class="pc-plan-day-events">${visible.map(event => `<button type="button" class="pc-plan-event ${event.type === 'entry' ? 'is-entry' : 'is-exit'} ${visualStatusClass(event.vehicle)}" data-select-day-vehicle="${event.vehicle.id}" data-event-day="${day}" title="${esc(vehicleBrief(event.vehicle))}">${esc(vehicleBrief(event.vehicle))}</button>`).join('')}${events.length > 3 ? `<button type="button" class="pc-plan-more" data-select-day="${day}">还有${events.length - 3}条</button>` : ''}</div>
      </div>`
    }).join('')}
  </div>`
}

function statusLabel(vehicle) {
  const approval = { SUBMITTED: '待审核', REVIEWED: '已审核待申请发布', PENDING_PUBLISH: '待发布', PUBLISHED: '已发布', REJECTED: '已驳回', REVISING: '待修改' }
  const change={ADDED:'新增',MODIFIED:'修改',CANCELLED:'申请取消',DELETE:'删除'}[vehicle.changeType]
  const workflowStatus = vehicle.approvalStatus || vehicle.applicationStatus
  let label=''
  // 待发布是科长勾选并申请发布后的车辆状态，优先级必须高于旧的紫色审核标记。
  // 这样即使车辆同时携带来源审核申请的标记，日历卡片也不会继续显示“已审核待申请发布”。
  if (workflowStatus === 'PENDING_PUBLISH') label='待发布'
  else if (vehicle.isDraft && vehicle.approvalStatus === 'REJECTED') label='驳回待修改'
  else if (vehicle.isDraft && vehicle.approvalStatus === 'WITHDRAWN') label='已撤回'
  else if (vehicle.isDraft || vehicle.approvalStatus === 'DRAFT') label='草稿'
  else if (vehicle.pendingDeletion && vehicle.approvalStatus === 'PUBLISHED') label='已发布 · 待提交删除'
  else if (approval[workflowStatus]) label=approval[workflowStatus]
  else if (!vehicle.currentVersionId && ['DRAFT', 'UNSCHEDULED'].includes(vehicle.status)) label='未模拟'
  if(label)return change&&['草稿','驳回待修改','已撤回','待审核','已审核待申请发布','待发布'].includes(label)?`${label} · ${change}`:label
  const names = { UNSCHEDULED: '未排程', SCHEDULED: '已排程', IN_PROGRESS: '检修中', COMPLETED: '已完成', CANCELLED: '已取消', CANCELED: '已取消' }
  return names[vehicle.status] || vehicle.status || '未填写'
}

function visualStatusClass(vehicle) {
  // 先判断当前申请环节，避免申请发布后的车辆因残留 REVIEWED 标记继续显示紫色。
  if (vehicle.approvalStatus === 'PENDING_PUBLISH' || vehicle.applicationStatus === 'PENDING_PUBLISH') {
    return view.simulatedRole === 'DEPUTY_DIRECTOR' ? 'is-review' : 'is-pending'
  }
  if (vehicle.approvalStatus === 'SUBMITTED' || vehicle.applicationStatus === 'PENDING_REVIEW') {
    return view.simulatedRole === 'SECTION_CHIEF' ? 'is-review' : 'is-pending'
  }
  if (vehicle.isDraft || vehicle.approvalStatus === 'DRAFT') return 'is-draft'
  if (vehicle.isReviewedPending || vehicle.approvalStatus === 'REVIEWED') return 'is-reviewed'
  if (vehicle.isPending) {
    const mine = (vehicle.approvalStatus === 'SUBMITTED' && view.simulatedRole === 'SECTION_CHIEF') || (vehicle.approvalStatus === 'PENDING_PUBLISH' && view.simulatedRole === 'DEPUTY_DIRECTOR')
    return mine ? 'is-review' : 'is-pending'
  }
  if (vehicle.isPublished || vehicle.approvalStatus === 'PUBLISHED') return 'is-published'
  return ''
}

function draftKey(vehicle) { return String(vehicle.stableItemKey || `vehicle-${vehicle.vehicleRepairId || vehicle.id}`) }
function selectionStorageKey() { return `pc1-monthly-selection:${view.simulatedRole}:${view.month}` }
function saveSelection() {
  try {
    if (!view.draftSelectionMode || !view.selectedDraftKeys.size) globalThis.localStorage?.removeItem(selectionStorageKey())
    else globalThis.localStorage?.setItem(selectionStorageKey(), JSON.stringify({ mode:view.draftSelectionMode, keys:[...view.selectedDraftKeys] }))
  } catch {}
}
function restoreSelection() {
  const scope=selectionStorageKey()
  if(view.selectionScope===scope)return
  view.selectionScope=scope; view.draftSelectionMode=null; view.selectedDraftKeys.clear()
  try {
    const value=globalThis.localStorage?.getItem(scope), saved=value?JSON.parse(value):null
    if(['SUBMIT','PUBLISH','DIRECT_PUBLISH'].includes(saved?.mode) && Array.isArray(saved.keys)){view.draftSelectionMode=saved.mode;view.selectedDraftKeys=new Set(saved.keys.map(String))}
  } catch {}
}
function clearSelection() { view.draftSelectionMode=null; view.daySelectionCollapsed=false; view.selectedDraftKeys.clear(); saveSelection() }
function startSelection(mode) { view.draftSelectionMode=mode; view.daySelectionCollapsed=false; view.selectedDraftKeys.clear(); saveSelection() }
function leaveSelectionScope() { view.draftSelectionMode=null; view.selectedDraftKeys.clear(); view.selectionScope=null }
function canSelectDraft(vehicle) { return Boolean(vehicle.isDraft && vehicle.draftOwnerRole === view.simulatedRole && vehicle.selectableDraft !== false && !vehicle.isPending) }
function canSelectPublishCandidate(vehicle) { return Boolean(view.simulatedRole === 'SECTION_CHIEF' && (canSelectDraft(vehicle) || vehicle.isReviewedPending || vehicle.approvalStatus === 'REVIEWED')) }
function canSelectCurrentCandidate(vehicle) { return view.draftSelectionMode === 'PUBLISH' ? canSelectPublishCandidate(vehicle) : canSelectDraft(vehicle) }
function selectedDraftCount() { return view.selectedDraftKeys.size }
function selectionCheckbox(vehicle, className = '') {
  if (!view.draftSelectionMode || view.daySelectionCollapsed || !canSelectCurrentCandidate(vehicle)) return ''
  const key = draftKey(vehicle), checked = view.selectedDraftKeys.has(key)
  return `<label class="pc-draft-select ${className}" title="选择本车提交审批"><input type="checkbox" data-draft-select="${esc(key)}" ${checked ? 'checked' : ''} aria-label="选择${esc(vehicle.locomotiveNo || '车辆')}提交审批"><span></span></label>`
}
function disabledSelectionCheckbox(vehicle) {
  if (!view.draftSelectionMode) return ''
  const reason = vehicle.isSubmitted || vehicle.isPending ? '本车已提交审核，不能重复选择。' : vehicle.isPublished ? '本车已是正式发布计划，请先创建新的修改草稿。' : '本车不属于当前角色可提交的草稿。'
  return `<label class="pc-draft-select is-disabled" title="${esc(reason)}"><input type="checkbox" disabled aria-label="${esc(reason)}"><span></span></label>`
}

function vehicleCard(vehicle, event) {
  const expanded=view.dayVehicleId===vehicle.id
  const value=item=>item==null||item===''?'未填写':esc(item)
  return `<article class="pc-plan-vehicle-card ${expanded?'is-expanded':''}">${selectionCheckbox(vehicle)}<button type="button" class="pc-plan-vehicle-choice" data-toggle-day-vehicle="${vehicle.id}" aria-expanded="${expanded}"><span>${esc(vehicleBrief(vehicle))}<em class="pc-plan-state-pill ${visualStatusClass(vehicle)}">${esc(statusLabel(vehicle))}</em></span><i>${expanded?'收起':'展开'}</i></button>${expanded?`<div class="pc-plan-vehicle-inline-detail"><dl><div><dt>机型</dt><dd>${value(vehicle.modelName)}</dd></div><div><dt>机号</dt><dd>${value(vehicle.locomotiveNo)}</dd></div><div><dt>配属局</dt><dd>${value(vehicle.ownerBureau)}</dd></div><div><dt>配属段</dt><dd>${value(vehicle.ownerDepot)}</dd></div><div><dt>修程</dt><dd>${value(vehicle.repairProgramName)}</dd></div><div><dt>修次</dt><dd>${vehicle.repairSequence==null?'未填写':`第${esc(vehicle.repairSequence)}次`}</dd></div><div><dt>计划入段时间</dt><dd>${value(vehicle.plannedEntryAt)}</dd></div><div><dt>累计走行公里</dt><dd>${vehicle.mileageKm==null?'未填写':`${esc(vehicle.mileageKm)} km`}</dd></div><div><dt>状态</dt><dd><span class="pc-plan-state-pill ${visualStatusClass(vehicle)}">${esc(statusLabel(vehicle))}</span></dd></div><div class="is-wide"><dt>备注</dt><dd>${value(vehicle.remark)}</dd></div></dl><button type="button" class="btn btn-sm btn-primary" data-open-vehicle="${vehicle.id}" data-event-day="${view.day}">查看详细信息</button></div>`:''}</article>`
}

function dayPanel(demo=false) {
  if (!view.day) return '<div class="pc-plan-empty">选择日期查看当日计划。</div>'
  const events = entriesForDay(view.day)
  const entries = events.filter(event => event.type === 'entry')
  const exits = events.filter(event => event.type === 'exit')
  const vehicleCount = new Set(events.map(event => event.vehicle.id)).size
  const selectableToday=[...new Map(entries.filter(event=>canSelectCurrentCandidate(event.vehicle)).map(event=>[draftKey(event.vehicle),event.vehicle])).values()]
  const selectedToday=selectableToday.filter(vehicle=>view.selectedDraftKeys.has(draftKey(vehicle))).length
  return `<div class="pc-plan-day-panel">
    ${!demo&&view.draftSelectionMode?`<div class="pc-plan-day-selection" role="status"><span>选择车辆 ${selectedToday}/${selectableToday.length}辆</span><div class="table-actions"><button type="button" class="btn btn-sm" data-select-day-drafts ${selectableToday.length?'':'disabled title="当天没有可选择的草稿车辆"'}>全选</button><button type="button" class="btn btn-sm" data-clear-day-drafts ${selectedToday?'':'disabled title="当天没有已选择的车辆"'}>取消</button></div></div>`:''}
    ${demo?'':`<div class="pc-plan-day-summary"><div><span>当日事件</span><strong>${events.length}</strong></div><div><span>涉及检修</span><strong>${vehicleCount}</strong></div></div>`}
    ${[['计划入段', entries], ['预计出段', exits]].map(([title, rows]) => `<section class="pc-plan-event-group"><h3>${title}<span>${rows.length}</span></h3>${rows.map(event => vehicleCard(event.vehicle, event)).join('') || `<p class="pc-plan-empty">当日暂无${title}事件</p>`}</section>`).join('')}
    <p class="pc-plan-hint">预计出段仅依据该次检修已确认的正式排程版本；未排程或草稿不显示。</p>
  </div>`
}

function periodControl() {
  return view.importType === 'ANNUAL'
    ? `<label>年度 <input class="input" type="number" min="1900" max="2199" value="${view.annualYear || view.month.slice(0, 4)}" data-annual-year></label>`
    : `<label>列表月份 <input class="input" type="month" min="1900-01" max="2199-12" value="${view.month}" data-import-month></label>`
}

function previewPanel() {
  const preview = view.preview
  if (!preview) return ''
  const rows = preview.rows.filter(row => view.previewFilter === 'all' || (view.previewFilter === 'ready' ? row.status === 'ready' : row.status !== 'ready'))
  const period = preview.importType === 'ANNUAL' ? `${preview.period.year}年度` : '月度计划（入段日期不限制月份）'
  const displayValue = (row, label, normalized) => {
    const value = row.status === 'ready' ? normalized : row.raw?.[label]
    return value == null || value === '' ? '未填写' : value
  }
  return `<section class="card pc-plan-preview" aria-labelledby="pc-preview-title">
    <div class="pc-plan-preview-head"><div><h2 id="pc-preview-title">导入预览 · ${esc(preview.filename || '计划文件')}</h2><p role="status">${period} · 共${preview.total}行，可导入${preview.importable}行，错误${preview.errors}行。预览有效期15分钟，确认前不会写入业务数据。</p></div><div class="table-actions">${preview.importType === 'MONTHLY' ? '<button type="button" class="btn btn-primary" data-new-from-preview>新建车辆</button>' : ''}<button type="button" class="btn" data-cancel-preview>取消预览</button></div></div>
    ${preview.warnings?.length ? `<p class="pc-plan-warning">${preview.warnings.map(esc).join('；')}</p>` : ''}
    <div class="pc-plan-preview-tools"><div class="pc-plan-filters"><button type="button" class="btn btn-sm ${view.previewFilter === 'all' ? 'is-active' : ''}" data-preview-filter="all">全部 ${preview.total}</button><button type="button" class="btn btn-sm ${view.previewFilter === 'ready' ? 'is-active' : ''}" data-preview-filter="ready">可导入 ${preview.importable}</button><button type="button" class="btn btn-sm ${view.previewFilter === 'errors' ? 'is-active' : ''}" data-preview-filter="errors">错误 ${preview.errors}</button></div>${preview.errors ? `<button type="button" class="btn btn-sm" data-download-errors>下载错误明细</button>` : ''}</div>
    <div class="pc-plan-preview-table"><table><thead><tr><th>源行</th><th>机车编号</th><th>机型 / 修程</th><th>修次</th><th>计划入段</th><th>配属局 / 段</th><th>公里数</th><th>备注</th><th>错误字段</th><th>错误原因</th><th>操作</th></tr></thead><tbody>${rows.map(row => `<tr class="${row.status === 'ready' ? '' : 'has-error'}"><td>${row.line}</td><td>${esc(displayValue(row, '机车编号', row.data.locomotiveNo))}</td><td>${esc(displayValue(row, '机型', row.data.modelName))} / ${esc(displayValue(row, '修程', row.data.repairProgramName))}</td><td>${esc(displayValue(row, '修次', row.data.repairSequence))}</td><td>${esc(displayValue(row, '计划入段日期', row.data.plannedEntryAt))}</td><td>${esc(displayValue(row, '配属局', row.data.ownerBureau))} / ${esc(displayValue(row, '配属段', row.data.ownerDepot))}</td><td>${esc(displayValue(row, '累计走行公里', row.data.mileageKm))}</td><td>${esc(displayValue(row, '备注', row.data.remark))}</td><td>${row.status === 'ready' ? '—' : esc(row.errors.map(error => error.field).join('；'))}</td><td>${row.status === 'ready' ? '通过' : `${esc(row.errors.map(error => error.message).join('；'))}${row.warnings?.map(warning => `<div class="pc-plan-warning">${esc(warning)}</div>`).join('') || ''}`}</td><td><div class="pc-plan-preview-row-actions"><button type="button" class="btn btn-sm" data-edit-preview-row="${row.line}">编辑</button><button type="button" class="btn btn-sm btn-danger" data-delete-preview-row="${row.line}">删除</button></div></td></tr>`).join('') || '<tr><td colspan="11" class="pc-plan-empty">当前筛选没有记录</td></tr>'}</tbody></table></div>
    <div class="pc-plan-preview-footer"><span>单击确认后仅保存通过校验的完整记录；错误行不会写入。</span><button type="button" class="btn btn-primary" data-confirm-import ${!preview.importable || view.busy ? `disabled title="${view.busy?'正在提交，请稍候。':'没有通过校验的可导入记录。'}"` : ''}>${view.busy ? '正在提交…' : `确认导入${preview.importable}条`}</button></div>
  </section>`
}

function renderReviewHistory(vehicle) {
  const rows = Array.isArray(vehicle.reviewHistory) ? vehicle.reviewHistory : []
  if (!rows.length) return ''
  return `<section class="pc-review-history"><h3>审核修改记录</h3>${rows.map(row => `<div class="pc-review-history-row"><div><strong>第${esc(row.revisionNo)}次修改</strong><span>${esc(roleText[row.editorRole] || row.editorRole || '审核人员')}</span><time>${esc(row.editedAt || '')}</time></div><p>原因：${esc(row.changeReason || '未填写')}</p><small>入段：${esc(row.beforeData?.plannedEntryAt || row.beforeData?.planned_entry_at || '未填写')} → ${esc(row.afterData?.plannedEntryAt || row.afterData?.planned_entry_at || '未填写')}；修程：${esc(row.beforeData?.repairProgramName || row.beforeData?.repair_program_id || '未填写')} → ${esc(row.afterData?.repairProgramName || row.afterData?.repair_program_id || '未填写')}</small></div>`).join('')}</section>`
}

function renderPendingChangeDetail(vehicle) {
  if (vehicle.isDeletionMarker || vehicle.changeType === 'DELETE') {
    return `<section class="pc-review-history"><h3>删除事项</h3><div class="pc-review-history-row"><p><strong>删除原因：</strong>${esc(vehicle.deleteReason || vehicle.changeReason || '未填写')}</p>${vehicle.deleteNote ? `<p><strong>补充说明：</strong>${esc(vehicle.deleteNote)}</p>` : ''}<small>该事项发布前，原正式车辆仍然有效；审批发布后才从当前有效月度计划中删除。</small></div></section>`
  }
  const original = vehicle.originalSnapshot
  if (!original || !['MODIFIED', 'UPDATE'].includes(vehicle.changeType)) return ''
  const fields = [
    ['机车编号', 'locomotiveNo'], ['计划入段', 'plannedEntryAt'], ['配属局', 'ownerBureau'],
    ['配属段', 'ownerDepot'], ['修次', 'repairSequence'], ['累计走行公里', 'mileageKm'], ['备注', 'remark']
  ]
  const changed = fields.map(([label, key]) => {
    const before = original[key] ?? original[key.replace(/[A-Z]/g, value => `_${value.toLowerCase()}`)]
    const after = vehicle[key]
    return String(before ?? '') === String(after ?? '') ? '' : `<tr><th>${esc(label)}</th><td>${esc(before ?? '未填写')}</td><td>${esc(after ?? '未填写')}</td></tr>`
  }).filter(Boolean).join('')
  if (!changed) return ''
  return `<section class="pc-review-history"><h3>本次修改对比</h3><div class="table-wrap"><table><thead><tr><th>字段</th><th>原正式值</th><th>本次申请值</th></tr></thead><tbody>${changed}</tbody></table></div>${vehicle.changeReason ? `<p>修改原因：${esc(vehicle.changeReason)}</p>` : ''}</section>`
}

function legacyDetailDrawer(state, demo=false) {
  const vehicle = view.detail
  if (!vehicle && view.detailLoading) return `<div class="pc-plan-drawer-backdrop"><aside class="pc-plan-drawer" role="dialog" aria-modal="true" aria-labelledby="pc-vehicle-detail-title"><div class="pc-plan-drawer-head"><div><span>车辆检修详情</span><h2 id="pc-vehicle-detail-title">正在加载…</h2></div></div><p role="status">正在从数据库加载车辆详情…</p></aside></div>`
  if (!vehicle) return ''
  const value = item => item == null || item === '' ? '未填写' : esc(item)
  const source = vehicle.planSource === 'ANNUAL' ? '年度计划' : vehicle.planSource === 'MONTHLY' ? '月度计划' : value(vehicle.planSource)
  const stateVehicle=state.vehicleRepairs.find(row=>row.id===Number(vehicle.id))||vehicle
  const published=stateVehicle.approvalStatus==='PUBLISHED'||vehicle.approvalStatus==='PUBLISHED'
  const reviewEditable=Boolean(vehicle.canReviewEdit), draftEditable=canSelectDraft(vehicle), formalVehicle=published&&!vehicle.isSubmitted&&!vehicle.isDraft
  const publishedEditable=view.simulatedRole==='DEPUTY_DIRECTOR'&&formalVehicle
  const requestEditable=['PLANNER','SECTION_CHIEF'].includes(view.simulatedRole)&&formalVehicle
  const maintenanceReason=reviewEditable?'':draftEditable?'':publishedEditable?'':requestEditable?'':'当前车辆只读；只有草稿所属角色或当前审核责任人可以修改。'
  const unavailable=reason=>`class="btn btn-sm is-disabled" type="button" aria-disabled="true" data-plan-operation-unavailable="${esc(reason)}"`
  const vehicleActions=demo?'':`<div class="table-actions pc-plan-detail-actions">${reviewEditable?(vehicle.isDeletionMarker?`<button class="btn btn-sm btn-primary" type="button" data-monthly-review-deletion="${vehicle.deletionId}">修改删除事项</button>`:`<button class="btn btn-sm btn-primary" type="button" data-monthly-review-edit="${vehicle.id}">修改本次审核车辆</button>`):draftEditable?`<button class="btn btn-sm" type="button" data-monthly-item-edit="${vehicle.id}">修改草稿</button><button class="btn btn-sm btn-danger" type="button" data-monthly-item-delete="${vehicle.id}">删除草稿</button>`:requestEditable?`<button class="btn btn-sm btn-primary" type="button" data-monthly-request-edit="${vehicle.id}">申请修改</button><button class="btn btn-sm" type="button" data-monthly-request-cancel="${vehicle.id}">申请删除</button>`:publishedEditable?`<button class="btn btn-sm btn-primary" type="button" data-monthly-published-edit="${vehicle.id}">编辑正式计划</button><button class="btn btn-sm btn-danger" type="button" data-monthly-published-delete="${vehicle.id}">直接删除正式车辆</button>`:`<button ${unavailable(maintenanceReason)}>编辑</button><button ${unavailable(maintenanceReason)}>删除或取消</button>`}${published?`<a class="btn btn-sm btn-primary" href="#/scheduling/dashboard" data-go-schedule="${vehicle.id}">去排程</a>`:`<button ${unavailable('仅当前正式发布版本中的车辆可以进入排程。')}>去排程</button>`}</div>`
  return `<div class="pc-plan-drawer-backdrop" data-close-drawer><aside class="pc-plan-drawer" role="dialog" aria-modal="true" aria-labelledby="pc-vehicle-detail-title"><div class="pc-plan-drawer-head"><div><span>车辆检修详情</span><h2 id="pc-vehicle-detail-title">${esc(vehicle.locomotiveNo)}</h2></div><button type="button" class="btn" data-close-detail aria-label="关闭车辆详情">关闭</button></div><dl>
    <div><dt>机型</dt><dd>${value(vehicle.modelName)}</dd></div><div><dt>修程</dt><dd>${value(vehicle.repairProgramName)}</dd></div><div><dt>修次</dt><dd>${vehicle.repairSequence == null ? '未填写' : esc(vehicle.repairSequence)}</dd></div><div><dt>状态</dt><dd>${esc(statusLabel(vehicle))}</dd></div><div><dt>配属局</dt><dd>${value(vehicle.ownerBureau)}</dd></div><div><dt>配属段</dt><dd>${value(vehicle.ownerDepot)}</dd></div><div><dt>累计走行公里</dt><dd>${vehicle.mileageKm == null ? '未填写' : `${esc(vehicle.mileageKm)} km`}</dd></div><div><dt>计划入段</dt><dd>${value(vehicle.entryDate)}</dd></div><div><dt>预计出段</dt><dd>${vehicle.confirmedExitDate ? esc(vehicle.confirmedExitDate) : vehicle.versionStatus === 'CURRENT' ? '暂无预计出段' : '尚未正式排程'}</dd></div><div><dt>计划来源</dt><dd>${source}</dd></div><div class="is-wide"><dt>备注</dt><dd>${value(vehicle.remark)}</dd></div>
    </dl>${vehicleActions}<a class="btn" href="#/scheduling/workforce" data-pc1-open-single="${vehicle.id}">查看本车日历、甘特图与检修记录</a>${renderVehicleResources(state, vehicle.id, true)}</aside></div>`
}

function detailDrawer(state, demo=false) {
  const html = legacyDetailDrawer(state, demo)
  const vehicle = view.detail
  if (!vehicle) return html
  const additions = `${renderPendingChangeDetail(vehicle)}${renderReviewHistory(vehicle)}`
  return additions ? html.replace('</dl>', `</dl>${additions}`) : html
}

function todoReadStorageKey() { return `pc1-monthly-todo-read:${view.simulatedRole}` }
function readTodoIds() {
  try {
    const raw = globalThis.localStorage?.getItem(todoReadStorageKey())
    return new Set(raw ? JSON.parse(raw).map(Number) : [])
  } catch { return new Set() }
}
function markTodoRead(id) {
  const ids = readTodoIds(); ids.add(Number(id))
  try { globalThis.localStorage?.setItem(todoReadStorageKey(), JSON.stringify([...ids])) } catch {}
}
function todoStatusLabel(status) { return status === 'PENDING_PUBLISH' ? '待发布' : '待审核' }
function monthlyTodoButton() {
  const unread = view.todos.filter(item => !readTodoIds().has(Number(item.id))).length
  return `<button type="button" class="btn pc-monthly-todo-button" data-open-monthly-todos>待办${view.todos.length ? `（${view.todos.length}）` : ''}${unread ? `<i class="pc-monthly-todo-dot" data-monthly-todo-unread aria-label="${unread} 条未读待办"></i>` : ''}</button>`
}
function toolbar() {
  return `<div class="pc-plan-toolbar"><div class="pc-plan-month-nav"><button type="button" class="btn" data-month-step="-1" aria-label="上个月">${actionIcon('previous',26)}</button><input class="input" type="month" min="1900-01" max="2199-12" value="${view.month}" data-calendar-month><button type="button" class="btn" data-month-step="1" aria-label="下个月">${actionIcon('next',26)}</button><button type="button" class="btn" data-today>回到今天</button><button type="button" class="btn btn-primary" data-open-import-dialog ${view.busy?'disabled title="正在处理上一项操作，请稍候。"':''}>${actionIcon('upload')}导入计划文件</button><button type="button" class="btn" data-open-manual-dialog>新建车辆</button>${monthlyTodoButton()}</div><label class="pc-plan-role-control">模拟角色<select class="select" data-monthly-role>${Object.entries(roleText).map(([value,label])=>`<option value="${value}" ${view.simulatedRole===value?'selected':''}>${label}</option>`).join('')}</select></label></div>`
}

const roleText={PLANNER:'计划员',SECTION_CHIEF:'运用科主管科长',DEPUTY_DIRECTOR:'主管副段长'}
function headerPendingChangeCount(role, plan) {
  // 科长顶部的待提交数量必须和“申请发布”选择模式使用同一批候选车辆：
  // 科长自己的草稿 + 尚未被勾选转发的紫色“已审核待申请发布”车辆。
  const candidates = [...new Map([...view.rows, ...view.planRows]
    .filter(row => role === 'SECTION_CHIEF' ? canSelectPublishCandidate(row) : canSelectDraft(row))
    .map(row => [draftKey(row), row])).values()]
  return candidates.length
}

function monthlyWorkflowBar(){
  const plan=view.monthlyPlan
  if(!plan)return''
  const active=plan.application?.status, count=selectedDraftCount(), role=view.simulatedRole
  const pendingChangeCount = headerPendingChangeCount(role, plan)
  const flowing=['PENDING_REVIEW','PENDING_PUBLISH'].includes(active)
  const draftEligibleCount=[...new Set([...view.rows,...view.planRows].filter(canSelectDraft).map(draftKey))].length
  const publishEligibleCount=[...new Set([...view.rows,...view.planRows].filter(canSelectPublishCandidate).map(draftKey))].length
  const selectingSubmit=view.draftSelectionMode==='SUBMIT', selectingPublish=view.draftSelectionMode==='PUBLISH', selectingDirect=view.draftSelectionMode==='DIRECT_PUBLISH'
  const canStartSelection=!flowing&&draftEligibleCount>0
  const canWithdraw=plan.application?.applicantRole===role&&flowing
  const canReview=role==='SECTION_CHIEF'&&active==='PENDING_REVIEW'
  const canReject=canReview||(role==='DEPUTY_DIRECTOR'&&active==='PENDING_PUBLISH')
  const canPublish=role==='DEPUTY_DIRECTOR'&&active==='PENDING_PUBLISH'
  const canTakeover=role==='DEPUTY_DIRECTOR'&&active==='PENDING_REVIEW'
  const disabled=(enabled,reason)=>enabled?'':`disabled aria-disabled="true" title="${esc(reason)}" data-disabled-reason="${esc(reason)}"`
  const submitReason=flowing?'当前月份已有流转中的申请，请先撤回或等待处理。':draftEligibleCount===0?'当前角色没有可提交变更。':count===0?'请进入选择模式并勾选至少一项待提交变更。':''
  const directReason=flowing?'当前月份已有流转中的申请，请先完成、驳回或接管。':draftEligibleCount===0?'当前角色没有可直接发布的变更。':count===0?'请进入选择模式并勾选至少一项待直接发布变更。':''
  const submitButton=selectingSubmit?`<button class="btn btn-primary" type="button" data-confirm-monthly-submit ${disabled(count>0,submitReason)}>确认申请审核（${count}）</button>`:`<button class="btn btn-primary" type="button" data-start-monthly-submit ${disabled(canStartSelection,submitReason)}>申请审核</button>`
  const publishRequestReason=flowing?'当前月份已有流转中的申请，请先处理完成。':publishEligibleCount===0?'当前没有科长草稿或紫色已审核待申请发布事项。':count===0?'请勾选科长草稿或紫色已审核待申请发布事项。':''
  const publishRequestButton=selectingPublish?`<button class="btn btn-primary" type="button" data-confirm-request-publish ${disabled(count>0,publishRequestReason)}>确认申请发布（${count}）</button>`:`<button class="btn btn-primary" type="button" data-start-request-publish ${disabled(!flowing&&publishEligibleCount>0,publishRequestReason)}>申请发布</button>`
  const directButton=selectingDirect?`<button class="btn btn-primary" type="button" data-confirm-direct-publish ${disabled(count>0,directReason)}>确认直接发布（${count}）</button>`:`<button class="btn" type="button" data-start-direct-publish ${disabled(canStartSelection,directReason)}>直接发布</button>`
  const selectionCancel=(selectingSubmit||selectingPublish||selectingDirect)?`<button class="btn" type="button" data-cancel-draft-selection>取消选择</button>`:''
  let roleActions=''
  if(role==='PLANNER') roleActions=`${submitButton}<button class="btn" type="button" data-monthly-withdraw ${disabled(canWithdraw,!flowing?'当前没有可撤回的申请。':'只能由本次申请角色撤回申请。')}>撤回申请</button>${selectionCancel}`
  if(role==='SECTION_CHIEF') roleActions=`${publishRequestButton}<button class="btn" type="button" data-monthly-withdraw ${disabled(canWithdraw,!flowing?'当前没有可撤回的申请。':'只能由本次申请角色撤回申请。')}>撤回申请</button><button class="btn" type="button" data-monthly-approve ${disabled(canReview,'当前没有待科长审核的申请。')}>审核通过</button><button class="btn" type="button" data-monthly-reject ${disabled(canReject,'当前没有待科长审核的申请。')}>驳回</button>${selectionCancel}`
  if(role==='DEPUTY_DIRECTOR') roleActions=`<button class="btn" type="button" data-monthly-publish ${disabled(canPublish,'当前没有待发布申请。')}>审批发布</button><button class="btn" type="button" data-monthly-reject ${disabled(canReject,'当前没有待副段长处理的申请。')}>驳回</button>${directButton}${selectionCancel}`
  if(canTakeover)roleActions+=`<button class="btn" type="button" data-monthly-takeover>接管处理</button>`
  const statusClass=active==='REVIEWED'&&view.simulatedRole==='SECTION_CHIEF'?'is-reviewed':(active==='PENDING_REVIEW'&&view.simulatedRole==='SECTION_CHIEF')||(active==='PENDING_PUBLISH'&&view.simulatedRole==='DEPUTY_DIRECTOR')?'is-review':['PENDING_REVIEW','PENDING_PUBLISH'].includes(active)?'is-pending':plan.status==='已发布'?'is-published':plan.hasOwnDraft?'is-draft':''
  const draftSummary=`我的待提交变更：${pendingChangeCount} 项`
  return `<section class="card pc-plan-workflow-bar"><div class="card-title-row"><div><div class="card-title">${esc(plan.title)}</div><div class="card-subtitle">正式计划：<span class="pc-plan-state-pill ${plan.hasPublishedVersion?'is-published':'is-draft'}">${plan.hasPublishedVersion?'已发布':'未发布'}</span> · 申请：<span class="pc-plan-state-pill ${statusClass}">${esc(plan.status)}</span> · ${draftSummary}${view.draftSelectionMode?` · 已选择 ${count} 项`:''}</div></div><div class="table-actions"><button class="btn" type="button" data-edit-monthly-title>修改标题</button>${roleActions}</div></div></section>`
}

function mainCalendar(state,demo=false) {
  if (view.loading) return '<section class="card pc-plan-loading" role="status">正在从数据库加载检修计划…</section>'
  if (view.error) return `<section class="card pc-plan-load-error" role="alert"><strong>数据库查询失败</strong><p>${esc(view.error)}</p><button type="button" class="btn" data-retry>重试</button></section>`
  return `${view.rows.length ? '' : '<p class="pc-plan-empty-notice" role="status">当前日历范围内暂无匹配的检修计划。</p>'}<section class="card pc-plan-layout pc-plan-calendar-shell"><div class="pc-plan-calendar-card ${view.calendarCollapsed?'is-collapsed':''}"><div class="pc-plan-panel-head"><div><h2>${esc(view.month)} 检修计划</h2><p>计划入段与正式排程预计出段</p></div><div class="pc-plan-calendar-head-tools"><button type="button" class="btn btn-sm" data-toggle-calendar aria-expanded="${!view.calendarCollapsed}">${view.calendarCollapsed?'展开日历':'收起日历'}</button><div class="pc-plan-legend"><span><i class="is-draft"></i>灰色：我的待提交变更</span><span><i class="is-pending"></i>黄色：等待其他角色处理</span><span><i class="is-reviewed"></i>紫色：已审核待申请发布</span><span><i class="is-review"></i>红色：待我处理</span><span><i class="is-published"></i>蓝色：正式已发布</span></div></div></div>${view.calendarCollapsed?'<div class="pc-plan-calendar-collapsed" role="status">日历已收起，点击“展开日历”查看当月车辆安排。</div>':calendarHtml()}</div><aside class="pc-plan-day-card"><div class="pc-plan-panel-head pc-plan-day-head"><div><h2>当日详情</h2><p>${esc(view.day || '选择日期')}</p></div>${demo?'':`<div class="table-actions"><button type="button" class="btn btn-sm btn-primary" data-add-vehicle-for-day="${esc(view.day)}">增加车辆</button></div>`}</div>${dayPanel(demo)}</aside></section>`
}

function listMulti(name, label, options, selected) {
  return `<div class="pc-chip-select" data-chip-select="${name}"><button type="button" class="pc-chip-control" data-chip-toggle="${name}"><span class="pc-chip-placeholder">${selected.length?'':`请选择${label}`}</span>${selected.map(value=>{const item=options.find(option=>String(option.value)===String(value));return item?`<span class="pc-filter-chip">${esc(item.label)}<i role="button" aria-label="移除${esc(item.label)}" data-list-chip-remove="${name}" data-chip-value="${esc(value)}">×</i></span>`:''}).join('')}<b>⌄</b></button><div class="pc-chip-menu" data-chip-menu="${name}" hidden>${options.map(item=>`<label><input type="checkbox" value="${esc(item.value)}" ${selected.includes(String(item.value))?'checked':''}>${esc(item.label)}</label>`).join('')}</div></div>`
}

function decorateDraftSelection() {
  if(!view.draftSelectionMode)return
  const eligible = [...new Map([...view.rows, ...view.planRows].filter(canSelectCurrentCandidate).map(row => [draftKey(row), row])).values()]
  const table = document.querySelector('.pc-monthly-plan-table')
  if (table) {
    const head = table.tHead?.rows[0]
    if (head && !head.querySelector('[data-select-all-drafts]')) {
      const cell = document.createElement('th'); cell.className = 'pc-plan-select-col'; cell.innerHTML='<label class="pc-draft-select-all" title="全选当前可提交车辆"><input type="checkbox" data-select-all-drafts aria-label="全选当前可提交车辆"><span></span></label>'; head.prepend(cell)
    }
    table.querySelectorAll('tbody [data-plan-detail]').forEach(button => {
      const row = view.planRows.find(item => String(item.id) === String(button.dataset.planDetail))
      if (!row || button.closest('tr')?.querySelector('.pc-plan-select-col')) return
      const cell = button.closest('tr').insertCell(0); cell.className = 'pc-plan-select-col'; cell.innerHTML = canSelectCurrentCandidate(row) ? selectionCheckbox(row) : disabledSelectionCheckbox(row)
    })
    const selectAll = table.querySelector('[data-select-all-drafts]')
    if (selectAll) selectAll.checked = eligible.length > 0 && eligible.every(row => view.selectedDraftKeys.has(draftKey(row)))
  }
  document.querySelectorAll('.pc-plan-vehicle-card').forEach(card => {
    const button = card.querySelector('[data-toggle-day-vehicle]'), row = view.rows.find(item => String(item.id) === String(button?.dataset.toggleDayVehicle))
    if (!row || !canSelectCurrentCandidate(row) || card.querySelector('[data-draft-select]')) return
    card.insertAdjacentHTML('afterbegin', selectionCheckbox(row))
  })
}

function plansList() {
  if (view.loading) return '<section class="card pc-plan-loading" role="status">正在从数据库加载计划…</section>'
  if (view.error) return `<section class="card pc-plan-load-error" role="alert"><strong>数据库查询失败</strong><p>${esc(view.error)}</p><button type="button" class="btn" data-retry>重试</button></section>`
  const programs=view.lookups.programs.filter(program=>!view.filter.modelIds.length||view.filter.modelIds.includes(String(program.modelId)))
  const filtered=view.planRows.filter(row=>(!view.filter.modelIds.length||view.filter.modelIds.includes(String(row.modelId)))&&(!view.filter.programIds.length||view.filter.programIds.includes(String(row.repairProgramId||row.programId))))
  const rows=[...filtered]
  if(view.listSort)rows.sort((a,b)=>view.listSort==='date-desc'?(b.entryDate||'').localeCompare(a.entryDate||'')||(b.locomotiveNo||'').localeCompare(a.locomotiveNo||''):(a.entryDate||'').localeCompare(b.entryDate||'')||(a.locomotiveNo||'').localeCompare(b.locomotiveNo||''))
  const sortIcon=view.listSort==='date-asc'?'↑':view.listSort==='date-desc'?'↓':'↕'
  const sortLabel=view.listSort==='date-asc'?'升序':view.listSort==='date-desc'?'降序':'默认排序'
  return `<section class="card pc-plan-records pc-plan-records-embedded"><div class="pc-delivery-query pc-monthly-list-filters">${listMulti('monthly-list-model','机型',view.lookups.models.map(model=>({value:String(model.id),label:model.name})),view.filter.modelIds)}${listMulti('monthly-list-program','修程',programs.map(program=>({value:String(program.id),label:program.name})),view.filter.programIds)}<input class="input" type="search" maxlength="64" value="${esc(view.filter.locomotiveNo)}" placeholder="机型机号" aria-label="机型机号" data-list-locomotive><input class="input" maxlength="64" value="${esc(view.filter.ownerDepot)}" placeholder="配属段" aria-label="配属段" data-list-depot><input class="input" type="number" min="1" value="${esc(view.filter.repairSequence)}" placeholder="修次" aria-label="修次" data-list-sequence><select class="select" aria-label="状态" data-list-business-status><option value="">全部状态</option>${[["status:UNSCHEDULED","未模拟"],["status:SCHEDULED","已排程"],["approval:SUBMITTED","待审核"],["approval:REVIEWED","已审核待申请发布"],["approval:PENDING_PUBLISH","待发布"],["approval:PUBLISHED","已发布"],["approval:REJECTED","已驳回"],["approval:REVISING","待修改"],["status:IN_PROGRESS","检修中"],["status:COMPLETED","已完成"]].map(([value,label])=>`<option value="${value}" ${(value===`status:${view.filter.status}`||value===`approval:${view.filter.approvalStatus}`)?"selected":""}>${label}</option>`).join("")}</select><button type="button" class="btn btn-primary" data-list-search>查询列表</button><button type="button" class="btn" data-list-reset>重置</button></div>
    <div class="plan-record-table table-wrap"><table class="pc-monthly-plan-table"><thead><tr><th>机型</th><th>机号</th><th>配属局</th><th>配属段</th><th>修程</th><th>修次</th><th><button type="button" class="pc-plan-date-sort" data-list-sort-toggle title="计划入段：${sortLabel}" aria-label="计划入段时间${sortLabel}">计划入段时间 <span aria-hidden="true">${sortIcon}</span></button></th><th>累计走行公里</th><th>状态</th><th class="cell-end">操作</th></tr></thead><tbody>${rows.map(row => `<tr class="${row.isDraft?'is-draft-row ':''}${view.draftSelectionMode&&canSelectCurrentCandidate(row)?'is-selectable-row':''}"><td>${esc(row.modelName||'未填写')}</td><td><strong class="plan-car-no">${esc(row.locomotiveNo||'未填写')}</strong></td><td>${esc(row.ownerBureau||'未填写')}</td><td>${esc(row.ownerDepot||'未填写')}</td><td>${esc(row.repairProgramName||'未填写')}</td><td>${row.repairSequence==null?'未填写':`第 ${esc(row.repairSequence)} 次`}</td><td class="date-cell">${esc(row.plannedEntryAt||row.entryDate||'未填写')}</td><td>${row.mileageKm==null?'未填写':`${esc(row.mileageKm)} km`}</td><td><span class="plan-status ${visualStatusClass(row)} ${row.status === 'SCHEDULED' || row.versionStatus === 'CURRENT' ? 'is-scheduled' : ''}">${esc(statusLabel(row))}</span></td><td class="cell-end"><div class="table-actions"><button type="button" class="btn btn-sm" data-plan-detail="${row.vehicleRepairId||row.id}" data-plan-item-id="${esc(row.id)}">查看详情</button>${row.isDeletionMarker&&row.isDraft?`<button type="button" class="btn btn-sm" data-cancel-delete-marker="${row.vehicleRepairId}">取消删除</button>`:''}</div></td></tr>`).join('') || '<tr><td colspan="10" class="empty"><strong>这个月份还没有检修计划</strong><span>点击上方“导入计划文件”或“新建车辆”开始添加。</span></td></tr>'}</tbody></table></div><div class="plan-table-footer"><span>共 ${rows.length} 条车辆</span></div></section>`
}

function importGuide() {
  return `<aside class="plan-guide" aria-label="导入指引"><div class="guide-heading"><h2>${icon('file',20)}从计划到检修</h2><p>简单三步，完成检修计划导入。</p></div><div class="plan-guide-art">${workspaceArt('plan')}</div><ol class="guide-steps"><li><b>1</b><div><strong>填写模板</strong><p>填入车号、机型、修程和入段日期。</p></div></li><li class="${view.preview ? 'is-current' : ''}"><b>2</b><div><strong>上传并检查</strong><p>系统逐行校验，先预览，再入库。</p></div></li><li><b>3</b><div><strong>确认导入</strong><p>通过的计划保存后，即可选车排程。</p></div></li></ol><div class="guide-download"><span>还没有模板？</span><a class="template-download" href="/api/planning/import/template.xlsx">${icon('file',17)}下载 Excel 模板 ${icon('arrow',15)}</a><details class="guide-other"><summary>CSV 模板与填写说明</summary><div><a href="/api/planning/import/template.csv">下载 CSV 模板</a><a href="/api/planning/import/example.md" target="_blank" rel="noreferrer">查看填写示例 ↗</a></div></details></div><p class="guide-caption">支持 .xlsx、.xls、.csv<br>单个文件不超过 5 MB，最多 1,000 条。</p></aside>`
}

function manualForm() {
  if (!view.manualOpen) return ''
  return `<section class="card pc-plan-manual"><div class="pc-plan-panel-head"><div><h2>手动新建计划</h2><p>保存前仍会经过与文件导入相同的校验和确认。</p></div><button type="button" class="btn" data-close-manual>收起</button></div><div class="pc-plan-manual-grid">
    <label>机车编号<input class="input" maxlength="64" data-manual-loco></label>
    <label>机型<select class="select" data-manual-model><option value="">请选择机型</option>${view.lookups.models.map(row=>`<option value="${esc(row.name)}">${esc(row.name)}</option>`).join('')}</select></label>
    <label>修程<select class="select" data-manual-program><option value="">请选择修程</option>${view.lookups.programs.map(row=>`<option value="${esc(row.name)}" data-model-id="${row.modelId}">${esc(row.name)}</option>`).join('')}</select></label>
    <label>修次（选填）<input class="input" type="number" min="1" step="1" data-manual-sequence></label>
    <label>计划入段日期<input class="input" type="date" data-manual-date></label>
    <label>配属局（选填）<input class="input" data-manual-bureau></label>
    <label>配属段（选填）<input class="input" data-manual-depot></label>
    <label>累计走行公里（选填）<input class="input" type="number" min="0" step="0.1" data-manual-mileage></label>
    <label class="is-wide">备注（选填）<input class="input" data-manual-remark></label>
  </div><button type="button" class="btn btn-primary" data-manual-preview ${view.busy?'disabled title="正在处理上一项操作，请稍候。"':''}>校验并预览</button></section>`
}

function removeFloatingNotice(button) {
  const notice = button?.closest('.pc-plan-notification')
  if (!notice) return
  const stack = notice.parentElement
  notice.remove()
  if (stack && !stack.children.length) stack.remove()
}

function setMessage(message, kind = 'info') {
  if(message){const item={id:`${Date.now()}-${Math.random()}`,text:message,kind};view.messages.push(item);setTimeout(()=>{view.messages=view.messages.filter(row=>row.id!==item.id);removeFloatingNotice(document.querySelector(`[data-dismiss-message="${item.id}"]`))},5000)}
}

function floatingNotices() {
  const items=[]
  if(view.result)items.push(`<section class="pc-plan-notification is-success" role="status"><div><strong>导入完成</strong><span>新增 ${view.result.imported} 条，未导入 ${view.result.notImported} 条。</span></div><button type="button" data-dismiss-result aria-label="关闭导入结果">×</button></section>`)
  for(const message of view.messages){const kind=message.kind==='error'?'is-error':message.kind==='success'?'is-success':'is-info',title=message.kind==='error'?'操作失败':message.kind==='success'?'操作成功':'提示';items.push(`<section class="pc-plan-notification ${kind}" role="${message.kind==='error'?'alert':'status'}"><div><strong>${title}</strong><span>${esc(message.text)}</span></div><button type="button" data-dismiss-message="${esc(message.id)}" aria-label="关闭提示">×</button></section>`)}
  return items.length?`<div class="pc-plan-notification-stack" aria-live="polite">${items.join('')}</div>`:''
}

function openMonthlyTodos(ctx) {
  const items = view.todos
  const body = items.length
    ? `<div class="pc-monthly-todo-modal-list">${items.map(item => `<button type="button" class="pc-monthly-todo-modal-item" data-monthly-todo-jump="${item.id}" data-todo-month="${item.year}-${pad(item.month)}"><span><strong>${esc(item.title)}</strong><small>${item.year}年${item.month}月 · ${todoStatusLabel(item.status)}</small></span><em>${item.vehicleCount} 辆车待处理</em><i>查看</i></button>`).join('')}</div>`
    : '<p class="pc-plan-empty">当前角色暂无待办事项。</p>'
  const wrap = openModal({ title: '待办', body, wide: true, confirmText: '关闭', cancelText: '关闭', onConfirm: () => true })
  wrap.querySelectorAll('[data-monthly-todo-jump]').forEach(button => button.addEventListener('click', () => {
    markTodoRead(button.dataset.monthlyTodoJump)
    view.month = button.dataset.todoMonth
    view.day = `${view.month}-01`
    leaveSelectionScope()
    wrap.querySelector('[data-modal-close]')?.click()
    refresh(ctx, 'calendar')
  }))
}

async function loadData(mode = 'calendar', revision = null) {
  view.loading = true; view.error = ''
  try {
    const lookups = await api('/api/planning/lookups')
    view.lookups = lookups
    if (mode === 'calendar') {
      const bounds = monthBounds(view.month),calendarParams=new URLSearchParams({from:bounds.from,to:bounds.to}),from=`${view.month}-01`,to=monthEnd(view.month),listParams=new URLSearchParams({from,to,locomotiveNo:view.filter.locomotiveNo,ownerDepot:view.filter.ownerDepot,repairSequence:view.filter.repairSequence,status:view.filter.status,approvalStatus:view.filter.approvalStatus})
      const [calendarResult,listResult,monthlyPlan,todos]=await Promise.all([api(`/api/planning/calendar?${calendarParams}`),api(`/api/planning/plans?${listParams}`),api(`/api/monthly-plans/month?year=${view.month.slice(0,4)}&month=${Number(view.month.slice(5,7))}`),api('/api/monthly-plans/todos')])
      view.monthlyPlan=monthlyPlan
      view.todos=todos.items||[]
      const allItems=[...(monthlyPlan.items||[])]
      const mergeItem=(row,item,isDraft=false)=>({...row,...item,id:row.id,entryDate:item.plannedEntryAt.slice(0,10),planSource:'MONTHLY',approvalStatus:item.approvalStatus|| (isDraft?'DRAFT':'PUBLISHED'),isDraft:Boolean(item.isDraft||isDraft),isPending:Boolean(item.isPending),isChanged:Boolean(item.isChanged),isPublished:Boolean(item.isPublished)})
      const mergeRows=source=>{const rawByVehicle=new Map(source.filter(row=>row.planSource!=='ANNUAL').map(row=>[row.id,row]));return allItems.map(item=>{const raw=rawByVehicle.get(item.vehicleRepairId);const fallback={id:item.vehicleRepairId,locomotiveNo:item.locomotiveNo,modelId:item.modelId,modelName:item.modelName,repairProgramId:item.repairProgramId,repairProgramName:item.repairProgramName,status:'UNSCHEDULED',planSource:'MONTHLY'};return mergeItem(raw||fallback,item,Boolean(item.isDraft))})}
      view.rows = mergeRows(calendarResult.vehicles)
      view.planRows = mergeRows(listResult.vehicles)
      const availableDraftKeys=new Set([...view.rows,...view.planRows].filter(canSelectCurrentCandidate).map(draftKey)); view.selectedDraftKeys=new Set([...view.selectedDraftKeys].filter(key=>availableDraftKeys.has(key))); if(view.draftSelectionMode) saveSelection()
    } else {
      const month = view.month
      const from = view.importType === 'ANNUAL' ? `${view.annualYear || month.slice(0, 4)}-01-01` : `${month}-01`
      const to = view.importType === 'ANNUAL' ? `${view.annualYear || month.slice(0, 4)}-12-31` : monthEnd(month)
      const params = new URLSearchParams({ from, to, locomotiveNo:view.filter.locomotiveNo, ownerDepot:view.filter.ownerDepot, repairSequence:view.filter.repairSequence, status:view.filter.status, approvalStatus:view.filter.approvalStatus, ...(view.importType === 'ANNUAL' ? { planSource:'ANNUAL' } : {}) })
      const result = await api(`/api/planning/plans?${params}`)
      view.planRows = view.importType === 'ANNUAL' ? result.vehicles : result.vehicles.filter(row=>row.planSource!=='ANNUAL')
    }
    if(view.detail){
      const id=view.detail.id
      const detail=await api(`/api/planning/vehicles/${encodeURIComponent(id)}`)
      if(view.detail?.id===id)view.detail=detail
    }
  } catch (error) { view.error = error.message }
  finally { view.loading = false; view.loadedMode = mode; view.loadedRevision = revision }
}

function render(ctx, mode = 'calendar') {
  let isCalendar = mode === 'calendar'
  const planningView = ctx.state.planningView ||= { tab: 'monthly', month: view.month, vehicleFilter: '', day: view.day }
  const requestedMonth=sessionStorage.getItem('pc1-monthly-open-month')
  if(requestedMonth&&/^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)){view.month=requestedMonth;view.day=`${requestedMonth}-01`;sessionStorage.removeItem('pc1-monthly-open-month')}
  if (!viewRestored) {
    viewRestored = true
    for (const key of ['month','day','importMonth','annualYear']) if (planningView[key]) view[key] = planningView[key]
    if (['MONTHLY','ANNUAL'].includes(planningView.importType)) view.importType = planningView.importType
  }
  restoreSelection()
  if(mode==='calendar')sessionStorage.removeItem('planning-import-context')
  const annualImportMode = mode === 'plans' && sessionStorage.getItem('planning-import-context') === 'ANNUAL'
  if(mode==='plans'&&!annualImportMode)isCalendar=true
  if(ctx.demo){view.filter={modelIds:[],programIds:[],locomotiveNo:'',ownerDepot:'',repairSequence:'',status:'',approvalStatus:''}}
  rememberView(ctx)
  view.importType = annualImportMode ? 'ANNUAL' : 'MONTHLY'
  const actions = annualImportMode?`<div class="plan-import-actions"><button type="button" class="btn btn-primary" data-open-import-dialog ${view.busy?'disabled title="正在处理上一项操作，请稍候。"':''}>${actionIcon('upload')}导入年度计划文件</button></div>`:''
  const title = annualImportMode ? '年度计划导入' : '月度计划'
  const description = annualImportMode ? '导入并校验年度检修计划，确认后进入年度计划管理。' : isCalendar ? '按日期查看车辆入段与排程后的预计出段。' : '从月度计划开始，安排每一辆机车的检修。'
  return `<div class="pc-planning pc-plan-page">${pageHeader(title, ctx.demo?'':description, actions)}
    ${floatingNotices()}
    ${annualImportMode?'<nav class="plan-view-tabs plan-switch-tabs" aria-label="年度计划导入"><a href="#/functions/plans/annual-plan">返回年度计划</a><a class="active" aria-current="page">年度计划导入</a></nav>':`<nav class="plan-view-tabs plan-switch-tabs" aria-label="月度计划查看方式"><a href="#/functions/plans/monthly-calendar" class="active" aria-current="page">计划日历</a><a href="#/functions/plans/monthly-verification">交验统计</a></nav>`}
    ${isCalendar ? `${toolbar(ctx.demo)}${ctx.demo?'':monthlyWorkflowBar()}${view.preview?previewPanel():view.manualOpen?manualForm():`<div class="pc-plan-calendar-list-stack"><div class="pc-plan-calendar-section">${mainCalendar(ctx.state,ctx.demo)}</div>${plansList()}</div>`}${detailDrawer(ctx.state,ctx.demo)}` : `<div class="plan-workspace"><div class="plan-workspace-main">${view.preview ? previewPanel() : plansList()}${detailDrawer(ctx.state,ctx.demo)}</div>${ctx.demo?'':importGuide()}</div>`}</div>`
}

async function refresh(ctx, mode = 'calendar') { rememberView(ctx); await ctx.demoPersistence?.load?.(); await loadData(mode,ctx.demoPersistence?.revision); ctx.rerender(false) }

function selectCalendarDay(ctx, day) {
  view.day = day
  view.dayVehicleId = null
  view.detail = null
  if (!day.startsWith(view.month)) {
    view.month = day.slice(0, 7)
    view.loading = true
    view.error = ''
    ctx.rerender(false)
    return
  }
  document.querySelectorAll('.pc-plan-day.is-selected').forEach(cell => cell.classList.remove('is-selected'))
  document.querySelectorAll('.pc-plan-day-number').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.selectDay === day)))
  document.querySelectorAll('.pc-plan-day[data-calendar-day]').forEach(cell => cell.setAttribute('aria-pressed', String(cell.dataset.calendarDay === day)))
  document.querySelector(`.pc-plan-day-number[data-select-day="${day}"]`)?.closest('.pc-plan-day')?.classList.add('is-selected')
  const heading = document.querySelector('.pc-plan-day-card .pc-plan-panel-head p')
  if (heading) heading.textContent = day
  document.querySelector('[data-add-vehicle-for-day]')?.setAttribute('data-add-vehicle-for-day', day)
  const panel = document.querySelector('.pc-plan-day-panel')
  if (panel) panel.outerHTML = dayPanel()
}

async function openVehicle(ctx, id, day, monthlyItemId = null) {
  if (day) {
    view.day = day
    if (!day.startsWith(view.month)) { view.month = day.slice(0, 7); view.loading = true; view.error = '' }
  }
  view.detailLoading = true; view.detail = null
  ctx.rerender(false)
  try { const base=await api(`/api/planning/vehicles/${encodeURIComponent(id)}`),item=monthlyItemId!=null?view.monthlyPlan?.items.find(row=>String(row.id)===String(monthlyItemId)):view.monthlyPlan?.items.find(row=>row.vehicleRepairId===Number(id));view.detail=item?{...base,...item,id:base.id,entryDate:item.plannedEntryAt.slice(0,10)}:base }
  catch (error) { setMessage(error.message, 'error') }
  finally { view.detailLoading = false; ctx.rerender(false) }
}

async function createPreviewFromFile(file,importMode='MONTHLY_IMPORT',importMonth=view.month) {
  if (!file) throw new Error('请选择要导入的 Excel 或 CSV 文件')
  if (file.size > 5 * 1024 * 1024) throw new Error('文件不得超过5MB')
  const preview = await api('/api/planning/import/preview', { method:'POST', body:JSON.stringify({ filename:file.name, contentBase64:await fileToBase64(file), importType:view.importType, importMode, year:view.annualYear||view.month.slice(0,4), month:importMonth }) })
  preview.filename = file.name
  return preview
}

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}

function showMonthlyPreview(ctx){setTimeout(()=>ctx.rerender(false),0)}
function openImportDialog(ctx,mode) {
  const annual=view.importType==='ANNUAL'
  const modal=openModal({title:annual?'导入年度计划文件':'导入月度计划文件',wide:true,body:`<div class="notice notice-info"><strong>${annual?'年度':'月度'}计划导入</strong><span>请选择 XLSX、XLS 或 CSV 文件。系统会先校验并生成预览，确认前不会写入计划。</span></div>${annual?'':`<div class="field" style="margin-top:16px"><label>导入方式 *</label><select class="select" data-dialog-import-mode><option value="MONTHLY_IMPORT">选择月份导入</option><option value="BATCH_IMPORT">跨月份批量导入</option></select></div><div class="field" style="margin-top:16px" data-dialog-month-wrap><label>导入月份 *</label><input class="input" type="month" min="1900-01" max="2199-12" value="${esc(view.month)}" data-dialog-import-month></div>`}<div class="field" style="margin-top:16px"><label>计划文件 *</label><input class="input" type="file" accept=".xlsx,.xls,.csv" data-dialog-plan-file></div><p role="alert" class="pc-error-text" data-dialog-plan-error></p>`,confirmText:'上传并校验',async onConfirm(wrap){const error=wrap.querySelector('[data-dialog-plan-error]');try{view.busy=true;const importMode=wrap.querySelector('[data-dialog-import-mode]')?.value||'MONTHLY_IMPORT',importMonth=wrap.querySelector('[data-dialog-import-month]')?.value||view.month;view.preview=await createPreviewFromFile(wrap.querySelector('[data-dialog-plan-file]').files?.[0],importMode,importMonth);if(importMode==='BATCH_IMPORT'){view.preview.titleConflict=false;view.preview.titleOverwriteChoice='NOT_APPLICABLE'}view.previewFilter='all';setMessage('文件已校验；请复核预览后确认导入。');showMonthlyPreview(ctx,mode);return true}catch(reason){error.textContent=reason.message;return false}finally{view.busy=false}}})
  const importMode=modal.querySelector('[data-dialog-import-mode]'),monthWrap=modal.querySelector('[data-dialog-month-wrap]'),monthInput=modal.querySelector('[data-dialog-import-month]')
  const syncMonth=()=>{const batch=importMode?.value==='BATCH_IMPORT';if(monthWrap)monthWrap.hidden=batch;if(monthInput)monthInput.disabled=batch}
  importMode?.addEventListener('change',syncMonth)
  syncMonth()
}

function openManualDialog(ctx,mode,defaultDate=view.day,existingPreviewId=null) {
  openModal({title:'新建车辆',wide:true,body:`<div class="pc-plan-manual-grid"><label>机车编号<input class="input" maxlength="64" data-dialog-loco></label><label>机型<select class="select" data-dialog-model><option value="">请选择机型</option>${view.lookups.models.map(row=>`<option value="${esc(row.name)}">${esc(row.name)}</option>`).join('')}</select></label><label>修程<select class="select" data-dialog-program><option value="">请选择修程</option>${view.lookups.programs.map(row=>`<option value="${esc(row.name)}">${esc(row.name)}</option>`).join('')}</select></label><label>修次（选填）<input class="input" type="number" min="1" data-dialog-sequence></label><label>计划入段日期<input class="input" type="date" value="${esc(defaultDate||'')}" data-dialog-date></label><label>配属局（选填）<input class="input" data-dialog-bureau></label><label>配属段（选填）<input class="input" data-dialog-depot></label><label>累计走行公里（选填）<input class="input" type="number" min="0" data-dialog-mileage></label><label class="is-wide">备注（选填）<input class="input" data-dialog-remark></label></div><p role="alert" class="pc-error-text" data-dialog-plan-error></p>`,confirmText:'校验并预览',async onConfirm(wrap){const get=name=>wrap.querySelector(`[data-dialog-${name}]`)?.value||'',fields=['机车编号','机型','修程','修次','计划入段日期','配属局','配属段','累计走行公里','备注'],row=['loco','model','program','sequence','date','bureau','depot','mileage','remark'].map(get),csv=`\uFEFF${[fields,row].map(items=>items.map(item=>`"${String(item).replaceAll('"','""')}"`).join(',')).join('\r\n')}\r\n`,file=new File([csv],'新建车辆.csv',{type:'text/csv'});try{view.busy=true;if(existingPreviewId){const previewFilename=view.preview?.filename||'计划文件',previewTitleConflict=view.preview?.titleConflict,previewTitleChoice=view.preview?.titleOverwriteChoice;view.preview=await api(`/api/planning/import/preview/${encodeURIComponent(existingPreviewId)}/rows`,{method:'POST',body:JSON.stringify({filename:file.name,contentBase64:await fileToBase64(file)})});view.preview.filename=previewFilename;if(previewTitleConflict!==undefined)view.preview.titleConflict=previewTitleConflict;if(previewTitleChoice!==undefined)view.preview.titleOverwriteChoice=previewTitleChoice;setMessage('新建车辆已追加到当前导入预览，请继续复核后统一确认导入。','success')}else{view.preview=await createPreviewFromFile(file);view.preview.filename='新建车辆';view.preview.titleConflict=false;view.preview.titleOverwriteChoice='KEEP';setMessage('已生成新建车辆预览；请复核后确认。')}view.previewFilter='all';view.importType='MONTHLY';showMonthlyPreview(ctx,mode);return true}catch(reason){wrap.querySelector('[data-dialog-plan-error]').textContent=reason.message;return false}finally{view.busy=false}}})
}

function openPreviewRowEditor(ctx,line) {
  const row=view.preview?.rows.find(item=>item.line===Number(line))
  if(!row)return
  const raw=row.raw||{},value=(label,key)=>raw[label]??row.data?.[key]??''
  const input=(label,key,type='text')=>`<label>${label}<input class="input" type="${type}" value="${esc(value(label,key))}" data-preview-value="${key}"></label>`
  const modelOptions=view.lookups.models.map(model=>`<option value="${esc(model.name)}" ${String(value('机型','modelName'))===String(model.name)?'selected':''}>${esc(model.name)}</option>`).join('')
  const programOptions=view.lookups.programs.map(program=>`<option value="${esc(program.name)}" data-model-id="${program.modelId}" ${String(value('修程','repairProgramName'))===String(program.name)?'selected':''}>${esc(program.name)}</option>`).join('')
  openModal({title:`编辑导入预览第${row.line}行`,wide:true,body:`<div class="pc-plan-manual-grid">${input('机车编号','locomotiveNo')}<label>机型<select class="select" data-preview-value="modelName" data-preview-model><option value="">请选择机型</option>${modelOptions}</select></label><label>修程<select class="select" data-preview-value="repairProgramName" data-preview-program><option value="">请选择修程</option>${programOptions}</select></label>${input('修次','repairSequence','number')}${input('计划入段日期','plannedEntryAt','date')}${input('配属局','ownerBureau')}${input('配属段','ownerDepot')}${input('累计走行公里','mileageKm','number')}<label class="is-wide">备注<input class="input" value="${esc(value('备注','remark'))}" data-preview-value="remark"></label></div><p role="alert" class="pc-error-text" data-preview-edit-error></p>`,confirmText:'保存',async onConfirm(wrap){const values=Object.fromEntries([...wrap.querySelectorAll('[data-preview-value]')].map(element=>[element.dataset.previewValue,element.value]));try{view.preview=await api(`/api/planning/import/preview/${encodeURIComponent(view.preview.id)}/rows/${row.line}`,{method:'PATCH',body:JSON.stringify({values})});const updated=view.preview.rows.find(item=>item.line===row.line);setMessage(updated?.status==='ready'?'修改已保存。':'修改已保存，当前行仍有错误需要处理。',updated?.status==='ready'?'success':'error');ctx.rerender(false);return true}catch(error){wrap.querySelector('[data-preview-edit-error]').textContent=error.message;return false}}})
  const model=document.querySelector('[data-preview-model]'),program=document.querySelector('[data-preview-program]')
  const filterPrograms=()=>{const modelId=view.lookups.models.find(item=>item.name===model.value)?.id;for(const option of program.options){if(!option.value)continue;option.hidden=Boolean(modelId)&&String(option.dataset.modelId)!==String(modelId)}if(program.selectedOptions[0]?.hidden)program.value=''}
  model?.addEventListener('change',filterPrograms);filterPrograms()
}

function openPreviewRowDelete(ctx,line) {
  const row=view.preview?.rows.find(item=>item.line===Number(line))
  if(!row)return
  openModal({title:'删除导入数据',body:`<p>确认删除第 ${row.line} 行“${esc(row.raw?.['机车编号']||row.data?.locomotiveNo||'未填写机车编号')}”吗？删除后不会导入该条数据。</p><p role="alert" class="pc-error-text" data-preview-delete-error></p>`,confirmText:'删除',async onConfirm(wrap){try{view.preview=await api(`/api/planning/import/preview/${encodeURIComponent(view.preview.id)}/rows/${row.line}`,{method:'DELETE'});setMessage('该条导入数据已删除。','success');ctx.rerender(false);return true}catch(error){wrap.querySelector('[data-preview-delete-error]').textContent=error.message;return false}}})
}

const currentPeriod=()=>({year:Number(view.month.slice(0,4)),month:Number(view.month.slice(5,7))})
async function runMonthlyAction(ctx,path,payload={}){try{view.busy=true;const result=await api(path,{method:'POST',body:JSON.stringify({...currentPeriod(),...payload})});setMessage(result.statusText||'操作已完成','success');await refresh(ctx,'calendar');return true}catch(error){setMessage(error.message,'error');ctx.rerender(false);return false}finally{view.busy=false}}

function openMonthlySubmit(ctx){
  const plan=view.monthlyPlan, title=plan?.title||'本月计划', adjustment=Boolean(plan?.hasPublishedVersion)
  const rows=[...new Map([...view.rows,...view.planRows].filter(row=>view.selectedDraftKeys.has(draftKey(row))&&canSelectDraft(row)).map(row=>[draftKey(row),row])).values()]
  const added=rows.filter(row=>['ADD','ADDED'].includes(row.changeType)).length
  const cancelled=rows.filter(row=>['DELETE','CANCELLED'].includes(row.changeType)||row.isCancelled).length
  const modified=rows.length-added-cancelled
  const publishedKeys=new Set((plan?.items||[]).filter(row=>row.isPublished&&!row.isCancelled).map(row=>row.stableItemKey))
  const expected=Math.max(0,publishedKeys.size+added-cancelled)
  openModal({title:`${title} · 申请审核`,wide:true,body:`<div class="pc-application-summary"><dl><div><dt>年月</dt><dd>${esc(view.month)}</dd></div><div><dt>当前角色</dt><dd>${esc(roleText[view.simulatedRole])}</dd></div><div><dt>选中变更</dt><dd>${rows.length} 项</dd></div><div><dt>新增</dt><dd>${added} 项</dd></div><div><dt>修改</dt><dd>${modified} 项</dd></div><div><dt>删除</dt><dd>${cancelled} 项</dd></div><div><dt>当前正式车辆</dt><dd>${publishedKeys.size} 辆</dd></div><div><dt>发布后预计</dt><dd>${expected} 辆</dd></div></dl></div><div class="pc-selected-vehicle-list">${rows.map(row=>`<span class="pc-plan-state-pill is-draft">${esc(row.locomotiveNo)} · ${esc(row.plannedEntryAt?.slice(0,10)||'未填写')} · ${esc(['ADD','ADDED'].includes(row.changeType)?'新增':['DELETE','CANCELLED'].includes(row.changeType)||row.isCancelled?'删除':'修改')}</span>`).join('')}</div><div class="field"><label>本次申请说明<textarea class="textarea" maxlength="500" data-monthly-note></textarea></label></div>${adjustment?'<div class="field"><label>调整原因 *<textarea class="textarea" maxlength="500" data-monthly-adjust></textarea></label></div>':''}<p class="pc-error-text" data-monthly-error></p>`,confirmText:'确认提交审核',async onConfirm(wrap){try{if(!rows.length)throw new Error('请先勾选至少一项自己的待提交变更。');await api('/api/monthly-plans/submit',{method:'POST',body:JSON.stringify({...currentPeriod(),selectedItemKeys:rows.map(draftKey),note:wrap.querySelector('[data-monthly-note]').value,adjustReason:wrap.querySelector('[data-monthly-adjust]')?.value||''})});clearSelection();setMessage(`已提交 ${rows.length} 项变更，未选事项保持可编辑。`,'success');await refresh(ctx,'calendar');return true}catch(error){wrap.querySelector('[data-monthly-error]').textContent=error.message;return false}}})
}

function openMonthlyRequestPublish(ctx){
  const plan=view.monthlyPlan, title=plan?.title||'本月计划', rows=[...new Map([...view.rows,...view.planRows].filter(row=>view.selectedDraftKeys.has(draftKey(row))&&canSelectPublishCandidate(row)).map(row=>[draftKey(row),row])).values()]
  const own=rows.filter(row=>canSelectDraft(row)).length, reviewed=rows.filter(row=>row.isReviewedPending||row.approvalStatus==='REVIEWED').length, adjustment=Boolean(plan?.hasPublishedVersion)
  openModal({title:`${title} · 申请发布`,wide:true,body:`<div class="pc-application-summary"><dl><div><dt>年月</dt><dd>${esc(view.month)}</dd></div><div><dt>当前角色</dt><dd>${esc(roleText[view.simulatedRole])}</dd></div><div><dt>本次选择</dt><dd>${rows.length} 项</dd></div><div><dt>科长自己的草稿</dt><dd>${own} 项</dd></div><div><dt>紫色已审核事项</dt><dd>${reviewed} 项</dd></div></dl></div><div class="pc-selected-vehicle-list">${rows.map(row=>`<span class="pc-plan-state-pill ${row.isReviewedPending||row.approvalStatus==='REVIEWED'?'is-reviewed':'is-draft'}">${esc(row.locomotiveNo)} · ${esc(row.plannedEntryAt?.slice(0,10)||'未填写')} · ${esc(row.isReviewedPending||row.approvalStatus==='REVIEWED'?'已审核待申请发布':'科长草稿')}</span>`).join('')}</div><div class="field"><label>本次申请发布说明<textarea class="textarea" maxlength="500" data-monthly-note></textarea></label></div>${adjustment?'<div class="field"><label>调整原因 *<textarea class="textarea" maxlength="500" data-monthly-adjust></textarea></label></div>':''}<p class="pc-error-text" data-monthly-error></p>`,confirmText:'确认申请发布',async onConfirm(wrap){try{if(!rows.length)throw new Error('请先勾选科长草稿或紫色已审核待申请发布事项。');await api('/api/monthly-plans/request-publish',{method:'POST',body:JSON.stringify({...currentPeriod(),selectedItemKeys:rows.map(draftKey),note:wrap.querySelector('[data-monthly-note]').value,adjustReason:wrap.querySelector('[data-monthly-adjust]')?.value||''})});clearSelection();setMessage(`已申请发布 ${rows.length} 项；只有本次勾选事项进入待发布，未勾选事项继续保持紫色。`,'success');await refresh(ctx,'calendar');return true}catch(error){wrap.querySelector('[data-monthly-error]').textContent=error.message;return false}}})
}

function openMonthlyDirectPublish(ctx){const title=view.monthlyPlan?.title||'本月计划',rows=[...new Map([...view.rows,...view.planRows].filter(row=>view.selectedDraftKeys.has(draftKey(row))).map(row=>[draftKey(row),row])).values()];openModal({title:`${title} · 直接发布`,body:`<p>主管副段长将直接发布已选<strong>${rows.length}</strong>辆草稿车辆。</p><div class="pc-selected-vehicle-list">${rows.map(row=>`<span class="pc-plan-state-pill is-draft">${esc(row.locomotiveNo)} · ${esc(row.plannedEntryAt?.slice(0,10)||'未填写')}</span>`).join('')}</div><div class="field"><label>发布说明</label><textarea class="textarea" maxlength="500" data-monthly-note></textarea></div><p class="pc-error-text" data-monthly-error></p>`,confirmText:'确认直接发布',async onConfirm(wrap){try{await api('/api/monthly-plans/direct-publish',{method:'POST',body:JSON.stringify({...currentPeriod(),selectedItemKeys:rows.map(draftKey),note:wrap.querySelector('[data-monthly-note]').value})});clearSelection();setMessage('已选草稿车辆已直接发布。','success');await refresh(ctx,'calendar');return true}catch(error){wrap.querySelector('[data-monthly-error]').textContent=error.message;return false}}})}
function openMonthlyReject(ctx){const title=view.monthlyPlan?.title||'本月计划';openModal({title:`${title} · 驳回计划`,body:`<p>确认驳回“<strong>${esc(title)}</strong>”计划？</p><div class="field"><label>驳回原因 *</label><textarea class="textarea" maxlength="500" data-monthly-reason></textarea></div><p class="pc-error-text" data-monthly-error></p>`,confirmText:'确认驳回',async onConfirm(wrap){try{await api('/api/monthly-plans/decision',{method:'POST',body:JSON.stringify({...currentPeriod(),action:'REJECT',reason:wrap.querySelector('[data-monthly-reason]').value})});setMessage('计划已驳回。','success');await refresh(ctx,'calendar');return true}catch(error){wrap.querySelector('[data-monthly-error]').textContent=error.message;return false}}})}
function confirmMonthlyAction(ctx,{title,body,confirmText,path,payload={}}){const planTitle=view.monthlyPlan?.title||'本月计划';openModal({title:`${planTitle} · ${title}`,body:`<p>${body.replace('{title}',`<strong>${esc(planTitle)}</strong>`)}</p><p class="pc-error-text" data-monthly-confirm-error></p>`,confirmText,async onConfirm(wrap){try{const result=await api(path,{method:'POST',body:JSON.stringify({...currentPeriod(),...payload})});setMessage(result.statusText||`${title}完成`,'success');await refresh(ctx,'calendar');return true}catch(error){wrap.querySelector('[data-monthly-confirm-error]').textContent=error.message;return false}}})}

function mountPublishedDraftActions(ctx){
  document.querySelector('[data-monthly-request-edit]')?.addEventListener('click',()=>{
    const vehicle=view.detail;if(!vehicle)return
    const field=(key,label,type='text',value=vehicle[key])=>`<div class="field"><label>${label}<input class="input" data-request-edit-field="${key}" type="${type}" value="${esc(value??'')}"></label></div>`
    openModal({title:`申请修改 · ${esc(vehicle.locomotiveNo)}`,wide:true,body:`<p class="pc-help">原正式计划在审批发布前保持不变；本次内容保存为当前角色的修改草稿。</p><div class="grid grid-2">${field('locomotiveNo','机车编号')}<div class="field"><label>机型 / 修程<select class="select" data-request-edit-field="repairProgramId">${view.lookups.programs.map(row=>`<option value="${row.id}" ${row.id===vehicle.repairProgramId?'selected':''}>${esc(view.lookups.models.find(model=>model.id===row.modelId)?.name||'')} / ${esc(row.name)}</option>`).join('')}</select></label></div>${field('plannedEntryAt','计划入段日期','date',vehicle.plannedEntryAt?.slice(0,10))}${field('repairSequence','修次（选填）','number')}${field('ownerBureau','配属局（选填）')}${field('ownerDepot','配属段（选填）')}${field('mileageKm','累计走行公里（选填）','number')}${field('remark','备注（选填）')}</div><div class="field"><label>修改原因 *<textarea class="textarea" maxlength="500" data-request-change-reason></textarea></label></div><p class="pc-error-text" data-request-edit-error></p>`,confirmText:'保存修改草稿',async onConfirm(wrap){const values=Object.fromEntries([...wrap.querySelectorAll('[data-request-edit-field]')].map(input=>[input.dataset.requestEditField,input.value]));try{await api(`/api/monthly-plans/items/${vehicle.id}`,{method:'PATCH',body:JSON.stringify({...currentPeriod(),values,changeReason:wrap.querySelector('[data-request-change-reason]').value})});view.detail=null;setMessage('修改草稿已创建，原正式计划未改变。','success');await refresh(ctx,'calendar');return true}catch(error){wrap.querySelector('[data-request-edit-error]').textContent=error.message;return false}}})
  })
  document.querySelector('[data-monthly-request-cancel]')?.addEventListener('click',()=>{
    const vehicle=view.detail;if(!vehicle)return
    openModal({title:`申请删除 · ${esc(vehicle.locomotiveNo)}`,body:`<div class="pc-application-summary"><dl><div><dt>车辆编号</dt><dd>${esc(vehicle.locomotiveNo)}</dd></div><div><dt>原计划入段日期</dt><dd>${esc(vehicle.plannedEntryAt?.slice(0,10)||'未填写')}</dd></div></dl></div><p>本操作只创建删除标记，不复制或删除车辆；正式车辆在审批发布前继续有效。</p><div class="field"><label>删除原因 *<textarea class="textarea" maxlength="500" data-request-cancel-reason></textarea></label></div><div class="field"><label>删除说明（选填）<textarea class="textarea" maxlength="500" data-request-delete-note></textarea></label></div><p class="pc-error-text" data-request-cancel-error></p>`,confirmText:'创建删除标记',async onConfirm(wrap){try{const result=await api(`/api/monthly-plans/items/${vehicle.id}`,{method:'DELETE',body:JSON.stringify({...currentPeriod(),changeReason:wrap.querySelector('[data-request-cancel-reason]').value,deleteNote:wrap.querySelector('[data-request-delete-note]').value})});view.detail=null;setMessage(result.statusText,'success');await refresh(ctx,'calendar');return true}catch(error){wrap.querySelector('[data-request-cancel-error]').textContent=error.message;return false}}})
  })
}

function renderMount(ctx, mode = 'calendar') {
  const isCalendar = mode === 'calendar'
  document.querySelector('[data-pc1-open-single]')?.addEventListener('click', event => { ctx.state.selectedVehicleRepairId = Number(event.currentTarget.dataset.pc1OpenSingle) })
  mountResourceLists(ctx, ctx.state.planningView ||= { tab: 'monthly', month: view.month, vehicleFilter: '', day: view.day }, false)
  mountPublishedDraftActions(ctx)
  decorateDraftSelection()
  document.querySelector('[data-monthly-role]')?.addEventListener('change',event=>{leaveSelectionScope();view.simulatedRole=event.target.value;localStorage.setItem('pc1-monthly-role',view.simulatedRole);setMessage(`已切换为${roleText[view.simulatedRole]}模拟视角。`);refresh(ctx,'calendar')})
  if(!selectionListenerBound){selectionListenerBound=true;document.addEventListener('change',event=>{const target=event.target;if(target.matches?.('[data-draft-select]')){event.stopPropagation();const key=String(target.dataset.draftSelect);if(target.checked)view.selectedDraftKeys.add(key);else view.selectedDraftKeys.delete(key);saveSelection();ctx.rerender(false)}else if(target.matches?.('[data-select-all-drafts]')){event.stopPropagation();const eligible=[...new Map([...view.rows,...view.planRows].filter(canSelectCurrentCandidate).map(row=>[draftKey(row),row])).values()];if(target.checked)eligible.forEach(row=>view.selectedDraftKeys.add(draftKey(row)));else eligible.forEach(row=>view.selectedDraftKeys.delete(draftKey(row)));saveSelection();ctx.rerender(false)}});document.addEventListener('click',event=>{const select=event.target.closest?.('[data-select-day-drafts]'), clear=event.target.closest?.('[data-clear-day-drafts]');if(!select&&!clear)return;event.preventDefault();event.stopPropagation();const candidates=entriesForDay(view.day).filter(item=>item.type==='entry'&&canSelectCurrentCandidate(item.vehicle));candidates.forEach(item=>clear?view.selectedDraftKeys.delete(draftKey(item.vehicle)):view.selectedDraftKeys.add(draftKey(item.vehicle)));saveSelection();ctx.rerender(false)})}
  document.querySelector('[data-edit-monthly-title]')?.addEventListener('click',()=>openModal({title:'修改月度计划标题',body:`<div class="field"><label>计划标题 *</label><input class="input" maxlength="255" value="${esc(view.monthlyPlan?.title||'')}" data-monthly-title></div><p class="pc-error-text" data-monthly-error></p>`,confirmText:'保存标题',async onConfirm(wrap){try{await api('/api/monthly-plans/title',{method:'PATCH',body:JSON.stringify({...currentPeriod(),title:wrap.querySelector('[data-monthly-title]').value})});setMessage('月度计划标题已保存。','success');await refresh(ctx,'calendar');return true}catch(error){wrap.querySelector('[data-monthly-error]').textContent=error.message;return false}}}))
  document.querySelector('[data-start-monthly-submit]')?.addEventListener('click',()=>{startSelection('SUBMIT');ctx.rerender(false)})
  document.querySelector('[data-confirm-monthly-submit]')?.addEventListener('click',()=>openMonthlySubmit(ctx))
  document.querySelector('[data-start-request-publish]')?.addEventListener('click',()=>{startSelection('PUBLISH');ctx.rerender(false)})
  document.querySelector('[data-confirm-request-publish]')?.addEventListener('click',()=>openMonthlyRequestPublish(ctx))
  document.querySelector('[data-start-direct-publish]')?.addEventListener('click',()=>{startSelection('DIRECT_PUBLISH');ctx.rerender(false)})
  document.querySelector('[data-confirm-direct-publish]')?.addEventListener('click',()=>openMonthlyDirectPublish(ctx))
  document.querySelector('[data-cancel-draft-selection]')?.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();clearSelection();ctx.rerender(false)})
  document.querySelector('[data-toggle-calendar]')?.addEventListener('click',()=>{view.calendarCollapsed=!view.calendarCollapsed;ctx.rerender(false)})
  document.querySelector('[data-toggle-day-selection]')?.addEventListener('click',()=>{view.daySelectionCollapsed=!view.daySelectionCollapsed;ctx.rerender(false)})
  document.querySelector('[data-monthly-withdraw]')?.addEventListener('click',()=>confirmMonthlyAction(ctx,{title:'撤回申请',body:'确认撤回“{title}”的审核申请？撤回后可以继续修改。',confirmText:'确认撤回',path:'/api/monthly-plans/withdraw'}))
  document.querySelector('[data-monthly-takeover]')?.addEventListener('click',()=>{const title=view.monthlyPlan?.title||'本月计划';openModal({title:`${title} · 接管处理`,body:`<p>接管后申请将跳过科长审核，直接进入主管副段长审批发布环节；原申请不会重复流转。</p><div class="field"><label>接管原因 *<textarea class="textarea" maxlength="500" data-monthly-takeover-reason></textarea></label></div><p class="pc-error-text" data-monthly-takeover-error></p>`,confirmText:'确认接管',async onConfirm(wrap){try{const result=await api('/api/monthly-plans/takeover',{method:'POST',body:JSON.stringify({...currentPeriod(),reason:wrap.querySelector('[data-monthly-takeover-reason]').value})});setMessage(result.statusText,'success');await refresh(ctx,'calendar');return true}catch(error){wrap.querySelector('[data-monthly-takeover-error]').textContent=error.message;return false}}})})
  document.querySelector('[data-monthly-approve]')?.addEventListener('click',()=>confirmMonthlyAction(ctx,{title:'审核通过',body:'确认“{title}”整份申请审核通过吗？通过后变为紫色“已审核待申请发布”，需由科长勾选后申请发布。',confirmText:'确认审核通过',path:'/api/monthly-plans/decision',payload:{action:'APPROVE'}}))
  document.querySelector('[data-monthly-publish]')?.addEventListener('click',()=>confirmMonthlyAction(ctx,{title:'审批发布',body:'确认发布“{title}”？发布后将成为当前正式月度计划。',confirmText:'确认发布',path:'/api/monthly-plans/decision',payload:{action:'APPROVE'}}))
  document.querySelector('[data-monthly-reject]')?.addEventListener('click',()=>openMonthlyReject(ctx))
  document.querySelectorAll('[data-cancel-delete-marker]').forEach(button=>button.addEventListener('click',()=>openModal({title:'取消删除标记',body:'<p>取消后正式车辆继续保持已发布状态，本次取消操作会保留历史。</p><div class="field"><label>取消说明（选填）<textarea class="textarea" maxlength="500" data-cancel-delete-reason></textarea></label></div><p class="pc-error-text" data-cancel-delete-error></p>',confirmText:'确认取消删除',async onConfirm(wrap){try{const result=await api(`/api/monthly-plans/items/${button.dataset.cancelDeleteMarker}`,{method:'DELETE',body:JSON.stringify({...currentPeriod(),operation:'CANCEL_DELETE',cancelReason:wrap.querySelector('[data-cancel-delete-reason]').value})});setMessage(result.statusText,'success');await refresh(ctx,'calendar');return true}catch(error){wrap.querySelector('[data-cancel-delete-error]').textContent=error.message;return false}}})))
  document.querySelectorAll('[data-plan-detail]').forEach(button => button.addEventListener('click', () => openVehicle(ctx, button.dataset.planDetail, null, button.dataset.planItemId)))
  document.querySelector('[data-monthly-item-edit]')?.addEventListener('click',()=>{const vehicle=view.detail;if(!vehicle)return;const field=(key,label,type='text',value=vehicle[key])=>`<div class="field"><label>${label}<input class="input" data-monthly-edit-field="${key}" type="${type}" value="${esc(value??'')}"></label></div>`;openModal({title:`修改车辆 · ${esc(vehicle.locomotiveNo)}`,wide:true,body:`<div class="grid grid-2">${field('locomotiveNo','机车编号')}<div class="field"><label>机型 / 修程<select class="select" data-monthly-edit-field="repairProgramId">${view.lookups.programs.map(row=>`<option value="${row.id}" ${row.id===vehicle.repairProgramId?'selected':''}>${esc(view.lookups.models.find(model=>model.id===row.modelId)?.name||'')} / ${esc(row.name)}</option>`).join('')}</select></label></div>${field('plannedEntryAt','计划入段日期','date',vehicle.plannedEntryAt?.slice(0,10))}${field('repairSequence','修次（选填）','number')}${field('ownerBureau','配属局（选填）')}${field('ownerDepot','配属段（选填）')}${field('mileageKm','累计走行公里（选填）','number')}${field('remark','备注（选填）')}</div><p class="pc-error-text" data-monthly-edit-error></p>`,confirmText:'保存修改',async onConfirm(wrap){const values=Object.fromEntries([...wrap.querySelectorAll('[data-monthly-edit-field]')].map(input=>[input.dataset.monthlyEditField,input.value]));try{await api(`/api/monthly-plans/items/${vehicle.id}`,{method:'PATCH',body:JSON.stringify({...currentPeriod(),values})});view.detail=null;setMessage('车辆修改已保存到当前角色草稿。','success');await refresh(ctx,'calendar');return true}catch(error){wrap.querySelector('[data-monthly-edit-error]').textContent=error.message;return false}}})})
  document.querySelector('[data-monthly-item-delete]')?.addEventListener('click',()=>{const vehicle=view.detail;if(!vehicle)return;openModal({title:'删除车辆',body:`<p>确认从当前角色的月度计划草稿中删除 <strong>${esc(vehicle.locomotiveNo)}</strong>？</p><p class="pc-help">已发布车辆会形成取消申请，审核发布前不会影响当前正式计划。</p><p class="pc-error-text" data-monthly-edit-error></p>`,confirmText:'确认删除',async onConfirm(wrap){try{const result=await api(`/api/monthly-plans/items/${vehicle.id}`,{method:'DELETE',body:JSON.stringify(currentPeriod())});view.detail=null;setMessage(result.statusText,'success');await refresh(ctx,'calendar');return true}catch(error){wrap.querySelector('[data-monthly-edit-error]').textContent=error.message;return false}}})})
  document.querySelector('[data-monthly-review-deletion]')?.addEventListener('click',()=>{const vehicle=view.detail;if(!vehicle?.deletionId)return;openModal({title:`修改删除事项 · ${esc(vehicle.locomotiveNo)}`,body:`<div class="field"><label>删除原因 *<textarea class="textarea" maxlength="500" data-review-delete-reason>${esc(vehicle.deleteReason||'')}</textarea></label></div><div class="field"><label>删除说明（选填）<textarea class="textarea" maxlength="500" data-review-delete-note>${esc(vehicle.deleteNote||'')}</textarea></label></div><div class="field"><label>审核修改原因 *<textarea class="textarea" maxlength="500" data-review-delete-change></textarea></label></div><p class="pc-error-text" data-review-delete-error></p>`,confirmText:'保存审核修订',async onConfirm(wrap){try{await api(`/api/monthly-plans/deletions/${vehicle.deletionId}`,{method:'PATCH',body:JSON.stringify({...currentPeriod(),deleteReason:wrap.querySelector('[data-review-delete-reason]').value,deleteNote:wrap.querySelector('[data-review-delete-note]').value,changeReason:wrap.querySelector('[data-review-delete-change]').value})});view.detail=null;setMessage('删除事项审核修订已保存。','success');await refresh(ctx,'calendar');return true}catch(error){wrap.querySelector('[data-review-delete-error]').textContent=error.message;return false}}})})
  document.querySelectorAll('[data-monthly-review-edit],[data-monthly-published-edit]').forEach(button=>button.addEventListener('click',()=>{const vehicle=view.detail;if(!vehicle)return;const publishedEdit=button.hasAttribute('data-monthly-published-edit'),field=(key,label,type='text',value=vehicle[key])=>`<div class="field"><label>${label}<input class="input" data-review-edit-field="${key}" type="${type}" value="${esc(value??'')}"></label></div>`;openModal({title:publishedEdit?`编辑正式计划 · ${esc(vehicle.locomotiveNo)}`:`修改本次审核车辆 · ${esc(vehicle.locomotiveNo)}`,wide:true,body:`<div class="grid grid-2">${field('locomotiveNo','机车编号')}<div class="field"><label>机型 / 修程<select class="select" data-review-edit-field="repairProgramId">${view.lookups.programs.map(row=>`<option value="${row.id}" ${row.id===vehicle.repairProgramId?'selected':''}>${esc(view.lookups.models.find(model=>model.id===row.modelId)?.name||'')} / ${esc(row.name)}</option>`).join('')}</select></label></div>${field('plannedEntryAt','计划入段日期','date',vehicle.plannedEntryAt?.slice(0,10))}${field('repairSequence','修次（选填）','number')}${field('ownerBureau','配属局（选填）')}${field('ownerDepot','配属段（选填）')}${field('mileageKm','累计走行公里（选填）','number')}${field('remark','备注（选填）')}</div><div class="field"><label>${publishedEdit?'调整原因':'审核修改原因'} *<textarea class="textarea" maxlength="500" data-review-change-reason></textarea></label></div><p class="pc-error-text" data-review-edit-error></p>`,confirmText:'保存修改',async onConfirm(wrap){const values=Object.fromEntries([...wrap.querySelectorAll('[data-review-edit-field]')].map(input=>[input.dataset.reviewEditField,input.value]));try{await api(`/api/monthly-plans/items/${vehicle.id}`,{method:'PATCH',body:JSON.stringify({...currentPeriod(),values,changeReason:wrap.querySelector('[data-review-change-reason]').value,editScope:publishedEdit?'PUBLISHED':'REVIEW'})});view.detail=null;setMessage(publishedEdit?'正式计划已保存新版本。':'审核修改已保存并记录历史。','success');await refresh(ctx,'calendar');return true}catch(error){wrap.querySelector('[data-review-edit-error]').textContent=error.message;return false}}})}))
  document.querySelectorAll('[data-monthly-published-delete]').forEach(button=>button.addEventListener('click',()=>{const vehicle=view.detail;if(!vehicle)return;openModal({title:`取消正式计划 · ${esc(vehicle.locomotiveNo)}`,body:`<p>确认取消正式车辆 <strong>${esc(vehicle.locomotiveNo)}</strong>？系统会生成新正式版本，历史版本不会删除。</p><div class="field"><label>取消原因 *<textarea class="textarea" maxlength="500" data-published-cancel-reason></textarea></label></div><p class="pc-error-text" data-published-cancel-error></p>`,confirmText:'确认取消',async onConfirm(wrap){try{await api(`/api/monthly-plans/items/${vehicle.id}`,{method:'DELETE',body:JSON.stringify({...currentPeriod(),editScope:'PUBLISHED',changeReason:wrap.querySelector('[data-published-cancel-reason]').value})});view.detail=null;setMessage('正式车辆已取消并保留历史版本。','success');await refresh(ctx,'calendar');return true}catch(error){wrap.querySelector('[data-published-cancel-error]').textContent=error.message;return false}}})}))
  document.querySelectorAll('[data-go-schedule]').forEach(link=>link.addEventListener('click',()=>{const id=Number(link.dataset.goSchedule);ctx.state.planningView||={tab:'monthly',month:view.month,vehicleFilter:'',day:view.day};ctx.state.planningView.resourceVehicleIds=[id];ctx.state.selectedVehicleRepairId=id;ctx.demoPersistence?.save()}))
  document.querySelectorAll('[data-plan-operation-unavailable]').forEach(button=>button.addEventListener('click',()=>openModal({title:'当前操作不可用',body:`<p>${esc(button.dataset.planOperationUnavailable)}</p>`,confirmText:'知道了',cancelText:'关闭',onConfirm:()=>true})))
  document.querySelector('[data-open-import-dialog]')?.addEventListener('click',()=>openImportDialog(ctx,mode))
  document.querySelector('[data-open-manual-dialog]')?.addEventListener('click',()=>openManualDialog(ctx,mode))
  document.querySelector('[data-open-monthly-todos]')?.addEventListener('click',()=>openMonthlyTodos(ctx))
  document.querySelectorAll('[data-open-monthly-todo]').forEach(button=>button.addEventListener('click',()=>{view.month=button.dataset.todoMonth;view.day=`${view.month}-01`;refresh(ctx,'calendar')}))
  document.querySelectorAll('[data-dismiss-monthly-todo]').forEach(button=>button.addEventListener('click',()=>{view.dismissedTodos.add(Number(button.dataset.dismissMonthlyTodo));ctx.rerender(false)}))
  document.querySelector('[data-open-manual]')?.addEventListener('click', () => { view.manualOpen = true; ctx.rerender(false) })
  document.querySelector('[data-close-manual]')?.addEventListener('click', () => { view.manualOpen = false; ctx.rerender(false) })
  document.querySelector('[data-manual-model]')?.addEventListener('change', event => {
    const modelId = view.lookups.models.find(row => row.name === event.target.value)?.id
    const select = document.querySelector('[data-manual-program]')
    if (!select) return
    select.value = ''
    for (const option of select.options) if (option.value) option.hidden = modelId != null && Number(option.dataset.modelId) !== Number(modelId)
  })
  document.querySelector('[data-manual-preview]')?.addEventListener('click', async () => {
    const value = selector => document.querySelector(selector)?.value || ''
    const row = [value('[data-manual-loco]'), value('[data-manual-model]'), value('[data-manual-program]'), value('[data-manual-sequence]'), value('[data-manual-date]'), value('[data-manual-bureau]'), value('[data-manual-depot]'), value('[data-manual-mileage]'), value('[data-manual-remark]')]
    const fields = ['机车编号','机型','修程','修次','计划入段日期','配属局','配属段','累计走行公里','备注']
    const csv = `\uFEFF${[fields,row].map(items=>items.map(item=>`"${String(item).replaceAll('"','""')}"`).join(',')).join('\r\n')}\r\n`
    const bytes = new TextEncoder().encode(csv); let binary = ''
    for (let offset=0; offset<bytes.length; offset+=0x8000) binary += String.fromCharCode(...bytes.subarray(offset,offset+0x8000))
    view.busy = true; setMessage('正在校验手动录入内容…'); ctx.rerender(false)
    try {
      const preview = await api('/api/planning/import/preview', { method:'POST', body:JSON.stringify({ filename:'手动新建计划.csv', contentBase64:btoa(binary), importType:view.importType, importMode:'MONTHLY_IMPORT', year:document.querySelector('[data-annual-year]')?.value || view.annualYear || view.month.slice(0,4), month:document.querySelector('[data-import-month]')?.value || view.importMonth || view.month }) })
      preview.filename = '手动新建计划'
      view.preview = preview; view.previewFilter = 'all'; setMessage('已生成手动录入预览；确认前不会写入数据库。')
    } catch (error) { setMessage(error.message, 'error') }
    finally { view.busy = false; ctx.rerender(false) }
  })
  document.querySelector('[data-import-type]')?.addEventListener('change', event => {
    view.importType = event.target.value
    if (view.importType === 'ANNUAL') view.annualYear ||= view.month.slice(0, 4)
    else view.importMonth ||= view.month
    rememberView(ctx); ctx.demoPersistence?.save()
    refresh(ctx, 'plans')
  })
  document.querySelector('[data-start-import]')?.addEventListener('click', () => document.querySelector('[data-plan-file]').click())
  document.querySelector('[data-plan-file]')?.addEventListener('change', async event => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    view.busy = true; view.preview = null; setMessage(`正在上传并校验 ${file.name}…`); ctx.rerender(false)
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('文件不得超过5MB')
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
      const preview = await api('/api/planning/import/preview', { method: 'POST', body: JSON.stringify({ filename: file.name, contentBase64: btoa(binary), importType: view.importType, importMode:'MONTHLY_IMPORT', year: document.querySelector('[data-annual-year]')?.value || view.annualYear, month: document.querySelector('[data-import-month]')?.value || view.importMonth || view.month }) })
      preview.filename = file.name
      view.preview = preview; view.previewFilter = 'all'; setMessage('文件已校验；当前仍为预览，尚未写入数据库。')
    } catch (error) { setMessage(error.message, 'error') }
    finally { view.busy = false; if (input.isConnected) input.value = ''; ctx.rerender(false) }
  })
  document.querySelector('[data-import-month]')?.addEventListener('change', event => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) { view.month = event.target.value; view.importMonth = event.target.value; view.day = `${event.target.value}-01`; refresh(ctx, 'plans') } })
  document.querySelector('[data-annual-year]')?.addEventListener('change', event => { if (/^\d{4}$/.test(event.target.value)) { view.annualYear = event.target.value; view.importMonth = `${event.target.value}-01`; refresh(ctx, 'plans') } })
  document.querySelector('[data-retry]')?.addEventListener('click', () => refresh(ctx, mode))
  document.querySelector('[data-calendar-month]')?.addEventListener('change', event => {
    if (!event.target.validity.valid || !/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) return
    leaveSelectionScope(); view.month = event.target.value; view.day = `${view.month}-01`; refresh(ctx, 'calendar')
  })
  document.querySelectorAll('[data-month-step]').forEach(button => button.addEventListener('click', () => {
    const [year, month] = view.month.split('-').map(Number), moved = new Date(Date.UTC(year, month - 1 + Number(button.dataset.monthStep), 1))
    const value = `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}`
    if (value >= '1900-01' && value <= '2199-12') { leaveSelectionScope(); view.month = value; view.day = `${value}-01`; refresh(ctx, 'calendar') }
  }))
  document.querySelector('[data-today]')?.addEventListener('click', () => { leaveSelectionScope(); view.month = today().slice(0, 7); view.day = today(); refresh(ctx, 'calendar') })
  document.querySelector('[data-filter-model]')?.addEventListener('change', event => { view.filter.modelId = event.target.value; view.filter.programId = ''; refresh(ctx, 'calendar') })
  document.querySelector('[data-filter-program]')?.addEventListener('change', event => { view.filter.programId = event.target.value; refresh(ctx, 'calendar') })
  document.querySelector('[data-filter-locomotive]')?.addEventListener('change', event => { view.filter.locomotiveNo = event.target.value.trim(); refresh(ctx, 'calendar') })
  document.querySelectorAll('[data-chip-toggle^="monthly-list-"]').forEach(control=>control.addEventListener('click',event=>{if(event.target.closest('[data-list-chip-remove]'))return;const menu=document.querySelector(`[data-chip-menu="${control.dataset.chipToggle}"]`);if(menu)menu.hidden=!menu.hidden}))
  document.querySelectorAll('[data-list-chip-remove]').forEach(remove=>remove.addEventListener('click',event=>{event.stopPropagation();const key=remove.dataset.listChipRemove==='monthly-list-model'?'modelIds':'programIds';view.filter[key]=view.filter[key].filter(value=>value!==remove.dataset.chipValue);if(key==='modelIds'){const allowed=new Set(view.lookups.programs.filter(program=>!view.filter.modelIds.length||view.filter.modelIds.includes(String(program.modelId))).map(program=>String(program.id)));view.filter.programIds=view.filter.programIds.filter(value=>allowed.has(value))}ctx.rerender(false)}))
  document.querySelector('[data-list-search]')?.addEventListener('click',()=>{
    view.filter.modelIds=[...document.querySelectorAll('[data-chip-menu="monthly-list-model"] input:checked')].map(option=>option.value)
    view.filter.programIds=[...document.querySelectorAll('[data-chip-menu="monthly-list-program"] input:checked')].map(option=>option.value)
    view.filter.locomotiveNo=document.querySelector('[data-list-locomotive]')?.value.trim()||''
    view.filter.ownerDepot=document.querySelector('[data-list-depot]')?.value.trim()||''
    view.filter.repairSequence=document.querySelector('[data-list-sequence]')?.value||''
    const businessStatus=document.querySelector('[data-list-business-status]')?.value||''
    view.filter.status=businessStatus.startsWith('status:')?businessStatus.slice(7):''
    view.filter.approvalStatus=businessStatus.startsWith('approval:')?businessStatus.slice(9):''
    refresh(ctx,'calendar')
  })
  document.querySelector('[data-list-reset]')?.addEventListener('click',()=>{view.filter={modelIds:[],programIds:[],locomotiveNo:'',ownerDepot:'',repairSequence:'',status:'',approvalStatus:''};view.listSort='';refresh(ctx,'calendar')})
  document.querySelector('[data-list-sort-toggle]')?.addEventListener('click',()=>{view.listSort=view.listSort===''?'date-asc':view.listSort==='date-asc'?'date-desc':'';ctx.rerender(false)})
  document.querySelectorAll('[data-list-locomotive],[data-list-depot],[data-list-sequence]').forEach(input=>input.addEventListener('keydown',event=>{if(event.key==='Enter')document.querySelector('[data-list-search]')?.click()}))
  document.querySelector('.pc-plan-layout')?.addEventListener('click', event => {
    const addVehicle=event.target.closest('[data-add-vehicle-for-day]')
    if(addVehicle){openManualDialog(ctx,mode,addVehicle.dataset.addVehicleForDay);return}
    const calendarVehicle=event.target.closest('[data-select-day-vehicle]')
    if(calendarVehicle){view.day=calendarVehicle.dataset.eventDay;view.dayVehicleId=Number(calendarVehicle.dataset.selectDayVehicle);ctx.rerender(false);return}
    const dayVehicle=event.target.closest('[data-toggle-day-vehicle]')
    if(dayVehicle){const id=Number(dayVehicle.dataset.toggleDayVehicle);view.dayVehicleId=view.dayVehicleId===id?null:id;ctx.rerender(false);return}
    const vehicleButton = event.target.closest('[data-open-vehicle]')
    if (vehicleButton) { openVehicle(ctx, vehicleButton.dataset.openVehicle, vehicleButton.dataset.eventDay); return }
    const dayButton = event.target.closest('[data-select-day]')
    if (dayButton) { selectCalendarDay(ctx, dayButton.dataset.selectDay); return }
    const dayCell = event.target.closest('[data-calendar-day]')
    if (dayCell) selectCalendarDay(ctx, dayCell.dataset.calendarDay)
  })
  document.querySelector('.pc-plan-layout')?.addEventListener('keydown', event => {
    const dayCell = event.target.closest('[data-calendar-day]')
    if (dayCell && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      selectCalendarDay(ctx, dayCell.dataset.calendarDay)
    }
  })
  document.querySelector('[data-close-detail]')?.addEventListener('click', () => { view.detail = null; ctx.rerender(false) })
  document.querySelector('[data-close-drawer]')?.addEventListener('click', event => { if (event.target === event.currentTarget) { view.detail = null; ctx.rerender(false) } })
  document.querySelectorAll('[data-preview-filter]').forEach(button => button.addEventListener('click', () => { view.previewFilter = button.dataset.previewFilter; ctx.rerender(false) }))
  document.querySelector('[data-new-from-preview]')?.addEventListener('click',()=>openManualDialog(ctx,mode,view.day,view.preview?.id||null))
  document.querySelectorAll('[data-edit-preview-row]').forEach(button=>button.addEventListener('click',()=>openPreviewRowEditor(ctx,button.dataset.editPreviewRow)))
  document.querySelectorAll('[data-delete-preview-row]').forEach(button=>button.addEventListener('click',()=>openPreviewRowDelete(ctx,button.dataset.deletePreviewRow)))
  document.querySelector('[data-cancel-preview]')?.addEventListener('click', async () => {
    if (!view.preview) return
    try { await api(`/api/planning/import/preview/${encodeURIComponent(view.preview.id)}`, { method: 'DELETE' }) }
    catch (error) { setMessage(error.message, 'error') }
    view.preview = null; ctx.rerender(false)
  })
  document.querySelector('[data-download-errors]')?.addEventListener('click', async () => {
    try {
      const response = await api(`/api/planning/import/${encodeURIComponent(view.preview.id)}/errors.csv`)
      const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = '检修计划导入错误明细.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { setMessage(error.message, 'error'); ctx.rerender(false) }
  })
  document.querySelector('[data-confirm-import]')?.addEventListener('click', async event => {
    if (!view.preview || view.busy || !view.preview.importable) return
    const titleCanChange = view.preview.importType === 'MONTHLY' && view.preview.importMode === 'MONTHLY_IMPORT'
    if(titleCanChange && view.preview.titleConflict&&!['KEEP','REPLACE'].includes(view.preview.titleOverwriteChoice)){
      openModal({title:'确认月度计划标题',body:`<p>当前标题：<strong>${esc(view.preview.existingTitle)}</strong></p><p>文件名建议标题：<strong>${esc(view.preview.suggestedTitle)}</strong></p><div class="field"><label>标题处理方式 *</label><select class="select" data-title-choice><option value="KEEP">保留当前标题</option><option value="REPLACE">使用文件名覆盖标题</option></select></div>`,confirmText:'继续导入',onConfirm(wrap){view.preview.titleOverwriteChoice=wrap.querySelector('[data-title-choice]').value;setTimeout(()=>document.querySelector('[data-confirm-import]')?.click(),0);return true}})
      return
    }
    view.busy = true; event.currentTarget.disabled = true
    try {
      const importedRows=view.preview.rows.filter(row=>row.status==='ready').map(row=>({locomotiveNo:row.data.locomotiveNo,plannedEntryAt:row.data.plannedEntryAt})).sort((a,b)=>a.plannedEntryAt.localeCompare(b.plannedEntryAt)||a.locomotiveNo.localeCompare(b.locomotiveNo))
      const result = await api('/api/planning/import/confirm', { method: 'POST', body: JSON.stringify({ previewId: view.preview.id, titleOverwriteChoice:view.preview.titleOverwriteChoice||'NOT_APPLICABLE' }) })
      if (result.changed) {
        view.preview = { ...result.preview, filename: view.preview.filename }; setMessage('数据库出现新的计划冲突；数据未写入，请复核更新后的预览。', 'error'); ctx.rerender(false); return
      }
      view.result = result; view.preview = null; view.manualOpen = false; setMessage('导入已提交到数据库。', 'success')
      const target = view.importType === 'ANNUAL' ? `${view.annualYear || view.month.slice(0, 4)}-01` : (importedRows[0]?.plannedEntryAt?.slice(0,7)||view.month)
      view.month = target
      await Promise.all([ctx.demoPersistence?.load?.(), loadData(view.importType==='ANNUAL'?'plans':'calendar',ctx.demoPersistence?.revision)])
      if(view.importType!=='ANNUAL'&&importedRows.length){const first=view.planRows.filter(row=>importedRows.some(item=>item.locomotiveNo===row.locomotiveNo)).sort((a,b)=>a.entryDate.localeCompare(b.entryDate)||a.locomotiveNo.localeCompare(b.locomotiveNo))[0];if(first){view.day=first.entryDate;view.dayVehicleId=first.id}}
      ctx.rerender(false)
      setTimeout(()=>{view.result=null;removeFloatingNotice(document.querySelector('[data-dismiss-result]'))},5000)
    } catch (error) { setMessage(`提交失败：${error.message}。请核对数据库状态后再重试。`, 'error'); ctx.rerender(false) }
    finally { view.busy = false; ctx.rerender(false) }
  })
  document.querySelector('[data-dismiss-result]')?.addEventListener('click', () => { view.result = null; ctx.rerender(false) })
  document.querySelectorAll('[data-dismiss-message]').forEach(button=>button.addEventListener('click',()=>{view.messages=view.messages.filter(message=>message.id!==button.dataset.dismissMessage);ctx.rerender(false)}))
}

function page(mode) {
  return {
  render: ctx => render(ctx, mode==='plans'&&sessionStorage.getItem('planning-import-context')!=='ANNUAL'?'calendar':mode),
  mount(ctx) {
    const activeMode=mode==='plans'&&sessionStorage.getItem('planning-import-context')!=='ANNUAL'?'calendar':mode
    renderMount(ctx, activeMode)
    const revision=ctx.demoPersistence?.revision ?? null
    if ((view.loading || view.loadedMode !== activeMode || revision!==view.loadedRevision) && !view.loadingRequest) {
      view.loadingRequest = true
      loadData(activeMode,revision).then(() => { view.loadingRequest = false; ctx.rerender(false) })
    }
    if (view.preview) {
      const id = view.preview.id
      window.addEventListener('pagehide', () => fetch(`/api/planning/import/preview/${encodeURIComponent(id)}`, { method: 'DELETE', keepalive: true }).catch(() => {}), { once: true })
    }
  },
  }
}
export const plansPage = page('plans')
export const calendarPage = page('calendar')
