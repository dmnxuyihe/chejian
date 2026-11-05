import { loadConfig } from '../server/config.js'
import { createDatabase } from '../server/database.js'

const config = loadConfig()
if (process.argv[2] !== `--confirm=${config.schema}`) throw new Error(`必须显式传入 --confirm=${config.schema}`)
if (!/^[a-z][a-z0-9_]{0,62}$/.test(config.schema)) throw new Error('数据库 schema 名称无效')

const database = createDatabase(config)
try {
  const before = await database.read()
  const quoted = `"${config.schema.replaceAll('"', '""')}"`
  await database.pool.query(`DROP SCHEMA ${quoted} CASCADE`)
  const initialized = await database.init()
  const after = await database.read()
  console.log(JSON.stringify({
    schema: config.schema,
    previousRevision: before.revision,
    initialized: initialized.initialized,
    revision: after.revision,
    vehicles: after.snapshot.data.vehicleRepairs.length,
    schedules: after.snapshot.data.schedules.length,
    approvalFlows: after.snapshot.data.planApprovalFlows.length,
    monthlyVerificationRecords: after.snapshot.data.monthlyVerificationRecords.length,
  }, null, 2))
} finally {
  await database.close()
}
