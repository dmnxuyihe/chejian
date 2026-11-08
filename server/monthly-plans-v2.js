const roles = new Set(['PLANNER', 'SECTION_CHIEF', 'DEPUTY_DIRECTOR'])
const activeStatuses = ['PENDING_REVIEW', 'PENDING_PUBLISH']

function fail(status, message) { throw Object.assign(new Error(message), { status }) }
function roleOf(value) { const role = String(value || 'PLANNER').toUpperCase(); if (!roles.has(role)) fail(400, '模拟角色无效'); return role }
function period(year, month) { const y = Number(year), m = Number(month); if (!Number.isInteger(y) || y < 1900 || y > 2199 || !Number.isInteger(m) || m < 1 || m > 12) fail(400, '请选择有效年月'); return { year: y, month: m } }
const dateOnly = value => String(value || '').slice(0, 10)
const parseJson = value => typeof value === 'string' ? JSON.parse(value) : value

export function createMonthlyPlanService(database) {
  const { pool, schema } = database
  const q = name => `"${schema}"."${name}"`
  const itemSql = `SELECT i.*,rp.repair_program_name,lm.model_id,lm.model_name FROM ${q('monthly_plan_item')} i JOIN ${q('repair_program')} rp ON rp.repair_program_id=i.repair_program_id JOIN ${q('locomotive_model')} lm ON lm.model_id=rp.model_id WHERE i.plan_version_id=$1 ORDER BY i.planned_entry_at,i.locomotive_no,i.item_id`
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
  async function latestApp(client, planId) { return (await client.query(`SELECT * FROM ${q('monthly_plan_application')} WHERE monthly_plan_id=$1 ORDER BY application_id DESC LIMIT 1`, [planId])).rows[0] || null }
  async function activeApp(client, planId, lock = false) { return (await client.query(`SELECT * FROM ${q('monthly_plan_application')} WHERE monthly_plan_id=$1 AND application_status=ANY($2) ORDER BY application_id DESC LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [planId, activeStatuses])).rows[0] || null }
  async function backfillLegacyApplicationItems(client, app, submittedRows) {
    if (!app || !submittedRows.length) return
    const count = Number((await client.query(`SELECT count(*) value FROM ${q('monthly_plan_application_item')} WHERE application_id=$1`, [app.application_id])).rows[0].value)
    if (count) return
    for (const row of submittedRows) await client.query(`INSERT INTO ${q('monthly_plan_application_item')}(application_id,submitted_item_id,stable_item_key,submitted_snapshot,reviewed_snapshot,change_type) VALUES($1,$2,$3,$4::jsonb,$4::jsonb,$5) ON CONFLICT(application_id,stable_item_key) DO NOTHING`, [app.application_id, row.item_id, row.stable_item_key, JSON.stringify(snapshot(row)), row.change_type])
  }
  function snapshot(row) { return { stableItemKey: row.stable_item_key, vehicleRepairId: row.vehicle_repair_id == null ? null : Number(row.vehicle_repair_id), locomotiveNo: row.locomotive_no, repairProgramId: Number(row.repair_program_id), plannedEntryAt: dateOnly(row.planned_entry_at), ownerBureau: row.owner_bureau, ownerDepot: row.owner_depot, repairSequence: row.repair_sequence == null ? null : Number(row.repair_sequence), mileageKm: row.mileage_km == null ? null : Number(row.mileage_km), remark: row.remark, changeReason: row.change_reason, changeType: row.change_type, isCancelled: Boolean(row.is_cancelled) } }
  function mapItem(row, flags = {}) { return { id: Number(row.item_id), stableItemKey: row.stable_item_key, vehicleRepairId: row.vehicle_repair_id == null ? null : Number(row.vehicle_repair_id), locomotiveNo: row.locomotive_no, repairProgramId: Number(row.repair_program_id), repairProgramName: row.repair_program_name, modelId: Number(row.model_id), modelName: row.model_name, plannedEntryAt: String(row.planned_entry_at).replace(' ', 'T'), ownerBureau: row.owner_bureau, ownerDepot: row.owner_depot, repairSequence: row.repair_sequence, mileageKm: row.mileage_km == null ? null : Number(row.mileage_km), remark: row.remark, changeReason: row.change_reason, changeType: row.change_type, isCancelled: Boolean(row.is_cancelled), ...flags } }
  function mapDeletion(row, flags = {}) { return { id: `deletion-${row.deletion_id}`, deletionId: Number(row.deletion_id), stableItemKey: row.stable_item_key, vehicleRepairId: Number(row.vehicle_repair_id), locomotiveNo: row.locomotive_no, repairProgramId: Number(row.repair_program_id), repairProgramName: row.repair_program_name, modelId: Number(row.model_id), modelName: row.model_name, plannedEntryAt: String(row.planned_entry_at).replace(' ', 'T'), ownerBureau: row.owner_bureau, ownerDepot: row.owner_depot, repairSequence: row.repair_sequence, mileageKm: row.mileage_km == null ? null : Number(row.mileage_km), remark: row.remark, changeReason: row.delete_reason, deleteReason: row.delete_reason, deleteNote: row.delete_note, changeType: 'DELETE', deletionStatus: row.delete_status, isDeletionMarker: true, hideFromCalendar: true, ...flags } }
  function planStatus(plan, app, draftCount) { if (app?.application_status === 'PENDING_REVIEW') return plan.current_published_version_id ? '部分待审核' : '待审核'; if (app?.application_status === 'REVIEWED') return plan.current_published_version_id ? '部分已审核待申请发布' : '已审核待申请发布'; if (app?.application_status === 'PENDING_PUBLISH') return plan.current_published_version_id ? '部分待发布' : '待发布'; if (app?.application_status === 'REJECTED') return plan.current_published_version_id ? '部分已驳回' : '已驳回'; if (app?.application_status === 'WITHDRAWN') return plan.current_published_version_id ? '已发布' : (draftCount ? '编制中' : '已撤回'); return plan.current_published_version_id ? '已发布' : '编制中' }

  async function read({ year, month, role }) {
    const p = period(year, month), currentRole = roleOf(role), client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`SELECT revision FROM ${q('application_state')} WHERE singleton FOR UPDATE`)
      const plan = await ensurePlan(client, p.year, p.month), draft = await ensureDraft(client, plan, currentRole), app = await latestApp(client, plan.monthly_plan_id)
      const active = Boolean(app && activeStatuses.includes(app.application_status))
      const publishedRows = plan.current_published_version_id ? (await client.query(itemSql, [plan.current_published_version_id])).rows : []
      const submittedRows = active ? (await client.query(itemSql, [app.submitted_version_id])).rows : []
      const reviewedApps = (await client.query(`SELECT * FROM ${q('monthly_plan_application')} WHERE monthly_plan_id=$1 AND application_status='REVIEWED' ORDER BY application_id`, [plan.monthly_plan_id])).rows
      const reviewedRows = [], reviewedKeys = new Set()
      for (const reviewedApp of reviewedApps) { const availableKeys = new Set((await client.query(`SELECT stable_item_key FROM ${q('monthly_plan_application_item')} WHERE application_id=$1 AND forwarded_application_id IS NULL AND change_type<>'DELETE'`, [reviewedApp.application_id])).rows.map(row => row.stable_item_key)); for (const row of (await client.query(itemSql, [reviewedApp.submitted_version_id])).rows) if (availableKeys.has(row.stable_item_key) && !reviewedKeys.has(row.stable_item_key)) { reviewedKeys.add(row.stable_item_key); reviewedRows.push({ row, application: reviewedApp }) } }
      await backfillLegacyApplicationItems(client, app, submittedRows)
      const draftRows = (await client.query(itemSql, [draft.plan_version_id])).rows
      const appItems = app ? (await client.query(`SELECT ai.* FROM ${q('monthly_plan_application_item')} ai WHERE ai.application_id=$1 ORDER BY ai.application_item_id`, [app.application_id])).rows : []
      const ownDeletions = (await client.query(`${deletionSql} WHERE d.monthly_plan_id=$1 AND d.applicant_role=$2 AND d.delete_status='DRAFT' ORDER BY d.created_at,d.deletion_id`, [plan.monthly_plan_id, currentRole])).rows
      const pendingDeletions = app ? (await client.query(`${deletionSql} JOIN ${q('monthly_plan_application_item')} ai ON ai.deletion_id=d.deletion_id WHERE ai.application_id=$1 ORDER BY ai.application_item_id`, [app.application_id])).rows : []
      const reviewedDeletions = (await client.query(`${deletionSql} JOIN ${q('monthly_plan_application_item')} ai ON ai.deletion_id=d.deletion_id JOIN ${q('monthly_plan_application')} a ON a.application_id=ai.application_id WHERE d.monthly_plan_id=$1 AND a.application_status='REVIEWED' AND ai.forwarded_application_id IS NULL ORDER BY a.application_id,ai.application_item_id`, [plan.monthly_plan_id])).rows
      const activeAppItems = active ? appItems : []
      const applicationKeys = new Set(activeAppItems.map(row => row.stable_item_key))
      const applicationItemByKey = new Map(activeAppItems.map(row => [row.stable_item_key, row]))
      const selectedKeys = new Set(activeAppItems.map(row => row.stable_item_key)), result = []
      const publishedKeys = new Set(publishedRows.filter(row => !row.is_cancelled).map(row => row.stable_item_key))
      const publishedByKey = new Map(publishedRows.filter(row => !row.is_cancelled).map(row => [row.stable_item_key, row]))
      const deletionKeys = new Set([...ownDeletions, ...pendingDeletions, ...reviewedDeletions].map(row => row.stable_item_key))
      for (const row of publishedRows.filter(row => !row.is_cancelled)) result.push(mapItem(row, { isPublished: true, approvalStatus: 'PUBLISHED', draftOwnerRole: null, pendingDeletion: deletionKeys.has(row.stable_item_key) }))
      for (const row of submittedRows) { const applicationItem = applicationItemByKey.get(row.stable_item_key), originalSnapshot = parseJson(applicationItem?.original_snapshot); result.push(mapItem(row, { isPending: true, isSubmitted: true, isChanged: true, originalSnapshot, hideFromCalendar: row.change_type === 'MODIFIED' && dateOnly(row.planned_entry_at) === dateOnly(originalSnapshot?.plannedEntryAt), approvalStatus: app.application_status === 'PENDING_REVIEW' ? 'SUBMITTED' : 'PENDING_PUBLISH', applicationStatus: app.application_status, draftOwnerRole: app.applicant_role, canReviewEdit: (currentRole === 'SECTION_CHIEF' && app.application_status === 'PENDING_REVIEW') || (currentRole === 'DEPUTY_DIRECTOR' && app.application_status === 'PENDING_PUBLISH') })) }
      for (const row of pendingDeletions) { const applicationItem = applicationItemByKey.get(row.stable_item_key); result.push(mapDeletion(row, { isPending: true, isSubmitted: true, isChanged: true, originalSnapshot: parseJson(applicationItem?.original_snapshot), approvalStatus: app.application_status === 'PENDING_REVIEW' ? 'SUBMITTED' : 'PENDING_PUBLISH', applicationStatus: app.application_status, draftOwnerRole: app.applicant_role, canReviewEdit: (currentRole === 'SECTION_CHIEF' && app.application_status === 'PENDING_REVIEW') || (currentRole === 'DEPUTY_DIRECTOR' && app.application_status === 'PENDING_PUBLISH') })) }
      for (const { row, application } of reviewedRows) if ((!publishedKeys.has(row.stable_item_key) || row.change_type !== 'UNCHANGED' || row.is_cancelled) && !selectedKeys.has(row.stable_item_key)) result.push(mapItem(row, { isReviewedPending: true, isChanged: true, approvalStatus: 'REVIEWED', applicationStatus: 'REVIEWED', reviewedApplicationId: Number(application.application_id), draftOwnerRole: 'SECTION_CHIEF', canReviewEdit: currentRole === 'SECTION_CHIEF' }))
      for (const row of reviewedDeletions) if (!selectedKeys.has(row.stable_item_key)) result.push(mapDeletion(row, { isReviewedPending: true, isChanged: true, approvalStatus: 'REVIEWED', applicationStatus: 'REVIEWED', draftOwnerRole: 'SECTION_CHIEF', canReviewEdit: false }))
      for (const row of draftRows) {
        if (active && selectedKeys.has(row.stable_item_key)) continue
        if (reviewedKeys.has(row.stable_item_key)) continue
        if (plan.current_published_version_id && row.change_type === 'UNCHANGED') continue
        const ownUnsubmitted = !selectedKeys.has(row.stable_item_key)
        const ownerOutcome = app && app.applicant_role === currentRole && applicationKeys.has(row.stable_item_key) && ['REJECTED', 'WITHDRAWN'].includes(app.application_status) ? app.application_status : 'DRAFT'
        const original = publishedByKey.get(row.stable_item_key), originalSnapshot = original ? snapshot(original) : null
        const item = mapItem(row, { isDraft: true, isChanged: row.change_type !== 'UNCHANGED', originalSnapshot, hideFromCalendar: row.change_type === 'MODIFIED' && dateOnly(row.planned_entry_at) === dateOnly(original?.planned_entry_at), approvalStatus: ownerOutcome, draftOwnerRole: currentRole, selectableDraft: ownUnsubmitted && (!plan.current_published_version_id || row.change_type !== 'UNCHANGED') })
        result.push(item)
      }
      for (const row of ownDeletions) if (!selectedKeys.has(row.stable_item_key)) result.push(mapDeletion(row, { isDraft: true, isChanged: true, approvalStatus: 'DRAFT', draftOwnerRole: currentRole, selectableDraft: true }))
      const revisionRows = app ? (await client.query(`SELECT rh.*,ai.stable_item_key FROM ${q('monthly_plan_revision_history')} rh LEFT JOIN ${q('monthly_plan_application_item')} ai ON ai.application_item_id=rh.application_item_id WHERE rh.application_id=$1 ORDER BY rh.revision_no`, [app.application_id])).rows : []
      for (const item of result) item.reviewHistory = revisionRows.filter(row => row.stable_item_key === item.stableItemKey).map(row => ({ revisionNo: row.revision_no, editorRole: row.editor_role, beforeData: parseJson(row.before_data), afterData: parseJson(row.after_data), changeReason: row.change_reason, editedAt: row.edited_at }))
      await client.query('COMMIT')
const ownDraftCount = draftRows.filter(row => row.change_type !== 'UNCHANGED').length + ownDeletions.length
// 以最终返回给日历的车辆集合为准，确保顶部数量与科长实际可以勾选的车辆一致。
// 其中包含科长自己的草稿和未被转发到待发布申请的紫色审核事项，不包含已经申请发布的车辆。
const pendingChangeCount = currentRole === 'SECTION_CHIEF'
  ? result.filter(row => (row.isDraft && row.selectableDraft) || row.isReviewedPending).length
  : ownDraftCount
      return { planId: Number(plan.monthly_plan_id), year: p.year, month: p.month, title: plan.plan_title, role: currentRole, status: planStatus(plan, app, pendingChangeCount), hasPublishedVersion: Boolean(plan.current_published_version_id), hasOwnDraft: pendingChangeCount > 0, draftNotice: Boolean(plan.current_published_version_id && pendingChangeCount), pendingChangeCount, readOnly: active, ownDraftEditable: !active || app?.applicant_role !== currentRole, application: app ? { id: Number(app.application_id), applicantRole: app.applicant_role, status: app.application_status, type: app.application_type, note: app.application_note, adjustReason: app.adjust_reason, submittedAt: app.submitted_at, selectedCount: appItems.length, selectedStableItemKeys: appItems.map(row => row.stable_item_key), revisions: revisionRows.map(row => ({ revisionNo: row.revision_no, stableItemKey: row.stable_item_key, editorRole: row.editor_role, beforeData: parseJson(row.before_data), afterData: parseJson(row.after_data), changeReason: row.change_reason, editedAt: row.edited_at })) } : null, items: result, draftItems: result.filter(row => row.isDraft) }
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
  async function approval(client, applicationId, level, role, status, opinion = null) { const id = Number((await client.query(`SELECT COALESCE(max(approval_id),0)+1 value FROM ${q('approval_record')}`)).rows[0].value); await client.query(`INSERT INTO ${q('approval_record')}(approval_id,business_type,business_id,approval_level,approval_role,approval_status,approval_opinion,approved_at) VALUES($1,'MONTHLY_PLAN_APPLICATION',$2,$3,$4,$5,$6,CASE WHEN $7::text IN ('APPROVED','REJECTED','WITHDRAWN') THEN now() END)`, [id, applicationId, level, role, status, opinion, status]) }

  async function submit({ year, month, role, note, adjustReason, selectedItemKeys }) {
    const p = period(year, month), currentRole = roleOf(role); if (!['PLANNER', 'SECTION_CHIEF'].includes(currentRole)) fail(403, '主管副段长只负责直接发布，不能发起普通审核申请'); const client = await pool.connect()
    try {
      await beginMutation(client); const plan = await ensurePlan(client, p.year, p.month); await client.query(`SELECT monthly_plan_id FROM ${q('monthly_plan')} WHERE monthly_plan_id=$1 FOR UPDATE`, [plan.monthly_plan_id]); if (await activeApp(client, plan.monthly_plan_id, true)) fail(409, '本月已有流转中的审核申请')
      if (!Array.isArray(selectedItemKeys)) fail(400, '必须明确选择本次申请审核的草稿车辆')
      const draft = await ensureDraft(client, plan, currentRole), allDraftRows = (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 ORDER BY planned_entry_at,locomotive_no,item_id`, [draft.plan_version_id])).rows, draftCandidates = plan.current_published_version_id ? allDraftRows.filter(row => row.change_type !== 'UNCHANGED') : allDraftRows, deletionCandidates = (await client.query(`SELECT * FROM ${q('monthly_plan_deletion')} WHERE monthly_plan_id=$1 AND applicant_role=$2 AND delete_status='DRAFT' ORDER BY deletion_id`, [plan.monthly_plan_id, currentRole])).rows, keys = [...new Set(selectedItemKeys.map(String))]
      if (!keys.length) fail(400, '请至少勾选一项自己的待提交变更后再提交'); const byKey = new Map(draftCandidates.map(row => [row.stable_item_key, { kind: 'ITEM', row }])); for (const row of deletionCandidates) { if (byKey.has(row.stable_item_key)) fail(409, '同一车辆存在冲突的修改和删除事项，请先保留其中一种'); byKey.set(row.stable_item_key, { kind: 'DELETE', row }) } const selected = keys.map(key => byKey.get(key)).filter(Boolean); if (selected.length !== keys.length) fail(403, '只能提交当前模拟角色拥有的可提交变更事项')
      const type = plan.current_published_version_id ? 'ADJUSTMENT' : 'INITIAL'; if (type === 'ADJUSTMENT' && !String(adjustReason || '').trim()) fail(400, '已发布计划再次申请时必须填写调整原因'); const version = await createVersion(client, plan, currentRole, 'SUBMITTED'), app = (await client.query(`INSERT INTO ${q('monthly_plan_application')}(monthly_plan_id,submitted_version_id,applicant_role,application_type,application_status,application_note,adjust_reason) VALUES($1,$2,$3,$4,'PENDING_REVIEW',$5,$6) RETURNING *`, [plan.monthly_plan_id, version.plan_version_id, currentRole, type, String(note || '').trim() || null, String(adjustReason || '').trim() || null])).rows[0]
      for (const selectedChange of selected) {
        if (selectedChange.kind === 'DELETE') {
          const deletion = selectedChange.row, original = (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE item_id=$1 AND plan_version_id=$2 AND NOT is_cancelled`, [deletion.original_published_item_id, plan.current_published_version_id])).rows[0]
          if (!original) fail(409, '删除标记关联的正式车辆版本已经变化，请取消后重新申请删除')
          const deleteSnapshot = { ...snapshot(original), changeType: 'DELETE', deletionId: Number(deletion.deletion_id), deleteReason: deletion.delete_reason, deleteNote: deletion.delete_note }
          await client.query(`INSERT INTO ${q('monthly_plan_application_item')}(application_id,deletion_id,stable_item_key,original_snapshot,submitted_snapshot,reviewed_snapshot,change_type) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$5::jsonb,'DELETE')`, [app.application_id, deletion.deletion_id, deletion.stable_item_key, JSON.stringify(snapshot(original)), JSON.stringify(deleteSnapshot)])
          await client.query(`UPDATE ${q('monthly_plan_deletion')} SET delete_status='SUBMITTED',application_id=$2,updated_at=now() WHERE deletion_id=$1`, [deletion.deletion_id, app.application_id])
        } else {
          const row = selectedChange.row, submitted = await copyRow(client, version.plan_version_id, row, row.change_type)
          const original = plan.current_published_version_id && row.change_type !== 'ADDED' ? (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND stable_item_key=$2`, [plan.current_published_version_id, row.stable_item_key])).rows[0] : null
          await client.query(`INSERT INTO ${q('monthly_plan_application_item')}(application_id,draft_item_id,submitted_item_id,stable_item_key,original_snapshot,submitted_snapshot,reviewed_snapshot,change_type) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$6::jsonb,$7)`, [app.application_id, row.item_id, submitted.item_id, row.stable_item_key, original ? JSON.stringify(snapshot(original)) : null, JSON.stringify(snapshot(row)), row.change_type])
        }
      }
      await approval(client, app.application_id, 1, 'SECTION_CHIEF', 'PENDING'); await commitMutation(client); return { applicationId: Number(app.application_id), selectedCount: selected.length, status: 'PENDING_REVIEW', statusText: '待审核' }
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
  async function withdraw({ year, month, role }) { const p = period(year, month), currentRole = roleOf(role), client = await pool.connect(); try { await beginMutation(client); const plan = (await client.query(`SELECT * FROM ${q('monthly_plan')} WHERE plan_year=$1 AND plan_month=$2 FOR UPDATE`, [p.year, p.month])).rows[0]; if (!plan) fail(404, '本月计划不存在'); const app = await activeApp(client, plan.monthly_plan_id, true); if (!app) fail(409, '没有可撤回的审核申请'); if (app.applicant_role !== currentRole) fail(403, '只能由申请角色撤回'); if (app.application_type !== 'PUBLISH') await restoreDraft(client, app); await client.query(`UPDATE ${q('monthly_plan_application')} SET application_status='WITHDRAWN',withdrawn_at=now() WHERE application_id=$1`, [app.application_id]); await client.query(`UPDATE ${q('monthly_plan_version')} SET version_status='WITHDRAWN' WHERE plan_version_id=$1`, [app.submitted_version_id]); await approval(client, app.application_id, 1, currentRole, 'WITHDRAWN', '申请人撤回申请'); await commitMutation(client); return { status: 'WITHDRAWN', statusText: '已撤回' } } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() } }

  async function takeover({ year, month, role, reason }) {
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

  function validate(values, p, original = {}) { const text = (key, max) => { const value = String(values?.[key] ?? original[key] ?? '').trim(); if (value.length > max) fail(400, `${key}内容过长`); return value || null }; const locomotiveNo = text('locomotiveNo', 64); if (!locomotiveNo) fail(400, '机车编号不能为空'); const repairProgramId = Number(values?.repairProgramId ?? original.repairProgramId); if (!Number.isSafeInteger(repairProgramId)) fail(400, '请选择有效修程'); const entry = String(values?.plannedEntryAt || original.plannedEntryAt || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(entry) || !entry.startsWith(`${p.year}-${String(p.month).padStart(2, '0')}-`)) fail(400, '计划入段日期必须属于当前月份'); const sequenceValue = values?.repairSequence === '' ? null : (values?.repairSequence ?? original.repairSequence), mileageValue = values?.mileageKm === '' ? null : (values?.mileageKm ?? original.mileageKm), repairSequence = sequenceValue == null ? null : Number(sequenceValue), mileageKm = mileageValue == null ? null : Number(mileageValue); if (repairSequence != null && (!Number.isSafeInteger(repairSequence) || repairSequence < 1)) fail(400, '修次必须是正整数'); if (mileageKm != null && (!Number.isFinite(mileageKm) || mileageKm < 0)) fail(400, '累计走行公里必须是非负数'); return { locomotiveNo, repairProgramId, plannedEntryAt: entry, ownerBureau: text('ownerBureau', 64), ownerDepot: text('ownerDepot', 64), repairSequence, mileageKm, remark: text('remark', 500) } }
  async function updateRow(client, id, data, changeReason = null) { return (await client.query(`UPDATE ${q('monthly_plan_item')} SET locomotive_no=$2,repair_program_id=$3,planned_entry_at=$4::date,owner_bureau=$5,owner_depot=$6,repair_sequence=$7,mileage_km=$8,remark=$9,change_reason=COALESCE($10,change_reason),change_type=CASE WHEN change_type='ADDED' THEN 'ADDED' ELSE 'MODIFIED' END,is_cancelled=false WHERE item_id=$1 RETURNING *`, [id, data.locomotiveNo, data.repairProgramId, data.plannedEntryAt, data.ownerBureau, data.ownerDepot, data.repairSequence, data.mileageKm, data.remark, changeReason])).rows[0] }

  async function updateItem({ year, month, role, vehicleRepairId, values, changeReason, editScope }) {
    const p = period(year, month), currentRole = roleOf(role); if (editScope === 'PUBLISHED') return directEdit({ ...p, role: currentRole, vehicleRepairId, values, changeReason }); const client = await pool.connect()
    try {
      await beginMutation(client); const plan = await ensurePlan(client, p.year, p.month), app = await activeApp(client, plan.monthly_plan_id, true), reviewer = app && ((currentRole === 'SECTION_CHIEF' && app.application_status === 'PENDING_REVIEW') || (currentRole === 'DEPUTY_DIRECTOR' && app.application_status === 'PENDING_PUBLISH'))
      const ownSubmittedKeyRows = app && app.applicant_role === currentRole ? (await client.query(`SELECT i.stable_item_key FROM ${q('monthly_plan_application_item')} ai JOIN ${q('monthly_plan_item')} i ON i.item_id=ai.submitted_item_id WHERE ai.application_id=$1 AND i.vehicle_repair_id=$2`, [app.application_id, Number(vehicleRepairId)])).rows : []
      const ownUnsubmittedDraft = app && !reviewer && ownSubmittedKeyRows.length === 0
      if (app && !reviewer && !ownUnsubmittedDraft) fail(409, '当前申请正在审核，申请内容不能直接修改；请先撤回申请')
      if (reviewer) { if (!String(changeReason || '').trim()) fail(400, '审核修改必须填写修改原因'); const item = (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND vehicle_repair_id=$2 AND NOT is_cancelled FOR UPDATE`, [app.submitted_version_id, Number(vehicleRepairId)])).rows[0]; if (!item) fail(404, '本次申请中没有这辆车'); const ai = (await client.query(`SELECT * FROM ${q('monthly_plan_application_item')} WHERE application_id=$1 AND submitted_item_id=$2 FOR UPDATE`, [app.application_id, item.item_id])).rows[0], before = snapshot(item), updated = await updateRow(client, item.item_id, validate(values, p, before)), after = snapshot(updated), no = Number((await client.query(`SELECT COALESCE(max(revision_no),0)+1 value FROM ${q('monthly_plan_revision_history')} WHERE application_id=$1`, [app.application_id])).rows[0].value); await client.query(`INSERT INTO ${q('monthly_plan_revision_history')}(application_id,application_item_id,revision_no,editor_role,before_data,after_data,change_reason) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`, [app.application_id, ai.application_item_id, no, currentRole, JSON.stringify(before), JSON.stringify(after), String(changeReason).trim()]); await client.query(`UPDATE ${q('monthly_plan_application_item')} SET reviewed_snapshot=$2::jsonb WHERE application_item_id=$1`, [ai.application_item_id, JSON.stringify(after)]); await commitMutation(client); return { statusText: '审核中的车辆已修改，修改历史已保存' } }
      if (currentRole === 'DEPUTY_DIRECTOR') fail(403, '主管副段长修改正式车辆请使用正式计划编辑操作'); const draft = await ensureDraft(client, plan, currentRole); let item = (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND vehicle_repair_id=$2 AND NOT is_cancelled FOR UPDATE`, [draft.plan_version_id, Number(vehicleRepairId)])).rows[0]; if (!item && plan.current_published_version_id) { const published = (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND vehicle_repair_id=$2 AND NOT is_cancelled`, [plan.current_published_version_id, Number(vehicleRepairId)])).rows[0]; if (published) item = await copyRow(client, draft.plan_version_id, published, 'MODIFIED') } if (!item) fail(404, '当前角色草稿中没有这辆车'); const deletionConflict = (await client.query(`SELECT 1 FROM ${q('monthly_plan_deletion')} WHERE monthly_plan_id=$1 AND stable_item_key=$2 AND delete_status IN ('DRAFT','SUBMITTED','REVIEWED')`, [plan.monthly_plan_id, item.stable_item_key])).rowCount; if (deletionConflict) fail(409, '该车辆已有未完成的删除事项，不能同时创建修改副本'); if (plan.current_published_version_id && item.change_type !== 'ADDED' && !String(changeReason || '').trim()) fail(400, '申请修改正式车辆必须填写修改原因'); await updateRow(client, item.item_id, validate(values, p, snapshot(item)), String(changeReason || '').trim() || null); await commitMutation(client); return { statusText: '车辆修改副本已保存，原正式车辆保持不变' }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async function applyDirectEdit({ year, month, role, vehicleRepairId, values, changeReason }) {
    if (role !== 'DEPUTY_DIRECTOR') fail(403, '只有主管副段长可以直接修改正式计划'); if (!String(changeReason || '').trim()) fail(400, '修改正式计划必须填写调整原因'); const client = await pool.connect()
    try { await beginMutation(client); const plan = await ensurePlan(client, year, month); if (await activeApp(client, plan.monthly_plan_id, true)) fail(409, '当前月份有流转中的申请，不能绕过申请直接修改'); if (!plan.current_published_version_id) fail(409, '当前月份还没有正式发布计划'); const baseRows = (await client.query(itemSql, [plan.current_published_version_id])).rows, base = baseRows.find(row => Number(row.vehicle_repair_id) === Number(vehicleRepairId) && !row.is_cancelled); if (!base) fail(404, '正式计划中没有这辆车'); const data = validate(values, { year, month }, snapshot(base)), version = await createVersion(client, plan, role, 'PUBLISHED'); for (const row of baseRows) await copyRow(client, version.plan_version_id, row, row.change_type); await client.query(`UPDATE ${q('monthly_plan_item')} SET locomotive_no=$2,repair_program_id=$3,planned_entry_at=$4::date,owner_bureau=$5,owner_depot=$6,repair_sequence=$7,mileage_km=$8,remark=$9 WHERE plan_version_id=$1 AND vehicle_repair_id=$10`, [version.plan_version_id, data.locomotiveNo, data.repairProgramId, data.plannedEntryAt, data.ownerBureau, data.ownerDepot, data.repairSequence, data.mileageKm, data.remark, Number(vehicleRepairId)]); await client.query(`UPDATE ${q('monthly_plan_version')} SET version_status='SUPERSEDED' WHERE plan_version_id=$1`, [plan.current_published_version_id]); await client.query(`UPDATE ${q('vehicle_repair')} SET locomotive_no=$2,repair_program_id=$3,planned_entry_at=$4::date,owner_bureau=$5,owner_depot=$6,repair_sequence=$7,mileage_km=$8,remark=$9,approval_status='PUBLISHED' WHERE vehicle_repair_id=$1`, [Number(vehicleRepairId), data.locomotiveNo, data.repairProgramId, data.plannedEntryAt, data.ownerBureau, data.ownerDepot, data.repairSequence, data.mileageKm, data.remark]); await client.query(`UPDATE ${q('monthly_plan')} SET current_published_version_id=$1,updated_at=now() WHERE monthly_plan_id=$2`, [version.plan_version_id, plan.monthly_plan_id]); await client.query(`INSERT INTO ${q('monthly_plan_publication_history')}(monthly_plan_id,publish_method,published_by_role,publish_reason,base_version_id,new_version_id) VALUES($1,'DIRECT_MODIFY',$2,$3,$4,$5)`, [plan.monthly_plan_id, role, String(changeReason).trim(), plan.current_published_version_id, version.plan_version_id]); await commitMutation(client); return { statusText: '正式计划已修改并生成新版本' } } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async function directEdit({ year, month, role, vehicleRepairId, values, changeReason }) {
    if (role === 'DEPUTY_DIRECTOR') {
      const p = period(year, month)
      const plan = (await pool.query(`SELECT current_published_version_id FROM ${q('monthly_plan')} WHERE plan_year=$1 AND plan_month=$2`, [year, month])).rows[0]
      if (plan?.current_published_version_id) {
        const base = (await pool.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND vehicle_repair_id=$2 AND NOT is_cancelled`, [plan.current_published_version_id, Number(vehicleRepairId)])).rows[0]
        if (base) {
          const scheduled = Number((await pool.query(`SELECT count(*) value FROM ${q('vehicle_repair_schedule')} WHERE vehicle_repair_id=$1 AND status NOT IN ('CANCELLED','CANCELED')`, [Number(vehicleRepairId)])).rows[0]?.value || 0)
          const after = validate(values, p, snapshot(base))
          if (scheduled && (String(base.planned_entry_at || '').slice(0, 10) !== String(after.plannedEntryAt || '') || Number(base.repair_program_id) !== Number(after.repairProgramId))) fail(409, '该车辆已有正式排程，修改入段日期或修程会影响排程，请先重新排程后再保存')
        }
      }
    }
    return applyDirectEdit({ year, month, role, vehicleRepairId, values, changeReason })
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

  async function deleteItem({ year, month, role, vehicleRepairId, editScope, changeReason, deleteNote, operation, cancelReason }) {
    if (editScope === 'PUBLISHED' && role === 'DEPUTY_DIRECTOR') {
      const scheduled = Number((await pool.query(`SELECT count(*) value FROM ${q('vehicle_repair_schedule')} WHERE vehicle_repair_id=$1 AND status NOT IN ('CANCELLED','CANCELED')`, [Number(vehicleRepairId)])).rows[0]?.value || 0)
      if (scheduled) fail(409, '该车辆已有正式排程，取消前请先确认排程影响并重新排程')
    }
    return applyDeleteItem({ year, month, role, vehicleRepairId, editScope, changeReason, deleteNote, operation, cancelReason })
  }

  async function applyDeleteItem({ year, month, role, vehicleRepairId, editScope, changeReason, deleteNote, operation, cancelReason }) {
    const currentRole = roleOf(role); if (editScope === 'PUBLISHED') { if (currentRole !== 'DEPUTY_DIRECTOR') fail(403, '只有主管副段长可以取消正式计划'); if (!String(changeReason || '').trim()) fail(400, '取消正式计划必须填写取消原因'); const client = await pool.connect(); try { await beginMutation(client); const plan = await ensurePlan(client, year, month); if (await activeApp(client, plan.monthly_plan_id, true)) fail(409, '当前月份有流转中的申请，不能直接取消正式计划'); const rows = (await client.query(itemSql, [plan.current_published_version_id])).rows, target = rows.find(row => Number(row.vehicle_repair_id) === Number(vehicleRepairId) && !row.is_cancelled); if (!target) fail(404, '正式计划中没有这辆车'); const version = await createVersion(client, plan, currentRole, 'PUBLISHED'); for (const row of rows) await copyRow(client, version.plan_version_id, row, row.change_type); await client.query(`UPDATE ${q('monthly_plan_item')} SET is_cancelled=true,change_type='CANCELLED' WHERE plan_version_id=$1 AND vehicle_repair_id=$2`, [version.plan_version_id, Number(vehicleRepairId)]); await client.query(`UPDATE ${q('monthly_plan_version')} SET version_status='SUPERSEDED' WHERE plan_version_id=$1`, [plan.current_published_version_id]); await client.query(`UPDATE ${q('vehicle_repair')} SET status='CANCELLED',approval_status='PUBLISHED' WHERE vehicle_repair_id=$1`, [Number(vehicleRepairId)]); await client.query(`UPDATE ${q('monthly_plan')} SET current_published_version_id=$1,updated_at=now() WHERE monthly_plan_id=$2`, [version.plan_version_id, plan.monthly_plan_id]); await client.query(`INSERT INTO ${q('monthly_plan_publication_history')}(monthly_plan_id,publish_method,published_by_role,publish_reason,base_version_id,new_version_id) VALUES($1,'DIRECT_CANCEL',$2,$3,$4,$5)`, [plan.monthly_plan_id, currentRole, String(changeReason).trim(), plan.current_published_version_id, version.plan_version_id]); await commitMutation(client); return { statusText: '正式车辆已取消，历史版本已保留' } } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() } }
    if (currentRole === 'DEPUTY_DIRECTOR') fail(403, '主管副段长取消正式车辆请使用正式计划操作')
    const client = await pool.connect()
    try {
      await beginMutation(client)
      const plan = await ensurePlan(client, year, month), app = await activeApp(client, plan.monthly_plan_id, true), draft = await ensureDraft(client, plan, currentRole)
      const draftItem = (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND vehicle_repair_id=$2 AND NOT is_cancelled FOR UPDATE`, [draft.plan_version_id, Number(vehicleRepairId)])).rows[0]
      if (draftItem?.change_type === 'ADDED') {
        if (app && (await client.query(`SELECT 1 FROM ${q('monthly_plan_application_item')} WHERE application_id=$1 AND draft_item_id=$2`, [app.application_id, draftItem.item_id])).rowCount) fail(409, '新增草稿已提交审核，请先撤回申请')
        await client.query(`DELETE FROM ${q('monthly_plan_item')} WHERE item_id=$1`, [draftItem.item_id])
        await commitMutation(client); return { statusText: '新增车辆已从待提交变更中删除' }
      }
      if (draftItem?.change_type === 'MODIFIED') {
        if (app && (await client.query(`SELECT 1 FROM ${q('monthly_plan_application_item')} WHERE application_id=$1 AND draft_item_id=$2`, [app.application_id, draftItem.item_id])).rowCount) fail(409, '修改副本已提交审核，请先撤回整份申请')
        const original = plan.current_published_version_id ? (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND stable_item_key=$2 AND NOT is_cancelled`, [plan.current_published_version_id, draftItem.stable_item_key])).rows[0] : null
        if (!original) fail(409, '原正式车辆已发生变化，不能直接取消修改副本')
        await client.query(`UPDATE ${q('monthly_plan_item')} SET vehicle_repair_id=$2,locomotive_no=$3,repair_program_id=$4,planned_entry_at=$5,owner_bureau=$6,owner_depot=$7,repair_sequence=$8,mileage_km=$9,remark=$10,change_reason=NULL,change_type='UNCHANGED',is_cancelled=false WHERE item_id=$1`, [draftItem.item_id, original.vehicle_repair_id, original.locomotive_no, original.repair_program_id, original.planned_entry_at, original.owner_bureau, original.owner_depot, original.repair_sequence, original.mileage_km, original.remark])
        await commitMutation(client); return { statusText: '修改副本已取消，原正式车辆保持不变' }
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
      const deletion = (await client.query(`INSERT INTO ${q('monthly_plan_deletion')}(monthly_plan_id,original_published_item_id,stable_item_key,applicant_role,delete_reason,delete_note) VALUES($1,$2,$3,$4,$5,$6) RETURNING deletion_id`, [plan.monthly_plan_id, published.item_id, published.stable_item_key, currentRole, String(changeReason).trim(), String(deleteNote || '').trim() || null])).rows[0]
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
    const baseId = plan.current_published_version_id, baseRows = baseId ? (await client.query(itemSql, [baseId])).rows : [], submittedRows = (await client.query(itemSql, [app.submitted_version_id])).rows, deletionItems = (await client.query(`SELECT ai.*,d.original_published_item_id,d.delete_reason FROM ${q('monthly_plan_application_item')} ai JOIN ${q('monthly_plan_deletion')} d ON d.deletion_id=ai.deletion_id WHERE ai.application_id=$1 AND ai.change_type='DELETE' ORDER BY ai.application_item_id`, [app.application_id])).rows, version = await createVersion(client, plan, role, 'PUBLISHED', baseId)
    for (const row of baseRows) await copyRow(client, version.plan_version_id, row, row.change_type)
    for (const row of submittedRows) { const old = (await client.query(`SELECT item_id FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND stable_item_key=$2`, [version.plan_version_id, row.stable_item_key])).rows[0]; if (old) await client.query(`UPDATE ${q('monthly_plan_item')} SET vehicle_repair_id=$2,locomotive_no=$3,repair_program_id=$4,planned_entry_at=$5,owner_bureau=$6,owner_depot=$7,repair_sequence=$8,mileage_km=$9,remark=$10,change_reason=$11,change_type=$12,is_cancelled=$13 WHERE item_id=$1`, [old.item_id, row.vehicle_repair_id, row.locomotive_no, row.repair_program_id, row.planned_entry_at, row.owner_bureau, row.owner_depot, row.repair_sequence, row.mileage_km, row.remark, row.change_reason, row.change_type, row.is_cancelled]); else await copyRow(client, version.plan_version_id, row, row.change_type); if (row.vehicle_repair_id != null) { if (row.is_cancelled) await client.query(`UPDATE ${q('vehicle_repair')} SET status='CANCELLED',approval_status='PUBLISHED' WHERE vehicle_repair_id=$1`, [row.vehicle_repair_id]); else await client.query(`UPDATE ${q('vehicle_repair')} SET locomotive_no=$2,repair_program_id=$3,planned_entry_at=$4,owner_bureau=$5,owner_depot=$6,repair_sequence=$7,mileage_km=$8,remark=$9,approval_status='PUBLISHED' WHERE vehicle_repair_id=$1`, [row.vehicle_repair_id, row.locomotive_no, row.repair_program_id, row.planned_entry_at, row.owner_bureau, row.owner_depot, row.repair_sequence, row.mileage_km, row.remark]) } }
    for (const deletion of deletionItems) {
      const target = (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND stable_item_key=$2 AND NOT is_cancelled FOR UPDATE`, [version.plan_version_id, deletion.stable_item_key])).rows[0]
      if (!target) fail(409, '删除事项关联的正式车辆已发生变化，不能发布')
      const activeSchedules = Number((await client.query(`SELECT count(*) value FROM ${q('vehicle_repair_schedule')} WHERE vehicle_repair_id=$1 AND status NOT IN ('CANCELLED','CANCELED')`, [target.vehicle_repair_id])).rows[0]?.value || 0)
      if (activeSchedules) fail(409, `车辆 ${target.locomotive_no} 已有正式排程，请先按排程业务规则处理后再发布删除`)
      await client.query(`UPDATE ${q('monthly_plan_item')} SET is_cancelled=true,change_type='CANCELLED',change_reason=$2 WHERE item_id=$1`, [target.item_id, deletion.delete_reason])
      await client.query(`UPDATE ${q('vehicle_repair')} SET status='CANCELLED',approval_status='PUBLISHED' WHERE vehicle_repair_id=$1`, [target.vehicle_repair_id])
      await client.query(`UPDATE ${q('monthly_plan_deletion')} SET delete_status='PUBLISHED',published_at=now(),updated_at=now() WHERE deletion_id=$1`, [deletion.deletion_id])
    }
    await syncApplicantDraft(client, app, submittedRows)
    await syncReviewedSourceDrafts(client, plan, submittedRows, app)
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
    await client.query(`INSERT INTO ${q('monthly_plan_publication_history')}(monthly_plan_id,application_id,publish_method,published_by_role,publish_reason,base_version_id,new_version_id) VALUES($1,$2,$3,$4,$5,$6,$7)`, [plan.monthly_plan_id, app.application_id, method, role, reason, baseId, version.plan_version_id])
    return version
  }
  async function directPublish({ year, month, role, note, selectedItemKeys }) { const currentRole = roleOf(role); if (currentRole !== 'DEPUTY_DIRECTOR') fail(403, '只有主管副段长可以直接发布自己的草稿'); if (!Array.isArray(selectedItemKeys)) fail(400, '必须明确选择本次直接发布的草稿车辆'); const client = await pool.connect(); try { await beginMutation(client); const plan = await ensurePlan(client, year, month); if (await activeApp(client, plan.monthly_plan_id, true)) fail(409, '当前月份已有流转中的申请，不能直接发布'); const draft = await ensureDraft(client, plan, currentRole), allDraftRows = (await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 ORDER BY item_id`, [draft.plan_version_id])).rows, candidates = plan.current_published_version_id ? allDraftRows.filter(row => row.change_type !== 'UNCHANGED') : allDraftRows, keys = [...new Set(selectedItemKeys.map(String))]; if (!keys.length) fail(400, '请至少勾选一辆自己的草稿车辆后再直接发布'); const selected = keys.map(key => candidates.find(row => row.stable_item_key === key)).filter(Boolean); if (selected.length !== keys.length) fail(403, '只能直接发布当前角色拥有的草稿车辆'); const version = await createVersion(client, plan, currentRole, 'SUBMITTED'), app = (await client.query(`INSERT INTO ${q('monthly_plan_application')}(monthly_plan_id,submitted_version_id,applicant_role,application_type,application_status,application_note) VALUES($1,$2,$3,$4,'PENDING_PUBLISH',$5) RETURNING *`, [plan.monthly_plan_id, version.plan_version_id, currentRole, plan.current_published_version_id ? 'ADJUSTMENT' : 'INITIAL', String(note || '').trim() || '主管副段长直接发布'])).rows[0]; for (const row of selected) { const submitted = await copyRow(client, version.plan_version_id, row, row.change_type); await client.query(`INSERT INTO ${q('monthly_plan_application_item')}(application_id,draft_item_id,submitted_item_id,stable_item_key,submitted_snapshot,reviewed_snapshot,change_type) VALUES($1,$2,$3,$4,$5::jsonb,$5::jsonb,$6)`, [app.application_id, row.item_id, submitted.item_id, row.stable_item_key, JSON.stringify(snapshot(row)), row.change_type]) } await publishApp(client, plan, app, currentRole, 'DIRECT_PUBLISH', String(note || '').trim() || '主管副段长直接发布'); await approval(client, app.application_id, 2, currentRole, 'APPROVED', '主管副段长直接发布'); await commitMutation(client); return { status: 'PUBLISHED', statusText: '已发布', selectedCount: selected.length } } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() } }
  async function decide({ year, month, role, action, reason }) { const currentRole = roleOf(role), client = await pool.connect(); try { await beginMutation(client); const plan = (await client.query(`SELECT * FROM ${q('monthly_plan')} WHERE plan_year=$1 AND plan_month=$2 FOR UPDATE`, [year, month])).rows[0]; if (!plan) fail(404, '本月计划不存在'); const app = await activeApp(client, plan.monthly_plan_id, true); if (!app) fail(409, '没有待处理的审核申请'); if (action === 'REJECT') { if (!String(reason || '').trim()) fail(400, '驳回时必须填写原因'); if (currentRole === 'SECTION_CHIEF' && app.application_status !== 'PENDING_REVIEW') fail(403, '当前不在科长审核环节'); if (currentRole === 'DEPUTY_DIRECTOR' && app.application_status !== 'PENDING_PUBLISH') fail(403, '当前不在副段长发布环节'); await restoreDraft(client, app); await client.query(`UPDATE ${q('monthly_plan_application')} SET application_status='REJECTED',application_note=concat_ws(E'\n',application_note,$2::text),rejected_at=now() WHERE application_id=$1`, [app.application_id, String(reason).trim()]); await client.query(`UPDATE ${q('monthly_plan_version')} SET version_status='REJECTED' WHERE plan_version_id=$1`, [app.submitted_version_id]); await approval(client, app.application_id, currentRole === 'SECTION_CHIEF' ? 1 : 2, currentRole, 'REJECTED', String(reason).trim()); await commitMutation(client); return { status: 'REJECTED', statusText: '已驳回' } } if (currentRole === 'SECTION_CHIEF') { if (app.application_status !== 'PENDING_REVIEW') fail(409, '该申请不在待审核状态'); await client.query(`UPDATE ${q('monthly_plan_application')} SET application_status='REVIEWED' WHERE application_id=$1`, [app.application_id]); await client.query(`UPDATE ${q('monthly_plan_deletion')} SET delete_status='REVIEWED',updated_at=now() WHERE application_id=$1 AND delete_status='SUBMITTED'`, [app.application_id]); await client.query(`UPDATE ${q('monthly_plan_version')} SET version_status='REVIEWED' WHERE plan_version_id=$1`, [app.submitted_version_id]); await approval(client, app.application_id, 1, currentRole, 'APPROVED', '科长审核通过，等待选择申请发布'); await commitMutation(client); return { status: 'REVIEWED', statusText: '已审核待申请发布' } } if (currentRole !== 'DEPUTY_DIRECTOR' || app.application_status !== 'PENDING_PUBLISH') fail(403, '只有主管副段长可以发布科长申请发布的计划'); await publishApp(client, plan, app, currentRole, 'NORMAL_APPROVAL', String(reason || '').trim() || '审批发布'); await approval(client, app.application_id, 2, currentRole, 'APPROVED', String(reason || '').trim() || '审批发布'); await commitMutation(client); return { status: 'PUBLISHED', statusText: '已发布' } } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() } }
  async function requestPublish({ year, month, role, note, adjustReason, selectedItemKeys }) {
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
  async function isVehiclePublished(vehicleRepairId) { const result = await pool.query(`SELECT 1 FROM ${q('monthly_plan')} p JOIN ${q('monthly_plan_item')} i ON i.plan_version_id=p.current_published_version_id WHERE i.vehicle_repair_id=$1 AND NOT i.is_cancelled`, [Number(vehicleRepairId)]); return Boolean(result.rowCount) }
  async function todos({ role }) { const currentRole = roleOf(role), status = currentRole === 'SECTION_CHIEF' ? 'PENDING_REVIEW' : currentRole === 'DEPUTY_DIRECTOR' ? 'PENDING_PUBLISH' : null; if (!status) return { items: [] }; const rows = (await pool.query(`SELECT a.application_id,a.application_status,a.submitted_at,p.plan_year,p.plan_month,p.plan_title,(SELECT count(*)::int FROM ${q('monthly_plan_application_item')} ai WHERE ai.application_id=a.application_id) vehicle_count FROM ${q('monthly_plan_application')} a JOIN ${q('monthly_plan')} p ON p.monthly_plan_id=a.monthly_plan_id WHERE a.application_status=$1 ORDER BY a.submitted_at,p.plan_year,p.plan_month`, [status])).rows; return { items: rows.map(row => ({ id: Number(row.application_id), year: row.plan_year, month: row.plan_month, title: row.plan_title, status: row.application_status, submittedAt: row.submitted_at, vehicleCount: Number(row.vehicle_count) })) } }
  return { read, setTitle, submit, requestPublish, withdraw, takeover, updateItem, updateDeletion, deleteItem, directPublish, decide, todos, isVehiclePublished }
}
