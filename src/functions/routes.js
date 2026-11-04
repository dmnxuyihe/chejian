import { roles } from '../roles/index.js'
import { demoRoute } from '../demo/index.js'
import { functionEntries, functionForSource } from './catalog.js'

export const defaultFunctionEntry = functionEntries.find(entry=>entry.id==='monthly-calendar')
const start = () => ({type:'function',entry:defaultFunctionEntry})
export function resolveFunctionRoute(hash='') {
  const raw=hash.replace(/^#\/?/,'').replace(/\/+$/,'')
  if(!raw || raw==='select' || raw==='functions')return start()
  if(raw==='functions/catalog')return {type:'catalog'}
  if(raw.startsWith('functions/')){
    const [,group,id]=raw.split('/')
    const entry=functionEntries.find(item=>item.group===group&&item.id===id)
    return entry?{type:'function',entry}:start()
  }
  const [roleId,pageId]=raw.split('/')
  if(roleId==='demo')return {type:'demo',demo:demoRoute(pageId)}
  const entry=roles[roleId]&&functionForSource(roleId,pageId)
  return entry?{type:'function',entry}:start()
}
