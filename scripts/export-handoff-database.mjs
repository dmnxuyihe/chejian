import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const {default:pg}=await import(pathToFileURL(ROOT+'/node_modules/pg/lib/index.js'))
const {loadConfig}=await import(pathToFileURL(ROOT+'/server/config.js'))
const cfg=loadConfig(),out=process.argv[2]
if(!out)throw Error('请指定数据库备份输出目录')
await fs.mkdir(out,{recursive:true})
const c=new pg.Client({connectionString:cfg.connectionString})
const quote=s=>'"'+s.replaceAll('"','""')+'"'
const run=promisify(execFile),bin=path.resolve(process.argv[3]||'C:/Program Files/PostgreSQL/16/bin')+path.sep
await c.connect()
try {
 await c.query("SET TIME ZONE 'UTC'")
 await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
 const snapshot=(await c.query('SELECT pg_export_snapshot() AS id')).rows[0].id
 const params=c.connectionParameters
 const env={...process.env,PGHOST:params.host,PGPORT:String(params.port),PGUSER:params.user,PGPASSWORD:params.password,PGDATABASE:params.database,PGCLIENTENCODING:'UTF8'}
 const base=['--no-owner','--no-acl','--snapshot='+snapshot]
 await run(bin+'pg_dump.exe',[...base,'--format=custom','--file='+path.join(out,'whole-database.dump')],{env,windowsHide:true,timeout:120000,maxBuffer:1024*1024})
 await run(bin+'pg_dump.exe',[...base,'--format=plain','--file='+path.join(out,'whole-database.sql')],{env,windowsHide:true,timeout:120000,maxBuffer:1024*1024})
 await run(bin+'pg_dump.exe',[...base,'--format=custom','--schema='+cfg.schema,'--file='+path.join(out,'pc1-business.dump')],{env,windowsHide:true,timeout:120000,maxBuffer:1024*1024})
 const tables=(await c.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT LIKE 'pg_%' AND schemaname<>'information_schema' ORDER BY 1,2")).rows
 const inventory=[]
 for(const {schemaname,tablename} of tables){
  const rows=(await c.query(`SELECT md5(to_jsonb(t)::text) AS h FROM ${quote(schemaname)}.${quote(tablename)} t ORDER BY h`)).rows
  inventory.push({schema:schemaname,table:tablename,rows:rows.length,contentSha256:createHash('sha256').update(rows.map(r=>r.h).join('\n')).digest('hex')})
 }
 const metadata=(await c.query(`SELECT revision,schema_version,updated_at FROM ${quote(cfg.schema)}.application_state WHERE singleton`)).rows[0]
 const media=(await c.query(`SELECT id,file_name,mime_type,octet_length(content) AS bytes,md5(content) AS md5 FROM ${quote(cfg.schema)}.pc1_maintenance_media ORDER BY id`)).rows
 const objects=(await c.query("SELECT n.nspname AS schema,c.relkind,count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' GROUP BY 1,2 ORDER BY 1,2")).rows
 const constraints=(await c.query("SELECT n.nspname AS schema,c.contype,count(*)::int AS count FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' GROUP BY 1,2 ORDER BY 1,2")).rows
 const database=(await c.query('SELECT current_database() AS name,version() AS version')).rows[0]
 const schemas=(await c.query("SELECT nspname AS name FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema' ORDER BY 1")).rows
 const info={exportedAt:new Date().toISOString(),database,schema:cfg.schema,metadata,schemas,tables:inventory,objects,constraints,media,scope:'Entire application database including all user schemas; no cluster accounts or passwords',transactionConsistent:true}
 await fs.writeFile(path.join(out,'database-inventory.json'),JSON.stringify(info,null,2))
 await c.query('COMMIT')
 const toc=await run(bin+'pg_restore.exe',['--list',path.join(out,'whole-database.dump')],{windowsHide:true,encoding:'utf8',maxBuffer:8*1024*1024})
 await fs.writeFile(path.join(out,'archive-contents.txt'),toc.stdout)
 console.log(JSON.stringify({passed:true,exportedAt:info.exportedAt,revision:metadata.revision,tables:tables.length,schemas:schemas.map(s=>s.name),pc1Tables:tables.filter(t=>t.schemaname===cfg.schema).length,media:media.length,mediaBytes:media.reduce((s,m)=>s+m.bytes,0)}))
}catch(e){await c.query('ROLLBACK').catch(()=>{});console.error('Export failed: '+(e.code||e.name));process.exitCode=1}finally{await c.end()}
