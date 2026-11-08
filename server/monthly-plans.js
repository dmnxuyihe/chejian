const roles = new Set(['PLANNER', 'SECTION_CHIEF', 'DEPUTY_DIRECTOR'])
const activeStatuses = ['PENDING_REVIEW', 'PENDING_PUBLISH']

function fail(status, message) {
  throw Object.assign(new Error(message), { status })
}

function roleOf(value) {
  const role = String(value || 'PLANNER').toUpperCase()
  if (!roles.has(role)) fail(400, '模拟角色无效')
  return role
}

function period(year, month) {
  const y = Number(year), m = Number(month)
  if (!Number.isInteger(y) || y < 1900 || y > 2199 || !Number.isInteger(m) || m < 1 || m > 12) fail(400, '请选择有效年月')
  return { year: y, month: m }
}

/*
 * 月度计划只保留 v2 状态机。旧实现曾把整月状态、车辆审批状态和排程状态
 * 混为一体，已不再作为可调用服务导出。
 */
function createMonthlyPlanServiceLegacy(database) {
  const { pool, schema } = database
  const q = name => `"${schema}"."${name}"`

  async function ensurePlan(client, year, month) {
    return (await client.query(`
      INSERT INTO ${q('monthly_plan')}(plan_year,plan_month,plan_title,title_source)
      VALUES($1,$2,$3,'DEFAULT')
      ON CONFLICT(plan_year,plan_month) DO UPDATE SET updated_at=${q('monthly_plan')}.updated_at
      RETURNING *`, [year, month, `${year}年${month}月检修计划`])).rows[0]
  }

  async function ensureDraft(client, plan, role) {
    let draft = (await client.query(`SELECT * FROM ${q('monthly_plan_version')} WHERE monthly_plan_id=$1 AND owner_role=$2 AND version_status='DRAFT' ORDER BY version_no DESC LIMIT 1`, [plan.monthly_plan_id, role])).rows[0]
    if (draft) return draft
    const number = Number((await client.query(`SELECT COALESCE(max(version_no),0)+1 AS value FROM ${q('monthly_plan_version')} WHERE monthly_plan_id=$1`, [plan.monthly_plan_id])).rows[0].value)
    draft = (await client.query(`INSERT INTO ${q('monthly_plan_version')}(monthly_plan_id,version_no,base_version_id,owner_role,version_status,snapshot_title) VALUES($1,$2,$3,$4,'DRAFT',$5) RETURNING *`, [plan.monthly_plan_id, number, plan.current_published_version_id, role, plan.plan_title])).rows[0]
    if (plan.current_published_version_id) await client.query(`
      INSERT INTO ${q('monthly_plan_item')}(plan_version_id,stable_item_key,vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,repair_sequence,mileage_km,remark,change_type,is_cancelled)
      SELECT $1,stable_item_key,vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,repair_sequence,mileage_km,remark,'UNCHANGED',is_cancelled
      FROM ${q('monthly_plan_item')} WHERE plan_version_id=$2`, [draft.plan_version_id, plan.current_published_version_id])
    return draft
  }

  async function application(client, planId) {
    return (await client.query(`SELECT * FROM ${q('monthly_plan_application')} WHERE monthly_plan_id=$1 ORDER BY application_id DESC LIMIT 1`, [planId])).rows[0] || null
  }

  function displayStatus(plan, app, hasDraft) {
    const published=Boolean(plan.current_published_version_id)
    if (app?.application_status === 'PENDING_REVIEW') return published?'部分待审核':'待审核'
    if (app?.application_status === 'PENDING_PUBLISH') return published?'部分待发布':'待发布'
    if (app?.application_status === 'REJECTED') return published ? '部分已驳回' : '已驳回'
    if (plan.current_published_version_id) return '已发布'
    return hasDraft ? '编制中' : '编制中'
  }

  async function read({ year, month, role }) {
    const p = period(year, month), currentRole = roleOf(role)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const plan = await ensurePlan(client, p.year, p.month)
      const draft = await ensureDraft(client, plan, currentRole)
      const app = await application(client, plan.monthly_plan_id)
      const itemQuery = `
        SELECT i.*,rp.repair_program_name,lm.model_id,lm.model_name
        FROM ${q('monthly_plan_item')} i
        JOIN ${q('repair_program')} rp ON rp.repair_program_id=i.repair_program_id
        JOIN ${q('locomotive_model')} lm ON lm.model_id=rp.model_id
        WHERE i.plan_version_id=$1
        ORDER BY i.planned_entry_at,i.locomotive_no,i.item_id`
      const active = Boolean(app && activeStatuses.includes(app.application_status))
      const publishedRows = plan.current_published_version_id ? (await client.query(itemQuery, [plan.current_published_version_id])).rows : []
      const submittedRows = active ? (await client.query(itemQuery, [app.submitted_version_id])).rows : []
      const draftRows = (await client.query(itemQuery, [draft.plan_version_id])).rows
      const changed = row => row.change_type !== 'UNCHANGED' || row.is_cancelled
      const mapItem = (row, flags = {}) => ({ id:Number(row.item_id), stableItemKey:row.stable_item_key, vehicleRepairId:row.vehicle_repair_id == null ? null : Number(row.vehicle_repair_id), locomotiveNo:row.locomotive_no, repairProgramId:Number(row.repair_program_id), repairProgramName:row.repair_program_name, modelId:Number(row.model_id), modelName:row.model_name, plannedEntryAt:String(row.planned_entry_at).replace(' ','T'), ownerBureau:row.owner_bureau, ownerDepot:row.owner_depot, repairSequence:row.repair_sequence, mileageKm:row.mileage_km == null ? null : Number(row.mileage_km), remark:row.remark, changeType:row.change_type, isCancelled:Boolean(row.is_cancelled), ...flags })
      let displayRows = active && plan.current_published_version_id
        ? [...publishedRows.filter(row => !row.is_cancelled).map(row => mapItem(row, { isPublished:true, approvalStatus:'PUBLISHED' })), ...submittedRows.filter(changed).map(row => mapItem(row, { isPending:true, isChanged:true, approvalStatus:app.application_status === 'PENDING_REVIEW' ? 'SUBMITTED' : 'REVIEWED' }))]
        : active
          ? submittedRows.filter(row => !row.is_cancelled).map(row => mapItem(row, { isPending:true, isChanged:true, approvalStatus:app.application_status === 'PENDING_REVIEW' ? 'SUBMITTED' : 'REVIEWED' }))
          : plan.current_published_version_id
            ? publishedRows.filter(row => !row.is_cancelled).map(row => mapItem(row, { isPublished:true, approvalStatus:'PUBLISHED' }))
            : draftRows.filter(row => !row.is_cancelled).map(row => mapItem(row, { isDraft:true, isChanged:true, approvalStatus:'DRAFT' }))
      const draftOnlyRows = plan.current_published_version_id || active ? draftRows.filter(changed) : []
      for (const row of draftOnlyRows) {
        const draftItem = mapItem(row, { isDraft:true, isChanged:true, approvalStatus:'DRAFT' })
        const index = displayRows.findIndex(item => item.vehicleRepairId === draftItem.vehicleRepairId)
        if (index >= 0) displayRows[index] = draftItem
        else displayRows.push(draftItem)
      }
      await client.query('COMMIT')
      return {
        planId: Number(plan.monthly_plan_id), year: p.year, month: p.month, title: plan.plan_title,
        role: currentRole, status: displayStatus(plan, app, true), hasPublishedVersion: Boolean(plan.current_published_version_id),
        hasOwnDraft: true, draftNotice: Boolean(plan.current_published_version_id && draft),
        application: app ? { id:Number(app.application_id), applicantRole:app.applicant_role, status:app.application_status, type:app.application_type, note:app.application_note, adjustReason:app.adjust_reason, submittedAt:app.submitted_at } : null,
        readOnly: Boolean(app && activeStatuses.includes(app.application_status)),
        items: displayRows,
        draftItems: draftOnlyRows.map(row => mapItem(row, { isDraft:true, isChanged:true, approvalStatus:'DRAFT' }))
      }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async function setTitle({ year, month, role, title }) {
    const p = period(year, month); roleOf(role)
    const value = String(title || '').trim()
    if (!value || value.length > 255) fail(400, '计划标题应为1至255个字符')
    const result = await pool.query(`UPDATE ${q('monthly_plan')} SET plan_title=$3,title_source='MANUAL',last_title_updated_at=now(),updated_at=now() WHERE plan_year=$1 AND plan_month=$2 RETURNING monthly_plan_id`, [p.year,p.month,value])
    if (!result.rowCount) { const client=await pool.connect(); try { await client.query('BEGIN'); const plan=await ensurePlan(client,p.year,p.month); await client.query(`UPDATE ${q('monthly_plan')} SET plan_title=$2,title_source='MANUAL',last_title_updated_at=now(),updated_at=now() WHERE monthly_plan_id=$1`,[plan.monthly_plan_id,value]); await client.query('COMMIT') } catch(e){await client.query('ROLLBACK');throw e} finally{client.release()} }
    return { title:value }
  }

  async function submit({ year, month, role, note, adjustReason }) {
    const p=period(year,month), currentRole=roleOf(role)
    if (!['PLANNER','SECTION_CHIEF'].includes(currentRole)) fail(403,'主管副段长只负责最终发布，不能发起申请')
    const client=await pool.connect()
    try {
      await client.query('BEGIN')
      const plan=await ensurePlan(client,p.year,p.month)
      await client.query(`SELECT monthly_plan_id FROM ${q('monthly_plan')} WHERE monthly_plan_id=$1 FOR UPDATE`,[plan.monthly_plan_id])
      const active=(await client.query(`SELECT 1 FROM ${q('monthly_plan_application')} WHERE monthly_plan_id=$1 AND application_status=ANY($2)`,[plan.monthly_plan_id,activeStatuses])).rowCount
      if(active) fail(409,'本月已有流转中的审核申请')
      const draft=await ensureDraft(client,plan,currentRole)
      const count=Number((await client.query(`SELECT count(*) FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND NOT is_cancelled`,[draft.plan_version_id])).rows[0].count)
      if(!count) fail(400,'当前角色的月度计划草稿没有车辆，不能申请审核发布')
      const type=plan.current_published_version_id?'ADJUSTMENT':'INITIAL'
      if(type==='ADJUSTMENT'&&!String(adjustReason||'').trim()) fail(400,'已发布计划再次申请时必须填写调整原因')
      await client.query(`UPDATE ${q('monthly_plan_version')} SET version_status='SUBMITTED',snapshot_title=$2,submitted_at=now() WHERE plan_version_id=$1`,[draft.plan_version_id,plan.plan_title])
      const app=(await client.query(`INSERT INTO ${q('monthly_plan_application')}(monthly_plan_id,submitted_version_id,applicant_role,application_type,application_status,application_note,adjust_reason) VALUES($1,$2,$3,$4,'PENDING_REVIEW',$5,$6) RETURNING application_id`,[plan.monthly_plan_id,draft.plan_version_id,currentRole,type,String(note||'').trim()||null,String(adjustReason||'').trim()||null])).rows[0]
      await client.query('COMMIT'); return { applicationId:Number(app.application_id), status:'PENDING_REVIEW', statusText:'待审核' }
    } catch(e){await client.query('ROLLBACK');throw e} finally{client.release()}
  }

  async function withdraw({ year,month,role }) {
    const p=period(year,month),currentRole=roleOf(role),client=await pool.connect()
    try{await client.query('BEGIN');const plan=(await client.query(`SELECT * FROM ${q('monthly_plan')} WHERE plan_year=$1 AND plan_month=$2 FOR UPDATE`,[p.year,p.month])).rows[0];if(!plan)fail(404,'本月计划不存在');const app=(await client.query(`SELECT * FROM ${q('monthly_plan_application')} WHERE monthly_plan_id=$1 AND application_status=ANY($2) FOR UPDATE`,[plan.monthly_plan_id,activeStatuses])).rows[0];if(!app)fail(409,'没有可撤回的申请');if(app.applicant_role!==currentRole)fail(403,'只能由申请角色撤回');await client.query(`UPDATE ${q('monthly_plan_application')} SET application_status='WITHDRAWN',withdrawn_at=now() WHERE application_id=$1`,[app.application_id]);await client.query(`UPDATE ${q('monthly_plan_version')} SET version_status='WITHDRAWN' WHERE plan_version_id=$1`,[app.submitted_version_id]);const fresh=await ensureDraft(client,plan,currentRole);await client.query(`INSERT INTO ${q('monthly_plan_item')}(plan_version_id,stable_item_key,vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,repair_sequence,mileage_km,remark,change_type,is_cancelled) SELECT $1,stable_item_key,vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,repair_sequence,mileage_km,remark,change_type,is_cancelled FROM ${q('monthly_plan_item')} WHERE plan_version_id=$2 ON CONFLICT DO NOTHING`,[fresh.plan_version_id,app.submitted_version_id]);await client.query('COMMIT');return{status:'WITHDRAWN',statusText:'已撤回'}}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }

  async function updateItem({year,month,role,vehicleRepairId,values}){
    const p=period(year,month),currentRole=roleOf(role)
    if(currentRole==='DEPUTY_DIRECTOR')fail(403,'主管副段长仅负责最终审批发布，不能修改车辆草稿')
    const client=await pool.connect()
    try{await client.query('BEGIN');const plan=await ensurePlan(client,p.year,p.month);const active=await application(client,plan.monthly_plan_id);if(active&&activeStatuses.includes(active.application_status))fail(409,'当前整月计划正在审核，不能修改车辆');const draft=await ensureDraft(client,plan,currentRole);const item=(await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND vehicle_repair_id=$2 AND NOT is_cancelled FOR UPDATE`,[draft.plan_version_id,Number(vehicleRepairId)])).rows[0];if(!item)fail(404,'当前角色草稿中没有该车辆');const text=(key,max)=>{const value=String(values?.[key]??'').trim();if(value.length>max)fail(400,`${key}内容过长`);return value||null};const locomotiveNo=text('locomotiveNo',64);if(!locomotiveNo)fail(400,'机车编号不能为空');const repairProgramId=Number(values?.repairProgramId);if(!Number.isSafeInteger(repairProgramId))fail(400,'请选择有效修程');const entry=String(values?.plannedEntryAt||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(entry)||!entry.startsWith(`${p.year}-${String(p.month).padStart(2,'0')}-`))fail(400,'计划入段日期必须属于当前月份');const sequence=values?.repairSequence===''||values?.repairSequence==null?null:Number(values.repairSequence),mileage=values?.mileageKm===''||values?.mileageKm==null?null:Number(values.mileageKm);if(sequence!=null&&(!Number.isSafeInteger(sequence)||sequence<1))fail(400,'修次必须是正整数');if(mileage!=null&&(!Number.isFinite(mileage)||mileage<0))fail(400,'累计走行公里必须是非负数');await client.query(`UPDATE ${q('monthly_plan_item')} SET locomotive_no=$2,repair_program_id=$3,planned_entry_at=$4::date,owner_bureau=$5,owner_depot=$6,repair_sequence=$7,mileage_km=$8,remark=$9,change_type=CASE WHEN change_type='ADDED' THEN 'ADDED' ELSE 'MODIFIED' END WHERE item_id=$1`,[item.item_id,locomotiveNo,repairProgramId,entry,text('ownerBureau',64),text('ownerDepot',64),sequence,mileage,text('remark',500)]);await client.query('COMMIT');return{statusText:'车辆草稿已修改'}}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }

  async function deleteItem({year,month,role,vehicleRepairId}){
    const p=period(year,month),currentRole=roleOf(role)
    if(currentRole==='DEPUTY_DIRECTOR')fail(403,'主管副段长仅负责最终审批发布，不能删除车辆草稿')
    const client=await pool.connect()
    try{await client.query('BEGIN');const plan=await ensurePlan(client,p.year,p.month);const active=await application(client,plan.monthly_plan_id);if(active&&activeStatuses.includes(active.application_status))fail(409,'当前整月计划正在审核，不能删除车辆');const draft=await ensureDraft(client,plan,currentRole);const item=(await client.query(`SELECT * FROM ${q('monthly_plan_item')} WHERE plan_version_id=$1 AND vehicle_repair_id=$2 AND NOT is_cancelled FOR UPDATE`,[draft.plan_version_id,Number(vehicleRepairId)])).rows[0];if(!item)fail(404,'当前角色草稿中没有该车辆');if(item.change_type==='ADDED')await client.query(`DELETE FROM ${q('monthly_plan_item')} WHERE item_id=$1`,[item.item_id]);else await client.query(`UPDATE ${q('monthly_plan_item')} SET is_cancelled=true,change_type='CANCELLED' WHERE item_id=$1`,[item.item_id]);await client.query('COMMIT');return{statusText:item.change_type==='ADDED'?'车辆已从草稿删除':'已在草稿中申请取消该车辆'}}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }

  async function decide({ year,month,role,action,reason }) {
    const p=period(year,month),currentRole=roleOf(role),client=await pool.connect()
    try{await client.query('BEGIN');const plan=(await client.query(`SELECT * FROM ${q('monthly_plan')} WHERE plan_year=$1 AND plan_month=$2 FOR UPDATE`,[p.year,p.month])).rows[0];if(!plan)fail(404,'本月计划不存在');const app=(await client.query(`SELECT * FROM ${q('monthly_plan_application')} WHERE monthly_plan_id=$1 AND application_status=ANY($2) FOR UPDATE`,[plan.monthly_plan_id,activeStatuses])).rows[0];if(!app)fail(409,'没有待处理的审核申请')
      if(action==='REJECT'){if(!String(reason||'').trim())fail(400,'驳回时必须填写原因');if(currentRole==='SECTION_CHIEF'&&app.application_status!=='PENDING_REVIEW')fail(403,'当前不在科长审核环节');if(currentRole==='DEPUTY_DIRECTOR'&&app.application_status!=='PENDING_PUBLISH')fail(403,'当前不在发布审批环节');await client.query(`UPDATE ${q('monthly_plan_application')} SET application_status='REJECTED',application_note=concat_ws(E'\n',application_note,$2),rejected_at=now() WHERE application_id=$1`,[app.application_id,String(reason).trim()]);await client.query(`UPDATE ${q('monthly_plan_version')} SET version_status='REJECTED' WHERE plan_version_id=$1`,[app.submitted_version_id]);await client.query('COMMIT');return{status:'REJECTED',statusText:'已驳回'}}
      if(currentRole==='SECTION_CHIEF'){if(app.application_status!=='PENDING_REVIEW')fail(409,'该申请不在待审核状态');await client.query(`UPDATE ${q('monthly_plan_application')} SET application_status='PENDING_PUBLISH' WHERE application_id=$1`,[app.application_id]);await client.query(`UPDATE ${q('monthly_plan_version')} SET version_status='REVIEWED' WHERE plan_version_id=$1`,[app.submitted_version_id]);await client.query('COMMIT');return{status:'PENDING_PUBLISH',statusText:'待发布'}}
      if(currentRole!=='DEPUTY_DIRECTOR'||app.application_status!=='PENDING_PUBLISH')fail(403,'只有主管副段长可以发布科长已审核的计划')
      if(plan.current_published_version_id)await client.query(`UPDATE ${q('monthly_plan_version')} SET version_status='SUPERSEDED' WHERE plan_version_id=$1`,[plan.current_published_version_id])
      await client.query(`UPDATE ${q('vehicle_repair')} vr SET locomotive_no=i.locomotive_no,repair_program_id=i.repair_program_id,planned_entry_at=i.planned_entry_at,owner_bureau=i.owner_bureau,owner_depot=i.owner_depot,repair_sequence=i.repair_sequence,mileage_km=i.mileage_km,remark=i.remark,approval_status='PUBLISHED' FROM ${q('monthly_plan_item')} i WHERE i.plan_version_id=$1 AND NOT i.is_cancelled AND i.vehicle_repair_id=vr.vehicle_repair_id`,[app.submitted_version_id])
      await client.query(`UPDATE ${q('monthly_plan_version')} SET version_status='PUBLISHED',published_at=now() WHERE plan_version_id=$1`,[app.submitted_version_id]);await client.query(`UPDATE ${q('monthly_plan')} SET current_published_version_id=$1,updated_at=now() WHERE monthly_plan_id=$2`,[app.submitted_version_id,plan.monthly_plan_id]);await client.query(`UPDATE ${q('monthly_plan_application')} SET application_status='PUBLISHED',published_at=now() WHERE application_id=$1`,[app.application_id]);await client.query('COMMIT');return{status:'PUBLISHED',statusText:'已发布'}
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  }

  async function isVehiclePublished(vehicleRepairId) {
    const result=await pool.query(`SELECT 1 FROM ${q('monthly_plan')} p JOIN ${q('monthly_plan_item')} i ON i.plan_version_id=p.current_published_version_id WHERE i.vehicle_repair_id=$1 AND NOT i.is_cancelled`,[Number(vehicleRepairId)])
    return Boolean(result.rowCount)
  }

  async function todos({ role }) {
    const currentRole=roleOf(role)
    let status=null
    if(currentRole==='SECTION_CHIEF')status='PENDING_REVIEW'
    if(currentRole==='DEPUTY_DIRECTOR')status='PENDING_PUBLISH'
    if(!status)return{items:[]}
    const result=await pool.query(`SELECT a.application_id,a.application_status,a.submitted_at,p.plan_year,p.plan_month,p.plan_title,(SELECT count(*)::int FROM ${q('monthly_plan_item')} i WHERE i.plan_version_id=a.submitted_version_id AND NOT i.is_cancelled) AS vehicle_count FROM ${q('monthly_plan_application')} a JOIN ${q('monthly_plan')} p ON p.monthly_plan_id=a.monthly_plan_id WHERE a.application_status=$1 ORDER BY a.submitted_at,p.plan_year,p.plan_month`,[status])
    return{items:result.rows.map(row=>({id:Number(row.application_id),year:row.plan_year,month:row.plan_month,title:row.plan_title,status:row.application_status,submittedAt:row.submitted_at,vehicleCount:Number(row.vehicle_count)}))}
  }

  return { read,setTitle,submit,withdraw,updateItem,deleteItem,decide,todos,isVehiclePublished }
}

export { createMonthlyPlanService } from './monthly-plans-v2.js'
