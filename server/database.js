import fs from 'node:fs/promises'
import pg from 'pg'
import { createState } from '../src/core/state.js'
import { exportDemoSnapshot, parseDemoSnapshot } from '../src/core/demo-persistence.js'

// UI preferences are per browser. Business records and draft locks are shared.
export const localKeys = ['selectedWorkerId', 'selectedTeamId', 'selectedVehicleRepairId', 'ganttFilters', 'planningView']
const separated = ['vehicleRepairs', 'scheduleVersions', 'schedules', 'employeeAssignments', 'equipmentAssignments', 'componentAssignments']
const assignmentTypes = [['employee', 'employeeAssignments', 'employeeId'], ['equipment', 'equipmentAssignments', 'equipmentId'], ['component', 'componentAssignments', 'componentInstanceId']]
const without = (row, keys) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)))
const localTime = field => `to_char(${field}, 'YYYY-MM-DD"T"HH24:MI:SS')`

export function createDatabase({ connectionString, schema = 'pc1' }) {
  if (!connectionString) throw new Error('请在.env中配置DATABASE_URL后启动PostgreSQL模式')
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('数据库schema名称无效')
  const s = `"${schema}"`
  const pool = new pg.Pool({ connectionString, max: 8, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 })
  pool.on('error', error => console.error('PostgreSQL连接中断:', error.code || 'CONNECTION_ERROR'))
  async function writeData(client, data) {
    await client.query(`DELETE FROM ${s}.resource_assignments`)
    await client.query(`DELETE FROM ${s}.schedules`)
    await client.query(`DELETE FROM ${s}.schedule_versions`)
    await client.query(`DELETE FROM ${s}.vehicle_repairs`)
    await client.query(`DELETE FROM ${s}.reference_data`)
    for (const [key, value] of Object.entries(data)) {
      if (!separated.includes(key) && !localKeys.includes(key)) await client.query(`INSERT INTO ${s}.reference_data(collection,payload) VALUES($1,$2::jsonb)`, [key, JSON.stringify(value)])
    }
    for (const row of data.vehicleRepairs) await client.query(`INSERT INTO ${s}.vehicle_repairs VALUES($1,$2,$3,$4,$5,$6::jsonb)`, [row.id, row.locomotiveNo, row.plannedEntryAt, row.plannedExitAt, row.status, JSON.stringify(without(row, ['id', 'locomotiveNo', 'plannedEntryAt', 'plannedExitAt', 'status']))])
    for (const row of data.scheduleVersions) await client.query(`INSERT INTO ${s}.schedule_versions VALUES($1,$2,$3,$4::jsonb)`, [row.id, row.vehicleRepairId, row.status, JSON.stringify(without(row, ['id', 'vehicleRepairId', 'status']))])
    for (const row of data.schedules) await client.query(`INSERT INTO ${s}.schedules VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`, [row.id, row.vehicleRepairId, row.taskId, row.versionId, row.workstationId, row.plannedStartAt, row.plannedEndAt, row.status, !!row.isLocked, JSON.stringify(without(row, ['id', 'vehicleRepairId', 'taskId', 'versionId', 'workstationId', 'plannedStartAt', 'plannedEndAt', 'status', 'isLocked']))])
    for (const [kind, key, field] of assignmentTypes) for (const row of data[key]) await client.query(`INSERT INTO ${s}.resource_assignments VALUES($1,$2,$3,$4,$5::jsonb)`, [kind, row.id, row.scheduleTaskId, row[field], JSON.stringify(without(row, ['id', 'scheduleTaskId', field]))])
  }
  async function readData(client) {
    const data = createState()
    const refs = await client.query(`SELECT collection,payload FROM ${s}.reference_data`)
    for (const row of refs.rows) data[row.collection] = row.payload
    const vehicles = await client.query(`SELECT id,locomotive_no,status,details,${localTime('planned_entry_at')} AS entry,${localTime('requested_exit_at')} AS exit FROM ${s}.vehicle_repairs ORDER BY id`)
    data.vehicleRepairs = vehicles.rows.map(r => ({ ...r.details, id: Number(r.id), locomotiveNo: r.locomotive_no, plannedEntryAt: r.entry, plannedExitAt: r.exit, status: r.status }))
    const versions = await client.query(`SELECT * FROM ${s}.schedule_versions ORDER BY id`)
    data.scheduleVersions = versions.rows.map(r => ({ ...r.details, id: Number(r.id), vehicleRepairId: Number(r.vehicle_repair_id), status: r.status }))
    const schedules = await client.query(`SELECT *,${localTime('planned_start_at')} AS start,${localTime('planned_end_at')} AS end FROM ${s}.schedules ORDER BY id`)
    data.schedules = schedules.rows.map(r => ({ ...r.details, id: Number(r.id), vehicleRepairId: Number(r.vehicle_repair_id), taskId: Number(r.task_id), versionId: r.version_id == null ? null : Number(r.version_id), workstationId: Number(r.workstation_id), plannedStartAt: r.start, plannedEndAt: r.end, status: r.status, isLocked: r.is_locked }))
    const assignments = await client.query(`SELECT * FROM ${s}.resource_assignments ORDER BY kind,id`)
    for (const [kind, key, field] of assignmentTypes) data[key] = assignments.rows.filter(r => r.kind === kind).map(r => ({ ...r.details, id: Number(r.id), scheduleTaskId: Number(r.schedule_id), [field]: Number(r.resource_id) }))
    return data
  }
  return {
    pool, schema,
    async init({ snapshot } = {}) {
      const initialData = snapshot === undefined ? exportDemoSnapshot(createState()).data : parseDemoSnapshot(JSON.stringify(snapshot)).data
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`rail-maintenance:${schema}`])
        const sql = (await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8')).replaceAll('__SCHEMA__', s)
        await client.query(sql)
        const result = await client.query(`SELECT revision FROM ${s}.metadata WHERE singleton FOR UPDATE`)
        const initialized = Number(result.rows[0].revision) === 0
        if (initialized) {
          await writeData(client, initialData)
          await client.query(`UPDATE ${s}.metadata SET revision=1,updated_at=now() WHERE singleton`)
        }
        await client.query('COMMIT')
        return { initialized, revision: initialized ? 1 : Number(result.rows[0].revision) }
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    },
    async read() {
      const client = await pool.connect()
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        const meta = (await client.query(`SELECT revision,updated_at FROM ${s}.metadata WHERE singleton`)).rows[0]
        const data = await readData(client)
        await client.query('COMMIT')
        return { revision: Number(meta.revision), snapshot: { format: 'rail-maintenance-pc1', schemaVersion: 1, savedAt: meta.updated_at.toISOString(), data } }
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    },
    async save(revision, snapshot) {
      if (!Number.isSafeInteger(revision) || revision < 1) throw Object.assign(new Error('缺少有效的数据版本'), { status: 400 })
      let data
      try { data = parseDemoSnapshot(JSON.stringify(snapshot)).data }
      catch (error) { throw Object.assign(new Error(error.message), { status: 400 }) }
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const current = (await client.query(`SELECT revision FROM ${s}.metadata WHERE singleton FOR UPDATE`)).rows[0]
        if (Number(current.revision) !== revision) throw Object.assign(new Error('其他页面已更新数据库，请先备份当前修改，再加载数据库最新数据'), { status: 409 })
        await writeData(client, data)
        const meta = (await client.query(`UPDATE ${s}.metadata SET revision=revision+1,updated_at=now() WHERE singleton RETURNING revision,updated_at`)).rows[0]
        await client.query('COMMIT')
        return { revision: Number(meta.revision), savedAt: meta.updated_at.toISOString() }
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    },
    async health() { await pool.query('SELECT 1'); return { storage: 'postgresql', schema } },
    close() { return pool.end() },
  }
}
