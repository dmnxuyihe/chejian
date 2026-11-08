import { randomUUID } from 'node:crypto'
import { planFields, planHeaders, parsePlanUpload, templateCsv, makeTemplateXlsx, safeCsvCell } from './planning-import.js'

const ttl = 15 * 60 * 1000
const terminal = new Set(['COMPLETED', 'FINISHED', 'CANCELLED', 'CANCELED', 'CLOSED'])
const normalizeText = value => String(value ?? '').trim().normalize('NFC')
const dateOnly = value => value == null ? null : String(value).slice(0, 10)
const httpError = (status, message) => Object.assign(new Error(message), { status })

function parseBusinessDate(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1 || value > 110000) return { value: '', error: 'Excel 日期值无效' }
    const day = Math.floor(value)
    return { value: new Date(Date.UTC(1899, 11, 30) + day * 86400000).toISOString().slice(0, 10), error: '' }
  }
  const raw = String(value ?? '').trim()
  if (!raw) return { value: '', error: '日期不能为空' }
  const match = raw.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/)
  if (!match) return { value: '', error: '日期格式不支持；请填写 YYYY-MM-DD 或 YYYY/MM/DD' }
  const [, year, month, day] = match
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() + 1 !== Number(month) || parsed.getUTCDate() !== Number(day)) return { value: '', error: '日期不存在' }
  return { value: `${year}-${month}-${day}`, error: '' }
}

function addError(row, field, message) {
  row.errors.push({ field, message })
}

function detailedErrorsCsv(rows) {
  const output = [['原始行号', '错误字段', '错误值', '错误原因']]
  for (const row of rows) for (const error of row.errors) output.push([
    row.line,
    error.field,
    row.raw?.[error.field] ?? '',
    error.message,
  ])
  return `\uFEFF${output.map(row => row.map(safeCsvCell).join(',')).join('\r\n')}\r\n`
}

function emptyRow(line, cells) {
  return { line, cells, data: {}, errors: [], status: 'ready', warnings: [] }
}

function normalizeRows(matrix, importType, period, dictionaries) {
  if (!Array.isArray(matrix) || !matrix.length) throw httpError(400, '文件为空，缺少表头')
  const header = matrix[0].map(value => normalizeText(value))
  const seenHeaders = new Set()
  const duplicates = header.filter((value, i) => value && (header.indexOf(value) !== i || seenHeaders.has(value)))
  if (duplicates.length) throw httpError(400, `表头重复：${[...new Set(duplicates)].join('、')}`)
  for (const field of planFields.filter(item => item.required)) if (!header.includes(field.label)) throw httpError(400, `缺少必填列：${field.label}`)
  const indexes = Object.fromEntries(planFields.map(field => [field.key, header.indexOf(field.label)]))
  const extraColumns = header.filter(value => value && !planHeaders.includes(value))
  const rows = []
  for (let i = 1; i < matrix.length; i++) {
    const cells = matrix[i] || []
    if (cells.every(value => normalizeText(value) === '')) continue
    const row = emptyRow(i + 1, cells)
    const get = key => indexes[key] < 0 ? '' : (cells[indexes[key]] ?? '')
    const text = key => normalizeText(get(key))
    row.raw = Object.fromEntries(planFields.map(field => [field.label, get(field.key)]))
    const parsedEntryDate = parseBusinessDate(get('plannedEntryAt'))
    const data = {
      locomotiveNo: typeof get('locomotiveNo') === 'string' ? text('locomotiveNo') : '',
      modelName: text('modelName'),
      repairProgramName: text('repairProgramName'),
      repairSequence: null,
      plannedEntryAt: parsedEntryDate.value,
      ownerBureau: text('ownerBureau'),
      ownerDepot: text('ownerDepot'),
      mileageKm: null,
      remark: text('remark'),
      repairProgramId: null,
    }
    row.data = data
    if (typeof get('locomotiveNo') !== 'string') addError(row, '机车编号', '请将机车编号列设置为文本，不能使用数字格式')
    if (!data.locomotiveNo) addError(row, '机车编号', '机车编号不能为空')
    else if (data.locomotiveNo.length > 64) addError(row, '机车编号', '机车编号不能超过64个字符')
    if (!data.modelName) addError(row, '机型', '机型不能为空')
    else if (data.modelName.length > 64) addError(row, '机型', '机型不能超过64个字符')
    if (!data.repairProgramName) addError(row, '修程', '修程不能为空')
    else if (data.repairProgramName.length > 64) addError(row, '修程', '修程不能超过64个字符')
    const model = dictionaries.modelByName.get(data.modelName)
    if (data.modelName && !model) addError(row, '机型', '机型不在有效字典中')
    const program = model && dictionaries.programByModelAndName.get(`${model.model_id}\0${data.repairProgramName}`)
    if (data.repairProgramName && model && !program) addError(row, '修程', '修程与机型不匹配或不在有效字典中')
    if (program) data.repairProgramId = Number(program.repair_program_id)
    if (!data.plannedEntryAt) addError(row, '计划入段日期', parsedEntryDate.error)
    else if (importType === 'ANNUAL' && !data.plannedEntryAt.startsWith(`${period.year}-`)) addError(row, '计划入段日期', `日期不属于${period.year}年`)
    const sequence = get('repairSequence')
    if (normalizeText(sequence) !== '') {
      const value = typeof sequence === 'number' && Number.isInteger(sequence) ? sequence : /^\d+$/.test(normalizeText(sequence)) ? Number(sequence) : NaN
      if (!Number.isSafeInteger(value) || value < 1) addError(row, '修次', '修次必须是正整数')
      else data.repairSequence = value
    }
    for (const key of ['ownerBureau', 'ownerDepot', 'remark']) {
      const field = planFields.find(item => item.key === key)
      if (data[key].length > field.max) addError(row, field.label, `不能超过${field.max}个字符`)
    }
    const mileage = get('mileageKm')
    if (normalizeText(mileage) !== '') {
      const raw = typeof mileage === 'number' && Number.isFinite(mileage) ? String(mileage) : normalizeText(mileage)
      if (!/^\d+(?:\.\d)?$/.test(raw)) addError(row, '累计走行公里', '必须为非负数，最多1位小数')
      else {
        const value = Number(raw)
        if (!Number.isFinite(value) || value > 99999999999.9) addError(row, '累计走行公里', '超出数据库 DECIMAL(12,1) 范围')
        else data.mileageKm = value
      }
    }
    if (extraColumns.length) row.warnings.push(`未识别列将忽略：${extraColumns.join('、')}`)
    if (row.errors.length) row.status = 'error'
    rows.push(row)
  }
  if (rows.length > 1000) throw httpError(400, '每次最多导入1000条非空计划')
  if (!rows.length) throw httpError(400, '文件没有计划数据')
  markFileDuplicates(rows)
  return rows
}

