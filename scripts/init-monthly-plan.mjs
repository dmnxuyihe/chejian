import fs from 'node:fs/promises'
import pg from 'pg'
import { loadConfig } from '../server/config.js'
import { createDatabase } from '../server/database.js'
import { ensurePlanningDemoData } from '../src/data/planning-demo-data.js'

let client, appDatabase
try {
  const config = loadConfig()
  const schema = config.schema
  const quotedSchema = `"${schema.replaceAll('"', '""')}"`
  const sqlPath = new URL('../server/monthly_plan_init.sql', import.meta.url)
  let sql = await fs.readFile(sqlPath, 'utf8')
  sql = sql
    .replace('CREATE SCHEMA IF NOT EXISTS pc1;', `CREATE SCHEMA IF NOT EXISTS ${quotedSchema};`)
    .replace('SET LOCAL search_path TO pc1, public;', `SET LOCAL search_path TO ${quotedSchema}, public;`)

  client = new pg.Client({ connectionString: config.connectionString, connectionTimeoutMillis: 5000 })
  await client.connect()
  await client.query(sql)

  const tables = [
    'monthly_plan_import_batch', 'monthly_plan_import_item', 'monthly_plan',
    'monthly_plan_version', 'monthly_plan_vehicle', 'monthly_plan_schedule_snapshot',
    'plan_approval_instance', 'plan_approval_action', 'plan_attachment',
    'monthly_plan_verification',
  ]
  const counts = {}
  for (const table of tables) {
    const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${quotedSchema}."${table}"`)
    counts[table] = result.rows[0].count
  }
  appDatabase = createDatabase(config)
  const current = await appDatabase.read()
  const appCaseAdded = ensurePlanningDemoData(current.snapshot.data)
  if (appCaseAdded) await appDatabase.save(current.revision, current.snapshot)
  console.log(JSON.stringify({
    initialized: true,
    schema,
    sql: new URL('../server/monthly_plan_init.sql', import.meta.url).pathname,
    counts,
    appCaseAdded,
    approvalCase: { monthlyPlanId: 10001, currentVersionId: 11002, approvalInstanceId: 14002 },
  }, null, 2))
} catch (error) {
  const code = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'ERROR'
  const position = error.position ? `，SQL位置 ${error.position}` : ''
  console.error(`月度计划初始化失败（${code}${position}）：${String(error.message || '未知错误').replace(/postgresql:\/\/[^\s]+/gi, '[连接信息已隐藏]')}`)
  process.exitCode = 1
} finally {
  await appDatabase?.close()
  await client?.end()
}
