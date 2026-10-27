import fs from 'node:fs/promises'
import pg from 'pg'
import { createState } from '../src/core/state.js'
import { exportDemoSnapshot, parseDemoSnapshot } from '../src/core/demo-persistence.js'
import { databaseBusinessCollections, fromDatabaseStatus, stateTables, toDatabaseStatus } from './state-mapping.js'

// PostgreSQL's timestamp-without-time-zone values represent workshop local time.
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
          await client.query(`UPDATE ${quotedSchema}.application_state SET revision=1,schema_version=2,updated_at=now() WHERE singleton`)
          initialized = !migrated
        } else if (Number(meta.rows[0].schema_version) < 2) {
          const data = await readLegacyV1(client)
          await writeData(client, data, definitions)
          await client.query(`UPDATE ${quotedSchema}.application_state SET revision=revision+1,schema_version=2,updated_at=now() WHERE singleton`)
          migrated = true
        }
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
    async save(revision, snapshot) {
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
        await client.query('SET CONSTRAINTS ALL DEFERRED')
        await writeData(client, data, definitions)
        const meta = (await client.query(`UPDATE ${quotedSchema}.application_state SET revision=revision+1,updated_at=now() WHERE singleton RETURNING revision,updated_at`)).rows[0]
        await client.query('COMMIT')
        return { revision: Number(meta.revision), savedAt: meta.updated_at.toISOString() }
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    },
    async counts() {
      const result = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename`, [schema])
      return result.rows.map(row => row.tablename)
    },
    async health() { await pool.query(`SELECT 1 FROM ${quotedSchema}.application_state WHERE singleton`); return { storage: 'postgresql', schema, businessTables: stateTables.length } },
    close() { return pool.end() },
  }
}
