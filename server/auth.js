import {randomBytes,randomUUID,scrypt as derive,timingSafeEqual,createHash} from 'node:crypto'
import {promisify} from 'node:util'
const scrypt=promisify(derive),hash=value=>createHash('sha256').update(value).digest('hex')
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})}
const cookieName='workshop_session',age=8*60*60
export const isLocalSetup=req=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&!req.headers['x-forwarded-for']&&!req.headers['cf-connecting-ip']&&['localhost','127.0.0.1','[::1]'].includes(new URL('http://'+req.headers.host).hostname)
const safeUser=row=>row?{id:row.id,username:row.username,name:row.display_name}:null
const token=req=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)||''
export async function passwordHash(password){const salt=randomBytes(16).toString('hex');return salt+':'+Buffer.from(await scrypt(password,salt,64)).toString('hex')}
export async function checkPassword(password,encoded){const [salt,key]=encoded.split(':');const actual=Buffer.from(await scrypt(password,salt,64)),expected=Buffer.from(key,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected)}
export function createAuth(db){
 const table='"'+db.schema+'"',attempts=new Map()
 const secure=req=>req.socket.encrypted||req.headers['x-forwarded-proto']==='https'
 const setCookie=(req,res,value,maxAge=age)=>res.setHeader('Set-Cookie',`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure(req)?'; Secure':''}`)
 async function user(req){const value=token(req);if(!/^[a-f0-9]{64}$/.test(value))return null;return safeUser((await db.pool.query(`SELECT u.* FROM ${table}.login_sessions s JOIN ${table}.login_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active`,[hash(value)])).rows[0])}
 async function requireUser(req){const current=await user(req);if(!current)fail('请先登录，再办理业务',401);return current}
 async function status(req){return {user:await user(req),setupRequired:!(await db.pool.query(`SELECT 1 FROM ${table}.login_users LIMIT 1`)).rowCount,canSetup:isLocalSetup(req)}}
 async function session(req,res,row){const value=randomBytes(32).toString('hex');await db.pool.query(`DELETE FROM ${table}.login_sessions WHERE expires_at<=now()`);await db.pool.query(`INSERT INTO ${table}.login_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')`,[hash(value),row.id]);setCookie(req,res,value);return {user:safeUser(row)}}
 async function setup(req,res,input){
  if(!isLocalSetup(req))fail('首次账号请在运行服务的电脑上，使用 localhost 地址创建',403)
  const username=String(input.username||'').trim().toLowerCase(),name=String(input.name||'').trim(),password=input.password
  if(!/^[a-z0-9_.-]{2,64}$/.test(username)||!name||name.length>80||typeof password!=='string'||password.length<12||password.length>128)fail('账号需为2至64位字母、数字或._-；请填写姓名，并设置12至128位密码')
  const encoded=await passwordHash(password),client=await db.pool.connect();let row
  try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`login-setup:${db.schema}`]);if((await client.query(`SELECT 1 FROM ${table}.login_users LIMIT 1`)).rowCount)fail('账号已初始化，请使用已有账号登录',409);row=(await client.query(`INSERT INTO ${table}.login_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4) RETURNING *`,[randomUUID(),username,name,encoded])).rows[0];await client.query('COMMIT')}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  return session(req,res,row)
 }
 async function login(req,res,input){
  const username=String(input.username||'').trim().toLowerCase(),password=input.password
  if(username.length>64||typeof password!=='string'||password.length>128)fail('账号或密码错误',401)
  const key=hash(username),now=Date.now();for(const [k,v] of attempts)if(v.until<=now)attempts.delete(k)
  if(attempts.size>10000)fail('登录请求过多，请稍后重试',429)
  const rate=attempts.get(key)||{count:0,until:now+15*60*1000};if(rate.count>=8)fail('失败次数过多，请15分钟后再试',429)
  rate.count++;attempts.set(key,rate)
  const row=(await db.pool.query(`SELECT * FROM ${table}.login_users WHERE username=$1 AND active`,[username])).rows[0]
  // A dummy derivation keeps unknown-account requests on the same slow path.
  const ok=await checkPassword(password,row?.password_hash||'00000000000000000000000000000000:'+ '00'.repeat(64))
  if(!row||!ok)fail('账号或密码错误',401)
  attempts.delete(key);return session(req,res,row)
 }
 async function logout(req,res){await db.pool.query(`DELETE FROM ${table}.login_sessions WHERE token_hash=$1`,[hash(token(req))]);setCookie(req,res,'',0);return {ok:true}}
 return {user,requireUser,status,setup,login,logout}
}