function naturalKey(row) {
  const d = row.data
  const locomotiveNo = d.locomotiveNo.toLocaleUpperCase('en-US')
  return d.repairProgramId ? `${locomotiveNo}\0${d.repairProgramId}\0${d.plannedEntryAt}` : `${locomotiveNo}\0${d.modelName}\0${d.repairProgramName}\0${d.plannedEntryAt}`
}

function comparisonData(data) {
  return JSON.stringify([data.locomotiveNo, data.repairProgramId, data.modelName, data.repairProgramName, data.repairSequence, data.plannedEntryAt, data.ownerBureau, data.ownerDepot, data.mileageKm, data.remark])
}

function markFileDuplicates(rows) {
  const groups = new Map()
  for (const row of rows) {
    const key = naturalKey(row)
    if (!row.data.locomotiveNo || !row.data.plannedEntryAt) continue
    groups.set(key, [...(groups.get(key) || []), row])
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const contents = new Set(group.map(row => comparisonData(row.data)))
    if (contents.size === 1) {
      for (const row of group.slice(1)) { addError(row, '整行', '与文件内首条记录完全重复，保留首条'); row.status = 'duplicate' }
    } else {
      for (const row of group) { addError(row, '整行', '相同检修识别信息的内容冲突；请修正后重新上传'); row.status = 'conflict' }
    }
  }
  const sameVehicleProgram = new Map()
  for (const row of rows) {
    const d = row.data
    if (!d.locomotiveNo || !d.repairProgramName) continue
    const key = `${d.locomotiveNo.toLocaleUpperCase('en-US')}\0${d.repairProgramId || d.modelName + '\0' + d.repairProgramName}`
    sameVehicleProgram.set(key, [...(sameVehicleProgram.get(key) || []), row])
  }
  for (const group of sameVehicleProgram.values()) {
    if (new Set(group.map(row => row.data.plannedEntryAt).filter(Boolean)).size < 2) continue
    for (const row of group.filter(item => item.status === 'ready' || item.status === 'duplicate')) {
      addError(row, '计划入段日期', '文件内同车同修程存在不同入段日期，可能是计划调整；请核对后分批导入')
      row.status = 'conflict'
    }
  }
}

function counts(preview) {
  const importable = preview.rows.filter(row => row.status === 'ready').length
  return { total: preview.rows.length, importable, errors: preview.rows.length - importable }
}

function publicPreview(preview) {
  const summary = counts(preview)
  return { id: preview.id, importType: preview.importType, importMode:preview.importMode, period: preview.period, suggestedTitle:preview.suggestedTitle, existingTitle:preview.existingTitle, titleConflict:preview.titleConflict, expiresAt: preview.expiresAt, warnings: preview.warnings, ...summary,
    rows: preview.rows.map(({ line, data, raw, errors, warnings, status }) => ({ line, data, raw, errors, warnings, status })) }
}

