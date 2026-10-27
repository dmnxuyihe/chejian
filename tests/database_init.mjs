import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createDatabase } from '../server/database.js'
import { loadConfig, projectRoot } from '../server/config.js'
import { exportDemoSnapshot } from '../src/core/demo-persistence.js'
import { createState } from '../src/core/state.js'

const config = loadConfig()
const schema = `pc1_test_${Date.now()}_${process.pid}`
const seedSchema = `${schema}_seed`
const db = createDatabase({ ...config, schema })
const seeded = createDatabase({ ...config, schema: seedSchema })
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pc1-init-'))
const seedFile = path.join(temp, 'demo backup.json')
const invalidFile = path.join(temp, 'invalid.json')
function cli(target, command, args = [], env = {}) {
  const result = spawnSync(process.execPath, ['scripts/database.mjs', command, ...args], {
    cwd: projectRoot, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, DATABASE_URL: config.connectionString, PC1_DB_SCHEMA: target, ...env },
  })
  assert.ifError(result.error)
  if (config.connectionString) assert.ok(!(result.stdout + result.stderr).includes(config.connectionString), '命令不得输出连接URL')
  return result
}
try {
  assert.equal(cli(schema, 'check').status, 1, '检查命令不能自动建表')
  const first = cli(schema, 'init')
  assert.equal(first.status, 0, first.stderr)
  assert.equal(JSON.parse(first.stdout).initialized, true)
  const original = await db.read()
  assert.equal(original.snapshot.data.schedules.length, 20)
  original.snapshot.data.vehicleRepairs[0].locomotiveNo = 'INIT-KEPT'
  const saved = await db.save(original.revision, original.snapshot)
  const repeated = cli(schema, 'init')
  assert.equal(repeated.status, 0, repeated.stderr)
  assert.equal(JSON.parse(repeated.stdout).initialized, false)
  assert.equal(JSON.parse(repeated.stdout).revision, saved.revision)
  assert.deepEqual((await db.read()).snapshot.data, original.snapshot.data, '重复初始化保留业务修改')
  assert.equal(cli(schema, 'check').status, 0)

  const snapshot = exportDemoSnapshot(createState())
  snapshot.data.vehicleRepairs[0].locomotiveNo = 'SEEDED-PRESENT'
  await fs.writeFile(seedFile, JSON.stringify(snapshot))
  const imported = cli(seedSchema, 'init', ['--seed', seedFile])
  assert.equal(imported.status, 0, imported.stderr)
  assert.equal((await seeded.read()).snapshot.data.vehicleRepairs[0].locomotiveNo, 'SEEDED-PRESENT')
  assert.equal(cli(schema, 'init', [`--seed=${seedFile}`]).status, 0)
  assert.equal((await db.read()).snapshot.data.vehicleRepairs[0].locomotiveNo, 'INIT-KEPT', '携带备份也不能覆盖已有库')

  await fs.writeFile(invalidFile, '{invalid}')
  assert.equal(cli(schema, 'init', ['--seed', invalidFile]).status, 1)
  assert.equal((await db.read()).revision, saved.revision)
  assert.equal(cli(schema, 'init', ['--seed']).status, 1)
  assert.equal(cli(schema, 'init', [], { DATABASE_URL: '' }).status, 1)
  assert.equal(cli(schema, 'init', [], { PC1_DB_SCHEMA: '../invalid' }).status, 1)
  console.log('PASS: 初始化命令首次建表、重复保留、备份迁移、只读检查、配置和备份错误；已验证真实PostgreSQL。')
} finally {
  for (const target of [schema, seedSchema]) {
    assert.ok(/^pc1_test_\d+_\d+(_seed)?$/.test(target))
    await db.pool.query(`DROP SCHEMA IF EXISTS "${target}" CASCADE`)
  }
  await Promise.all([db.close(), seeded.close()])
  await fs.rm(seedFile, { force: true })
  await fs.rm(invalidFile, { force: true })
  await fs.rmdir(temp)
}
