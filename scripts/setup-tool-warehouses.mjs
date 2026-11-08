import fs from 'node:fs/promises'
import path from 'node:path'
import {createDatabase} from '../server/database.js'
import {loadConfig,projectRoot} from '../server/config.js'

export async function setupToolWarehouses(db,{backup=true}={}){
  const current=await db.read()
  if(current.snapshot.data.toolManagement?.warehousePolicy==='FIXED_TWO')return {changed:false}
  if(backup){
    const folder=path.join(projectRoot,'backups');await fs.mkdir(folder,{recursive:true})
    await fs.writeFile(path.join(folder,`before-fixed-tool-warehouses-${Date.now()}.json`),JSON.stringify(current))
  }
  const result=await db.toolCommand({type:'WAREHOUSE_STANDARDIZE',actor:'系统初始化',requestId:`tool-fixed-warehouses-${current.revision}`,revision:current.revision,payload:{}})
  return {changed:true,revision:result.revision}
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.join(projectRoot,'scripts','setup-tool-warehouses.mjs')){
  const db=createDatabase(loadConfig())
  try{console.log(JSON.stringify(await setupToolWarehouses(db)))}finally{await db.close()}
}