async function dictionaries(pool, schema) {
  const result = await pool.query(
    `SELECT lm.model_id, lm.model_name, rp.repair_program_id, rp.repair_program_name
       FROM "${schema}".locomotive_model lm
       LEFT JOIN "${schema}".repair_program rp ON rp.model_id=lm.model_id AND rp.status='ENABLED'
      WHERE lm.status='ENABLED' ORDER BY lm.model_name, rp.repair_program_name`)
  const modelByName = new Map()
  const programByModelAndName = new Map()
  for (const row of result.rows) {
    modelByName.set(row.model_name, row)
    if (row.repair_program_id != null) programByModelAndName.set(`${row.model_id}\0${row.repair_program_name}`, row)
  }
  return result.rows.map(row => ({ modelId: Number(row.model_id), modelName: row.model_name, repairProgramId: row.repair_program_id == null ? null : Number(row.repair_program_id), repairProgramName: row.repair_program_name })).reduce((out, row) => {
    out.models.set(row.modelId, { id: row.modelId, name: row.modelName })
    if (row.repairProgramId != null) {
      out.programs.set(row.repairProgramId, { id: row.repairProgramId, name: row.repairProgramName, modelId: row.modelId })
      out.programByModelAndName.set(`${row.modelId}\0${row.repairProgramName}`, { repair_program_id: row.repairProgramId })
    }
    return out
  }, { modelByName, programByModelAndName, models: new Map(), programs: new Map() })
}

async function applyDatabaseConflicts(client, schema, rows) {
  const candidates = rows.filter(row => row.status === 'ready' && row.data.repairProgramId)
  if (!candidates.length) return []
  const locomotiveNos = [...new Set(candidates.map(row => row.data.locomotiveNo.toLocaleUpperCase('en-US')))]
  const result = await client.query(
    `SELECT locomotive_no, repair_program_id, planned_entry_at, status
       FROM "${schema}".vehicle_repair WHERE upper(locomotive_no) = ANY($1::text[])`, [locomotiveNos])
  const existing = result.rows
  const fresh = []
  for (const row of candidates) {
    const same = existing.filter(record => record.locomotive_no.toLocaleUpperCase('en-US') === row.data.locomotiveNo.toLocaleUpperCase('en-US') && Number(record.repair_program_id) === row.data.repairProgramId)
    if (same.some(record => dateOnly(record.planned_entry_at) === row.data.plannedEntryAt)) {
      addError(row, '计划入段日期', '数据库已存在相同机车、修程和入段日期的检修计划；本版只新增、不覆盖')
      row.status = 'error'; fresh.push(row)
    } else if (same.some(record => !terminal.has(String(record.status).toUpperCase()))) {
      addError(row, '计划入段日期', '同车同修程存在未完成计划，日期不同；请先核对计划调整')
      row.status = 'conflict'; fresh.push(row)
    }
  }
  return fresh
}

