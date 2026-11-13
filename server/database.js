import fs from 'node:fs/promises'
import pg from 'pg'
import {isDeepStrictEqual} from 'node:util'
import { createState } from '../src/core/state.js'
import { exportDemoSnapshot, parseDemoSnapshot } from '../src/core/demo-persistence.js'
import { databaseBusinessCollections, fromDatabaseStatus, stateTables, toDatabaseStatus } from './state-mapping.js'
import { prepareMaintenanceRecord } from './maintenance.js'
import { applyToolCommand } from '../src/core/tool-management.js'
import { RAILWAY_DEPOT_OPTIONS } from './railway-dictionaries.js'

// PostgreSQL's timestamp-without-time-zone values represent workshop local time.
pg.types.setTypeParser(1082, value => value)
pg.types.setTypeParser(1114, value => value.replace(' ', 'T'))
pg.types.setTypeParser(20, value => { const number = Number(value); return Number.isSafeInteger(number) ? number : value })
pg.types.setTypeParser(1700, value => { const number = Number(value); return Number.isFinite(number) ? number : value })
export const localKeys = ['selectedWorkerId', 'selectedTeamId', 'selectedVehicleRepairId', 'ganttFilters', 'planningView']
const definitionPath = new URL('./tables.json', import.meta.url)
const normalize = value => value instanceof Date ? value.toISOString() : value
const camel = value => value.replace(/_([a-z0-9])/g, (_, character) => character.toUpperCase())

function rowKey(definition, row, index) {
  const columns = Array.isArray(definition.primaryKey) ? definition.primaryKey : [definition.primaryKey]
  return JSON.stringify(columns.map(column => {
    if (column === 'operation_id') return row.operationId ?? row.id ?? index + 1
    const alias = definition.aliases[column] || camel(column)
    return row[alias] ?? null
  }))
}

function buildTableRows(data, definitions) {
  const storedRows = {}, rowExtras = {}
  for (const mapping of stateTables) {
    const definition = definitions.find(item => item.table === mapping.table)
    const rows = data[mapping.collection]
    if (!Array.isArray(rows)) throw new Error(`备份缺少${mapping.collection}集合`)
    const aliases = { ...mapping.aliases }
    if (mapping.table === 'task_team_requirement') aliases.operation_id ||= 'operationId'
    const columns = definition.columns.map(column => column.name)
    const appFields = new Set(columns.flatMap(column => [aliases[column] || camel(column)]))
    if (!Array.isArray(mapping.primaryKey) && mapping.primaryKey !== 'calendar_date') appFields.add('id')
    const ordered = rows.map((row, index) => {
      const sqlRow = {}
      for (const column of definition.columns) {
        let value = row[aliases[column.name] || camel(column.name)]
        if (column.name === 'operation_id') value ??= index + 1
        if (['created_at', 'updated_at', 'assigned_at', 'moved_at'].includes(column.name)) value ??= new Date().toISOString()
        if (column.name === 'status') value = toDatabaseStatus(mapping.table, value)
        sqlRow[column.name] = normalize(value) ?? null
      }
      const extras = Object.fromEntries(Object.entries(row).filter(([key]) => !appFields.has(key)))
      if (Object.keys(extras).length) rowExtras[`${mapping.collection}:${rowKey(mapping, row, index)}`] = extras
      return sqlRow
    })
    const primaryColumns = Array.isArray(mapping.primaryKey) ? mapping.primaryKey : [mapping.primaryKey]
    const keys = ordered.map(row => JSON.stringify(primaryColumns.map(column => row[column])))
    if (keys.some(key => key.includes('null')) || new Set(keys).size !== keys.length) throw new Error(`${mapping.table}主键重复或缺失`)
    storedRows[mapping.table] = ordered
  }
  const appState = Object.fromEntries(Object.entries(data).filter(([key]) => !databaseBusinessCollections.has(key) && !localKeys.includes(key)))
  return { storedRows, payload: { appState, rowExtras } }
}

