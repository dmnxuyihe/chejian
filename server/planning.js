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
  const output = [['原始行号', '原始数据', '错误字段', '错误原因']]
  for (const row of rows) output.push([
    row.line,
    JSON.stringify(row.raw || {}),
    row.errors.map(error => error.field).join('；'),
    row.errors.map(error => error.message).join('；'),
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
  return { id: preview.id, importType: preview.importType, period: preview.period, expiresAt: preview.expiresAt, warnings: preview.warnings, ...summary,
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

  async function calendarRows({ from, to, modelId, programId, locomotiveNo, vehicleId, entryOnly = false, planSource }) {
    const result = await pool.query(
      `SELECT vr.vehicle_repair_id, vr.locomotive_no, vr.repair_program_id,
              rp.repair_program_name, lm.model_id, lm.model_name,
              vr.planned_entry_at, vr.planned_exit_at, vr.owner_bureau, vr.owner_depot,
              vr.repair_sequence, vr.mileage_km, vr.plan_source, vr.remark,
              vr.status, vr.approval_status, vr.current_version_id,
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
          AND ($8::text IS NULL OR vr.plan_source=$8)
        ORDER BY vr.planned_entry_at, vr.locomotive_no, vr.vehicle_repair_id`, [from || '1900-01-01', to || '2199-12-31', modelId || null, programId || null, locomotiveNo || '', vehicleId || null, entryOnly, planSource || null])
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

  async function preview({ sessionId, importType, year, month, filename, contentBase64 }) {
    if (!['ANNUAL', 'MONTHLY'].includes(importType)) throw httpError(400, '请选择年度或月度导入')
    let period
    if (importType === 'ANNUAL') {
      const value = Number(year)
      if (!Number.isInteger(value) || value < 1900 || value > 2199) throw httpError(400, '请选择有效年份')
      period = { year: value }
    } else period = {}
    const matrix = parsePlanUpload({ filename, contentBase64 })
    const dictionary = await dictionaries(pool, schema)
    const rows = normalizeRows(matrix, importType, period, dictionary)
    const client = await pool.connect()
    let newConflicts
    try { newConflicts = await applyDatabaseConflicts(client, schema, rows) }
    finally { client.release() }
    sweep()
    const id = randomUUID(), expiresAtMs = Date.now() + ttl
    const fileWarnings = rows.some(row => row.warnings.length) ? [...new Set(rows.flatMap(row => row.warnings))] : []
    const entry = { id, sessionId, importType, period, filename, rows, warnings: fileWarnings, expiresAtMs, expiresAt: new Date(expiresAtMs).toISOString(), commitPromise: null, result: null }
    previews.set(id, entry)
    return publicPreview(entry)
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
        for (const row of ready) {
          const d = row.data
          await client.query(
            `INSERT INTO ${qualified('vehicle_repair')}
              (vehicle_repair_id, locomotive_no, repair_program_id, planned_entry_at, planned_exit_at,
               actual_entry_at, actual_exit_at, status, approval_status, current_version_id,
               owner_bureau, owner_depot, repair_sequence, mileage_km, plan_source, remark)
             VALUES ($1,$2,$3,$4::date,NULL,NULL,NULL,'UNSCHEDULED','DRAFT',NULL,$5,$6,$7,$8,$9,$10)`,
            [++id, d.locomotiveNo, d.repairProgramId, d.plannedEntryAt, d.ownerBureau || null, d.ownerDepot || null,
              d.repairSequence, d.mileageKm, entry.importType, d.remark || null])
        }
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
    async cancel(sessionId, id) { const entry = requirePreview(sessionId, id); if (entry.result) throw httpError(409, '导入已提交，不能取消'); previews.delete(id); return { cancelled: true } },
    async confirm(sessionId, id) {
      const entry = requirePreview(sessionId, id)
      const result = await commit(entry)
      return result.changed ? { changed: true, preview: result.preview } : result
    },
    previewFields: planFields,
  }
}
