import fs from 'node:fs/promises'
import { loadConfig } from '../server/config.js'
import { createDatabase } from '../server/database.js'
import { parseDemoSnapshot } from '../src/core/demo-persistence.js'

const usage = '用法：npm run db:init [-- --seed="备份.json"] 或 npm run db:check'
const [command, ...args] = process.argv.slice(2)
let database, stage = '读取配置'
try {
  if (!['init', 'check'].includes(command)) throw new Error(usage)
  let seedFile
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (command === 'init' && seedFile === undefined && (arg === '--seed' || arg.startsWith('--seed='))) {
      seedFile = arg === '--seed' ? args[++i] : arg.slice(7)
      if (!seedFile || seedFile.startsWith('--')) throw new Error(usage)
    } else throw new Error(usage)
  }
  let snapshot
  if (seedFile !== undefined) {
    stage = '读取初始化备份'
    if ((await fs.stat(seedFile)).size > 12 * 1024 * 1024) throw new Error('备份超过12MB')
    snapshot = parseDemoSnapshot(await fs.readFile(seedFile, 'utf8'))
  }
  stage = '读取配置'
  const config = loadConfig()
  database = createDatabase(config)
  stage = command === 'init' ? '初始化数据库' : '检查数据库'
  const result = command === 'init' ? await database.init({ snapshot }) : null
  const { revision, snapshot: saved } = await database.read()
  console.log(JSON.stringify({
    storage: 'postgresql', schema: config.schema, revision,
    ...(result ? { initialized: result.initialized, message: result.initialized ? '已建表并写入初始数据' : '已有数据，已保留；未覆盖或追加初始数据' } : { message: '连接与数据读取正常' }),
    vehicles: saved.data.vehicleRepairs.length,
    tasks: saved.data.schedules.length,
    assignments: saved.data.employeeAssignments.length + saved.data.equipmentAssignments.length + saved.data.componentAssignments.length,
  }, null, 2))
} catch (error) {
  // Do not print connection strings, driver messages or stacks containing credentials.
  const code = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'ERROR'
  const hint = error.message === usage ? usage
    : stage === '读取初始化备份' ? '请使用页面导出的PC1 JSON备份，并检查文件路径、格式和大小。'
    : code === '3D000' ? '目标数据库不存在，请先创建空数据库，再运行db:init。'
    : code === '42P01' || code === '3F000' ? '数据表尚未初始化，请先运行npm run db:init。'
    : '请检查.env中的DATABASE_URL、PC1_DB_SCHEMA，以及数据库服务和账号权限。'
  console.error(`${stage}失败（${code}）。${hint}`)
  process.exitCode = 1
} finally {
  await database?.close()
}
