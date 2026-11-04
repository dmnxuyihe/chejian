import http from 'node:http'
import { createDatabase } from '../server/database.js'
import { loadConfig } from '../server/config.js'
import { createHandler } from '../server/http.js'

const schema = `pc1_test_ui_${Date.now()}_${process.pid}`
const db = createDatabase({...loadConfig(),schema})
await db.init()
const server = http.createServer(createHandler(db))
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
process.stdout.write(`${JSON.stringify({base:`http://127.0.0.1:${server.address().port}`,schema})}\n`)
let closing = false
async function close() {
  if (closing) return
  closing = true
  await new Promise(resolve => server.close(resolve))
  if (!/^pc1_test_ui_\d+_\d+$/.test(schema)) throw new Error('测试数据区名称无效')
  await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await db.close()
  process.exit(0)
}
process.stdin.on('data',close)
process.stdin.on('end',close)
process.on('SIGTERM',close)
process.on('SIGINT',close)
