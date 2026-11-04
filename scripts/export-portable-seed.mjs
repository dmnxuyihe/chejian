import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import pg from 'pg'
import { loadConfig } from '../server/config.js'
const [destination,pgDump]=process.argv.slice(2)
if(!destination||!pgDump)throw Error('需要输出文件及pg_dump路径')
const config=loadConfig(),client=new pg.Client({connectionString:config.connectionString})
await fs.mkdir(path.dirname(destination),{recursive:true})
await client.connect()
try {
  const p=client.connectionParameters
  await promisify(execFile)(pgDump,['--format=custom','--no-owner','--no-acl','--schema='+config.schema,'--file='+destination],{windowsHide:true,env:{...process.env,PGHOST:p.host,PGPORT:String(p.port),PGUSER:p.user,PGPASSWORD:p.password,PGDATABASE:p.database},timeout:60000})
  const media=await client.query(`SELECT count(*)::int AS count FROM "${config.schema}".pc1_maintenance_media`)
  await fs.writeFile(path.join(path.dirname(destination),'seed-info.json'),JSON.stringify({schema:config.schema,exportedAt:new Date().toISOString(),mediaFiles:media.rows[0].count},null,2))
  console.log(JSON.stringify({schema:config.schema,mediaFiles:media.rows[0].count,bytes:(await fs.stat(destination)).size}))
} finally {await client.end()}
