import {createInterface} from 'node:readline/promises'
import {Writable} from 'node:stream'
import {randomUUID} from 'node:crypto'
import {createDatabase} from '../server/database.js'
import {loadConfig} from '../server/config.js'
import {passwordHash} from '../server/auth.js'
// This is a local administrator command, never an anonymous registration API.
if(!process.stdin.isTTY)throw Error('请在本机终端交互运行 npm run auth:user')
let muted=false
const output=new Writable({write(chunk,encoding,done){if(!muted)process.stdout.write(chunk,encoding);done()}}),prompt=createInterface({input:process.stdin,output,terminal:true})
let db
try{
 const username=(await prompt.question('账号（字母、数字、._-）：')).trim().toLowerCase(),name=(await prompt.question('经办人姓名：')).trim()
 process.stdout.write('密码（至少12位，输入隐藏）：');muted=true;const password=await prompt.question('');muted=false;process.stdout.write('\n再次输入密码：');muted=true;const confirmation=await prompt.question('');muted=false;process.stdout.write('\n')
 if(!/^[a-z0-9_.-]{2,64}$/.test(username)||!name||name.length>80||password.length<12||password.length>128)throw Error('账号、姓名或密码长度不符合要求')
 if(password!==confirmation)throw Error('两次密码不一致，未创建账号')
 db=createDatabase(loadConfig());await db.init();await db.pool.query(`INSERT INTO "${db.schema}".login_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4)`,[randomUUID(),username,name,await passwordHash(password)])
 console.log(`已创建账号：${username}（${name}）`)
}catch(e){console.error(e.code==='23505'?'账号或经办人姓名已存在，未重复创建':e.message);process.exitCode=1}finally{prompt.close();await db?.close()}