async function ensurePlanningDictionaries(client, schema) {
  const quotedSchema = `"${schema}"`
  const source = createState()
  let changed = false
  await client.query(`CREATE TABLE IF NOT EXISTS ${quotedSchema}.railway_depot_dictionary (
    bureau_name VARCHAR(64) NOT NULL,
    depot_name VARCHAR(128) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ENABLED',
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (bureau_name, depot_name)
  )`)
  for (const [bureau, depots] of RAILWAY_DEPOT_OPTIONS) {
    for (const depot of depots) {
      const result = await client.query(`INSERT INTO ${quotedSchema}.railway_depot_dictionary(bureau_name,depot_name) VALUES($1,$2) ON CONFLICT (bureau_name,depot_name) DO NOTHING`, [bureau, depot])
      changed ||= result.rowCount > 0
    }
  }
  const modelIds = new Map()
  for (const model of source.locomotiveModels) {
    const existing = (await client.query(`SELECT model_id FROM ${quotedSchema}.locomotive_model WHERE model_code=$1`, [model.code])).rows[0]
    let modelId = existing?.model_id
    if (modelId == null) {
      const conflict = (await client.query(`SELECT model_id FROM ${quotedSchema}.locomotive_model WHERE model_id=$1`, [model.id])).rows[0]
      modelId = conflict ? Number((await client.query(`SELECT COALESCE(MAX(model_id),0)+1 AS value FROM ${quotedSchema}.locomotive_model`)).rows[0].value) : model.id
      await client.query(`INSERT INTO ${quotedSchema}.locomotive_model(model_id,model_code,model_name,status) VALUES($1,$2,$3,'ENABLED')`, [modelId, model.code, model.name])
      changed = true
    } else {
      const result = await client.query(`UPDATE ${quotedSchema}.locomotive_model SET model_name=$2,status='ENABLED',updated_at=now() WHERE model_id=$1 AND (model_name<>$2 OR status<>'ENABLED')`, [modelId, model.name])
      changed ||= result.rowCount > 0
    }
    modelIds.set(model.id, Number(modelId))
  }
  for (const program of source.repairPrograms) {
    const modelId = modelIds.get(program.modelId)
    if (!modelId) continue
    const existing = (await client.query(`SELECT repair_program_id FROM ${quotedSchema}.repair_program WHERE model_id=$1 AND repair_program_name=$2`, [modelId, program.name])).rows[0]
    if (existing) {
      const result = await client.query(`UPDATE ${quotedSchema}.repair_program SET repair_program_code=$2,repair_duration_days=$3,status='ENABLED',updated_at=now() WHERE repair_program_id=$1 AND (repair_program_code IS DISTINCT FROM $2 OR repair_duration_days IS DISTINCT FROM $3 OR status<>'ENABLED')`, [existing.repair_program_id, program.code, program.durationDays || 18])
      changed ||= result.rowCount > 0
    } else {
      const conflict = (await client.query(`SELECT repair_program_id FROM ${quotedSchema}.repair_program WHERE repair_program_id=$1`, [program.id])).rows[0]
      const programId = conflict ? Number((await client.query(`SELECT COALESCE(MAX(repair_program_id),0)+1 AS value FROM ${quotedSchema}.repair_program`)).rows[0].value) : program.id
      await client.query(`INSERT INTO ${quotedSchema}.repair_program(repair_program_id,model_id,repair_program_code,repair_program_name,repair_duration_days,status) VALUES($1,$2,$3,$4,$5,'ENABLED')`, [programId, modelId, program.code, program.name, program.durationDays || 18])
      changed = true
    }
  }
  return changed
}

