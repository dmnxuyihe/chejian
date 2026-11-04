// Copied with the app into the Windows offline distribution. No installed service.
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { randomBytes, createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import pg from 'pg'
import { createDatabase } from '../server/database.js'
import { createHandler } from '../server/http.js'

const run = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const dataDir = path.join(root,'data'), runtimeFile = path.join(dataDir,'running.json')
let nativeRoot=root, cluster=path.join(dataDir,'postgres'), bin=path.join(root,'runtime/postgresql/bin')
const lockFile = path.join(dataDir,'launcher.lock')
const args = process.argv.slice(2)
const noOpen = args.includes('--no-open')
let db, server, ownedPg=false, lockOwned=false, stopping=false, connectionString, config, childEnv, identity
const exists = async file => fs.access(file).then(()=>true,()=>false)
const readJson = async file => JSON.parse(await fs.readFile(file,'utf8'))
const writeJson = (file,value) => fs.writeFile(file,JSON.stringify(value,null,2),'utf8')
const pgRun = (name, argv, env=process.env) => run(path.join(bin,name+'.exe'),argv,{env:{...env,PATH:bin+path.delimiter+(env.PATH||'')},windowsHide:true,timeout:120000,maxBuffer:2*1024*1024})
const safeMessage = error => String(error.message||error.code||'启动失败').replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[数据库连接已隐藏]')
function portValue(value,label) { if(!Number.isInteger(value)||value<0||value>65535)throw Error(label+'应为0到65535的整数');return value }
async function freePort(preferred) {
  for(let i=0;i<25;i++) {
    const port=preferred===0?0:preferred+i
    if(port>65535)break
    const probe=net.createServer()
    try { await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(port,'127.0.0.1',resolve)});const found=probe.address().port;await new Promise(r=>probe.close(r));return found }
    catch(error){if(!['EADDRINUSE','EACCES'].includes(error.code))throw error}
  }
  throw Error('附近端口均被占用，请修改config.json中的端口。')
}
function cliPort(name,fallback) { const value=args.find(arg=>arg.startsWith('--'+name+'='));return portValue(value?Number(value.split('=')[1]):fallback,name) }
async function prepareNativePaths() {
  if(/^[\x20-\x7e]+$/.test(root))return
  // PostgreSQL Windows tools may pass ANSI paths into UTF-8 bootstrap SQL.
  // A junction is only a second name; database files still live inside the package.
  const name=createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0,20)
  for(const parent of [process.env.LOCALAPPDATA,os.tmpdir(),process.env.PUBLIC&&path.join(process.env.PUBLIC,'Documents')].filter(Boolean)) {
    if(!/^[\x20-\x7e]+$/.test(parent))continue
    const alias=path.join(parent,'PC1PortablePaths',name)
    try {
      await fs.mkdir(path.dirname(alias),{recursive:true})
      if(!(await exists(alias)))await fs.symlink(root,alias,'junction')
      if((await fs.realpath(alias)).toLowerCase()!==(await fs.realpath(root)).toLowerCase())continue
      nativeRoot=alias;cluster=path.join(alias,'data/postgres');bin=path.join(alias,'runtime/postgresql/bin');return
    }catch{}
  }
  throw Error('无法建立中文路径兼容入口。请将文件夹解压到纯英文可写路径（如D:\\PC1Demo）。')
}
async function activeState() {
  try {
    const state=await readJson(runtimeFile)
    if(state.root!==root||!Number.isInteger(state.httpPort)||!/^[a-f0-9]{48}$/.test(state.token))return null
    const response=await fetch(`http://127.0.0.1:${state.httpPort}/__portable__/info`,{headers:{Authorization:'Bearer '+state.token},signal:AbortSignal.timeout(2500)})
    if(response.ok && (await response.json()).instance===state.token)return state
  } catch {}
  return null
}
async function openBrowser(url) {
  if(noOpen)return
  // URL is generated from a validated local numeric port.
  await run('cmd.exe',['/d','/c','start','',url],{windowsHide:true}).catch(()=>console.log('请手动打开：'+url))
}
function pgEnvironment(url) {
  const value=new URL(url)
  return {...process.env,PGHOST:value.hostname.replace(/^\[|\]$/g,''),PGPORT:value.port||'5432',PGUSER:decodeURIComponent(value.username),PGPASSWORD:decodeURIComponent(value.password),PGDATABASE:decodeURIComponent(value.pathname.slice(1)),PGSSLMODE:value.searchParams.get('sslmode')||'prefer'}
}
async function shutdown() {
  if(stopping)return
  stopping=true
  console.log('\n正在保存连接并停止演示…')
  if(server) { server.closeIdleConnections();await new Promise(resolve=>server.close(resolve)) }
  await db?.close()
  if(ownedPg)await pgRun('pg_ctl',['stop','-D',cluster,'-m','fast','-w','-t','90']).catch(error=>console.error('数据库停止未完成，请使用停止演示按钮重试。',error.code||''))
  if(identity && (await readJson(runtimeFile).catch(()=>null))?.token===identity.token)await fs.unlink(runtimeFile).catch(()=>{})
  if(lockOwned)await fs.unlink(lockFile).catch(()=>{})
}
async function backup() {
  const dir=path.join(root,'backups');await fs.mkdir(dir,{recursive:true})
  const name='PC1_'+new Date().toISOString().replace(/[:.]/g,'-')+'.dump'
  const destination=path.join(dir,name)
  await pgRun('pg_dump',['--format=custom','--no-owner','--no-acl','--file='+path.join(nativeRoot,'backups',name)],childEnv)
  return destination
}
async function requestCommand(command) {
  const state=await activeState()
  if(!state)throw Error('当前没有运行中的演示。请先双击“启动演示.bat”。')
  const response=await fetch(`http://127.0.0.1:${state.httpPort}/__portable__/${command}`,{method:command==='info'?'GET':'POST',headers:{Authorization:'Bearer '+state.token},signal:AbortSignal.timeout(60000)})
  const result=await response.json()
  if(!response.ok)throw Error(result.message||'操作未完成')
  console.log(command==='backup'?'完整数据库备份：'+result.file:command==='stop'?'已请求停止演示。':JSON.stringify({...result,instance:undefined},null,2))
}
async function acquireLock() {
  try { const handle=await fs.open(lockFile,'wx');await handle.writeFile(JSON.stringify({pid:process.pid,root}));await handle.close();lockOwned=true }
  catch(error) {
    if(error.code!=='EEXIST')throw error
    const old=await readJson(lockFile).catch(()=>null)
    if(!old||old.root!==root||!Number.isInteger(old.pid))throw Error('启动锁格式异常，请检查data/launcher.lock。')
    let alive=true;try{process.kill(old.pid,0)}catch(e){alive=e.code!=='ESRCH'}
    if(alive)throw Error('此目录中的演示正在启动，请稍候，避免连续双击。')
    await fs.unlink(lockFile);await acquireLock()
  }
}
async function startPortableDatabase() {
  await pgRun('pg_ctl',['--version']).catch(()=>{throw Error('无法运行内置PostgreSQL。若提示缺少运行库，请先安装support/vcredist_x64.exe，然后重试。')})
  const credentialsFile=path.join(dataDir,'local-database.json')
  let credentials=await readJson(credentialsFile).catch(()=>null)
  if(!(await exists(path.join(cluster,'PG_VERSION')))) {
    credentials={user:'pc1_demo',password:randomBytes(30).toString('base64url'),database:'workshop_demo'}
    await writeJson(credentialsFile,credentials)
    const pw=path.join(nativeRoot,'data','.init-password')
    try { await fs.writeFile(pw,credentials.password+'\n','utf8');console.log('首次启动：建立独立数据库…');await pgRun('initdb',['-D',cluster,'--username='+credentials.user,'--pwfile='+pw,'--encoding=UTF8','--locale=C','--auth-host=scram-sha-256','--auth-local=scram-sha-256']) }
    finally { await fs.unlink(pw).catch(()=>{}) }
  }
  if(!credentials?.password)throw Error('独立数据库凭据缺失，不能覆盖已有数据。请从完整备份恢复。')
  let running=false
  try { await pgRun('pg_ctl',['status','-D',cluster]);running=true }catch{}
  let port
  if(running) { const pid=await fs.readFile(path.join(cluster,'postmaster.pid'),'utf8');port=portValue(Number(pid.split(/\r?\n/)[3]),'现有数据库端口') }
  else {
    port=await freePort(cliPort('db-port',config.databasePort))
    await pgRun('pg_ctl',['start','-D',cluster,'-l',path.join(nativeRoot,'data/postgres.log'),'-w','-t','35','-o',`-p ${port} -h 127.0.0.1 -c shared_buffers=64MB -c max_connections=30`])
  }
  ownedPg=true
  const admin=new pg.Client({host:'127.0.0.1',port,user:credentials.user,password:credentials.password,database:'postgres'})
  await admin.connect()
  try { const found=await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[credentials.database]);if(!found.rowCount)await admin.query('CREATE DATABASE "workshop_demo"') }
  finally { await admin.end() }
  connectionString=`postgresql://${encodeURIComponent(credentials.user)}:${encodeURIComponent(credentials.password)}@127.0.0.1:${port}/${credentials.database}`
  return port
}
async function main() {
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('本免安装包适用于Windows 10/11的64位x64电脑。')
  if(args.includes('--stop'))return requestCommand('stop')
  if(args.includes('--backup'))return requestCommand('backup')
  if(args.includes('--check'))return requestCommand('info')
  config=await readJson(path.join(root,'config.json'))
  if(!['portable','external'].includes(config.mode))throw Error('config.json的mode应为portable或external。')
  config.schema ||= 'pc1'
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(config.schema))throw Error('数据库schema格式无效。')
  const existing=await activeState()
  if(existing) { console.log('演示已在运行：'+existing.url);await openBrowser(existing.url);return }
  await fs.mkdir(dataDir,{recursive:true});await acquireLock()
  await prepareNativePaths()
  const databasePort=config.mode==='portable'?await startPortableDatabase():null
  if(config.mode==='external') { if(!config.databaseUrl?.startsWith('postgres'))throw Error('请在config.json中配置databaseUrl。');connectionString=config.databaseUrl }
  childEnv=pgEnvironment(connectionString)
  const client=new pg.Client({connectionString});await client.connect()
  try {
    const found=await client.query('SELECT to_regclass($1) AS meta',[config.schema+'.application_state'])
    if(!found.rows[0].meta) {
      if(config.schema!==config.seedSchema)throw Error('空数据库初始化需使用与演示备份相同的schema：'+config.seedSchema)
      console.log('首次启动：恢复演示数据、图片和视频…')
      await pgRun('pg_restore',['--no-owner','--no-privileges','--exit-on-error','--single-transaction','--dbname='+childEnv.PGDATABASE,path.join(nativeRoot,'seed/current-demo.dump')],childEnv)
    }
  } finally { await client.end() }
  db=createDatabase({connectionString,schema:config.schema});await db.init()
  const httpPort=await freePort(cliPort('http-port',config.httpPort))
  const entry=config.entry==='roles'?'/#/select':'/demo.html#/demo/calendar'
  identity={root,httpPort,databasePort,url:`http://127.0.0.1:${httpPort}${entry}`,token:randomBytes(24).toString('hex'),pid:process.pid}
  const handler=createHandler(db)
  server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost')
    if(!url.pathname.startsWith('/__portable__/'))return handler(req,res)
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store')
    if(req.headers.authorization!=='Bearer '+identity.token){res.writeHead(403);return res.end(JSON.stringify({message:'无效控制请求'}))}
    try {
      if(url.pathname==='/__portable__/info'&&req.method==='GET') {const data=await db.read();return res.end(JSON.stringify({instance:identity.token,url:identity.url,storage:'postgresql',schema:config.schema,vehicles:data.snapshot.data.vehicleRepairs.length,tasks:data.snapshot.data.schedules.length,records:data.snapshot.data.maintenanceRecords.length}))}
      if(url.pathname==='/__portable__/backup'&&req.method==='POST')return res.end(JSON.stringify({file:await backup()}))
      if(url.pathname==='/__portable__/stop'&&req.method==='POST'){res.end(JSON.stringify({stopping:true}));setImmediate(()=>shutdown().then(()=>process.exit(0)));return}
      res.writeHead(404);res.end(JSON.stringify({message:'未知控制命令'}))
    }catch(error){res.writeHead(500);res.end(JSON.stringify({message:safeMessage(error)}))}
  })
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(httpPort,'127.0.0.1',resolve)})
  await writeJson(runtimeFile,identity)
  console.log('\nPC1 演示已启动：'+identity.url+'\n数据保存在本目录的data文件夹。\n停止时请双击“停止演示.bat”，或在本窗口按Ctrl+C。')
  console.log('PC1_PORTABLE_READY '+JSON.stringify({httpPort,databasePort,url:identity.url}))
  await openBrowser(identity.url)
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>shutdown().then(()=>process.exit(0)))
main().catch(async error=>{console.error('操作未完成：'+safeMessage(error));await shutdown();process.exitCode=1})
