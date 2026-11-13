import {randomUUID,createHash} from 'node:crypto'
import {passwordHash} from '../server/auth.js'
const sessions=new WeakMap()
export async function toolTestSession(db,base,name='测试经办'){
 if(!/^(tool_[a-z0-9_]+|pc1_test_[a-z0-9_]+)$/.test(db.schema))throw Error('Test accounts are only allowed in isolated test schemas')
 let cache=sessions.get(db);if(!cache){cache=new Map();sessions.set(db,cache)}
 if(cache.has(name))return cache.get(name)
 const pending=(async()=>{
 const username='test-'+createHash('sha256').update(name).digest('hex').slice(0,16),password=randomUUID()+'-test'
 await db.pool.query(`INSERT INTO "${db.schema}".login_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4)`,[randomUUID(),username,name,await passwordHash(password)])
 const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})})
 if(!response.ok)throw Error(await response.text());return response.headers.get('set-cookie').split(';')[0]
 })();cache.set(name,pending);return pending
}
export async function authenticateTestPage(page,db,base,name='合版界面测试员'){
 const cookie=await toolTestSession(db,base,name),separator=cookie.indexOf('=')
 await page.context().addCookies([{name:cookie.slice(0,separator),value:cookie.slice(separator+1),url:base,httpOnly:true,sameSite:'Strict'}])
}