function mapStateRows(clientData, definitions, payload) {
  const data = { ...createState(), ...(payload?.appState || {}) }
  for (const mapping of stateTables) {
    const definition = definitions.find(item => item.table === mapping.table)
    const inverseAliases = Object.fromEntries(Object.entries(mapping.aliases).map(([column, field]) => [column, field]))
    if (mapping.table === 'task_team_requirement') inverseAliases.operation_id = 'operationId'
    const rows = clientData[mapping.table].map(sqlRow => {
      const row = {}
      for (const column of definition.columns) {
        const field = inverseAliases[column.name] || camel(column.name)
        let value = sqlRow[column.name]
        if (column.name === 'status') value = fromDatabaseStatus(mapping.table, value)
        row[field] = normalize(value)
      }
      return row
    })
    const primaryColumns = Array.isArray(mapping.primaryKey) ? mapping.primaryKey : [mapping.primaryKey]
    data[mapping.collection] = rows.map((row, index) => {
      const key = JSON.stringify(primaryColumns.map(column => {
        const field = inverseAliases[column] || camel(column)
        return row[field] ?? null
      }))
      const extras = payload?.rowExtras?.[`${mapping.collection}:${key}`] || {}
      return { ...extras, ...row }
    })
  }
  return data
}

export function createDatabase({ connectionString, schema = 'pc1' }) {
  if (!connectionString) throw new Error('请在.env中配置DATABASE_URL后启动PostgreSQL模式')
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('数据库schema名称无效')
  const quotedSchema = `"${schema}"`, literalSchema = `'${schema.replaceAll("'", "''")}'`
  const pool = new pg.Pool({ connectionString, max: 8, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 })
  pool.on('error', error => console.error('PostgreSQL连接中断:', error.code || 'CONNECTION_ERROR'))

  async function writeData(client, data, definitions) {
    const { storedRows, payload } = buildTableRows(data, definitions)
    const reverse = [...stateTables].reverse()
    for (const mapping of reverse) await client.query(`DELETE FROM ${quotedSchema}."${mapping.table}"`)
    for (const mapping of stateTables) {
      const definition = definitions.find(item => item.table === mapping.table)
      const columns = definition.columns.map(column => column.name)
      if (!columns.length) continue
      const sqlColumns = columns.map(column => `"${column}"`).join(', ')
      const values = storedRows[mapping.table]
      for (let offset = 0; offset < values.length; offset += 300) {
        const batch = values.slice(offset, offset + 300)
        if (!batch.length) continue
        const parameters = [], records = batch.map(record => `(${columns.map(column => { parameters.push(record[column]); return `$${parameters.length}` }).join(', ')})`)
        await client.query(`INSERT INTO ${quotedSchema}."${mapping.table}" (${sqlColumns}) VALUES ${records.join(', ')}`, parameters)
      }
    }
    await client.query(`UPDATE ${quotedSchema}.application_state SET payload=$1::jsonb WHERE singleton`, [JSON.stringify(payload)])
  }

  async function readData(client, definitions) {
    const appResult = await client.query(`SELECT payload FROM ${quotedSchema}.application_state WHERE singleton`)
    const appPayload = appResult.rows[0]?.payload || {}
    const clientData = {}
    for (const mapping of stateTables) {
      const definition = definitions.find(item => item.table === mapping.table)
      const primary = (Array.isArray(mapping.primaryKey) ? mapping.primaryKey : [mapping.primaryKey]).map(column => `"${column}"`).join(', ')
      const result = await client.query(`SELECT * FROM ${quotedSchema}."${mapping.table}" ORDER BY ${primary}`)
      clientData[mapping.table] = result.rows
    }
    return mapStateRows(clientData, definitions, appPayload)
  }

  async function assertNewSchedulesPublished(client, data) {
    const incoming=new Set((data.schedules||[]).filter(row=>!['CANCELLED','CANCELED'].includes(String(row.status).toUpperCase())).map(row=>Number(row.vehicleRepairId)).filter(Number.isSafeInteger))
    if(!incoming.size)return
    const existing=(await client.query(`SELECT DISTINCT vehicle_repair_id FROM ${quotedSchema}.vehicle_repair_schedule WHERE status NOT IN ('CANCELLED','CANCELED')`)).rows.map(row=>Number(row.vehicle_repair_id))
    const added=[...incoming].filter(id=>!existing.includes(id))
    if(!added.length)return
    const allowed=(await client.query(`SELECT DISTINCT i.vehicle_repair_id FROM ${quotedSchema}.monthly_plan p JOIN ${quotedSchema}.monthly_plan_item i ON i.plan_version_id=p.current_published_version_id WHERE i.vehicle_repair_id=ANY($1::bigint[]) AND NOT i.is_cancelled`,[added])).rows.map(row=>Number(row.vehicle_repair_id))
    const denied=added.filter(id=>!allowed.includes(id))
    if(denied.length)throw Object.assign(new Error(`车辆计划尚未发布，不能进入检修排程：${denied.join('、')}`),{status:409})
  }

  function addResourceDemoRequirements(data) {
    const defaults = createState()
    if (!data.materials.some(row => row.name === 'O形圈')) {
      data.materials.push({ ...defaults.materials.find(row => row.name === 'O形圈'), id: Math.max(0, ...data.materials.map(row => Number(row.id) || 0)) + 1 })
    }
    for (const [key, inventory, idField] of [['toolRequirements', 'tools', 'toolId'], ['materialRequirements', 'materials', 'materialId']]) {
      if (data[key]?.length) continue
      const idMap = new Map()
      for (const requirement of defaults[key]) {
        const source = defaults[inventory].find(row => row.id === requirement[idField])
        if (!source || idMap.has(source.id)) continue
        let resource = data[inventory].find(row => row.name === source.name)
        if (!resource) {
          resource = { ...source, id: Math.max(0, ...data[inventory].map(row => Number(row.id) || 0)) + 1 }
          data[inventory].push(resource)
        }
        idMap.set(source.id, resource.id)
      }
      data[key] = defaults[key].map(row => ({ ...row, [idField]: idMap.get(row[idField]) }))
    }
    return data
  }

  async function migrateLegacyMonthlyPlans(client) {
    const existing = await client.query(`SELECT COUNT(*)::int AS count FROM ${quotedSchema}.monthly_plan`)
    if (existing.rows[0].count) return false
    const legacy = await client.query(`
      SELECT vr.*,
        EXISTS (
          SELECT 1 FROM ${quotedSchema}.schedule_version sv
          WHERE sv.vehicle_repair_id=vr.vehicle_repair_id
            AND sv.status IN ('PUBLISHED','CURRENT')
            AND (vr.current_version_id IS NULL OR sv.version_id=vr.current_version_id)
        ) AS has_published_schedule
      FROM ${quotedSchema}.vehicle_repair vr
      WHERE COALESCE(vr.plan_source,'MONTHLY') <> 'ANNUAL'
      ORDER BY vr.planned_entry_at,vr.vehicle_repair_id`)
    const groups = new Map()
    for (const row of legacy.rows) {
      const date = String(row.planned_entry_at).slice(0, 10), key = date.slice(0, 7)
      if (!/^\d{4}-\d{2}$/.test(key)) continue
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(row)
    }
    for (const [month, rows] of groups) {
      const [year, monthNumber] = month.split('-').map(Number)
      const plan = (await client.query(`INSERT INTO ${quotedSchema}.monthly_plan(plan_year,plan_month,plan_title,title_source) VALUES($1,$2,$3,'DEFAULT') RETURNING monthly_plan_id`, [year, monthNumber, `${year}年${monthNumber}月检修计划`])).rows[0]
      let versionNo = 0
      for (const [published, selected] of [[true, rows.filter(row => row.has_published_schedule)], [false, rows.filter(row => !row.has_published_schedule)]]) {
        if (!selected.length) continue
        const version = (await client.query(`INSERT INTO ${quotedSchema}.monthly_plan_version(monthly_plan_id,version_no,owner_role,version_status,snapshot_title,published_at) VALUES($1,$2,'PLANNER',$3,$4,$5) RETURNING plan_version_id`, [plan.monthly_plan_id, ++versionNo, published ? 'PUBLISHED' : 'DRAFT', `${year}年${monthNumber}月检修计划`, published ? new Date() : null])).rows[0]
        for (const row of selected) await client.query(`INSERT INTO ${quotedSchema}.monthly_plan_item(plan_version_id,stable_item_key,vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,owner_bureau,owner_depot,repair_sequence,mileage_km,remark,change_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [version.plan_version_id, `legacy-${row.vehicle_repair_id}`, row.vehicle_repair_id, row.locomotive_no, row.repair_program_id, row.planned_entry_at, row.owner_bureau, row.owner_depot, row.repair_sequence, row.mileage_km, row.remark, published ? 'UNCHANGED' : 'ADDED'])
        if (published) await client.query(`UPDATE ${quotedSchema}.monthly_plan SET current_published_version_id=$1,updated_at=CURRENT_TIMESTAMP WHERE monthly_plan_id=$2`, [version.plan_version_id, plan.monthly_plan_id])
      }
    }
    return groups.size > 0
  }

  async function readLegacyV1(client) {
    const data = createState()
    const ref = await client.query(`SELECT collection,payload FROM ${quotedSchema}.reference_data`)
    for (const row of ref.rows) data[row.collection] = row.payload
    const time = field => `to_char(${field}, 'YYYY-MM-DD"T"HH24:MI:SS')`
    const vehicles = await client.query(`SELECT id,locomotive_no,status,details,${time('planned_entry_at')} entry,${time('requested_exit_at')} exit FROM ${quotedSchema}.vehicle_repairs ORDER BY id`)
    data.vehicleRepairs = vehicles.rows.map(row => ({ ...row.details, id: Number(row.id), locomotiveNo: row.locomotive_no, plannedEntryAt: row.entry, plannedExitAt: row.exit, status: row.status }))
    const versions = await client.query(`SELECT * FROM ${quotedSchema}.schedule_versions ORDER BY id`)
    data.scheduleVersions = versions.rows.map(row => ({ ...row.details, id: Number(row.id), vehicleRepairId: Number(row.vehicle_repair_id), status: row.status === 'PUBLISHED' ? 'PUBLISHED' : row.status }))
    const schedules = await client.query(`SELECT *,${time('planned_start_at')} start,${time('planned_end_at')} "end" FROM ${quotedSchema}.schedules ORDER BY id`)
    data.schedules = schedules.rows.map(row => ({ ...row.details, id: Number(row.id), vehicleRepairId: Number(row.vehicle_repair_id), taskId: Number(row.task_id), versionId: row.version_id == null ? null : Number(row.version_id), workstationId: Number(row.workstation_id), plannedStartAt: row.start, plannedEndAt: row.end, status: row.status, isLocked: row.is_locked }))
    const assignments = await client.query(`SELECT * FROM ${quotedSchema}.resource_assignments ORDER BY kind,id`)
    data.employeeAssignments = assignments.rows.filter(row => row.kind === 'employee').map(row => ({ ...row.details, id: Number(row.id), scheduleTaskId: Number(row.schedule_id), employeeId: Number(row.resource_id) }))
    data.equipmentAssignments = assignments.rows.filter(row => row.kind === 'equipment').map(row => ({ ...row.details, id: Number(row.id), scheduleTaskId: Number(row.schedule_id), equipmentId: Number(row.resource_id) }))
    data.componentAssignments = assignments.rows.filter(row => row.kind === 'component').map(row => ({ ...row.details, id: Number(row.id), scheduleTaskId: Number(row.schedule_id), componentInstanceId: Number(row.resource_id) }))
    return data
  }

  return {
    pool, schema,
    async init({ snapshot } = {}) {
      const definitions = JSON.parse(await fs.readFile(definitionPath, 'utf8'))
      const initialData = snapshot === undefined ? exportDemoSnapshot(createState()).data : parseDemoSnapshot(JSON.stringify(snapshot)).data
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`rail-maintenance:${schema}`])
        const sql = (await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8')).replaceAll('__SCHEMA_LITERAL__', literalSchema).replaceAll('__SCHEMA__', quotedSchema)
        await client.query(sql)
        await client.query((await fs.readFile(new URL('./auth-schema.sql',import.meta.url),'utf8')).replaceAll('__SCHEMA__',quotedSchema))
        await client.query(`CREATE TABLE IF NOT EXISTS ${quotedSchema}.pc1_maintenance_media (id uuid PRIMARY KEY, file_name text NOT NULL, mime_type text NOT NULL, content bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`)
        const dictionariesMigrated = await ensurePlanningDictionaries(client, schema)
        const exists = await client.query(`SELECT to_regclass($1) AS legacy`, [`${schema}.metadata`])
        const meta = await client.query(`SELECT revision,schema_version FROM ${quotedSchema}.application_state WHERE singleton FOR UPDATE`)
        const revision = Number(meta.rows[0].revision)
        let initialized = false, migrated = false
        if (revision === 0) {
          if (exists.rows[0].legacy) {
          const tableCheck = await client.query(`SELECT to_regclass($1) AS table_name`, [`${schema}.vehicle_repairs`])
            if (tableCheck.rows[0].table_name) {
              const migratedData = await readLegacyV1(client)
              await writeData(client, migratedData, definitions)
              migrated = true
            } else await writeData(client, initialData, definitions)
          } else await writeData(client, initialData, definitions)
          await client.query(`UPDATE ${quotedSchema}.application_state SET revision=1,schema_version=4,updated_at=now() WHERE singleton`)
          initialized = !migrated
        } else if (Number(meta.rows[0].schema_version) < 2) {
          const data = await readLegacyV1(client)
          await writeData(client, addResourceDemoRequirements(data), definitions)
          await client.query(`UPDATE ${quotedSchema}.application_state SET revision=revision+1,schema_version=4,updated_at=now() WHERE singleton`)
          migrated = true
        } else if (Number(meta.rows[0].schema_version) < 3) {
          const data = addResourceDemoRequirements(await readData(client, definitions))
          await writeData(client, data, definitions)
          await client.query(`UPDATE ${quotedSchema}.application_state SET revision=revision+1,schema_version=4,updated_at=now() WHERE singleton`)
          migrated = true
        }
        const monthlyMigrated = await migrateLegacyMonthlyPlans(client)
        if (monthlyMigrated) {
          await client.query(`UPDATE ${quotedSchema}.application_state SET revision=revision+1,schema_version=4,updated_at=now() WHERE singleton`)
          migrated = true
        } else if (dictionariesMigrated && revision > 0 && !migrated) {
          await client.query(`UPDATE ${quotedSchema}.application_state SET revision=revision+1,schema_version=4,updated_at=now() WHERE singleton`)
          migrated = true
        } else await client.query(`UPDATE ${quotedSchema}.application_state SET schema_version=4 WHERE singleton AND schema_version<4`)
        if (exists.rows[0].legacy) {
          const legacyTables = ['resource_assignments','schedules','schedule_versions','vehicle_repairs','reference_data','metadata']
          const legacyPresent = await client.query(`SELECT count(*)::int AS count FROM pg_tables WHERE schemaname=$1 AND tablename=ANY($2::text[])`, [schema, legacyTables])
          if (legacyPresent.rows[0].count === legacyTables.length) await client.query(`DROP TABLE ${legacyTables.map(table => `${quotedSchema}."${table}"`).join(', ')}`)
        }
        await client.query('COMMIT')
        return { initialized, migrated, revision: revision > 0 ? revision + (migrated ? 1 : 0) : 1 }
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    },
    async read() {
      const definitions = JSON.parse(await fs.readFile(definitionPath, 'utf8'))
      const client = await pool.connect()
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        const meta = (await client.query(`SELECT revision,updated_at FROM ${quotedSchema}.application_state WHERE singleton`)).rows[0]
        const data = await readData(client, definitions)
        await client.query('COMMIT')
        return { revision: Number(meta.revision), snapshot: { format: 'rail-maintenance-pc1', schemaVersion: 1, savedAt: meta.updated_at.toISOString(), data } }
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    },
    async save(revision, snapshot,{protectTools=false}={}) {
      if (!Number.isSafeInteger(revision) || revision < 1) throw Object.assign(new Error('缺少有效的数据版本'), { status: 400 })
      let data
      try { data = parseDemoSnapshot(JSON.stringify(snapshot)).data }
      catch (error) { throw Object.assign(new Error(error.message), { status: 400 }) }
      const definitions = JSON.parse(await fs.readFile(definitionPath, 'utf8'))
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const current = (await client.query(`SELECT revision FROM ${quotedSchema}.application_state WHERE singleton FOR UPDATE`)).rows[0]
        if (Number(current.revision) !== revision) throw Object.assign(new Error('其他页面已更新数据库，请先备份当前修改，再加载数据库最新数据'), { status: 409 })
        if(protectTools){const committed=await readData(client,definitions);if(['toolManagement','tools','toolRequirements'].some(key=>!isDeepStrictEqual(data[key],committed[key])))throw Object.assign(Error('工具资料、业务及经办记录必须通过工具管理办理，不能直接覆盖'),{status:403})}
        await assertNewSchedulesPublished(client,data)
        await client.query('SET CONSTRAINTS ALL DEFERRED')
        await writeData(client, data, definitions)
        const meta = (await client.query(`UPDATE ${quotedSchema}.application_state SET revision=revision+1,updated_at=now() WHERE singleton RETURNING revision,updated_at`)).rows[0]
        await client.query('COMMIT')
        return { revision: Number(meta.revision), savedAt: meta.updated_at.toISOString() }
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    },
    async toolCommand(input,{hardware=false}={}) {
      const definitions=JSON.parse(await fs.readFile(definitionPath,'utf8')),client=await pool.connect()
      try {
        await client.query('BEGIN')
        const current=(await client.query(`SELECT revision FROM ${quotedSchema}.application_state WHERE singleton FOR UPDATE`)).rows[0]
        const data=await readData(client,definitions)
        const duplicate=data.toolManagement?.commands.some(c=>c.requestId===input.requestId)
        if(!hardware&&!duplicate&&input.revision!==Number(current.revision))throw Object.assign(new Error('数据已更新，请刷新工具管理后重试，当前操作未提交'),{status:409})
        const result=applyToolCommand(data,input,{hardware})
        if(!duplicate){
          const checked=exportDemoSnapshot(data).data
          await client.query('SET CONSTRAINTS ALL DEFERRED')
          await writeData(client,checked,definitions)
          await client.query(`UPDATE ${quotedSchema}.application_state SET revision=revision+1,updated_at=now() WHERE singleton`)
        }
        await client.query('COMMIT')
        return {...result,revision:Number(current.revision)+(duplicate?0:1)}
      }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
    },
    async submitMaintenanceRecord(input) {
      const definitions = JSON.parse(await fs.readFile(definitionPath, 'utf8'))
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const meta = (await client.query(`SELECT revision FROM ${quotedSchema}.application_state WHERE singleton FOR UPDATE`)).rows[0]
        const data = await readData(client, definitions)
        const existing = input.requestId && data.maintenanceRecords.find(row => row.requestId === input.requestId)
        if (existing) { await client.query('COMMIT'); return { record: existing, revision: Number(meta.revision), duplicate: true } }
        const { record, files } = prepareMaintenanceRecord(data, input)
        for (const file of files) await client.query(`INSERT INTO ${quotedSchema}.pc1_maintenance_media(id,file_name,mime_type,content) VALUES($1,$2,$3,$4)`, [file.id, file.name, file.mimeType, file.content])
        data.maintenanceRecords.push(record)
        const checked = exportDemoSnapshot(data).data
        await client.query('SET CONSTRAINTS ALL DEFERRED')
        await writeData(client, checked, definitions)
        const result = (await client.query(`UPDATE ${quotedSchema}.application_state SET revision=revision+1,updated_at=now() WHERE singleton RETURNING revision`)).rows[0]
        await client.query('COMMIT')
        return { record, revision: Number(result.revision) }
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    },
    async readMaintenanceMedia(id) {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) return null
      return (await pool.query(`SELECT file_name,mime_type,content FROM ${quotedSchema}.pc1_maintenance_media WHERE id=$1`, [id])).rows[0] || null
    },
    async counts() {
      const result = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename`, [schema])
      return result.rows.map(row => row.tablename)
    },
    async health() { await pool.query(`SELECT 1 FROM ${quotedSchema}.application_state WHERE singleton`); return { storage: 'postgresql', schema, businessTables: stateTables.length } },
    close() { return pool.end() },
  }
}
