// View preferences never alter business state. Count edits are a durable outbox
// until the command has been acknowledged by the database.
const viewKey='rail.tools.table-view.v2'
const fields=['query','warehouse','queryStatus','serviceQuery','borrowType','columnFilters','sortKey','sortDirection','selectedKeys','tableScroll']
export function restoreToolView(v){
 if(v.preferencesLoaded)return
 v.preferencesLoaded=true
 try{const p=JSON.parse(sessionStorage.getItem(viewKey)||'{}');for(const key of fields){const value=p[key];if(value===undefined)continue;if(key==='selectedKeys'){if(Array.isArray(value))v[key]=value.filter(x=>typeof x==='string')}else if(['columnFilters','tableScroll'].includes(key)){if(value&&typeof value==='object'&&!Array.isArray(value))v[key]=value}else if(typeof value==='string')v[key]=value}}catch{}
}
export function persistToolView(v){try{sessionStorage.setItem(viewKey,JSON.stringify(Object.fromEntries(fields.map(k=>[k,v[k]]))))}catch{}}
let clientId
function countKey(count){
 if(!clientId){try{clientId=sessionStorage.getItem('rail.tools.count-client');if(!clientId){clientId=crypto.randomUUID();sessionStorage.setItem('rail.tools.count-client',clientId)}}catch{clientId='current-tab'}}
 return `rail.tools.count-outbox.v2:${clientId}:${count.id}:${count.at}`
}
export function readCountOutbox(count){try{const box=JSON.parse(localStorage.getItem(countKey(count))||'null');return box&&Number.isSafeInteger(box.progressRevision)&&typeof box.requestId==='string'&&box.changes&&Object.values(box.changes).every(n=>n===null||Number.isSafeInteger(n)&&n>=0)?box:null}catch{return null}}
export function writeCountOutbox(count,outbox){localStorage.setItem(countKey(count),JSON.stringify(outbox))}
export function clearCountOutbox(count){try{localStorage.removeItem(countKey(count))}catch{}}
export function countDrafts(v,count){
 if(v.countDraftId===`${count.id}:${count.at}`)return
 v.countDraftId=`${count.id}:${count.at}`
 v.countDraft=Object.fromEntries(count.lines.map(l=>[l.assetId,{verified:l.counted!=null,present:Number(l.counted)>0,counted:l.counted??null}]))
 v.countOutbox=count.status==='OPEN'?readCountOutbox(count):null
 if(v.countOutbox)for(const [id,n] of Object.entries(v.countOutbox.changes))if(v.countDraft[id])v.countDraft[id]={verified:n!==null,present:n>0,counted:n}
 v.countSaveState=v.countOutbox?'pending':'saved';v.countLocalDurable=!!v.countOutbox;v.countSavedAt=count.updatedAt||null
}
