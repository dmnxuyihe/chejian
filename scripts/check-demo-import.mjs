import fs from 'node:fs/promises'
import pg from 'pg'
import { loadConfig } from '../server/config.js'
import { createPlanningService } from '../server/planning.js'

const file=process.argv[2]
if(!file)throw Error('请指定演示导入表路径')
const config=loadConfig()
const pool=new pg.Pool({connectionString:config.connectionString})
try {
  const service=createPlanningService({pool,schema:config.schema})
  const result=await service.preview({sessionId:'packaging-demo-validation',importType:'MONTHLY',month:'2026-11',filename:'两车月度计划_主流程.xlsx',contentBase64:(await fs.readFile(file)).toString('base64')})
  if(result.total!==2 || result.importable!==2 || result.errors!==0){
    const errors=result.rows.flatMap(row=>row.errors.map(error=>`${row.data.locomotiveNo || '未填写车号'}：${error.message}`))
    throw Error('随包导入演示表必须可新增2条计划。请更新车号和交接说明后再打包。'+errors.join('；'))
  }
  console.log(JSON.stringify({passed:true,scope:'read-only import preview',rows:result.total,importable:result.importable,errors:result.errors,vehicles:result.rows.map(row=>row.data.locomotiveNo)}))
} finally {await pool.end()}
