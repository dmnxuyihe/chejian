import {toolObjectIdentity} from '../core/tool-management.js'
// View preferences never alter business state. Count edits are a durable outbox
// until the command has been acknowledged by the database.
const viewKey='rail.tools.table-view.v2'
const fields=['ledgerScope','query','queryDraft','warehouse','queryStatus','serviceQuery','borrowType','columnFilters','sortKey','sortDirection','selectedKeys','selectionIdentities','tableScroll']
export function reconcileToolSelection(rows,v){
 const previous=v.selectionIdentities||{},tokens={}
 v.selectedKeys=(v.selectedKeys||[]).filter(key=>{const e=rows.find(r=>r.key===key);if(!e)return false;const identity=toolObjectIdentity(e.asset||e.kit||e.tool,e.kit?'kit':e.asset?'asset':'tool');if(previous[key]&&previous[key]!==identity)return false;tokens[key]=identity;return true})
 v.selectionIdentities=tokens
}
export function restoreToolView(v){
 if(v.preferencesLoaded)return
 v.preferencesLoaded=true
 try{const p=JSON.parse(sessionStorage.getItem(viewKey)||'{}');for(const key of fields){const value=p[key];if(value===undefined)continue;if(key==='selectedKeys'){if(Array.isArray(value))v[key]=p.selectionIdentities?value.filter(x=>typeof x==='string'&&typeof p.selectionIdentities[x]==='string'):[]}else if(['columnFilters','tableScroll','queryDraft','selectionIdentities'].includes(key)){if(value&&typeof value==='object'&&!Array.isArray(value))v[key]=value}else if(typeof value==='string')v[key]=value}}catch{}
}
export function persistToolView(v){if(v.pageMode&&v.pageMode!=='ledger')return;try{sessionStorage.setItem(viewKey,JSON.stringify(Object.fromEntries(fields.map(k=>[k,v[k]]))))}catch{}}
let clientId
function countKey(count){
 if(!clientId){try{clientId=sessionStorage.getItem('rail.tools.count-client');if(!clientId){clientId=crypto.randomUUID();sessionStorage.setItem('rail.tools.count-client',clientId)}}catch{clientId='current-tab'}}
 return `rail.tools.count-outbox.v2:${clientId}:${count.id}:${count.at}`
}
export function readCountOutbox(count){try{const box=JSON.parse(localStorage.getItem(countKey(count))||'null');return box&&Number.isSafeInteger(box.progressRevision)&&typeof box.requestId==='string'&&box.changes&&Object.values(box.changes).every(n=>n===null||Number.isSafeInteger(n)&&n>=0)?box:null}catch{return null}}
export function writeCountOutbox(count,outbox){localStorage.setItem(countKey(count),JSON.stringify(outbox))}
export function clearCountOutbox(count){try{localStorage.removeItem(countKey(count))}catch{}}
const countSessions=new Map()
const countFields=['countDraft','countOutbox','countSaveState','countLocalDurable','countSavedAt','countSaveError','countSaving']
export function countRuntime(count){
 const key=`${count.id}:${count.at}`
 if(!countSessions.has(key)){
  const countDraft=Object.fromEntries(count.lines.map(l=>[l.assetId,{verified:l.counted!=null,present:Number(l.counted)>0,counted:l.counted??null}])),countOutbox=count.status==='OPEN'?readCountOutbox(count):null
  if(countOutbox)for(const [id,n] of Object.entries(countOutbox.changes))if(countDraft[id])countDraft[id]={verified:n!==null,present:n>0,counted:n}
  countSessions.set(key,{countId:count.id,countDraft,countOutbox,countSaveState:countOutbox?'pending':'saved',countLocalDurable:!!countOutbox,countSavedAt:count.updatedAt||null,countSaving:null,timer:null})
 }
 return countSessions.get(key)
}
export function countDrafts(v,count){
 const runtime=countRuntime(count);v.countDraftId=`${count.id}:${count.at}`
 if(count.status!=='OPEN'){runtime.countOutbox=null;runtime.countSaveState='saved';runtime.countSavedAt=count.finishedAt||count.updatedAt||null}
 for(const key of countFields)Object.defineProperty(v,key,{configurable:true,enumerable:true,get:()=>runtime[key],set:value=>runtime[key]=value})
}
export function reloadCountRuntime(v,count){
 const old=countRuntime(count);clearTimeout(old.timer);countSessions.delete(`${count.id}:${count.at}`);countDrafts(v,count)
}