export function createPlanningService(database) {
  const { pool, schema } = database
  const previews = new Map()
  const qualified = name => `"${schema}"."${name}"`

  function sweep() {
    const now = Date.now()
    for (const [id, value] of previews) if (value.expiresAtMs <= now && !value.commitPromise) previews.delete(id)
  }

  function requirePreview(sessionId, previewId) {
    sweep()
    const preview = previews.get(previewId)
    if (!preview || preview.sessionId !== sessionId) throw httpError(404, '导入预览已取消、过期或不属于当前会话')
    return preview
  }

  function createRowKey(d) { return `${d.locomotiveNo}\0${d.repairProgramId}\0${d.plannedEntryAt}` }

  function applyMonthlyPeriodRule(entry,rows){
    if(entry.importType!=='MONTHLY'||entry.importMode!=='MONTHLY_IMPORT')return
    const target=entry.period.value
    if(rows.some(row=>row.data.plannedEntryAt&&!row.data.plannedEntryAt.startsWith(`${target}-`)))for(const row of rows){addError(row,'计划入段日期',`指定月份导入只能包含${target}的数据；文件存在跨月记录，整批不能导入`);row.status='error'}
  }

  async function calendarRows({ from, to, modelId, programId, locomotiveNo, vehicleId, entryOnly = false, planSource, ownerDepot = '', repairSequence, status = '', approvalStatus = '' }) {
    const result = await pool.query(
      `SELECT vr.vehicle_repair_id, vr.locomotive_no, vr.repair_program_id,
              rp.repair_program_name, lm.model_id, lm.model_name,
              vr.planned_entry_at, vr.planned_exit_at, vr.owner_bureau, vr.owner_depot,
              vr.repair_sequence, vr.mileage_km, vr.plan_source, vr.remark,
              vr.status,
              CASE WHEN EXISTS (
                SELECT 1 FROM ${qualified('monthly_plan')} mp
                JOIN ${qualified('monthly_plan_item')} mpi ON mpi.plan_version_id=mp.current_published_version_id
                WHERE mpi.vehicle_repair_id=vr.vehicle_repair_id AND NOT mpi.is_cancelled
              ) THEN 'PUBLISHED' ELSE 'DRAFT' END AS approval_status,
              vr.current_version_id,
              sv.status AS version_status,
              CASE WHEN sv.status='CURRENT' THEN to_char(exit_task.planned_end_at,'YYYY-MM-DD"T"HH24:MI:SS') ELSE NULL END AS confirmed_exit_at
         FROM ${qualified('vehicle_repair')} vr
         JOIN ${qualified('repair_program')} rp ON rp.repair_program_id=vr.repair_program_id
         JOIN ${qualified('locomotive_model')} lm ON lm.model_id=rp.model_id
         LEFT JOIN ${qualified('schedule_version')} sv ON sv.version_id=vr.current_version_id AND sv.vehicle_repair_id=vr.vehicle_repair_id AND sv.status='CURRENT'
         LEFT JOIN LATERAL (
           SELECT max(s.planned_end_at) AS planned_end_at
             FROM ${qualified('vehicle_repair_schedule')} s
            WHERE s.vehicle_repair_id=vr.vehicle_repair_id AND s.version_id=vr.current_version_id
              AND s.status NOT IN ('CANCELLED','CANCELED')
         ) exit_task ON true
        WHERE vr.status NOT IN ('CANCELLED','CANCELED')
          AND (($6::bigint IS NOT NULL AND vr.vehicle_repair_id=$6) OR ($6::bigint IS NULL AND
            (($7::boolean AND vr.planned_entry_at >= $1::date AND vr.planned_entry_at < ($2::date + interval '1 day')) OR
             (NOT $7::boolean AND ((vr.planned_entry_at >= $1::date AND vr.planned_entry_at < ($2::date + interval '1 day'))
              OR (sv.status='CURRENT' AND exit_task.planned_end_at >= $1::date AND exit_task.planned_end_at < ($2::date + interval '1 day')))))))
          AND ($3::bigint IS NULL OR lm.model_id=$3)
          AND ($4::bigint IS NULL OR rp.repair_program_id=$4)
          AND ($5::text = '' OR vr.locomotive_no ILIKE '%' || $5 || '%')
          AND ($8::text IS NULL OR ($8='NON_ANNUAL' AND vr.plan_source<>'ANNUAL') OR ($8<>'NON_ANNUAL' AND vr.plan_source=$8))
          AND ($9::text = '' OR COALESCE(vr.owner_depot,'') ILIKE '%' || $9 || '%')
          AND ($10::text = '' OR vr.status=$10)
          AND ($11::text = '' OR vr.approval_status=$11)
          AND ($12::integer IS NULL OR vr.repair_sequence=$12)
        ORDER BY vr.planned_entry_at, vr.locomotive_no, vr.vehicle_repair_id`, [from || '1900-01-01', to || '2199-12-31', modelId || null, programId || null, locomotiveNo || '', vehicleId || null, entryOnly, planSource || null, ownerDepot, status, approvalStatus, repairSequence || null])
    return result.rows.map(row => ({
      id: Number(row.vehicle_repair_id), locomotiveNo: row.locomotive_no,
      repairProgramId: Number(row.repair_program_id), repairProgramName: row.repair_program_name,
      modelId: Number(row.model_id), modelName: row.model_name,
      plannedEntryAt: String(row.planned_entry_at).replace(' ', 'T'), entryDate: dateOnly(row.planned_entry_at),
      plannedExitAt: row.confirmed_exit_at, confirmedExitDate: row.confirmed_exit_at?.slice(0, 10) || null,
      ownerBureau: row.owner_bureau, ownerDepot: row.owner_depot,
      repairSequence: row.repair_sequence, mileageKm: row.mileage_km == null ? null : Number(row.mileage_km),
      planSource: row.plan_source, remark: row.remark, status: row.status, approvalStatus: row.approval_status,
      currentVersionId: row.current_version_id == null ? null : Number(row.current_version_id), versionStatus: row.version_status,
    }))
  }

  async function annualRows({ year, depot = '', modelId, programId }) {
    const result = await pool.query(
      `SELECT vr.vehicle_repair_id, vr.locomotive_no, vr.repair_program_id,
              rp.repair_program_name, lm.model_id, lm.model_name,
              vr.planned_entry_at, vr.planned_exit_at, vr.actual_exit_at,
              vr.owner_bureau, vr.owner_depot, vr.repair_sequence, vr.mileage_km,
              vr.plan_source, vr.remark, vr.status, vr.approval_status,
              vr.current_version_id, sv.status AS version_status,
              COALESCE(vr.actual_exit_at,
                CASE WHEN sv.status='CURRENT' THEN exit_task.planned_end_at END,
                vr.planned_exit_at) AS verification_at,
              CASE
                WHEN vr.actual_exit_at IS NOT NULL THEN 'ACTUAL'
                WHEN sv.status='CURRENT' AND exit_task.planned_end_at IS NOT NULL THEN 'SCHEDULED'
                WHEN vr.planned_exit_at IS NOT NULL THEN 'PLANNED'
                ELSE NULL
              END AS verification_source
         FROM ${qualified('vehicle_repair')} vr
         JOIN ${qualified('repair_program')} rp ON rp.repair_program_id=vr.repair_program_id
         JOIN ${qualified('locomotive_model')} lm ON lm.model_id=rp.model_id
         LEFT JOIN ${qualified('schedule_version')} sv ON sv.version_id=vr.current_version_id AND sv.vehicle_repair_id=vr.vehicle_repair_id AND sv.status='CURRENT'
         LEFT JOIN LATERAL (
           SELECT max(s.planned_end_at) AS planned_end_at
             FROM ${qualified('vehicle_repair_schedule')} s
            WHERE s.vehicle_repair_id=vr.vehicle_repair_id AND s.version_id=vr.current_version_id
              AND s.status NOT IN ('CANCELLED','CANCELED')
         ) exit_task ON true
        WHERE vr.status NOT IN ('CANCELLED','CANCELED')
          AND vr.plan_source='ANNUAL'
          AND vr.planned_entry_at >= make_date($1,1,1)
          AND vr.planned_entry_at < make_date($1 + 1,1,1)
          AND ($2::text = '' OR COALESCE(vr.owner_depot,'未填写')=$2)
          AND ($3::bigint IS NULL OR lm.model_id=$3)
          AND ($4::bigint IS NULL OR rp.repair_program_id=$4)
        ORDER BY vr.planned_entry_at, vr.locomotive_no, vr.vehicle_repair_id`,
      [Number(year), depot, modelId || null, programId || null])
    return result.rows.map(row => ({
      id: Number(row.vehicle_repair_id), locomotiveNo: row.locomotive_no,
      repairProgramId: Number(row.repair_program_id), repairProgramName: row.repair_program_name,
      modelId: Number(row.model_id), modelName: row.model_name,
      plannedEntryAt: String(row.planned_entry_at).replace(' ', 'T'), entryDate: dateOnly(row.planned_entry_at),
      plannedExitDate: dateOnly(row.planned_exit_at), actualExitDate: dateOnly(row.actual_exit_at),
      verificationDate: dateOnly(row.verification_at), verificationSource: row.verification_source,
      ownerBureau: row.owner_bureau, ownerDepot: row.owner_depot || '未填写',
      repairSequence: row.repair_sequence, mileageKm: row.mileage_km == null ? null : Number(row.mileage_km),
      planSource: row.plan_source, remark: row.remark, status: row.status, approvalStatus: row.approval_status,
      currentVersionId: row.current_version_id == null ? null : Number(row.current_version_id), versionStatus: row.version_status,
    }))
  }

  function annualStats(rows, year) {
    const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`)
    const depots = [...new Set(rows.map(row => row.ownerDepot || '未填写'))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
    const series = depots.map(depot => ({ depot, values: months.map(month => rows.filter(row => row.ownerDepot === depot && row.verificationDate?.startsWith(month)).length), total: rows.filter(row => row.ownerDepot === depot && row.verificationDate?.startsWith(String(year))).length }))
    const detailMap = new Map()
    for (const row of rows) {
      if (!row.verificationDate?.startsWith(String(year))) continue
      const month = row.verificationDate.slice(0, 7)
      const key = `${month}\0${row.ownerDepot}`
      const detail = detailMap.get(key) || { month, depot: row.ownerDepot, count: 0, locomotives: [] }
      detail.count += 1
      detail.locomotives.push(row.locomotiveNo)
      detailMap.set(key, detail)
    }
    return { months, depots, series, details: [...detailMap.values()].sort((a, b) => a.month.localeCompare(b.month) || a.depot.localeCompare(b.depot, 'zh-CN')) }
  }

  function annualSummary(rows, year) {
    const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`)
    const groups = new Map()
    for (const row of rows) {
      const key = `${row.modelName}\0${row.repairProgramName}`
      const summary = groups.get(key) || { modelName: row.modelName, repairProgramName: row.repairProgramName, values: Array(12).fill(0), total: 0 }
      const index = months.indexOf(row.entryDate?.slice(0, 7))
      if (index >= 0) summary.values[index] += 1
      summary.total += 1
      groups.set(key, summary)
    }
    return { months, rows: [...groups.values()].sort((a, b) => a.modelName.localeCompare(b.modelName, 'zh-CN') || a.repairProgramName.localeCompare(b.repairProgramName, 'zh-CN')) }
  }

  async function preview({ sessionId, importType, year, month, filename, contentBase64, role = 'PLANNER', importMode = 'MONTHLY_IMPORT' }) {
    if (!['ANNUAL', 'MONTHLY'].includes(importType)) throw httpError(400, '请选择年度或月度导入')
    let period
    if (importType === 'ANNUAL') {
      const value = Number(year)
      if (!Number.isInteger(value) || value < 1900 || value > 2199) throw httpError(400, '请选择有效年份')
      period = { year: value }
    } else {
      const value=String(month||'')
      if(importMode==='MONTHLY_IMPORT'){
        if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))throw httpError(400,'指定月份导入必须先选择有效月份')
        period={year:Number(value.slice(0,4)),month:Number(value.slice(5,7)),value}
      }else if(importMode==='BATCH_IMPORT')period={}
      else throw httpError(400,'月度计划导入模式无效')
    }
    const matrix = parsePlanUpload({ filename, contentBase64 })
    const dictionary = await dictionaries(pool, schema)
    const rows = normalizeRows(matrix, importType, period, dictionary)
    applyMonthlyPeriodRule({importType,importMode,period},rows)
    const client = await pool.connect()
    let newConflicts,existingTitle=null
    try { newConflicts = await applyDatabaseConflicts(client, schema, rows);if(importType==='MONTHLY'&&importMode==='MONTHLY_IMPORT')existingTitle=(await client.query(`SELECT plan_title FROM ${qualified('monthly_plan')} WHERE plan_year=$1 AND plan_month=$2`,[period.year,period.month])).rows[0]?.plan_title||null }
    finally { client.release() }
    sweep()
    const id = randomUUID(), expiresAtMs = Date.now() + ttl
    const fileWarnings = rows.some(row => row.warnings.length) ? [...new Set(rows.flatMap(row => row.warnings))] : []
    const normalizedRole=['PLANNER','SECTION_CHIEF','DEPUTY_DIRECTOR'].includes(String(role).toUpperCase())?String(role).toUpperCase():'PLANNER'
    const suggestedTitle=String(filename||'').replace(/\.(xlsx?|csv)$/i,'').trim().slice(0,255)||`${period.year}年${period.month}月检修计划`
    const entry = { id, sessionId, importType, importMode, role:normalizedRole, period, filename, suggestedTitle, existingTitle, titleConflict:Boolean(existingTitle&&existingTitle!==suggestedTitle), titleOverwriteChoice:'NOT_APPLICABLE', rows, warnings: fileWarnings, expiresAtMs, expiresAt: new Date(expiresAtMs).toISOString(), commitPromise: null, result: null }
    previews.set(id, entry)
    return publicPreview(entry)
  }

  async function updatePreviewRow(sessionId, previewId, line, values) {
    const entry=requirePreview(sessionId,previewId)
    if(entry.result)throw httpError(409,'导入已提交，不能修改预览')
    const target=entry.rows.find(row=>row.line===Number(line))
    if(!target)throw httpError(404,'预览行不存在')
    if(!values||typeof values!=='object'||Array.isArray(values))throw httpError(400,'修改内容无效')
    const matrix=[planHeaders,...entry.rows.map(row=>planFields.map(field=>row.line===target.line?(values[field.key]??row.raw?.[field.label]??''):(row.raw?.[field.label]??'')))]
    const dictionary=await dictionaries(pool,schema)
    const rows=normalizeRows(matrix,entry.importType,entry.period,dictionary)
    applyMonthlyPeriodRule(entry,rows)
    const client=await pool.connect()
    try{await applyDatabaseConflicts(client,schema,rows)}finally{client.release()}
    const updated=rows.find(row=>row.line===target.line)
    if(updated){
      const result=updated.status==='ready'
        ? '重新校验通过'
        : `重新校验未通过：${updated.errors.map(error=>error.message).join('；')}`.slice(0,500)
      updated.validationMessage=result
    }
    entry.rows=rows;entry.warnings=rows.some(row=>row.warnings.length)?[...new Set(rows.flatMap(row=>row.warnings))]:[]
    entry.expiresAtMs=Date.now()+ttl;entry.expiresAt=new Date(entry.expiresAtMs).toISOString()
    return publicPreview(entry)
  }

  async function deletePreviewRow(sessionId, previewId, line) {
    const entry=requirePreview(sessionId,previewId)
    if(entry.result)throw httpError(409,'导入已提交，不能删除预览数据')
    const target=entry.rows.find(row=>row.line===Number(line))
    if(!target)throw httpError(404,'预览行不存在')
    const remaining=entry.rows.filter(row=>row.line!==target.line)
    const matrix=[planHeaders,...remaining.map(row=>planFields.map(field=>row.raw?.[field.label]??''))]
    const dictionary=await dictionaries(pool,schema)
    const rows=normalizeRows(matrix,entry.importType,entry.period,dictionary)
    applyMonthlyPeriodRule(entry,rows)
    const client=await pool.connect()
    try{await applyDatabaseConflicts(client,schema,rows)}finally{client.release()}
    entry.rows=rows;entry.warnings=rows.some(row=>row.warnings.length)?[...new Set(rows.flatMap(row=>row.warnings))]:[]
    entry.expiresAtMs=Date.now()+ttl;entry.expiresAt=new Date(entry.expiresAtMs).toISOString()
    return publicPreview(entry)
  }

  async function appendPreviewRows(sessionId, previewId, { filename, contentBase64 }) {
    const entry = requirePreview(sessionId, previewId)
    if (entry.result) throw httpError(409, '导入已提交，不能追加车辆')
    if (entry.importType !== 'MONTHLY') throw httpError(400, '年度计划预览不支持在预览中追加车辆')
    const matrix = parsePlanUpload({ filename, contentBase64 })
    if (entry.rows.length + Math.max(0, matrix.length - 1) > 1000) throw httpError(400, '每次最多导入1000条非空计划')
    const dictionary = await dictionaries(pool, schema)
    const rows = normalizeRows(matrix, entry.importType, entry.period, dictionary)
    applyMonthlyPeriodRule(entry, rows)
    const maxLine = Math.max(1, ...entry.rows.map(row => Number(row.line) || 1))
    rows.forEach((row, index) => { row.line = maxLine + index + 1 })
    const client = await pool.connect()
    try { await applyDatabaseConflicts(client, schema, rows) } finally { client.release() }
    entry.rows = [...entry.rows, ...rows]
    markFileDuplicates(entry.rows)
    entry.warnings = entry.rows.some(row => row.warnings.length) ? [...new Set(entry.rows.flatMap(row => row.warnings))] : []
    entry.expiresAtMs = Date.now() + ttl
    entry.expiresAt = new Date(entry.expiresAtMs).toISOString()
    return publicPreview(entry)
  }

  async function attachImportedMonthlyDrafts(client, entry, inserted) {
    const groups = new Map()
    for (const row of inserted) {
      const key = row.plannedEntryAt.slice(0, 7)
      groups.set(key, [...(groups.get(key) || []), row])
    }
    for (const [key, items] of groups) {
      const [year, month] = key.split('-').map(Number)
      const plan = (await client.query(`
        INSERT INTO ${qualified('monthly_plan')}(plan_year,plan_month,plan_title,title_source,last_monthly_import_at)
        VALUES($1,$2,$3,$4,now())
        ON CONFLICT(plan_year,plan_month) DO UPDATE SET last_monthly_import_at=now(),updated_at=now()
        RETURNING *`, [year, month, entry.importMode==='MONTHLY_IMPORT'?entry.suggestedTitle:`${year}年${month}月检修计划`, entry.importMode === 'MONTHLY_IMPORT' ? 'MONTHLY_IMPORT' : 'DEFAULT'])).rows[0]
      if(entry.importMode==='MONTHLY_IMPORT'&&entry.titleOverwriteChoice==='REPLACE')await client.query(`UPDATE ${qualified('monthly_plan')} SET plan_title=$2,title_source='MONTHLY_IMPORT',last_title_updated_at=now(),updated_at=now() WHERE monthly_plan_id=$1`,[plan.monthly_plan_id,entry.suggestedTitle])
      let draft = (await client.query(`SELECT * FROM ${qualified('monthly_plan_version')} WHERE monthly_plan_id=$1 AND owner_role=$2 AND version_status='DRAFT' ORDER BY version_no DESC LIMIT 1`, [plan.monthly_plan_id, entry.role])).rows[0]
      if (!draft) {
        const versionNo = Number((await client.query(`SELECT COALESCE(max(version_no),0)+1 AS value FROM ${qualified('monthly_plan_version')} WHERE monthly_plan_id=$1`, [plan.monthly_plan_id])).rows[0].value)
        draft = (await client.query(`INSERT INTO ${qualified('monthly_plan_version')}(monthly_plan_id,version_no,base_version_id,owner_role,version_status,snapshot_title) VALUES($1,$2,$3,$4,'DRAFT',$5) RETURNING *`, [plan.monthly_plan_id, versionNo, plan.current_published_version_id, entry.role, plan.plan_title])).rows[0]
        if (plan.current_published_version_id) await client.query(`
          INSERT INTO ${qualified('monthly_plan_item')}(plan_version_id,stable_item_key,vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,repair_sequence,mileage_km,remark,change_type,is_cancelled)
          SELECT $1,stable_item_key,vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,repair_sequence,mileage_km,remark,'UNCHANGED',is_cancelled
          FROM ${qualified('monthly_plan_item')} WHERE plan_version_id=$2`, [draft.plan_version_id, plan.current_published_version_id])
      }
      for (const item of items) await client.query(`
        INSERT INTO ${qualified('monthly_plan_item')}(plan_version_id,stable_item_key,vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,repair_sequence,mileage_km,remark,change_type)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ADDED')`, [draft.plan_version_id, `vehicle-${item.vehicleId}`, item.vehicleId, item.locomotiveNo, item.repairProgramId, item.plannedEntryAt, item.ownerBureau || null, item.ownerDepot || null, item.repairSequence, item.mileageKm, item.remark || null])
    }
    await client.query(`INSERT INTO ${qualified('monthly_plan_import_batch')}(import_mode,target_year,target_month,original_filename,suggested_plan_title,title_overwrite_choice,import_status,operator_role,total_count,success_count,error_count,completed_at) VALUES($1,$2,$3,$4,$5,$6,'SUCCESS',$7,$8,$9,$10,now())`,[entry.importMode,entry.importMode==='MONTHLY_IMPORT'?entry.period.year:null,entry.importMode==='MONTHLY_IMPORT'?entry.period.month:null,entry.filename,entry.suggestedTitle,entry.titleOverwriteChoice,entry.role,entry.rows.length,inserted.length,entry.rows.length-inserted.length])
  }

  async function commit(entry) {
    if (entry.result) return { ...entry.result, idempotent: true }
    if (entry.commitPromise) return entry.commitPromise
    entry.commitPromise = (async () => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const stateRow = await client.query(`SELECT revision FROM ${qualified('application_state')} WHERE singleton FOR UPDATE`)
        if (!stateRow.rows.length) throw new Error('数据库状态行不存在')
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pc1-plan-import:${schema}`])
        await client.query(`LOCK TABLE ${qualified('vehicle_repair')} IN EXCLUSIVE MODE`)
        const newlyConflicted = await applyDatabaseConflicts(client, schema, entry.rows)
        if (newlyConflicted.length) {
          await client.query('ROLLBACK')
          return { changed: true, preview: publicPreview(entry) }
        }
        const ready = entry.rows.filter(row => row.status === 'ready')
        if (!ready.length) { await client.query('ROLLBACK'); return { imported: 0, notImported: entry.rows.length, idempotent: false } }
        const maxResult = await client.query(`SELECT COALESCE(MAX(vehicle_repair_id),0)::bigint AS max_id FROM ${qualified('vehicle_repair')}`)
        let id = Number(maxResult.rows[0].max_id)
        const inserted = []
        for (const row of ready) {
          const d = row.data
          const vehicleId = ++id
          await client.query(
            `INSERT INTO ${qualified('vehicle_repair')}
              (vehicle_repair_id, locomotive_no, repair_program_id, planned_entry_at, planned_exit_at,
               actual_entry_at, actual_exit_at, status, approval_status, current_version_id,
               owner_bureau, owner_depot, repair_sequence, mileage_km, plan_source, remark)
             VALUES ($1,$2,$3,$4::date,NULL,NULL,NULL,'UNSCHEDULED','DRAFT',NULL,$5,$6,$7,$8,$9,$10)`,
            [vehicleId, d.locomotiveNo, d.repairProgramId, d.plannedEntryAt, d.ownerBureau || null, d.ownerDepot || null,
              d.repairSequence, d.mileageKm, entry.importType, d.remark || null])
          inserted.push({ ...d, vehicleId })
        }
        if (entry.importType === 'MONTHLY') await attachImportedMonthlyDrafts(client, entry, inserted)
        const revision = await client.query(`UPDATE ${qualified('application_state')} SET revision=revision+1, updated_at=now() WHERE singleton RETURNING revision`)
        await client.query('COMMIT')
        const result = { imported: ready.length, notImported: entry.rows.length - ready.length, revision: Number(revision.rows[0].revision), idempotent: false }
        entry.result = result
        return result
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      } finally { client.release() }
    })()
    try { return await entry.commitPromise }
    finally { entry.commitPromise = null }
  }

  async function getVehicle(id) {
    const result = await calendarRows({ vehicleId: Number(id) })
    return result.find(row => row.id === Number(id)) || null
  }

  return {
    async lookups() {
      const dict = await dictionaries(pool, schema)
      return { models: [...dict.models.values()], programs: [...dict.programs.values()] }
    },
    async annual({ year, depot = '', modelId, programId }) {
      const allRows = await annualRows({ year, modelId, programId })
      const rows = depot ? allRows.filter(row => row.ownerDepot === depot) : allRows
      return { year: Number(year), rows, summary: annualSummary(rows, Number(year)), stats: annualStats(rows, Number(year)), depots: [...new Set(allRows.map(row => row.ownerDepot || '未填写'))].sort((a, b) => a.localeCompare(b, 'zh-CN')) }
    },
    async calendar(params) { return { vehicles: await calendarRows(params) } },
    async plans(params) { return { vehicles: await calendarRows({ ...params, entryOnly: true }) } },
    async vehicle(id) { return getVehicle(id) },
    templateCsv() { return templateCsv },
    templateXlsx() { return makeTemplateXlsx() },
    errorsCsv(previewId, sessionId) {
      const entry = requirePreview(sessionId, previewId)
      return detailedErrorsCsv(entry.rows.filter(row => row.errors.length || row.status !== 'ready'))
    },
    async preview(input) { return preview(input) },
    async updatePreviewRow(sessionId,id,line,values){return updatePreviewRow(sessionId,id,line,values)},
    async deletePreviewRow(sessionId,id,line){return deletePreviewRow(sessionId,id,line)},
    async appendPreviewRows(sessionId,id,input){return appendPreviewRows(sessionId,id,input)},
    async cancel(sessionId, id) { const entry = requirePreview(sessionId, id); if (entry.result) throw httpError(409, '导入已提交，不能取消'); previews.delete(id); return { cancelled: true } },
    async confirm(sessionId, id, options={}) {
      const entry = requirePreview(sessionId, id)
      const choice=String(options.titleOverwriteChoice||'NOT_APPLICABLE').toUpperCase()
      if(entry.importType==='MONTHLY'&&entry.importMode==='MONTHLY_IMPORT'&&entry.titleConflict&&!['KEEP','REPLACE'].includes(choice))throw httpError(400,'请先选择保留原标题或使用文件名覆盖标题')
      if(!['NOT_APPLICABLE','KEEP','REPLACE'].includes(choice))throw httpError(400,'标题处理方式无效')
      entry.titleOverwriteChoice=choice
      const result = await commit(entry)
      return result.changed ? { changed: true, preview: result.preview } : result
    },
    previewFields: planFields,
  }
}
