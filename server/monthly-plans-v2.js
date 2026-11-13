import { randomUUID } from 'node:crypto'

const roles = new Set(['PLANNER', 'SECTION_CHIEF', 'DEPUTY_DIRECTOR'])
const activeStatuses = ['PENDING_REVIEW', 'PENDING_PUBLISH']

function fail(status, message) { throw Object.assign(new Error(message), { status }) }
function roleOf(value) { const role = String(value || 'PLANNER').toUpperCase(); if (!roles.has(role)) fail(400, '模拟角色无效'); return role }
const rolePerson = role => ({ PLANNER: '计划员', SECTION_CHIEF: '运用科主管科长', DEPUTY_DIRECTOR: '主管副段长' }[roleOf(role)])
function period(year, month) { const y = Number(year), m = Number(month); if (!Number.isInteger(y) || y < 1900 || y > 2199 || !Number.isInteger(m) || m < 1 || m > 12) fail(400, '请选择有效年月'); return { year: y, month: m } }
const dateOnly = value => String(value || '').slice(0, 10)
const parseJson = value => typeof value === 'string' ? JSON.parse(value) : value

export function createMonthlyPlanService(database) {
  const { pool, schema } = database
  const q = name => `"${schema}"."${name}"`
  const itemSql = `SELECT i.*,rp.repair_program_name,COALESCE(rp.repair_duration_days,18) AS repair_duration_days,lm.model_id,lm.model_name FROM ${q('monthly_plan_item')} i JOIN ${q('repair_program')} rp ON rp.repair_program_id=i.repair_program_id JOIN ${q('locomotive_model')} lm ON lm.model_id=rp.model_id WHERE i.plan_version_id=$1 ORDER BY i.planned_entry_at,i.locomotive_no,i.item_id`
  const deletionSql = `SELECT d.*,i.vehicle_repair_id,i.locomotive_no,i.repair_program_id,i.planned_entry_at,i.owner_bureau,i.owner_depot,i.repair_sequence,i.mileage_km,i.remark,rp.repair_program_name,lm.model_id,lm.model_name FROM ${q('monthly_plan_deletion')} d JOIN ${q('monthly_plan_item')} i ON i.item_id=d.original_published_item_id JOIN ${q('repair_program')} rp ON rp.repair_program_id=i.repair_program_id JOIN ${q('locomotive_model')} lm ON lm.model_id=rp.model_id`

  async function ensurePlan(client, year, month) {
    return (await client.query(`INSERT INTO ${q('monthly_plan')}(plan_year,plan_month,plan_title,title_source) VALUES($1,$2,$3,'DEFAULT') ON CONFLICT(plan_year,plan_month) DO UPDATE SET updated_at=${q('monthly_plan')}.updated_at RETURNING *`, [year, month, `${year}年${month}月检修计划`])).rows[0]
  }
  async function ensureDraft(client, plan, role) {
    let draft = (await client.query(`SELECT * FROM ${q('monthly_plan_version')} WHERE monthly_plan_id=$1 AND owner_role=$2 AND version_status='DRAFT' ORDER BY version_no DESC LIMIT 1`, [plan.monthly_plan_id, role])).rows[0]
    if (draft) return draft
    const no = Number((await client.query(`SELECT COALESCE(max(version_no),0)+1 value FROM ${q('monthly_plan_version')} WHERE monthly_plan_id=$1`, [plan.monthly_plan_id])).rows[0].value)
    draft = (await client.query(`INSERT INTO ${q('monthly_plan_version')}(monthly_plan_id,version_no,base_version_id,owner_role,version_status,snapshot_title) VALUES($1,$2,$3,$4,'DRAFT',$5) RETURNING *`, [plan.monthly_plan_id, no, plan.current_published_version_id, role, plan.plan_title])).rows[0]
    if (plan.current_published_version_id) await client.query(`INSERT INTO ${q('monthly_plan_item')}(plan_version_id,stable_item_key,vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,repair_sequence,mileage_km,remark,change_type,is_cancelled) SELECT $1,stable_item_key,vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,repair_sequence,mileage_km,remark,'UNCHANGED',is_cancelled FROM ${q('monthly_plan_item')} WHERE plan_version_id=$2`, [draft.plan_version_id, plan.current_published_version_id])
    return draft
  }
  async function assertVehicleNotStarted(client, vehicleRepairId) {
    if (vehicleRepairId == null || vehicleRepairId === '') return
    const row = (await client.query(`SELECT status FROM ${q('vehicle_repair')} WHERE vehicle_repair_id=$1`, [Number(vehicleRepairId)])).rows[0]
    if (row && ['IN_PROGRESS', 'COMPLETED', 'FINISHED', 'CLOSED'].includes(String(row.status || '').toUpperCase())) fail(409, '车辆已开始维修，不能再修改或删除')
  }
  function normalizeApplication(row) { return row?.application_status === 'REVIEWED' ? { ...row, application_status: 'PENDING_PUBLISH' } : row }
  async function latestApp(client, planId) { return normalizeApplication((await client.query(`SELECT * FROM ${q('monthly_plan_application')} WHERE monthly_plan_id=$1 ORDER BY application_id DESC LIMIT 1`, [planId])).rows[0] || null) }
  async function activeApp(client, planId, lock = false) {
    // 先取本月最新申请，再判断状态；历史 REVIEWED 不能因为排在旧记录里就阻塞新的整月申请。
    const latest = (await client.query(`SELECT * FROM ${q('monthly_plan_application')} WHERE monthly_plan_id=$1 ORDER BY application_id DESC LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [planId])).rows[0] || null
    if (!latest || ![...activeStatuses, 'REVIEWED'].includes(latest.application_status)) return null
    return normalizeApplication(latest)
  }
  async function backfillLegacyApplicationItems(client, app, submittedRows) {
    if (!app || !submittedRows.length) return
    const count = Number((await client.query(`SELECT count(*) value FROM ${q('monthly_plan_application_item')} WHERE application_id=$1`, [app.application_id])).rows[0].value)
    if (count) return
    for (const row of submittedRows) await client.query(`INSERT INTO ${q('monthly_plan_application_item')}(application_id,submitted_item_id,stable_item_key,submitted_snapshot,reviewed_snapshot,change_type) VALUES($1,$2,$3,$4::jsonb,$4::jsonb,$5) ON CONFLICT(application_id,stable_item_key) DO NOTHING`, [app.application_id, row.item_id, row.stable_item_key, JSON.stringify(snapshot(row)), row.change_type])
  }
  function snapshot(row) { return { stableItemKey: row.stable_item_key, vehicleRepairId: row.vehicle_repair_id == null ? null : Number(row.vehicle_repair_id), locomotiveNo: row.locomotive_no, repairProgramId: Number(row.repair_program_id), repairProgramName: row.repair_program_name || null, modelId: row.model_id == null ? null : Number(row.model_id), modelName: row.model_name || null, plannedEntryAt: dateOnly(row.planned_entry_at), ownerBureau: row.owner_bureau, ownerDepot: row.owner_depot, repairSequence: row.repair_sequence == null ? null : Number(row.repair_sequence), mileageKm: row.mileage_km == null ? null : Number(row.mileage_km), remark: row.remark, changeReason: row.change_reason, changeType: row.change_type, isCancelled: Boolean(row.is_cancelled) } }
  function samePlanData(left, right) {
    if (!left || !right) return false
    const a = snapshot(left), b = snapshot(right)
    return ['vehicleRepairId', 'locomotiveNo', 'repairProgramId', 'plannedEntryAt', 'ownerBureau', 'ownerDepot', 'repairSequence', 'mileageKm', 'remark'].every(key => (a[key] ?? null) === (b[key] ?? null))
  }
  function normalizeDraftChange(row, base) {
    if (!base || !samePlanData(row, base)) return row
    return { ...row, change_type: 'UNCHANGED', change_reason: null, is_cancelled: false }
  }
  function mapItem(row, flags = {}) { return { id: Number(row.item_id), stableItemKey: row.stable_item_key, vehicleRepairId: row.vehicle_repair_id == null ? null : Number(row.vehicle_repair_id), locomotiveNo: row.locomotive_no, repairProgramId: Number(row.repair_program_id), repairProgramName: row.repair_program_name, repairDurationDays: Number(row.repair_duration_days) || 18, modelId: Number(row.model_id), modelName: row.model_name, plannedEntryAt: String(row.planned_entry_at).replace(' ', 'T'), ownerBureau: row.owner_bureau, ownerDepot: row.owner_depot, repairSequence: row.repair_sequence, mileageKm: row.mileage_km == null ? null : Number(row.mileage_km), remark: row.remark, changeReason: row.change_reason, changeType: row.change_type, isCancelled: Boolean(row.is_cancelled), ...flags } }
  function mapDeletion(row, flags = {}) { return { id: `deletion-${row.deletion_id}`, deletionId: Number(row.deletion_id), stableItemKey: row.stable_item_key, vehicleRepairId: Number(row.vehicle_repair_id), locomotiveNo: row.locomotive_no, repairProgramId: Number(row.repair_program_id), repairProgramName: row.repair_program_name, modelId: Number(row.model_id), modelName: row.model_name, plannedEntryAt: String(row.planned_entry_at).replace(' ', 'T'), ownerBureau: row.owner_bureau, ownerDepot: row.owner_depot, repairSequence: row.repair_sequence, mileageKm: row.mileage_km == null ? null : Number(row.mileage_km), remark: row.remark, changeReason: row.delete_reason, deleteReason: row.delete_reason, deleteNote: row.delete_note, changeType: 'DELETE', deletionStatus: row.delete_status, isDeletionMarker: true, hideFromCalendar: true, ...flags } }
  function planStatus(plan, app, draftCount) { if (app?.application_status === 'PENDING_REVIEW') return plan.current_published_version_id ? '部分待审核' : '待审核'; if (app?.application_status === 'REVIEWED' || app?.application_status === 'PENDING_PUBLISH') return plan.current_published_version_id ? '部分待发布' : '待发布'; if (app?.application_status === 'REJECTED') return plan.current_published_version_id ? '部分已驳回' : '已驳回'; if (app?.application_status === 'WITHDRAWN') return plan.current_published_version_id ? '已发布' : (draftCount ? '编制中' : '已撤回'); return plan.current_published_version_id ? '已发布' : '编制中' }

  async function read({ year, month, role }) {
    const p = period(year, month), currentRole = roleOf(role), client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`SELECT revision FROM ${q('application_state')} WHERE singleton FOR UPDATE`)
      const plan = await ensurePlan(client, p.year, p.month)
      const draft = await ensureDraft(client, plan, currentRole)
      const latest = await latestApp(client, plan.monthly_plan_id)
      const app = latest && latest.application_status === 'REVIEWED' ? { ...latest, application_status: 'PENDING_PUBLISH' } : latest
      const active = Boolean(app && activeStatuses.includes(app.application_status))
      const publishedRows = plan.current_published_version_id ? (await client.query(itemSql, [plan.current_published_version_id])).rows : []
      const publishedByKey = new Map(publishedRows.filter(row => !row.is_cancelled).map(row => [row.stable_item_key, row]))
      const draftRows = (await client.query(itemSql, [draft.plan_version_id])).rows
      const ownDeletions = (await client.query(`${deletionSql} WHERE d.monthly_plan_id=$1 AND d.applicant_role=$2 AND d.delete_status='DRAFT' ORDER BY d.created_at,d.deletion_id`, [plan.monthly_plan_id, currentRole])).rows
      const submittedRows = active ? (await client.query(itemSql, [app.submitted_version_id])).rows : []
      const appItems = app ? (await client.query(`SELECT * FROM ${q('monthly_plan_application_item')} WHERE application_id=$1 ORDER BY application_item_id`, [app.application_id])).rows : []
      const appItemByKey = new Map(appItems.map(row => [row.stable_item_key, row]))
      const submittedChangeKeys = new Set(appItems.filter(row => !['UNCHANGED', 'DELETE'].includes(row.change_type)).map(row => row.stable_item_key))
      const pendingDeletions = active ? (await client.query(`${deletionSql} JOIN ${q('monthly_plan_application_item')} ai ON ai.deletion_id=d.deletion_id WHERE ai.application_id=$1 ORDER BY ai.application_item_id`, [app.application_id])).rows : []
      const deletedKeys = new Set(pendingDeletions.map(row => row.stable_item_key))
      const submittedDraftItemIds = new Set(appItems.map(row => Number(row.draft_item_id)).filter(Number.isFinite))
      const draftChangedRows = draftRows.filter(row => !row.is_cancelled && row.change_type !== 'UNCHANGED')
      const privateDraftRows = draftChangedRows.filter(row => !submittedDraftItemIds.has(Number(row.item_id)))
      const draftDirty = !plan.current_published_version_id || draftChangedRows.length > 0 || ownDeletions.length > 0
      const result = []
      const workflow = app?.application_status
      const flagsFor = (row, base = {}) => {
        const original = publishedByKey.get(row.stable_item_key)
        const originalSnapshot = parseJson(appItemByKey.get(row.stable_item_key)?.original_snapshot) || (original ? snapshot(original) : null)
        if (active) {
          const pendingStatus = workflow === 'PENDING_REVIEW' ? 'SUBMITTED' : 'PENDING_PUBLISH'
          const unchangedFormal = original && samePlanData(row, original)
          const changed = row.change_type !== 'UNCHANGED' && !unchangedFormal
          return { ...base, isPublished: !changed && Boolean(original), isPending: changed, isSubmitted: true, isChanged: changed, originalSnapshot, approvalStatus: changed ? pendingStatus : 'PUBLISHED', applicationStatus: workflow, draftOwnerRole: changed ? app.applicant_role : null, canReviewEdit: changed && ((currentRole === 'SECTION_CHIEF' && workflow === 'PENDING_REVIEW') || (currentRole === 'DEPUTY_DIRECTOR' && workflow === 'PENDING_PUBLISH')) }
        }
        const changed = row.change_type !== 'UNCHANGED' || row.is_cancelled
        return { ...base, isDraft: changed, isChanged: changed, originalSnapshot, approvalStatus: changed ? 'DRAFT' : 'PUBLISHED', draftOwnerRole: changed ? currentRole : null }
      }
      if (active) {
        const displayRows = new Map(publishedRows.filter(row => !row.is_cancelled).map(row => [row.stable_item_key, { row, privateDraft: false, privateDeletion: false, submitted: false }]))
        // 只有申请明细中明确提交的新增/修改才能覆盖正式车辆；整月快照里的未变化行仅用于审核背景。
        for (const row of submittedRows.filter(row => !row.is_cancelled && submittedChangeKeys.has(row.stable_item_key))) {
          if (!deletedKeys.has(row.stable_item_key)) displayRows.set(row.stable_item_key, { row, privateDraft: false, privateDeletion: false, submitted: true })
        }
        for (const row of privateDraftRows.filter(row => !row.is_cancelled)) displayRows.set(row.stable_item_key, { row, privateDraft: true, privateDeletion: false, submitted: false })
        for (const deletion of ownDeletions) {
          const original = publishedByKey.get(deletion.stable_item_key)
          if (original) displayRows.set(deletion.stable_item_key, { row: original, privateDraft: true, privateDeletion: true, deletion, submitted: false })
        }
        for (const entry of displayRows.values()) {
          if (entry.privateDraft) {
            result.push(mapItem(entry.row, { isPublished: entry.privateDeletion || Boolean(publishedByKey.get(entry.row.stable_item_key)), isDraft: true, isChanged: true, draftItemId: entry.privateDeletion ? null : Number(entry.row.item_id), pendingModification: entry.privateDeletion, pendingDeletion: entry.privateDeletion, pendingChangeType: entry.privateDeletion ? 'DELETE' : entry.row.change_type, changeType: entry.privateDeletion ? 'DELETE' : entry.row.change_type, deletionId: entry.privateDeletion ? Number(entry.deletion.deletion_id) : null, deleteReason: entry.privateDeletion ? entry.deletion.delete_reason : null, deleteNote: entry.privateDeletion ? entry.deletion.delete_note : null, approvalStatus: 'DRAFT', draftOwnerRole: currentRole, selectableDraft: true, originalSnapshot: publishedByKey.has(entry.row.stable_item_key) ? snapshot(publishedByKey.get(entry.row.stable_item_key)) : null }))
            continue
          }
          const deletion = pendingDeletions.find(row => row.stable_item_key === entry.row.stable_item_key)
          const original = publishedByKey.get(entry.row.stable_item_key)
          const pendingApprovalStatus = workflow === 'PENDING_REVIEW' ? 'PENDING_REVIEW' : 'PENDING_PUBLISH'
          const reviewerCanEdit = (currentRole === 'SECTION_CHIEF' && workflow === 'PENDING_REVIEW') || (currentRole === 'DEPUTY_DIRECTOR' && workflow === 'PENDING_PUBLISH')
          if (deletion && original) {
            result.push(mapItem(original, { isPublished: true, isSubmitted: true, pendingDeletion: true, pendingModification: true, pendingChangeType: 'DELETE', changeType: 'DELETE', deletionId: Number(deletion.deletion_id), pendingApprovalStatus, deleteReason: deletion.delete_reason, deleteNote: deletion.delete_note, pendingSnapshot: parseJson(appItemByKey.get(entry.stable_item_key)?.submitted_snapshot) || { ...snapshot(original), changeType: 'DELETE', deletionId: Number(deletion.deletion_id), deleteReason: deletion.delete_reason, deleteNote: deletion.delete_note }, originalSnapshot: snapshot(original), approvalStatus: 'PUBLISHED', applicationStatus: workflow, draftOwnerRole: app.applicant_role, canReviewEdit: reviewerCanEdit }))
          } else if (original && !samePlanData(entry.row, original)) {
            result.push(mapItem(original, { isPublished: true, isSubmitted: true, pendingModification: true, pendingChangeType: entry.row.change_type || 'MODIFIED', pendingApprovalStatus, pendingSnapshot: snapshot(entry.row), originalSnapshot: snapshot(original), approvalStatus: 'PUBLISHED', applicationStatus: workflow, draftOwnerRole: app.applicant_role, canReviewEdit: reviewerCanEdit }))
          } else if (publishedByKey.has(entry.row.stable_item_key) && samePlanData(entry.row, publishedByKey.get(entry.row.stable_item_key))) {
            // 审核快照可能保留旧的 ADDED/MODIFIED 标记，但只要实际字段未变，正式版本优先。
            result.push(mapItem(publishedByKey.get(entry.row.stable_item_key), { isPublished: true, approvalStatus: 'PUBLISHED', draftOwnerRole: null }))
          }
          else result.push(mapItem(entry.row, flagsFor(entry.row)))
        }
      } else if (draftDirty) {
        // 私人工作版本只能覆盖本人发生的变更；未变化的正式车辆始终按公共正式版本展示。
        const displayRows = new Map(publishedRows.filter(row => !row.is_cancelled).map(row => [row.stable_item_key, { row, source: 'PUBLISHED' }]))
        for (const row of draftChangedRows.filter(row => !row.is_cancelled)) displayRows.set(row.stable_item_key, { row, source: 'DRAFT' })
        for (const deletion of ownDeletions) {
          const original = publishedByKey.get(deletion.stable_item_key)
          if (original) displayRows.set(deletion.stable_item_key, { row: original, source: 'DELETE', deletion })
        }
        for (const entry of displayRows.values()) {
          if (entry.source === 'PUBLISHED') result.push(mapItem(entry.row, { isPublished: true, approvalStatus: 'PUBLISHED', draftOwnerRole: null }))
          else {
            const original = publishedByKey.get(entry.row.stable_item_key)
            const isPublishedChange = Boolean(original)
            result.push(mapItem(isPublishedChange ? original : entry.row, {
              isPublished: isPublishedChange,
              isDraft: true,
              draftItemId: Number(entry.row.item_id),
              isChanged: true,
              pendingModification: isPublishedChange,
              pendingDeletion: entry.source === 'DELETE',
              pendingChangeType: entry.source === 'DELETE' ? 'DELETE' : 'MODIFIED',
              changeType: entry.source === 'DELETE' ? 'DELETE' : entry.row.change_type,
              deletionId: entry.source === 'DELETE' ? Number(entry.deletion.deletion_id) : null,
              deleteReason: entry.source === 'DELETE' ? entry.deletion.delete_reason : null,
              deleteNote: entry.source === 'DELETE' ? entry.deletion.delete_note : null,
              pendingSnapshot: entry.source === 'DELETE' ? { ...snapshot(entry.row), changeType: 'DELETE', deletionId: Number(entry.deletion.deletion_id), deleteReason: entry.deletion.delete_reason, deleteNote: entry.deletion.delete_note } : snapshot(entry.row),
              approvalStatus: 'DRAFT',
              draftOwnerRole: currentRole,
              selectableDraft: true,
              originalSnapshot: original ? snapshot(original) : null
            }))
          }
        }
      } else {
        for (const row of publishedRows.filter(row => !row.is_cancelled)) result.push(mapItem(row, { isPublished: true, approvalStatus: 'PUBLISHED', draftOwnerRole: null }))
      }
      const revisionRows = app ? (await client.query(`SELECT rh.*,ai.stable_item_key FROM ${q('monthly_plan_revision_history')} rh LEFT JOIN ${q('monthly_plan_application_item')} ai ON ai.application_item_id=rh.application_item_id WHERE rh.application_id=$1 ORDER BY rh.revision_no`, [app.application_id])).rows : []
      for (const item of result) item.reviewHistory = revisionRows.filter(row => row.stable_item_key === item.stableItemKey).map(row => ({ revisionNo: row.revision_no, editorRole: row.editor_role, beforeData: parseJson(row.before_data), afterData: parseJson(row.after_data), changeReason: row.change_reason, editedAt: row.edited_at }))
      const ownDraftCount = draftRows.filter(row => !row.is_cancelled && row.change_type !== 'UNCHANGED').length + ownDeletions.length
      await client.query('COMMIT')
      return { planId: Number(plan.monthly_plan_id), year: p.year, month: p.month, title: plan.plan_title, role: currentRole, status: planStatus(plan, app, ownDraftCount), hasPublishedVersion: Boolean(plan.current_published_version_id), hasOwnDraft: ownDraftCount > 0, draftNotice: Boolean(plan.current_published_version_id && ownDraftCount), pendingChangeCount: ownDraftCount, readOnly: active, ownDraftEditable: !active || app?.applicant_role !== currentRole, application: app ? { id: Number(app.application_id), applicantRole: app.applicant_role, status: app.application_status, type: app.application_type, note: app.application_note, adjustReason: app.adjust_reason, submittedAt: app.submitted_at, selectedCount: appItems.length, revisions: revisionRows.map(row => ({ revisionNo: row.revision_no, stableItemKey: row.stable_item_key, editorRole: row.editor_role, beforeData: parseJson(row.before_data), afterData: parseJson(row.after_data), changeReason: row.change_reason, editedAt: row.edited_at })) } : null, items: result, draftItems: result.filter(row => row.isDraft) }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  // Monthly plans, imports and tool commands share the same snapshot tables.
  // Serialize all writers before generating approval IDs and advance the revision
  // in the same transaction, so an older page cannot overwrite a newer approval.
  async function beginMutation(client) {
    await client.query('BEGIN')
    await client.query(`SELECT revision FROM ${q('application_state')} WHERE singleton FOR UPDATE`)
  }
  async function commitMutation(client) {
    await client.query(`UPDATE ${q('application_state')} SET revision=revision+1,updated_at=now() WHERE singleton`)
    await client.query('COMMIT')
  }
  async function setTitle({ year, month, role, title }) {
    const p=period(year,month);roleOf(role)
    const value=String(title||'').trim()
    if(!value||value.length>255)fail(400,'计划标题应为1至255个字符')
    const client=await pool.connect()
    try {
      await beginMutation(client)
      const plan=await ensurePlan(client,p.year,p.month)
      await client.query(`UPDATE ${q('monthly_plan')} SET plan_title=$2,title_source='MANUAL',last_title_updated_at=now(),updated_at=now() WHERE monthly_plan_id=$1`,[plan.monthly_plan_id,value])
      await commitMutation(client);return {title:value}
    } catch(error){await client.query('ROLLBACK');throw error} finally{client.release()}
  }
  async function createVersion(client, plan, ownerRole, status, baseVersionId = plan.current_published_version_id) { const no = Number((await client.query(`SELECT COALESCE(max(version_no),0)+1 value FROM ${q('monthly_plan_version')} WHERE monthly_plan_id=$1`, [plan.monthly_plan_id])).rows[0].value); return (await client.query(`INSERT INTO ${q('monthly_plan_version')}(monthly_plan_id,version_no,base_version_id,owner_role,version_status,snapshot_title,submitted_at,published_at) VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $7::text IN ('SUBMITTED','REVIEWED','PUBLISHED') THEN now() END,CASE WHEN $7::text='PUBLISHED' THEN now() END) RETURNING *`, [plan.monthly_plan_id, no, baseVersionId, ownerRole, status, plan.plan_title, status])).rows[0] }
  async function copyRow(client, versionId, row, changeType = row.change_type) { return (await client.query(`INSERT INTO ${q('monthly_plan_item')}(plan_version_id,stable_item_key,vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,repair_sequence,mileage_km,remark,change_reason,change_type,is_cancelled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [versionId, row.stable_item_key, row.vehicle_repair_id, row.locomotive_no, row.repair_program_id, row.planned_entry_at, row.owner_bureau, row.owner_depot, row.repair_sequence, row.mileage_km, row.remark, row.change_reason, changeType, row.is_cancelled])).rows[0] }
  async function invalidateVehicleSchedules(client, vehicleRepairId, reason, operatorRole = 'SYSTEM', applicationId = null) {
    const active = (await client.query(`SELECT DISTINCT version_id FROM ${q('vehicle_repair_schedule')} WHERE vehicle_repair_id=$1 AND status NOT IN ('CANCELLED','CANCELED')`, [Number(vehicleRepairId)])).rows
    if (!active.length) return
    await client.query(`INSERT INTO ${q('monthly_plan_schedule_impact_history')}(vehicle_repair_id,schedule_version_id,impact_reason,operator_role,application_id) SELECT $1,version_id,$2,$3,$4 FROM ${q('vehicle_repair_schedule')} WHERE vehicle_repair_id=$1 AND status NOT IN ('CANCELLED','CANCELED') GROUP BY version_id`, [Number(vehicleRepairId), reason, operatorRole, applicationId])
    await client.query(`UPDATE ${q('vehicle_repair_schedule')} SET status='CANCELLED',remark=concat_ws(E'\\n',remark,$2::text),updated_at=now() WHERE vehicle_repair_id=$1 AND status NOT IN ('CANCELLED','CANCELED')`, [Number(vehicleRepairId), reason])
    await client.query(`UPDATE ${q('schedule_version')} SET status='ARCHIVED',remark=concat_ws(E'\\n',remark,$2::text) WHERE version_id=ANY($1::bigint[]) AND status IN ('CURRENT','PUBLISHED')`, [active.map(row => Number(row.version_id)), reason])
    await client.query(`UPDATE ${q('vehicle_repair')} SET current_version_id=NULL,status=CASE WHEN status='SCHEDULED' THEN 'UNSCHEDULED' ELSE status END WHERE vehicle_repair_id=$1`, [Number(vehicleRepairId)])
  }
  async function approval(client, applicationId, level, role, status, opinion = null) { const id = Number((await client.query(`SELECT COALESCE(max(approval_id),0)+1 value FROM ${q('approval_record')}`)).rows[0].value); await client.query(`INSERT INTO ${q('approval_record')}(approval_id,business_type,business_id,approval_level,approval_role,responsible_person,approval_status,approval_opinion,approved_at) VALUES($1,'MONTHLY_PLAN_APPLICATION',$2,$3,$4,$5,$6,$7,CASE WHEN $8::text IN ('APPROVED','REJECTED','WITHDRAWN') THEN now() END)`, [id, applicationId, level, role, rolePerson(role), status, opinion, status]) }

  const statusActionText = {
    PLANNER_SUBMITTED: '申请审核', CHIEF_APPROVED: '科长审核通过', CHIEF_REJECTED: '科长驳回',
    CHIEF_SUBMITTED_FOR_PUBLISH: '科长申请发布', DEPUTY_APPROVED_PUBLISH: '副段长审批发布',
    DEPUTY_REJECTED: '副段长驳回', DEPUTY_DIRECT_PUBLISHED: '副段长直接发布',
    APPLICATION_WITHDRAWN: '撤回申请', RETURNED_TO_CHIEF_REVIEW: '审核修订后退回待审核'
  }
  const logStatusText = value => ({ DRAFT: '未提交', PENDING_REVIEW: '待科长审核', PENDING_PUBLISH: '待副段长审批', PUBLISHED: '已发布', REJECTED: '已驳回', WITHDRAWN: '已撤回' }[value] || value || null)
  function changedFields(before, after) {
    const labels = { locomotiveNo: '机车编号', repairProgramName: '修程', repairProgramId: '修程编号', plannedEntryAt: '计划入段日期', ownerBureau: '配属局', ownerDepot: '配属段', repairSequence: '修次', mileageKm: '累计走行公里', remark: '备注' }
    return Object.entries(labels).flatMap(([field, label]) => (before?.[field] ?? null) === (after?.[field] ?? null) ? [] : [{ field, label, before: before?.[field] ?? null, after: after?.[field] ?? null }])
  }
  async function freezeStatusSnapshot(client, plan, app, snapshotVersionId, baseVersionId, source = 'reviewed') {
    const baseRows = baseVersionId ? (await client.query(itemSql, [baseVersionId])).rows.filter(row => !row.is_cancelled) : []
    const versionRows = (await client.query(itemSql, [snapshotVersionId])).rows.filter(row => !row.is_cancelled)
    const versionByKey = new Map(versionRows.map(row => [row.stable_item_key, row]))
    const applicationItems = (await client.query(`SELECT * FROM ${q('monthly_plan_application_item')} WHERE application_id=$1 ORDER BY application_item_id`, [app.application_id])).rows
    const changes = applicationItems.map(item => {
      const before = parseJson(item.original_snapshot)
      const storedAfter = source === 'submitted' ? parseJson(item.submitted_snapshot) : parseJson(item.reviewed_snapshot || item.submitted_snapshot)
      const versionAfter = item.change_type === 'DELETE' ? null : versionByKey.get(item.stable_item_key)
      const after = item.change_type === 'DELETE' ? null : source === 'published' && versionAfter ? snapshot(versionAfter) : storedAfter
      const changeType = item.change_type === 'ADDED' ? 'ADD' : item.change_type === 'MODIFIED' ? 'UPDATE' : item.change_type === 'DELETE' ? 'DELETE' : 'UNCHANGED'
      return { stableItemKey: item.stable_item_key, locomotiveNo: after?.locomotiveNo || before?.locomotiveNo || '未填写', changeType, before, after, fieldChanges: changedFields(before, after), deleteReason: storedAfter?.deleteReason || null }
    })
    const changedKeys = new Set(changes.map(change => change.stableItemKey))
    const vehicles = new Map(baseRows.map(row => [row.stable_item_key, snapshot(row)]))
    for (const change of changes) { if (change.changeType === 'DELETE') vehicles.delete(change.stableItemKey); else if (change.after) vehicles.set(change.stableItemKey, change.after) }
    const summary = {
      addedCount: changes.filter(change => change.changeType === 'ADD').length,
      updatedCount: changes.filter(change => change.changeType === 'UPDATE').length,
      deletedCount: changes.filter(change => change.changeType === 'DELETE').length,
      unchangedCount: baseRows.filter(row => !changedKeys.has(row.stable_item_key)).length,
      beforeVehicleCount: baseRows.length,
      afterVehicleCount: vehicles.size,
      beforeVersionId: baseVersionId == null ? null : Number(baseVersionId),
      afterVersionId: Number(snapshotVersionId)
    }
    return { summary, snapshot: { planTitle: plan.plan_title, year: plan.plan_year, month: plan.plan_month, vehicles: [...vehicles.values()], changes } }
  }
  async function writeStatusLog(client, { plan, app, role, actionType, fromStatus, toStatus, snapshotVersionId = app.current_review_version_id || app.submitted_version_id, baseVersionId = null, publicationId = null, remark = null, source = 'reviewed' }) {
    const currentRole = roleOf(role)
    const linkage = (await client.query(`SELECT a.application_id,v.plan_version_id FROM ${q('monthly_plan_application')} a JOIN ${q('monthly_plan_version')} v ON v.plan_version_id=$2 AND v.monthly_plan_id=a.monthly_plan_id WHERE a.application_id=$1 AND a.monthly_plan_id=$3`, [app.application_id, snapshotVersionId, plan.monthly_plan_id])).rows[0]
    if (!linkage) fail(500, '状态日志关联的申请或历史版本不属于当前月度计划')
    const roundNo = Number((await client.query(`SELECT count(*) value FROM ${q('monthly_plan_application')} WHERE monthly_plan_id=$1 AND application_id<=$2`, [plan.monthly_plan_id, app.application_id])).rows[0].value)
    const transitionNo = Number((await client.query(`SELECT COALESCE(max(transition_no),0)+1 value FROM ${q('monthly_plan_status_log')} WHERE application_id=$1`, [app.application_id])).rows[0].value)
    const frozen = await freezeStatusSnapshot(client, plan, app, snapshotVersionId, baseVersionId ?? (await client.query(`SELECT base_version_id FROM ${q('monthly_plan_version')} WHERE plan_version_id=$1`, [app.submitted_version_id])).rows[0]?.base_version_id ?? null, source)
    await client.query(`INSERT INTO ${q('monthly_plan_status_log')}(monthly_plan_id,application_id,round_no,transition_no,publication_id,action_type,from_status,to_status,operator_id,operator_role,operator_name_snapshot,snapshot_version_id,base_published_version_id,remark,snapshot_json,change_summary_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb)`, [plan.monthly_plan_id, app.application_id, roundNo, transitionNo, publicationId, actionType, fromStatus, toStatus, `SIMULATED:${currentRole}`, currentRole, rolePerson(currentRole), snapshotVersionId, baseVersionId ?? frozen.summary.beforeVersionId, String(remark || '').trim() || null, JSON.stringify(frozen.snapshot), JSON.stringify(frozen.summary)])
  }
  function mapLog(row, includeDetails = false) {
    return {
      id: Number(row.log_id), roundNo: Number(row.round_no), operatedAt: row.occurred_at, operatorRole: row.operator_role, operatorName: row.operator_name_snapshot,
      actionType: row.action_type, actionText: `第${row.round_no}轮 · ${statusActionText[row.action_type] || row.action_type}`,
      beforeStatus: row.from_status, beforeStatusText: logStatusText(row.from_status), afterStatus: row.to_status,
      afterStatusText: logStatusText(row.to_status), description: statusActionText[row.action_type] || row.action_type, reason: row.remark,
      applicationId: Number(row.application_id), versionId: Number(row.snapshot_version_id), publicationId: row.publication_id == null ? null : Number(row.publication_id),
      ...(includeDetails ? { details: { ...(parseJson(row.change_summary_json) || {}), ...(parseJson(row.snapshot_json) || {}) } } : {})
    }
  }
  async function logs({ year, month, role, page = 1, pageSize = 20, actionType = '', logId = null }) {
    const p = period(year, month), currentRole = roleOf(role), pageNo = Math.max(1, Number(page) || 1), size = Math.min(100, Math.max(1, Number(pageSize) || 20))
    const plan = (await pool.query(`SELECT * FROM ${q('monthly_plan')} WHERE plan_year=$1 AND plan_month=$2`, [p.year, p.month])).rows[0]
    if (!plan) { if (logId) fail(404, '日志不存在'); return { items: [], page: pageNo, pageSize: size, total: 0, pages: 0 } }
    void currentRole
    const params = [plan.monthly_plan_id], filters = [`monthly_plan_id=$1`]
    if (actionType) { params.push(String(actionType)); filters.push(`action_type=$${params.length}`) }
    if (logId != null) {
      params.push(Number(logId)); filters.push(`log_id=$${params.length}`)
      const row = (await pool.query(`SELECT * FROM ${q('monthly_plan_status_log')} WHERE ${filters.join(' AND ')}`, params)).rows[0]
      if (!row) fail(404, '日志不存在或不属于当前月度计划')
      return { item: mapLog(row, true) }
    }
    const total = Number((await pool.query(`SELECT count(*) value FROM ${q('monthly_plan_status_log')} WHERE ${filters.join(' AND ')}`, params)).rows[0].value)
    params.push(size, (pageNo - 1) * size)
    const rows = (await pool.query(`SELECT * FROM ${q('monthly_plan_status_log')} WHERE ${filters.join(' AND ')} ORDER BY occurred_at DESC,log_id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows
    return { items: rows.map(row => mapLog(row)), page: pageNo, pageSize: size, total, pages: Math.ceil(total / size) }
  }

  async function submit({ year, month, role, note, adjustReason }) {
    const p = period(year, month), currentRole = roleOf(role)
    if (currentRole !== 'PLANNER') fail(403, '只有计划员可以提交月度计划审核；科长使用“申请发布”，副段长使用“直接发布”')
    const client = await pool.connect()
    try {
      await beginMutation(client)
      const plan = await ensurePlan(client, p.year, p.month)
      await client.query(`SELECT monthly_plan_id FROM ${q('monthly_plan')} WHERE monthly_plan_id=$1 FOR UPDATE`, [plan.monthly_plan_id])
      if (await activeApp(client, plan.monthly_plan_id, true)) fail(409, '本月已有流转中的整月审核申请')
      const draft = await ensureDraft(client, plan, currentRole)
      let draftRows = (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 ORDER BY planned_entry_at,locomotive_no,item_id`, [draft.plan_version_id])).rows
      const deletions = (await client.query(`SELECT * FROM ${q('monthly_plan_deletion')} WHERE monthly_plan_id=$1 AND applicant_role=$2 AND delete_status='DRAFT' ORDER BY deletion_id`, [plan.monthly_plan_id, currentRole])).rows
      const baseRows = plan.current_published_version_id ? (await client.query(itemSql, [plan.current_published_version_id])).rows : []
      const baseByKey = new Map(baseRows.filter(row => !row.is_cancelled).map(row => [row.stable_item_key, row]))
      // 工作版本可能来自旧数据，不能仅相信历史 change_type；与正式版本完全相同的车辆必须归一化为未变化。
      draftRows = draftRows.filter(row => !row.is_cancelled).map(row => normalizeDraftChange(row, baseByKey.get(row.stable_item_key)))
      const changedRows = draftRows.filter(row => row.change_type !== 'UNCHANGED')
      if (!changedRows.length && !deletions.length) fail(400, '当前没有可提交的计划变更')
      const type = plan.current_published_version_id ? 'ADJUSTMENT' : 'INITIAL'
      if (type === 'ADJUSTMENT' && !String(adjustReason || '').trim()) fail(400, '已发布月份再次申请审核必须填写调整原因')
      const version = await createVersion(client, plan, currentRole, 'SUBMITTED')
      const app = (await client.query(`INSERT INTO ${q('monthly_plan_application')}(monthly_plan_id,submitted_version_id,current_review_version_id,applicant_role,handler_name,application_type,application_status,application_note,adjust_reason) VALUES($1,$2,$2,$3,$4,$5,'PENDING_REVIEW',$6,$7) RETURNING *`, [plan.monthly_plan_id, version.plan_version_id, currentRole, rolePerson(currentRole), type, String(note || '').trim() || null, String(adjustReason || '').trim() || null])).rows[0]
      const deletionKeys = new Set(deletions.map(row => row.stable_item_key))
      for (const row of draftRows) {
        const submitted = await copyRow(client, version.plan_version_id, row, row.change_type)
        // 提交版本保存完整月度快照；申请明细只保存实际变更。
        // 删除车辆在下方以 DELETE 明细记录，不能再为同一稳定标识写一条 UNCHANGED 明细。
        if (row.change_type === 'UNCHANGED' || deletionKeys.has(row.stable_item_key)) continue
        const original = baseByKey.get(row.stable_item_key) || null
        await client.query(`INSERT INTO ${q('monthly_plan_application_item')}(application_id,draft_item_id,submitted_item_id,stable_item_key,original_snapshot,submitted_snapshot,reviewed_snapshot,change_type) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$6::jsonb,$7)`, [app.application_id, row.item_id, submitted.item_id, row.stable_item_key, original ? JSON.stringify(snapshot(original)) : null, JSON.stringify(snapshot(row)), row.change_type])
      }
      for (const deletion of deletions) {
        const original = (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE item_id=$1 AND plan_version_id=$2 AND NOT is_cancelled`, [deletion.original_published_item_id, plan.current_published_version_id])).rows[0]
        if (!original) fail(409, '删除标记关联的正式车辆版本已经变化，请取消后重新标记删除')
        const deleteSnapshot = { ...snapshot(original), changeType: 'DELETE', deletionId: Number(deletion.deletion_id), deleteReason: deletion.delete_reason, deleteNote: deletion.delete_note }
        await client.query(`INSERT INTO ${q('monthly_plan_application_item')}(application_id,deletion_id,stable_item_key,original_snapshot,submitted_snapshot,reviewed_snapshot,change_type) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$5::jsonb,'DELETE')`, [app.application_id, deletion.deletion_id, deletion.stable_item_key, JSON.stringify(snapshot(original)), JSON.stringify(deleteSnapshot)])
        await client.query(`UPDATE ${q('monthly_plan_deletion')} SET delete_status='SUBMITTED',application_id=$2,updated_at=now() WHERE deletion_id=$1`, [deletion.deletion_id, app.application_id])
      }
      await approval(client, app.application_id, 1, 'SECTION_CHIEF', 'PENDING')
      await writeStatusLog(client, { plan, app, role: currentRole, actionType: 'PLANNER_SUBMITTED', fromStatus: 'DRAFT', toStatus: 'PENDING_REVIEW', snapshotVersionId: version.plan_version_id, baseVersionId: plan.current_published_version_id, remark: String(note || '').trim() || String(adjustReason || '').trim() || null, source: 'submitted' })
      await commitMutation(client)
      return { applicationId: Number(app.application_id), submittedCount: changedRows.length + deletions.length, status: 'PENDING_REVIEW', statusText: '整个月度计划已提交，待科长审核' }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async function restoreDraft(client, app) {
    const draft = (await client.query(`SELECT * FROM ${q('monthly_plan_version')} WHERE monthly_plan_id=$1 AND owner_role=$2 AND version_status='DRAFT' ORDER BY version_no DESC LIMIT 1`, [app.monthly_plan_id, app.applicant_role])).rows[0]
    for (const item of (await client.query(`SELECT * FROM ${q('monthly_plan_application_item')} WHERE application_id=$1`, [app.application_id])).rows) {
      const source = (await client.query(`SELECT * FROM ${q('monthly_plan_application_item')} WHERE forwarded_application_id=$1 AND stable_item_key=$2 ORDER BY application_item_id LIMIT 1`, [app.application_id, item.stable_item_key])).rows[0]
      if (source) {
        await client.query(`UPDATE ${q('monthly_plan_application_item')} SET forwarded_application_id=NULL WHERE application_item_id=$1`, [source.application_item_id])
        if (source.change_type === 'DELETE' && source.deletion_id) await client.query(`UPDATE ${q('monthly_plan_deletion')} SET delete_status='REVIEWED',application_id=$2,updated_at=now() WHERE deletion_id=$1`, [source.deletion_id, source.application_id])
        continue
      }
      if (item.change_type === 'DELETE' && item.deletion_id) { await client.query(`UPDATE ${q('monthly_plan_deletion')} SET delete_status='DRAFT',application_id=NULL,updated_at=now() WHERE deletion_id=$1 AND delete_status IN ('SUBMITTED','REVIEWED')`, [item.deletion_id]); continue }
      if (!draft) continue
      const data = parseJson(item.submitted_snapshot), existing = (await client.query(`SELECT item_id FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND stable_item_key=$2`, [draft.plan_version_id, item.stable_item_key])).rows[0]
      if (existing) await client.query(`UPDATE ${q('monthly_plan_item')} SET vehicle_repair_id=$2,locomotive_no=$3,repair_program_id=$4,planned_entry_at=$5,owner_bureau=$6,owner_depot=$7,repair_sequence=$8,mileage_km=$9,remark=$10,change_reason=$11,change_type=$12,is_cancelled=$13 WHERE item_id=$1`, [existing.item_id, data.vehicleRepairId, data.locomotiveNo, data.repairProgramId, data.plannedEntryAt, data.ownerBureau, data.ownerDepot, data.repairSequence, data.mileageKm, data.remark, data.changeReason, data.changeType || 'MODIFIED', Boolean(data.isCancelled)])
    }
  }
  async function withdraw({ year, month, role }) { const p = period(year, month), currentRole = roleOf(role), client = await pool.connect(); try { await beginMutation(client); const plan = (await client.query(`SELECT * FROM ${q('monthly_plan')} WHERE plan_year=$1 AND plan_month=$2 FOR UPDATE`, [p.year, p.month])).rows[0]; if (!plan) fail(404, '本月计划不存在'); const app = await activeApp(client, plan.monthly_plan_id, true); if (!app) fail(409, '没有可撤回的审核申请'); if (app.applicant_role !== currentRole) fail(403, '只能由申请角色撤回'); if (app.application_type !== 'PUBLISH') await restoreDraft(client, app); await client.query(`UPDATE ${q('monthly_plan_application')} SET application_status='WITHDRAWN',withdrawn_at=now() WHERE application_id=$1`, [app.application_id]); await client.query(`UPDATE ${q('monthly_plan_version')} SET version_status='WITHDRAWN' WHERE plan_version_id=$1`, [app.submitted_version_id]); await approval(client, app.application_id, 1, currentRole, 'WITHDRAWN', '申请人撤回申请'); await writeStatusLog(client, { plan, app, role: currentRole, actionType: 'APPLICATION_WITHDRAWN', fromStatus: app.application_status, toStatus: 'WITHDRAWN', snapshotVersionId: app.current_review_version_id || app.submitted_version_id, remark: '申请人撤回申请', source: 'reviewed' }); await commitMutation(client); return { status: 'WITHDRAWN', statusText: '已撤回' } } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() } }

  async function takeover({ year, month, role, reason }) {
    fail(410, '当前流程不允许跳过科长审核，请按整月审核流程处理')
    const p = period(year, month), currentRole = roleOf(role)
    if (currentRole !== 'DEPUTY_DIRECTOR') fail(403, '只有主管副段长可以接管待科长审核申请')
    if (!String(reason || '').trim()) fail(400, '接管处理必须填写原因')
    const client = await pool.connect()
    try {
      await beginMutation(client)
      const plan = (await client.query(`SELECT * FROM ${q('monthly_plan')} WHERE plan_year=$1 AND plan_month=$2 FOR UPDATE`, [p.year, p.month])).rows[0]
      if (!plan) fail(404, '本月计划不存在')
      const app = await activeApp(client, plan.monthly_plan_id, true)
      if (!app || app.application_status !== 'PENDING_REVIEW') fail(409, '当前没有可接管的待科长审核申请')
      const note = `主管副段长接管：${String(reason).trim()}`
      await client.query(`UPDATE ${q('monthly_plan_application')} SET application_status='PENDING_PUBLISH',application_note=concat_ws(E'\n',application_note,$2::text) WHERE application_id=$1`, [app.application_id, note])
      await client.query(`UPDATE ${q('monthly_plan_deletion')} SET delete_status='REVIEWED',updated_at=now() WHERE application_id=$1 AND delete_status='SUBMITTED'`, [app.application_id])
      await client.query(`UPDATE ${q('monthly_plan_version')} SET version_status='REVIEWED' WHERE plan_version_id=$1`, [app.submitted_version_id])
      await approval(client, app.application_id, 2, currentRole, 'PENDING', note)
      await commitMutation(client)
      return { status: 'PENDING_PUBLISH', statusText: '已由主管副段长接管，进入待发布' }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  function validate(values, p, original = {}) {
    const text = (key, max) => {
      const value = String(values?.[key] ?? original[key] ?? '').trim()
      if (value.length > max) fail(400, `${key}内容过长`)
      return value || null
    }
    const locomotiveNo = text('locomotiveNo', 64)
    if (!locomotiveNo) fail(400, '机车编号不能为空')
    const repairProgramId = Number(values?.repairProgramId ?? original.repairProgramId)
    if (!Number.isSafeInteger(repairProgramId)) fail(400, '请选择有效修程')
    const entry = String(values?.plannedEntryAt || original.plannedEntryAt || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry) || !entry.startsWith(`${p.year}-${String(p.month).padStart(2, '0')}-`)) fail(400, '计划入段日期必须属于当前月份')
    const ownerBureau = text('ownerBureau', 64)
    if (!ownerBureau) fail(400, '请选择配属局')
    const ownerDepot = text('ownerDepot', 64)
    if (!ownerDepot) fail(400, '请选择配属段')
    const sequenceValue = values?.repairSequence === '' ? null : (values?.repairSequence ?? original.repairSequence)
    const mileageValue = values?.mileageKm === '' ? null : (values?.mileageKm ?? original.mileageKm)
    const repairSequence = sequenceValue == null ? null : Number(sequenceValue)
    const mileageKm = mileageValue == null ? null : Number(mileageValue)
    if (repairSequence == null) fail(400, '修次不能为空')
    if (!Number.isSafeInteger(repairSequence) || repairSequence < 1) fail(400, '修次必须是正整数')
    if (mileageKm != null && (!Number.isFinite(mileageKm) || mileageKm < 0)) fail(400, '累计走行公里必须是非负数')
    return { locomotiveNo, repairProgramId, plannedEntryAt: entry, ownerBureau, ownerDepot, repairSequence, mileageKm, remark: text('remark', 500) }
  }
  async function createDraftItem({ year, month, role, values }) {
    const p = period(year, month), currentRole = roleOf(role), client = await pool.connect()
    try {
      await beginMutation(client)
      const plan = await ensurePlan(client, p.year, p.month), draft = await ensureDraft(client, plan, currentRole)
      const modelName = String(values?.modelName || '').trim(), programName = String(values?.repairProgramName || '').trim()
      if (!modelName) fail(400, '请选择机型')
      if (!['C1', 'C2', 'C3', 'C4', 'C5'].includes(programName)) fail(400, '请选择有效修程（C1至C5）')
      const program = (await client.query(`SELECT rp.repair_program_id,COALESCE(rp.repair_duration_days,18) AS repair_duration_days FROM ${q('repair_program')} rp JOIN ${q('locomotive_model')} lm ON lm.model_id=rp.model_id WHERE lm.model_name=$1 AND rp.repair_program_name=$2 AND lm.status='ENABLED' AND rp.status='ENABLED'`, [modelName, programName])).rows[0]
      if (!program) fail(400, '当前机型没有对应的修程字典，请先维护基础数据')
      const data = validate({ ...values, repairProgramId: Number(program.repair_program_id) }, p)
      if (!data.ownerBureau) fail(400, '请选择配属局')
      if (!data.ownerDepot) fail(400, '请选择配属段')
      if (data.repairSequence == null) fail(400, '修次不能为空')
      const duplicate = await client.query(`
        SELECT 1 FROM ${q('monthly_plan')} p
        JOIN ${q('monthly_plan_version')} v ON v.monthly_plan_id=p.monthly_plan_id
        JOIN ${q('monthly_plan_item')} i ON i.plan_version_id=v.plan_version_id
        WHERE p.plan_year=$1 AND p.plan_month=$2
          AND v.version_status NOT IN ('SUPERSEDED','WITHDRAWN','REJECTED')
          AND NOT i.is_cancelled AND upper(i.locomotive_no)=upper($3)
        LIMIT 1`, [p.year, p.month, data.locomotiveNo])
      if (duplicate.rowCount) fail(409, '该机车已存在于当月计划中，不能重复增加')
      const stableItemKey = `manual-${randomUUID()}`
      const item = (await client.query(`INSERT INTO ${q('monthly_plan_item')}(plan_version_id,stable_item_key,vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,repair_sequence,mileage_km,remark,change_type,is_cancelled) VALUES($1,$2,NULL,$3,$4,$5::date,$6,$7,$8,$9,$10,'ADDED',false) RETURNING item_id`, [draft.plan_version_id, stableItemKey, data.locomotiveNo, data.repairProgramId, data.plannedEntryAt, data.ownerBureau, data.ownerDepot, data.repairSequence, data.mileageKm, data.remark])).rows[0]
      await commitMutation(client)
      return { itemId: Number(item.item_id), stableItemKey, status: 'DRAFT', statusText: '车辆已增加到当月计划草稿' }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }
  async function updateRow(client, id, data, changeReason = null) {
    const current = (await client.query(`SELECT i.stable_item_key,v.monthly_plan_id FROM ${q('monthly_plan_item')} i JOIN ${q('monthly_plan_version')} v ON v.plan_version_id=i.plan_version_id WHERE i.item_id=$1`, [id])).rows[0]
    if (!current) fail(404, '修改草稿不存在')
    const conflict = await client.query(`
      SELECT i.locomotive_no
      FROM ${q('monthly_plan_item')} i
      JOIN ${q('monthly_plan_version')} v ON v.plan_version_id=i.plan_version_id
      JOIN ${q('monthly_plan')} p ON p.monthly_plan_id=v.monthly_plan_id
      WHERE p.monthly_plan_id=$3
        AND v.version_status NOT IN ('SUPERSEDED','WITHDRAWN','REJECTED')
        AND NOT i.is_cancelled
        AND upper(i.locomotive_no)=upper($1)
        AND i.stable_item_key<>$2
      LIMIT 1`, [data.locomotiveNo, current.stable_item_key, current.monthly_plan_id])
    if (conflict.rowCount) fail(409, `机车编号“${data.locomotiveNo}”已存在于本月其他车辆，不能修改为该编号`)
    return (await client.query(`UPDATE ${q('monthly_plan_item')} SET locomotive_no=$2,repair_program_id=$3,planned_entry_at=$4::date,owner_bureau=$5,owner_depot=$6,repair_sequence=$7,mileage_km=$8,remark=$9,change_reason=COALESCE($10,change_reason),change_type=CASE WHEN change_type='ADDED' THEN 'ADDED' ELSE 'MODIFIED' END,is_cancelled=false WHERE item_id=$1 RETURNING *`, [id, data.locomotiveNo, data.repairProgramId, data.plannedEntryAt, data.ownerBureau, data.ownerDepot, data.repairSequence, data.mileageKm, data.remark, changeReason])).rows[0]
  }

  async function resolveDraftItemForEdit(client, draft, plan, requestedId, requestedDraftItemId = null) {
    const id = Number(requestedId) || null
    const explicitDraftId = Number(requestedDraftItemId) || null
    if (explicitDraftId) return (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND item_id=$2 AND NOT is_cancelled FOR UPDATE`, [draft.plan_version_id, explicitDraftId])).rows[0] || null
    if (!id) return null
    // 页面编辑已发布车辆时传 vehicle_repair_id；新增草稿尚无该关联，才使用 item_id。
    // 两种 ID 可能数值相同，必须分步查询，不能用 OR 随机命中另一辆草稿。
    let item = (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND vehicle_repair_id=$2 AND NOT is_cancelled FOR UPDATE`, [draft.plan_version_id, id])).rows[0]
    if (item) return item
    const published = plan.current_published_version_id
      ? (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND vehicle_repair_id=$2 AND NOT is_cancelled FOR UPDATE`, [plan.current_published_version_id, id])).rows[0]
      : null
    if (!published) return (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND item_id=$2 AND NOT is_cancelled FOR UPDATE`, [draft.plan_version_id, id])).rows[0] || null
    item = (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND stable_item_key=$2 AND NOT is_cancelled FOR UPDATE`, [draft.plan_version_id, published.stable_item_key])).rows[0]
    if (item) {
      if (Number(item.vehicle_repair_id || 0) !== Number(published.vehicle_repair_id || 0)) {
        item = (await client.query(`UPDATE ${q('monthly_plan_item')} SET vehicle_repair_id=$2 WHERE item_id=$1 RETURNING *`, [item.item_id, published.vehicle_repair_id])).rows[0]
      }
      return item
    }
    return copyRow(client, draft.plan_version_id, published, 'MODIFIED')
  }

  async function updateItem({ year, month, role, vehicleRepairId, draftItemId, values, changeReason, editScope, confirmScheduleReset = false }) {
    const p = period(year, month), currentRole = roleOf(role); const client = await pool.connect()
    try {
      await beginMutation(client); await assertVehicleNotStarted(client, vehicleRepairId); const plan = await ensurePlan(client, p.year, p.month), app = await activeApp(client, plan.monthly_plan_id, true), reviewer = app && ((currentRole === 'SECTION_CHIEF' && ['PENDING_REVIEW', 'PENDING_PUBLISH'].includes(app.application_status)) || (currentRole === 'DEPUTY_DIRECTOR' && app.application_status === 'PENDING_PUBLISH'))
      const ownSubmittedKeyRows = app && app.applicant_role === currentRole ? (await client.query(`SELECT i.stable_item_key FROM ${q('monthly_plan_application_item')} ai JOIN ${q('monthly_plan_item')} i ON i.item_id=ai.submitted_item_id WHERE ai.application_id=$1 AND i.vehicle_repair_id=$2`, [app.application_id, Number(vehicleRepairId)])).rows : []
      const ownUnsubmittedDraft = app && !reviewer && ownSubmittedKeyRows.length === 0
      if (app && !reviewer && !ownUnsubmittedDraft) fail(409, '当前申请正在审核，申请内容不能直接修改；请先撤回申请')
      if (reviewer) {
        if (!String(changeReason || '').trim()) fail(400, '审核修改必须填写修改原因')
        const item = (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND ((vehicle_repair_id=$2 AND $2 IS NOT NULL) OR item_id=$3) AND NOT is_cancelled FOR UPDATE`, [app.submitted_version_id, Number(vehicleRepairId) || null, Number(vehicleRepairId) || null])).rows[0]
        if (!item) fail(404, '本次申请中没有这辆车')
        const ai = (await client.query(`SELECT * FROM ${q('monthly_plan_application_item')} WHERE application_id=$1 AND submitted_item_id=$2 FOR UPDATE`, [app.application_id, item.item_id])).rows[0]
        if (!ai) fail(409, '申请明细与审核版本不一致，请刷新后重试')
        const before = snapshot(item)
        const updated = await updateRow(client, item.item_id, validate(values, p, before))
        const after = snapshot(updated)
        const no = Number((await client.query(`SELECT COALESCE(max(revision_no),0)+1 value FROM ${q('monthly_plan_revision_history')} WHERE application_id=$1`, [app.application_id])).rows[0].value)
        await client.query(`INSERT INTO ${q('monthly_plan_revision_history')}(application_id,application_item_id,revision_no,editor_role,before_data,after_data,change_reason) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`, [app.application_id, ai.application_item_id, no, currentRole, JSON.stringify(before), JSON.stringify(after), String(changeReason).trim()])
        await client.query(`UPDATE ${q('monthly_plan_application_item')} SET reviewed_snapshot=$2::jsonb WHERE application_item_id=$1`, [ai.application_item_id, JSON.stringify(after)])
        let afterStatus = app.application_status
        if (currentRole === 'SECTION_CHIEF' && app.application_status === 'PENDING_PUBLISH') {
          afterStatus = 'PENDING_REVIEW'
          await client.query(`UPDATE ${q('monthly_plan_application')} SET application_status='PENDING_REVIEW' WHERE application_id=$1`, [app.application_id])
          await client.query(`UPDATE ${q('monthly_plan_version')} SET version_status='SUBMITTED' WHERE plan_version_id=$1`, [app.submitted_version_id])
          await approval(client, app.application_id, 1, currentRole, 'PENDING', '科长修改了待发布版本，需重新确认审核')
        }
        if (afterStatus !== app.application_status) await writeStatusLog(client, { plan, app, role: currentRole, actionType: 'RETURNED_TO_CHIEF_REVIEW', fromStatus: app.application_status, toStatus: afterStatus, snapshotVersionId: app.submitted_version_id, remark: changeReason, source: 'reviewed' })
        await commitMutation(client)
        return { statusText: '审核版本已修改，修改历史已保存' }
      }
      const draft = await ensureDraft(client, plan, currentRole)
      const item = await resolveDraftItemForEdit(client, draft, plan, vehicleRepairId, draftItemId)
      if (!item) fail(404, '当前角色工作版本中没有这辆车')
      const deletionConflict = (await client.query(`SELECT 1 FROM ${q('monthly_plan_deletion')} WHERE monthly_plan_id=$1 AND stable_item_key=$2 AND delete_status IN ('DRAFT','SUBMITTED','REVIEWED')`, [plan.monthly_plan_id, item.stable_item_key])).rowCount
      if (deletionConflict) fail(409, '该车辆已有未完成的删除事项，不能同时创建修改副本')
      // 第一次基于正式车辆创建修改副本时原因必填；已有本人修改草稿可直接反复编辑并沿用原原因。
      if (plan.current_published_version_id && !['ADDED', 'MODIFIED'].includes(item.change_type) && !String(changeReason || '').trim()) fail(400, '修改正式计划必须填写修改原因')
      const before = snapshot(item)
      const data = validate(values, p, before)
      const scheduled = item.vehicle_repair_id == null ? 0 : Number((await client.query(`SELECT count(*) value FROM ${q('vehicle_repair_schedule')} WHERE vehicle_repair_id=$1 AND status NOT IN ('CANCELLED','CANCELED')`, [Number(item.vehicle_repair_id)])).rows[0]?.value || 0)
      const scheduleChanged = scheduled && (dateOnly(item.planned_entry_at) !== dateOnly(data.plannedEntryAt) || Number(item.repair_program_id) !== Number(data.repairProgramId))
      if (scheduleChanged && !confirmScheduleReset) fail(409, '该车辆已经排程，修改入段日期或修程前需要确认清除原排程')
      if (scheduleChanged) await invalidateVehicleSchedules(client, item.vehicle_repair_id, '月度计划工作版本修改，原排程已失效，需要重新排程', currentRole, app?.application_id || null)
      const updated = await updateRow(client, item.item_id, data, String(changeReason || '').trim() || null)
      const after = snapshot(updated)
      await commitMutation(client)
      return { statusText: '车辆修改已保存到当前工作版本，原正式计划保持不变' }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async function applyDirectEdit({ year, month, role, vehicleRepairId, values, changeReason }) {
    if (role !== 'DEPUTY_DIRECTOR') fail(403, '只有主管副段长可以直接修改正式计划'); if (!String(changeReason || '').trim()) fail(400, '修改正式计划必须填写调整原因'); const client = await pool.connect()
    try { await beginMutation(client); const plan = await ensurePlan(client, year, month); if (await activeApp(client, plan.monthly_plan_id, true)) fail(409, '当前月份有流转中的申请，不能绕过申请直接修改'); if (!plan.current_published_version_id) fail(409, '当前月份还没有正式发布计划'); const baseRows = (await client.query(itemSql, [plan.current_published_version_id])).rows, base = baseRows.find(row => Number(row.vehicle_repair_id) === Number(vehicleRepairId) && !row.is_cancelled); if (!base) fail(404, '正式计划中没有这辆车'); const data = validate(values, { year, month }, snapshot(base)), version = await createVersion(client, plan, role, 'PUBLISHED'); for (const row of baseRows) await copyRow(client, version.plan_version_id, row, row.change_type); await client.query(`UPDATE ${q('monthly_plan_item')} SET locomotive_no=$2,repair_program_id=$3,planned_entry_at=$4::date,owner_bureau=$5,owner_depot=$6,repair_sequence=$7,mileage_km=$8,remark=$9 WHERE plan_version_id=$1 AND vehicle_repair_id=$10`, [version.plan_version_id, data.locomotiveNo, data.repairProgramId, data.plannedEntryAt, data.ownerBureau, data.ownerDepot, data.repairSequence, data.mileageKm, data.remark, Number(vehicleRepairId)]); await client.query(`UPDATE ${q('monthly_plan_version')} SET version_status='SUPERSEDED' WHERE plan_version_id=$1`, [plan.current_published_version_id]); await client.query(`UPDATE ${q('vehicle_repair')} SET locomotive_no=$2,repair_program_id=$3,planned_entry_at=$4::date,owner_bureau=$5,owner_depot=$6,repair_sequence=$7,mileage_km=$8,remark=$9,approval_status='PUBLISHED' WHERE vehicle_repair_id=$1`, [Number(vehicleRepairId), data.locomotiveNo, data.repairProgramId, data.plannedEntryAt, data.ownerBureau, data.ownerDepot, data.repairSequence, data.mileageKm, data.remark]); await client.query(`UPDATE ${q('monthly_plan')} SET current_published_version_id=$1,updated_at=now() WHERE monthly_plan_id=$2`, [version.plan_version_id, plan.monthly_plan_id]); await client.query(`INSERT INTO ${q('monthly_plan_publication_history')}(monthly_plan_id,publish_method,published_by_role,publish_reason,base_version_id,new_version_id) VALUES($1,'DIRECT_MODIFY',$2,$3,$4,$5)`, [plan.monthly_plan_id, role, String(changeReason).trim(), plan.current_published_version_id, version.plan_version_id]); await commitMutation(client); return { statusText: '正式计划已修改并生成新版本' } } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async function directEdit({ year, month, role, vehicleRepairId, values, changeReason }) {
    fail(410, '正式计划不能直接覆盖，请先保存到工作版本并提交整月审核')
  }

  async function updateDeletion({ year, month, role, deletionId, deleteReason, deleteNote, changeReason }) {
    const p = period(year, month), currentRole = roleOf(role)
    if (!String(deleteReason || '').trim()) fail(400, '删除原因不能为空')
    if (!String(changeReason || '').trim()) fail(400, '审核修改删除事项必须填写修改原因')
    const client = await pool.connect()
    try {
      await beginMutation(client)
      const plan = (await client.query(`SELECT * FROM ${q('monthly_plan')} WHERE plan_year=$1 AND plan_month=$2 FOR UPDATE`, [p.year, p.month])).rows[0]
      if (!plan) fail(404, '本月计划不存在')
      const app = await activeApp(client, plan.monthly_plan_id, true)
      const reviewer = app && ((currentRole === 'SECTION_CHIEF' && app.application_status === 'PENDING_REVIEW') || (currentRole === 'DEPUTY_DIRECTOR' && app.application_status === 'PENDING_PUBLISH'))
      if (!reviewer) fail(403, '当前角色不在本申请的审核修订环节')
      const row = (await client.query(`SELECT d.*,ai.application_item_id,ai.reviewed_snapshot FROM ${q('monthly_plan_deletion')} d JOIN ${q('monthly_plan_application_item')} ai ON ai.deletion_id=d.deletion_id WHERE d.deletion_id=$1 AND ai.application_id=$2 FOR UPDATE`, [Number(deletionId), app.application_id])).rows[0]
      if (!row) fail(404, '本次申请中没有该删除事项')
      const before = parseJson(row.reviewed_snapshot) || { changeType: 'DELETE', deletionId: Number(row.deletion_id), deleteReason: row.delete_reason, deleteNote: row.delete_note }
      const after = { ...before, deleteReason: String(deleteReason).trim(), deleteNote: String(deleteNote || '').trim() || null }
      await client.query(`UPDATE ${q('monthly_plan_deletion')} SET delete_reason=$2,delete_note=$3,updated_at=now() WHERE deletion_id=$1`, [row.deletion_id, after.deleteReason, after.deleteNote])
      await client.query(`UPDATE ${q('monthly_plan_application_item')} SET reviewed_snapshot=$2::jsonb WHERE application_item_id=$1`, [row.application_item_id, JSON.stringify(after)])
      const revisionNo = Number((await client.query(`SELECT COALESCE(max(revision_no),0)+1 value FROM ${q('monthly_plan_revision_history')} WHERE application_id=$1`, [app.application_id])).rows[0].value)
      await client.query(`INSERT INTO ${q('monthly_plan_revision_history')}(application_id,application_item_id,revision_no,editor_role,before_data,after_data,change_reason) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`, [app.application_id, row.application_item_id, revisionNo, currentRole, JSON.stringify(before), JSON.stringify(after), String(changeReason).trim()])
      await commitMutation(client)
      return { statusText: '删除事项审核修订已保存' }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async function deleteItem({ year, month, role, vehicleRepairId, draftItemId, editScope, changeReason, deleteNote, operation, cancelReason, confirmScheduleReset = false }) {
    const current = draftItemId ? null : (await pool.query(`SELECT status FROM ${q('vehicle_repair')} WHERE vehicle_repair_id=$1`, [Number(vehicleRepairId)])).rows[0]
    if (current && ['IN_PROGRESS', 'COMPLETED', 'FINISHED', 'CLOSED'].includes(String(current.status || '').toUpperCase())) fail(409, '车辆已开始维修，不能再修改或删除')
    return applyDeleteItem({ year, month, role, vehicleRepairId, draftItemId, editScope, changeReason, deleteNote, operation, cancelReason, confirmScheduleReset })
  }

  async function applyDeleteItem({ year, month, role, vehicleRepairId, draftItemId, editScope, changeReason, deleteNote, operation, cancelReason, confirmScheduleReset = false }) {
    const currentRole = roleOf(role)
    const client = await pool.connect()
    try {
      await beginMutation(client)
      const plan = await ensurePlan(client, year, month), app = await activeApp(client, plan.monthly_plan_id, true), draft = await ensureDraft(client, plan, currentRole)
      const explicitDraftId = Number(draftItemId) || null
      const draftItem = explicitDraftId
        ? (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND item_id=$2 AND NOT is_cancelled FOR UPDATE`, [draft.plan_version_id, explicitDraftId])).rows[0]
        : (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND vehicle_repair_id=$2 AND NOT is_cancelled FOR UPDATE`, [draft.plan_version_id, Number(vehicleRepairId)])).rows[0]
      await assertVehicleNotStarted(client, draftItem?.vehicle_repair_id ?? (explicitDraftId ? null : vehicleRepairId))
      if (operation === 'CANCEL_MODIFICATION') {
        if (!draftItem || draftItem.change_type !== 'MODIFIED') fail(404, '当前没有可取消的修改草稿')
        if (app && (await client.query(`SELECT 1 FROM ${q('monthly_plan_application_item')} WHERE application_id=$1 AND draft_item_id=$2`, [app.application_id, draftItem.item_id])).rowCount) fail(409, '修改草稿已经提交审核，请先撤回整份申请')
        const published = plan.current_published_version_id
          ? (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND vehicle_repair_id=$2 AND NOT is_cancelled FOR UPDATE`, [plan.current_published_version_id, Number(vehicleRepairId)])).rows[0]
          : null
        if (!published) fail(404, '正式计划中没有这辆车')
        await client.query(`UPDATE ${q('monthly_plan_item')} SET vehicle_repair_id=$2,locomotive_no=$3,repair_program_id=$4,planned_entry_at=$5,owner_bureau=$6,owner_depot=$7,repair_sequence=$8,mileage_km=$9,remark=$10,change_reason=NULL,change_type='UNCHANGED',is_cancelled=false WHERE item_id=$1`, [draftItem.item_id, published.vehicle_repair_id, published.locomotive_no, published.repair_program_id, published.planned_entry_at, published.owner_bureau, published.owner_depot, published.repair_sequence, published.mileage_km, published.remark])
        await commitMutation(client)
        return { statusText: '修改已取消，车辆恢复为原已发布状态' }
      }
      if (draftItem?.change_type === 'ADDED') {
        if (app && (await client.query(`SELECT 1 FROM ${q('monthly_plan_application_item')} WHERE application_id=$1 AND draft_item_id=$2`, [app.application_id, draftItem.item_id])).rowCount) fail(409, '新增草稿已提交审核，请先撤回申请')
        await client.query(`DELETE FROM ${q('monthly_plan_item')} WHERE item_id=$1`, [draftItem.item_id])
        await commitMutation(client); return { statusText: '新增车辆已从待提交变更中删除' }
      }
      if (draftItem?.change_type === 'MODIFIED') {
        if (app && (await client.query(`SELECT 1 FROM ${q('monthly_plan_application_item')} WHERE application_id=$1 AND draft_item_id=$2`, [app.application_id, draftItem.item_id])).rowCount) fail(409, '修改副本已提交审核，请先撤回整份申请')
        await client.query(`DELETE FROM ${q('monthly_plan_item')} WHERE item_id=$1`, [draftItem.item_id])
      }
      if (!plan.current_published_version_id) fail(404, '当前月份没有可申请删除的正式车辆')
      const published = (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND vehicle_repair_id=$2 AND NOT is_cancelled FOR UPDATE`, [plan.current_published_version_id, Number(vehicleRepairId)])).rows[0]
      if (!published) fail(404, '正式计划中没有这辆车')
      const marker = (await client.query(`SELECT * FROM ${q('monthly_plan_deletion')} WHERE monthly_plan_id=$1 AND stable_item_key=$2 AND applicant_role=$3 AND delete_status='DRAFT' FOR UPDATE`, [plan.monthly_plan_id, published.stable_item_key, currentRole])).rows[0]
      if (operation === 'CANCEL_DELETE') {
        if (!marker) fail(404, '当前角色没有可取消的待提交删除标记')
        await client.query(`UPDATE ${q('monthly_plan_deletion')} SET delete_status='CANCELLED',cancelled_at=now(),cancelled_by_role=$2,cancel_reason=$3,updated_at=now() WHERE deletion_id=$1`, [marker.deletion_id, currentRole, String(cancelReason || '申请人取消未提交删除').trim()])
        await commitMutation(client); return { statusText: '删除标记已取消，正式车辆保持不变' }
      }
      if (marker) fail(409, '该车辆已经存在待提交删除标记')
      if (draftItem && draftItem.change_type !== 'UNCHANGED') fail(409, '该车辆已有修改副本，不能同时申请删除')
      if (!String(changeReason || '').trim()) fail(400, '申请删除正式车辆必须填写删除原因')
      const conflict = (await client.query(`SELECT 1 FROM ${q('monthly_plan_application_item')} ai JOIN ${q('monthly_plan_application')} a ON a.application_id=ai.application_id WHERE a.monthly_plan_id=$1 AND ai.stable_item_key=$2 AND a.application_status=ANY($3)`, [plan.monthly_plan_id, published.stable_item_key, activeStatuses])).rowCount
      if (conflict) fail(409, '该车辆已经进入其他审核申请，不能重复申请删除')
      const scheduled = Number((await client.query(`SELECT count(*) value FROM ${q('vehicle_repair_schedule')} WHERE vehicle_repair_id=$1 AND status NOT IN ('CANCELLED','CANCELED')`, [Number(vehicleRepairId)])).rows[0]?.value || 0)
      if (scheduled && !confirmScheduleReset) fail(409, '该车辆已经排程，删除后当前排程将失效，请确认后再删除')
      const deletion = (await client.query(`INSERT INTO ${q('monthly_plan_deletion')}(monthly_plan_id,original_published_item_id,stable_item_key,applicant_role,delete_reason,delete_note) VALUES($1,$2,$3,$4,$5,$6) RETURNING deletion_id`, [plan.monthly_plan_id, published.item_id, published.stable_item_key, currentRole, String(changeReason).trim(), String(deleteNote || '').trim() || null])).rows[0]
      if (scheduled) await invalidateVehicleSchedules(client, Number(vehicleRepairId), '月度计划工作版本标记删除，原排程已失效，需要重新确认排程', currentRole, app?.application_id || null)
      await commitMutation(client)
      return { deletionId: Number(deletion.deletion_id), statusText: scheduled ? '删除标记已创建；该车辆已有排程，正式删除发布前必须处理排程影响' : '删除标记已加入本月待提交变更' }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async function syncApplicantDraft(client, app, submittedRows) {
    const draft = (await client.query(`SELECT plan_version_id FROM ${q('monthly_plan_version')} WHERE monthly_plan_id=$1 AND owner_role=$2 AND version_status='DRAFT' ORDER BY version_no DESC LIMIT 1`, [app.monthly_plan_id, app.applicant_role])).rows[0]
    if (!draft) return
    for (const row of submittedRows) await client.query(`UPDATE ${q('monthly_plan_item')} SET locomotive_no=$3,repair_program_id=$4,planned_entry_at=$5,owner_bureau=$6,owner_depot=$7,repair_sequence=$8,mileage_km=$9,remark=$10,change_reason=$11,change_type='UNCHANGED',is_cancelled=$12 WHERE plan_version_id=$1 AND stable_item_key=$2`, [draft.plan_version_id, row.stable_item_key, row.locomotive_no, row.repair_program_id, row.planned_entry_at, row.owner_bureau, row.owner_depot, row.repair_sequence, row.mileage_km, row.remark, row.change_reason, row.is_cancelled])
  }
  async function syncReviewedSourceDrafts(client, plan, submittedRows, currentApplication) {
    const sourceIds = new Set()
    for (const row of submittedRows) {
      const source = (await client.query(`SELECT a.* FROM ${q('monthly_plan_application')} a JOIN ${q('monthly_plan_item')} i ON i.plan_version_id=a.submitted_version_id AND i.stable_item_key=$2 WHERE a.monthly_plan_id=$1 AND a.application_status='REVIEWED' ORDER BY a.application_id DESC LIMIT 1`, [plan.monthly_plan_id, row.stable_item_key])).rows[0]
      if (source && Number(source.application_id) !== Number(currentApplication.application_id)) { sourceIds.add(Number(source.application_id)); await syncApplicantDraft(client, source, [row]) }
    }
    return [...sourceIds]
  }
  async function publishApp(client, plan, app, role, method, reason) {
    const baseId = plan.current_published_version_id
    const baseRows = baseId ? (await client.query(itemSql, [baseId])).rows : []
    const submittedRows = (await client.query(itemSql, [app.submitted_version_id])).rows
    const applicationItems = (await client.query(`SELECT * FROM ${q('monthly_plan_application_item')} WHERE application_id=$1 ORDER BY application_item_id`, [app.application_id])).rows
    const submittedChangeKeys = new Set(applicationItems.filter(item => !['UNCHANGED', 'DELETE'].includes(item.change_type)).map(item => item.stable_item_key))
    const appliedRows = submittedRows.filter(row => submittedChangeKeys.has(row.stable_item_key))
    if (appliedRows.length !== submittedChangeKeys.size) fail(409, '本次申请的车辆变更快照不完整，请撤回后重新提交')
    const deletionItems = (await client.query(`SELECT ai.*,d.original_published_item_id,d.delete_reason FROM ${q('monthly_plan_application_item')} ai JOIN ${q('monthly_plan_deletion')} d ON d.deletion_id=ai.deletion_id WHERE ai.application_id=$1 AND ai.change_type='DELETE' ORDER BY ai.application_item_id`, [app.application_id])).rows
    const version = await createVersion(client, plan, role, 'PUBLISHED', baseId)
    const submittedVersion = (await client.query(`SELECT base_version_id FROM ${q('monthly_plan_version')} WHERE plan_version_id=$1 FOR UPDATE`, [app.submitted_version_id])).rows[0]
    if ((submittedVersion?.base_version_id ?? null) !== (baseId ?? null)) fail(409, '正式基础版本已变化，请重新生成申请')
     for (const row of baseRows) await copyRow(client, version.plan_version_id, row, 'UNCHANGED')
    // 提交版本是整月快照，但发布只能应用本次申请明细中明确列出的变更。
    // 未列入申请的旧草稿、已取消车辆和未变化车辆必须继续以当前正式版本为准。
    for (const row of appliedRows) {
      const old = (await client.query(`SELECT item_id FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND stable_item_key=$2`, [version.plan_version_id, row.stable_item_key])).rows[0]
      let target
      if (old) target = (await client.query(`UPDATE ${q('monthly_plan_item')} SET vehicle_repair_id=$2,locomotive_no=$3,repair_program_id=$4,planned_entry_at=$5,owner_bureau=$6,owner_depot=$7,repair_sequence=$8,mileage_km=$9,remark=$10,change_reason=$11,change_type=$12,is_cancelled=$13 WHERE item_id=$1 RETURNING *`, [old.item_id, row.vehicle_repair_id, row.locomotive_no, row.repair_program_id, row.planned_entry_at, row.owner_bureau, row.owner_depot, row.repair_sequence, row.mileage_km, row.remark, row.change_reason, row.change_type, row.is_cancelled])).rows[0]
      else target = await copyRow(client, version.plan_version_id, row, row.change_type)
      if (row.vehicle_repair_id != null && row.change_type !== 'UNCHANGED') {
        if (row.is_cancelled) await client.query(`UPDATE ${q('vehicle_repair')} SET status='CANCELLED',approval_status='PUBLISHED' WHERE vehicle_repair_id=$1`, [row.vehicle_repair_id])
        else {
          const oldRow = baseRows.find(base => base.stable_item_key === row.stable_item_key)
          const scheduleChanged = oldRow && (dateOnly(oldRow.planned_entry_at) !== dateOnly(row.planned_entry_at) || Number(oldRow.repair_program_id) !== Number(row.repair_program_id))
          if (scheduleChanged) await invalidateVehicleSchedules(client, row.vehicle_repair_id, `月度计划发布变更：${reason || '计划字段发生变化'}`, role, app.application_id)
          await client.query(`UPDATE ${q('vehicle_repair')} SET locomotive_no=$2,repair_program_id=$3,planned_entry_at=$4,planned_exit_at=$4::timestamp + ($5::int * interval '1 day'),owner_bureau=$6,owner_depot=$7,repair_sequence=$8,mileage_km=$9,remark=$10,approval_status='PUBLISHED' WHERE vehicle_repair_id=$1`, [row.vehicle_repair_id, row.locomotive_no, row.repair_program_id, row.planned_entry_at, Number(row.repair_duration_days) || 18, row.owner_bureau, row.owner_depot, row.repair_sequence, row.mileage_km, row.remark])
        }
      } else if (!row.is_cancelled) {
        const vehicleRepairId = Number((await client.query(`SELECT COALESCE(MAX(vehicle_repair_id),0)+1 AS value FROM ${q('vehicle_repair')}`)).rows[0].value)
        await client.query(`INSERT INTO ${q('vehicle_repair')}(vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,planned_exit_at,status,approval_status,owner_bureau,owner_depot,repair_sequence,mileage_km,plan_source,remark) VALUES($1,$2,$3,$4,$4::timestamp + ($5::int * interval '1 day'),'UNSCHEDULED','PUBLISHED',$6,$7,$8,$9,'MONTHLY',$10)`, [vehicleRepairId, row.locomotive_no, row.repair_program_id, row.planned_entry_at, Number(row.repair_duration_days) || 18, row.owner_bureau, row.owner_depot, row.repair_sequence, row.mileage_km, row.remark])
        await client.query(`UPDATE ${q('monthly_plan_item')} SET vehicle_repair_id=$2 WHERE item_id=$1`, [target.item_id, vehicleRepairId])
      }
    }
    for (const deletion of deletionItems) {
      const target = (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND stable_item_key=$2 AND NOT is_cancelled FOR UPDATE`, [version.plan_version_id, deletion.stable_item_key])).rows[0]
      if (!target) fail(409, '删除事项关联的正式车辆已发生变化，不能发布')
      const activeSchedules = Number((await client.query(`SELECT count(*) value FROM ${q('vehicle_repair_schedule')} WHERE vehicle_repair_id=$1 AND status NOT IN ('CANCELLED','CANCELED')`, [target.vehicle_repair_id])).rows[0]?.value || 0)
      if (activeSchedules) fail(409, `车辆 ${target.locomotive_no} 已有正式排程，请先按排程业务规则处理后再发布删除`)
      await client.query(`UPDATE ${q('monthly_plan_item')} SET is_cancelled=true,change_type='CANCELLED',change_reason=$2 WHERE item_id=$1`, [target.item_id, deletion.delete_reason])
      await client.query(`UPDATE ${q('vehicle_repair')} SET status='CANCELLED',approval_status='PUBLISHED' WHERE vehicle_repair_id=$1`, [target.vehicle_repair_id])
      await client.query(`UPDATE ${q('monthly_plan_deletion')} SET delete_status='PUBLISHED',published_at=now(),updated_at=now() WHERE deletion_id=$1`, [deletion.deletion_id])
    }
    // 正式版本只表达当前有效结果，不把上一次发布的 ADD/UPDATE 变更类型继续带成私人草稿。
    await client.query(`UPDATE ${q('monthly_plan_item')} SET change_type='UNCHANGED',change_reason=NULL WHERE plan_version_id=$1 AND NOT is_cancelled`, [version.plan_version_id])
    const expectedKeys = new Set(baseRows.filter(row => !row.is_cancelled).map(row => row.stable_item_key))
    for (const deletion of deletionItems) expectedKeys.delete(deletion.stable_item_key)
    for (const row of appliedRows) {
      if (row.is_cancelled) expectedKeys.delete(row.stable_item_key)
      else expectedKeys.add(row.stable_item_key)
    }
    const actualKeys = new Set((await client.query(`SELECT stable_item_key FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND NOT is_cancelled`, [version.plan_version_id])).rows.map(row => row.stable_item_key))
    if (expectedKeys.size !== actualKeys.size || [...expectedKeys].some(key => !actualKeys.has(key))) fail(409, '正式版本合并校验失败，未明确删除的正式车辆不能从月度计划中消失')
    await syncApplicantDraft(client, app, appliedRows)
    await syncReviewedSourceDrafts(client, plan, appliedRows, app)
    const forwardedSourceIds = (await client.query(`SELECT DISTINCT application_id FROM ${q('monthly_plan_application_item')} WHERE forwarded_application_id=$1`, [app.application_id])).rows.map(row => Number(row.application_id))
    const completedSourceIds = []
    for (const sourceId of forwardedSourceIds) {
      const remaining = Number((await client.query(`SELECT count(*) value FROM ${q('monthly_plan_application_item')} WHERE application_id=$1 AND forwarded_application_id IS NULL`, [sourceId])).rows[0].value)
      if (!remaining) completedSourceIds.push(sourceId)
    }
    if (completedSourceIds.length) await client.query(`UPDATE ${q('monthly_plan_application')} SET application_status='PUBLISHED',published_at=now() WHERE application_id=ANY($1::bigint[])`, [completedSourceIds])
    if (baseId) await client.query(`UPDATE ${q('monthly_plan_version')} SET version_status='SUPERSEDED' WHERE plan_version_id=$1`, [baseId])
    await client.query(`UPDATE ${q('monthly_plan')} SET current_published_version_id=$1,updated_at=now() WHERE monthly_plan_id=$2`, [version.plan_version_id, plan.monthly_plan_id])
    await client.query(`UPDATE ${q('monthly_plan_application')} SET application_status='PUBLISHED',published_at=now() WHERE application_id=$1`, [app.application_id])
    const publication = (await client.query(`INSERT INTO ${q('monthly_plan_publication_history')}(monthly_plan_id,application_id,publish_method,published_by_role,responsible_person,publish_reason,base_version_id,new_version_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [plan.monthly_plan_id, app.application_id, method, role, rolePerson(role), reason, baseId, version.plan_version_id])).rows[0]
    const publishAction = method === 'DIRECT_PUBLISH' ? 'DEPUTY_DIRECT_PUBLISHED' : 'DEPUTY_APPROVED_PUBLISH'
    await writeStatusLog(client, { plan, app, role, actionType: publishAction, fromStatus: method === 'DIRECT_PUBLISH' ? 'DRAFT' : app.application_status, toStatus: 'PUBLISHED', snapshotVersionId: version.plan_version_id, baseVersionId: baseId, publicationId: publication.publication_id, remark: reason, source: 'published' })
    return version
  }
  async function directPublishDeputyAdditions({ year, month, role, note }) {
    const currentRole = roleOf(role)
    if (currentRole !== 'DEPUTY_DIRECTOR') fail(403, '只有主管副段长可以直接发布本人工作变更')
    const client = await pool.connect()
    try {
      await beginMutation(client)
      const plan = await ensurePlan(client, year, month)
      await client.query(`SELECT monthly_plan_id FROM ${q('monthly_plan')} WHERE monthly_plan_id=$1 FOR UPDATE`, [plan.monthly_plan_id])
      if (await activeApp(client, plan.monthly_plan_id, true)) fail(409, '当前月份已有流转中的普通申请，请先完成、撤回或驳回后再直接发布')
      const draft = await ensureDraft(client, plan, currentRole)
      const draftRows = (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 ORDER BY planned_entry_at,locomotive_no,item_id`, [draft.plan_version_id])).rows
      const changedRows = draftRows.filter(row => !row.is_cancelled && row.change_type !== 'UNCHANGED')
      const deletions = (await client.query(`SELECT * FROM ${q('monthly_plan_deletion')} WHERE monthly_plan_id=$1 AND applicant_role=$2 AND delete_status='DRAFT' ORDER BY deletion_id`, [plan.monthly_plan_id, currentRole])).rows
      if (!changedRows.length && !deletions.length) fail(400, '当前没有可直接发布的工作变更')
      const baseRows = plan.current_published_version_id ? (await client.query(itemSql, [plan.current_published_version_id])).rows : []
      const version = await createVersion(client, plan, currentRole, 'SUBMITTED', plan.current_published_version_id)
      for (const row of baseRows) await copyRow(client, version.plan_version_id, row, 'UNCHANGED')
      // 直接发布不是普通审批申请：保留发布历史，但不制造待副段长审批的活动申请。
      const app = (await client.query(`INSERT INTO ${q('monthly_plan_application')}(monthly_plan_id,submitted_version_id,current_review_version_id,applicant_role,handler_name,application_type,application_status,application_note,adjust_reason,published_at) VALUES($1,$2,$2,$3,$4,'PUBLISH','PUBLISHED',$5,$6,now()) RETURNING *`, [plan.monthly_plan_id, version.plan_version_id, currentRole, rolePerson(currentRole), String(note || '').trim() || '主管副段长直接发布本人工作变更', plan.current_published_version_id ? '主管副段长直接发布本人工作变更' : null])).rows[0]
      for (const row of changedRows) {
        const existing = (await client.query(`SELECT item_id FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND stable_item_key=$2`, [version.plan_version_id, row.stable_item_key])).rows[0]
        let submitted
        if (existing) submitted = (await client.query(`UPDATE ${q('monthly_plan_item')} SET vehicle_repair_id=$2,locomotive_no=$3,repair_program_id=$4,planned_entry_at=$5,owner_bureau=$6,owner_depot=$7,repair_sequence=$8,mileage_km=$9,remark=$10,change_reason=$11,change_type=$12,is_cancelled=$13 WHERE item_id=$1 RETURNING *`, [existing.item_id, row.vehicle_repair_id, row.locomotive_no, row.repair_program_id, row.planned_entry_at, row.owner_bureau, row.owner_depot, row.repair_sequence, row.mileage_km, row.remark, row.change_reason, row.change_type, row.is_cancelled])).rows[0]
        else submitted = await copyRow(client, version.plan_version_id, row, row.change_type)
        await client.query(`INSERT INTO ${q('monthly_plan_application_item')}(application_id,draft_item_id,submitted_item_id,stable_item_key,original_snapshot,submitted_snapshot,reviewed_snapshot,change_type) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$6::jsonb,$7)`, [app.application_id, row.item_id, submitted.item_id, row.stable_item_key, baseRows.find(base => base.stable_item_key === row.stable_item_key) ? JSON.stringify(snapshot(baseRows.find(base => base.stable_item_key === row.stable_item_key))) : null, JSON.stringify(snapshot(row)), row.change_type === 'MODIFIED' ? 'MODIFIED' : row.change_type])
      }
      for (const deletion of deletions) {
        const original = baseRows.find(row => row.stable_item_key === deletion.stable_item_key && !row.is_cancelled)
        if (!original) fail(409, '删除事项关联的正式车辆已发生变化，不能直接发布')
        const deleteSnapshot = { ...snapshot(original), changeType: 'DELETE', deletionId: Number(deletion.deletion_id), deleteReason: deletion.delete_reason, deleteNote: deletion.delete_note }
        await client.query(`INSERT INTO ${q('monthly_plan_application_item')}(application_id,deletion_id,stable_item_key,original_snapshot,submitted_snapshot,reviewed_snapshot,change_type) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$5::jsonb,'DELETE')`, [app.application_id, deletion.deletion_id, deletion.stable_item_key, JSON.stringify(snapshot(original)), JSON.stringify(deleteSnapshot)])
        await client.query(`UPDATE ${q('monthly_plan_deletion')} SET delete_status='SUBMITTED',application_id=$2,updated_at=now() WHERE deletion_id=$1`, [deletion.deletion_id, app.application_id])
      }
      await publishApp(client, plan, app, currentRole, 'DIRECT_PUBLISH', String(note || '').trim() || '主管副段长直接发布本人工作变更')
      await commitMutation(client)
      return { status: 'PUBLISHED', statusText: '本人工作变更已直接发布', publishedCount: changedRows.length + deletions.length }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async function directPublish({ year, month, role, note, selectedItemKeys }) { return directPublishDeputyAdditions({ year, month, role, note }) }
  async function decide({ year, month, role, action, reason }) {
    const currentRole = roleOf(role), client = await pool.connect()
    try {
      await beginMutation(client)
      const plan = (await client.query(`SELECT * FROM ${q('monthly_plan')} WHERE plan_year=$1 AND plan_month=$2 FOR UPDATE`, [year, month])).rows[0]
      if (!plan) fail(404, '本月计划不存在')
      const app = await activeApp(client, plan.monthly_plan_id, true)
      if (!app) fail(409, '没有待处理的审核申请')
      if (action === 'REJECT') {
        if (!String(reason || '').trim()) fail(400, '驳回时必须填写原因')
        if (currentRole === 'SECTION_CHIEF' && app.application_status !== 'PENDING_REVIEW') fail(403, '当前不在科长审核环节')
        if (currentRole === 'DEPUTY_DIRECTOR' && app.application_status !== 'PENDING_PUBLISH') fail(403, '当前不在副段长发布环节')
        await restoreDraft(client, app)
        await client.query(`UPDATE ${q('monthly_plan_application')} SET application_status='REJECTED',application_note=concat_ws(E'\n',application_note,$2::text),rejected_at=now() WHERE application_id=$1`, [app.application_id, String(reason).trim()])
        await client.query(`UPDATE ${q('monthly_plan_version')} SET version_status='REJECTED' WHERE plan_version_id=$1`, [app.submitted_version_id])
        await approval(client, app.application_id, currentRole === 'SECTION_CHIEF' ? 1 : 2, currentRole, 'REJECTED', String(reason).trim())
        await writeStatusLog(client, { plan, app, role: currentRole, actionType: currentRole === 'SECTION_CHIEF' ? 'CHIEF_REJECTED' : 'DEPUTY_REJECTED', fromStatus: app.application_status, toStatus: 'REJECTED', snapshotVersionId: app.current_review_version_id || app.submitted_version_id, remark: reason, source: 'reviewed' })
        await commitMutation(client)
        return { status: 'REJECTED', statusText: '已驳回' }
      }
      if (currentRole === 'SECTION_CHIEF') {
        if (app.application_status !== 'PENDING_REVIEW') fail(409, '该申请不在待审核状态')
        await client.query(`UPDATE ${q('monthly_plan_application')} SET application_status='PENDING_PUBLISH' WHERE application_id=$1`, [app.application_id])
        await client.query(`UPDATE ${q('monthly_plan_deletion')} SET delete_status='REVIEWED',updated_at=now() WHERE application_id=$1 AND delete_status='SUBMITTED'`, [app.application_id])
        await client.query(`UPDATE ${q('monthly_plan_version')} SET version_status='REVIEWED' WHERE plan_version_id=$1`, [app.submitted_version_id])
        await approval(client, app.application_id, 1, currentRole, 'APPROVED', '科长审核通过，已进入待副段长发布')
        await writeStatusLog(client, { plan, app, role: currentRole, actionType: 'CHIEF_APPROVED', fromStatus: 'PENDING_REVIEW', toStatus: 'PENDING_PUBLISH', snapshotVersionId: app.current_review_version_id || app.submitted_version_id, remark: String(reason || '').trim() || '科长审核通过', source: 'reviewed' })
        await commitMutation(client)
        return { status: 'PENDING_PUBLISH', statusText: '科长审核通过，已进入待发布' }
      }
      if (currentRole !== 'DEPUTY_DIRECTOR' || app.application_status !== 'PENDING_PUBLISH') fail(403, '只有主管副段长可以发布待发布的整月计划')
      await publishApp(client, plan, app, currentRole, 'NORMAL_APPROVAL', String(reason || '').trim() || '审批发布')
      await approval(client, app.application_id, 2, currentRole, 'APPROVED', String(reason || '').trim() || '审批发布')
      await commitMutation(client)
      return { status: 'PUBLISHED', statusText: '已发布' }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }
  async function requestPublish({ year, month, role, note, adjustReason, selectedItemKeys }) {
    fail(410, '科长审核通过后自动进入待发布，不再单独申请发布')
    const p = period(year, month), currentRole = roleOf(role)
    if (currentRole !== 'SECTION_CHIEF') fail(403, '只有运用科主管科长可以申请发布')
    if (!Array.isArray(selectedItemKeys)) fail(400, '必须明确选择本次申请发布的事项')
    const client = await pool.connect()
    try {
      await beginMutation(client)
      const plan = await ensurePlan(client, p.year, p.month)
      await client.query(`SELECT monthly_plan_id FROM ${q('monthly_plan')} WHERE monthly_plan_id=$1 FOR UPDATE`, [plan.monthly_plan_id])
      if (await activeApp(client, plan.monthly_plan_id, true)) fail(409, '当前月份已有流转中的申请，请先处理完成')
      if (plan.current_published_version_id && !String(adjustReason || '').trim()) fail(400, '已发布计划再次申请发布时必须填写调整原因')
      const candidates = new Map(), draft = await ensureDraft(client, plan, currentRole)
      for (const row of (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND change_type<>'UNCHANGED' ORDER BY item_id`, [draft.plan_version_id])).rows) candidates.set(row.stable_item_key, { kind: 'ITEM', row, draftItemId: row.item_id })
      for (const row of (await client.query(`SELECT * FROM ${q('monthly_plan_deletion')} WHERE monthly_plan_id=$1 AND applicant_role=$2 AND delete_status='DRAFT' ORDER BY deletion_id`, [plan.monthly_plan_id, currentRole])).rows) { if (candidates.has(row.stable_item_key)) fail(409, '科长自己的同一车辆存在冲突的修改和删除事项'); candidates.set(row.stable_item_key, { kind: 'DELETE', row }) }
      const reviewedApps = (await client.query(`SELECT * FROM ${q('monthly_plan_application')} WHERE monthly_plan_id=$1 AND application_status='REVIEWED' ORDER BY application_id`, [plan.monthly_plan_id])).rows
      for (const sourceApp of reviewedApps) {
        const sourceItems = (await client.query(`SELECT * FROM ${q('monthly_plan_application_item')} WHERE application_id=$1 AND forwarded_application_id IS NULL ORDER BY application_item_id`, [sourceApp.application_id])).rows
        const sourceRows = new Map((await client.query(itemSql, [sourceApp.submitted_version_id])).rows.map(row => [row.stable_item_key, row]))
        for (const sourceItem of sourceItems) {
          if (candidates.has(sourceItem.stable_item_key)) fail(409, '同一车辆同时存在科长草稿和下级已审核事项，请先保留一种变更')
          if (sourceItem.change_type === 'DELETE') {
            const deletion = (await client.query(`SELECT * FROM ${q('monthly_plan_deletion')} WHERE deletion_id=$1`, [sourceItem.deletion_id])).rows[0]
            if (deletion) candidates.set(sourceItem.stable_item_key, { kind: 'DELETE', row: deletion, sourceItem })
          } else {
            const row = sourceRows.get(sourceItem.stable_item_key)
            if (row) candidates.set(sourceItem.stable_item_key, { kind: 'ITEM', row, sourceItem })
          }
        }
      }
      const keys = [...new Set(selectedItemKeys.map(String))]
      if (!keys.length) fail(400, '请至少勾选一项科长草稿或紫色已审核事项')
      const selected = keys.map(key => candidates.get(key)).filter(Boolean)
      if (selected.length !== keys.length) fail(403, '只能选择科长自己的草稿或已审核待申请发布事项')
      const version = await createVersion(client, plan, currentRole, 'SUBMITTED')
      const app = (await client.query(`INSERT INTO ${q('monthly_plan_application')}(monthly_plan_id,submitted_version_id,applicant_role,application_type,application_status,application_note,adjust_reason) VALUES($1,$2,$3,'PUBLISH','PENDING_PUBLISH',$4,$5) RETURNING *`, [plan.monthly_plan_id, version.plan_version_id, currentRole, String(note || '').trim() || '科长申请发布', String(adjustReason || '').trim() || null])).rows[0]
      for (const selectedChange of selected) {
        if (selectedChange.kind === 'DELETE') {
          const deletion = selectedChange.row, sourceItem = selectedChange.sourceItem
          const original = (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND stable_item_key=$2 AND NOT is_cancelled`, [plan.current_published_version_id, deletion.stable_item_key])).rows[0]
          if (!original) fail(409, '删除事项关联的正式车辆版本已经变化')
          const submittedSnapshot = sourceItem ? parseJson(sourceItem.reviewed_snapshot || sourceItem.submitted_snapshot) : { ...snapshot(original), changeType: 'DELETE', deletionId: Number(deletion.deletion_id), deleteReason: deletion.delete_reason, deleteNote: deletion.delete_note }
          await client.query(`INSERT INTO ${q('monthly_plan_application_item')}(application_id,deletion_id,stable_item_key,original_snapshot,submitted_snapshot,reviewed_snapshot,change_type) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$5::jsonb,'DELETE')`, [app.application_id, deletion.deletion_id, deletion.stable_item_key, sourceItem?.original_snapshot ? JSON.stringify(parseJson(sourceItem.original_snapshot)) : JSON.stringify(snapshot(original)), JSON.stringify(submittedSnapshot)])
          await client.query(`UPDATE ${q('monthly_plan_deletion')} SET delete_status='REVIEWED',application_id=$2,updated_at=now() WHERE deletion_id=$1`, [deletion.deletion_id, app.application_id])
          if (sourceItem) await client.query(`UPDATE ${q('monthly_plan_application_item')} SET forwarded_application_id=$2 WHERE application_item_id=$1`, [sourceItem.application_item_id, app.application_id])
        } else {
          const row = selectedChange.row, sourceItem = selectedChange.sourceItem, submitted = await copyRow(client, version.plan_version_id, row, row.change_type)
          const originalSnapshot = sourceItem?.original_snapshot ? parseJson(sourceItem.original_snapshot) : (plan.current_published_version_id && row.change_type !== 'ADDED' ? snapshot((await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND stable_item_key=$2`, [plan.current_published_version_id, row.stable_item_key])).rows[0]) : null)
          const submittedSnapshot = sourceItem ? parseJson(sourceItem.reviewed_snapshot || sourceItem.submitted_snapshot) : snapshot(row)
          await client.query(`INSERT INTO ${q('monthly_plan_application_item')}(application_id,draft_item_id,submitted_item_id,stable_item_key,original_snapshot,submitted_snapshot,reviewed_snapshot,change_type) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$6::jsonb,$7)`, [app.application_id, selectedChange.draftItemId || null, submitted.item_id, row.stable_item_key, originalSnapshot ? JSON.stringify(originalSnapshot) : null, JSON.stringify(submittedSnapshot), row.change_type])
          if (sourceItem) await client.query(`UPDATE ${q('monthly_plan_application_item')} SET forwarded_application_id=$2 WHERE application_item_id=$1`, [sourceItem.application_item_id, app.application_id])
        }
      }
      await approval(client, app.application_id, 2, 'DEPUTY_DIRECTOR', 'PENDING', '科长申请发布，等待主管副段长审批')
      await commitMutation(client)
      return { applicationId: Number(app.application_id), selectedCount: selected.length, status: 'PENDING_PUBLISH', statusText: '已申请发布，等待主管副段长审批' }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }
  async function withdrawV2({ year, month, role }) {
    const p = period(year, month), currentRole = roleOf(role), client = await pool.connect()
    try {
      await beginMutation(client)
      const plan = (await client.query(`SELECT * FROM ${q('monthly_plan')} WHERE plan_year=$1 AND plan_month=$2 FOR UPDATE`, [p.year, p.month])).rows[0]
      if (!plan) fail(404, '本月计划不存在')
      const app = await activeApp(client, plan.monthly_plan_id, true)
      if (!app) fail(409, '没有可撤回的审核申请')
      if (app.applicant_role !== currentRole) fail(403, '只能由申请角色撤回申请')
      await restoreDraft(client, app)
      await client.query(`UPDATE ${q('monthly_plan_application')} SET application_status='WITHDRAWN',withdrawn_at=now() WHERE application_id=$1`, [app.application_id])
      await client.query(`UPDATE ${q('monthly_plan_version')} SET version_status='WITHDRAWN' WHERE plan_version_id=$1`, [app.submitted_version_id])
      await approval(client, app.application_id, app.application_status === 'PENDING_REVIEW' ? 1 : 2, currentRole, 'WITHDRAWN', '申请人撤回申请')
      await writeStatusLog(client, { plan, app, role: currentRole, actionType: 'APPLICATION_WITHDRAWN', fromStatus: app.application_status, toStatus: 'WITHDRAWN', snapshotVersionId: app.current_review_version_id || app.submitted_version_id, remark: '申请人撤回申请', source: 'reviewed' })
      await commitMutation(client)
      return { status: 'WITHDRAWN', statusText: '已撤回，工作变更已恢复为本人草稿' }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async function requestPublishV2({ year, month, role, note, adjustReason }) {
    const p = period(year, month), currentRole = roleOf(role)
    if (currentRole !== 'SECTION_CHIEF') fail(403, '只有运用科主管科长可以申请发布本人工作变更')
    const client = await pool.connect()
    try {
      await beginMutation(client)
      const plan = await ensurePlan(client, p.year, p.month)
      await client.query(`SELECT monthly_plan_id FROM ${q('monthly_plan')} WHERE monthly_plan_id=$1 FOR UPDATE`, [plan.monthly_plan_id])
      if (await activeApp(client, plan.monthly_plan_id, true)) fail(409, '当前月份已有流转中的申请，请先处理完成')
      if (plan.current_published_version_id && !String(adjustReason || '').trim()) fail(400, '已发布计划再次申请发布时必须填写调整原因')
      const draft = await ensureDraft(client, plan, currentRole)
      const changedRows = (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND change_type<>'UNCHANGED' AND NOT is_cancelled ORDER BY planned_entry_at,locomotive_no,item_id`, [draft.plan_version_id])).rows
      const deletions = (await client.query(`SELECT * FROM ${q('monthly_plan_deletion')} WHERE monthly_plan_id=$1 AND applicant_role=$2 AND delete_status='DRAFT' ORDER BY deletion_id`, [plan.monthly_plan_id, currentRole])).rows
      if (!changedRows.length && !deletions.length) fail(400, '当前没有可申请发布的工作变更')
      const baseRows = plan.current_published_version_id ? (await client.query(itemSql, [plan.current_published_version_id])).rows : []
      const version = await createVersion(client, plan, currentRole, 'SUBMITTED', plan.current_published_version_id)
      const app = (await client.query(`INSERT INTO ${q('monthly_plan_application')}(monthly_plan_id,submitted_version_id,current_review_version_id,applicant_role,handler_name,application_type,application_status,application_note,adjust_reason) VALUES($1,$2,$2,$3,$4,'PUBLISH','PENDING_PUBLISH',$5,$6) RETURNING *`, [plan.monthly_plan_id, version.plan_version_id, currentRole, rolePerson(currentRole), String(note || '').trim() || '科长申请发布', String(adjustReason || '').trim() || null])).rows[0]
      for (const row of changedRows) {
        const submitted = await copyRow(client, version.plan_version_id, row, row.change_type)
        const original = baseRows.find(item => item.stable_item_key === row.stable_item_key)
        await client.query(`INSERT INTO ${q('monthly_plan_application_item')}(application_id,draft_item_id,submitted_item_id,stable_item_key,original_snapshot,submitted_snapshot,reviewed_snapshot,change_type) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$6::jsonb,$7)`, [app.application_id, row.item_id, submitted.item_id, row.stable_item_key, original ? JSON.stringify(snapshot(original)) : null, JSON.stringify(snapshot(row)), row.change_type])
      }
      for (const deletion of deletions) {
        const original = baseRows.find(item => item.stable_item_key === deletion.stable_item_key && !item.is_cancelled)
        if (!original) fail(409, '删除事项关联的正式车辆版本已经发生变化')
        const deleteSnapshot = { ...snapshot(original), changeType: 'DELETE', deletionId: Number(deletion.deletion_id), deleteReason: deletion.delete_reason, deleteNote: deletion.delete_note }
        await client.query(`INSERT INTO ${q('monthly_plan_application_item')}(application_id,deletion_id,stable_item_key,original_snapshot,submitted_snapshot,reviewed_snapshot,change_type) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$5::jsonb,'DELETE')`, [app.application_id, deletion.deletion_id, deletion.stable_item_key, JSON.stringify(snapshot(original)), JSON.stringify(deleteSnapshot)])
        await client.query(`UPDATE ${q('monthly_plan_deletion')} SET delete_status='SUBMITTED',application_id=$2,updated_at=now() WHERE deletion_id=$1`, [deletion.deletion_id, app.application_id])
      }
      await approval(client, app.application_id, 2, 'DEPUTY_DIRECTOR', 'PENDING', '科长申请发布，等待主管副段长审批')
      await writeStatusLog(client, { plan, app, role: currentRole, actionType: 'CHIEF_SUBMITTED_FOR_PUBLISH', fromStatus: 'DRAFT', toStatus: 'PENDING_PUBLISH', snapshotVersionId: version.plan_version_id, baseVersionId: plan.current_published_version_id, remark: String(note || '').trim() || String(adjustReason || '').trim() || null, source: 'submitted' })
      await commitMutation(client)
      return { applicationId: Number(app.application_id), submittedCount: changedRows.length + deletions.length, status: 'PENDING_PUBLISH', statusText: '已申请发布，等待主管副段长审批' }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }
  async function isVehiclePublished(vehicleRepairId) { const result = await pool.query(`SELECT 1 FROM ${q('monthly_plan')} p JOIN ${q('monthly_plan_item')} i ON i.plan_version_id=p.current_published_version_id WHERE i.vehicle_repair_id=$1 AND NOT i.is_cancelled`, [Number(vehicleRepairId)]); return Boolean(result.rowCount) }
  async function todos({ role }) { const currentRole = roleOf(role), status = currentRole === 'SECTION_CHIEF' ? 'PENDING_REVIEW' : currentRole === 'DEPUTY_DIRECTOR' ? 'PENDING_PUBLISH' : null; if (!status) return { items: [] }; const rows = (await pool.query(`SELECT a.application_id,a.application_status,a.submitted_at,p.plan_year,p.plan_month,p.plan_title,(SELECT count(*)::int FROM ${q('monthly_plan_application_item')} ai WHERE ai.application_id=a.application_id) vehicle_count FROM ${q('monthly_plan_application')} a JOIN ${q('monthly_plan')} p ON p.monthly_plan_id=a.monthly_plan_id WHERE a.application_status=$1 ORDER BY a.submitted_at,p.plan_year,p.plan_month`, [status])).rows; return { items: rows.map(row => ({ id: Number(row.application_id), year: row.plan_year, month: row.plan_month, title: row.plan_title, status: row.application_status, submittedAt: row.submitted_at, vehicleCount: Number(row.vehicle_count) })) } }
  return { read, setTitle, submit, requestPublish: requestPublishV2, withdraw: withdrawV2, takeover, createDraftItem, updateItem, updateDeletion, deleteItem, directPublish: directPublishDeputyAdditions, decide, todos, logs, isVehiclePublished }
}
