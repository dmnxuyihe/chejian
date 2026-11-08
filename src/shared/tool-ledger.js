import {escapeHtml as esc} from '../core/ui.js'
import {assetInStock,assetStock,assetCountShortage,assetPhysicalAvailable,toolAlerts,toolDueAt} from '../core/tool-management.js'

export const ledgerTypes={ALL:'全部台账',NUMBERED:'有编号工具',BULK:'无编号工具',KIT:'工具套装',LEGACY:'待完善登记'}
const name=(rows,id)=>rows.find(r=>r.id===id)?.name||'—'
const dt=v=>v?esc(String(v).replace('T',' ').slice(0,16)):'—'
const outstanding=line=>line.quantity-line.returned-(line.disposed||0)
export function returnableQuantity(m,loan,line){
  return Math.max(0,outstanding(line)-m.disposals.filter(r=>r.loanId===loan.id&&r.assetId===line.assetId&&r.status==='PENDING').reduce((n,r)=>n+r.quantity,0))
}
export function assetBalance(s,a){
  const m=s.toolManagement,loans=m.loans.filter(l=>l.lines.some(r=>r.assetId===a.id&&outstanding(r)>0))
  const services=m.services.filter(r=>r.assetId===a.id&&r.status==='OPEN')
  const transfers=m.transfers.filter(r=>r.assetId===a.id&&r.status==='PENDING')
  const disposals=m.disposals.filter(r=>r.assetId===a.id&&r.status==='PENDING')
  const due=toolDueAt(a),expired=due==='MISSING'||due&&new Date(due)<=new Date()
  const stock=assetInStock(m,a),available=s.tools.find(t=>t.id===a.toolId)?.status==='AVAILABLE'&&!expired?assetStock(m,a):0
  const physicalAvailable=assetPhysicalAvailable(m,a),countShortage=assetCountShortage(m,a.id)
  const borrowed=loans.reduce((n,l)=>n+l.lines.filter(r=>r.assetId===a.id).reduce((n,r)=>n+outstanding(r),0),0)
  const inspection=services.filter(r=>r.kind==='INSPECTION').reduce((n,r)=>n+r.quantity,0)
  const repair=services.filter(r=>r.kind==='REPAIR').reduce((n,r)=>n+r.quantity,0)
  const transfer=transfers.reduce((n,r)=>n+r.quantity,0),pending=disposals.reduce((n,r)=>n+r.quantity,0)
  const states=[]
  if(a.status==='SCRAPPED')states.push('已报废')
  else if(a.status==='LOST')states.push('已遗失')
  else{
    if(stock>0)states.push(`${a.status==='DISABLED'?'停用库存':'在库'} ${stock}件`)
    if(borrowed)states.push(`借出 ${borrowed}件`)
    if(inspection)states.push(`送检 ${inspection}件`)
    if(repair)states.push(`送修 ${repair}件`)
    if(transfer)states.push(`调拨中 ${transfer}件`)
    if(pending)states.push(`待审核 ${pending}件${disposals.some(r=>r.loanId)?'（含借出）':''}`)
    if(countShortage)states.push(`盘亏待处理 ${countShortage}件（不可领用）`)
    if(!states.length)states.push('无库存')
    if(expired)states.push(due==='MISSING'?'未登记合格检定，暂不可借':'检定到期，暂不可借')
    if(s.tools.find(t=>t.id===a.toolId)?.status!=='AVAILABLE')states.push('工具品种暂停使用')
  }
  return {stock,available,physicalAvailable,countShortage,borrowed,inspection,repair,transfer,pending,due,expired,loans,services,transfers,disposals,states}
}
export function toolLedgerEntries(s,v={}){
  const m=s.toolManagement,alerts=toolAlerts(s)
  const entries=m.assets.map(a=>{
    const balance=assetBalance(s,a)
    const warnings=alerts.filter(r=>r.assetId===a.id||r.toolId===a.toolId&&(!r.warehouseId||r.warehouseId===a.warehouseId)||r.loanId&&balance.loans.some(l=>l.id===r.loanId)).map(r=>r.message)
    return {key:`asset:${a.id}`,id:a.id,type:a.mode,title:name(s.tools,a.toolId),code:a.code,warehouseId:a.warehouseId,asset:a,balance,warnings:[...new Set(warnings)]}
  })
  for(const kit of m.kits){
    const members=kit.lines.map(line=>({line,entry:entries.find(r=>r.id===line.assetId)}))
    const loans=m.loans.filter(l=>l.kitId===kit.id&&l.status==='OPEN')
    const available=members.length?Math.min(...members.map(({line,entry})=>Math.floor((entry?.balance.available||0)/line.quantity))):0
    entries.push({key:`kit:${kit.id}`,id:kit.id,type:'KIT',title:kit.name,code:kit.code,warehouseId:members[0]?.entry?.warehouseId,kit,members,loans,available,warnings:[...new Set(members.flatMap(r=>r.entry?.warnings||[]))]})
  }
  for(const t of s.tools.filter(t=>Number(t.quantity)>0&&!m.assets.some(a=>a.toolId===t.id))){
    entries.push({key:`legacy:${t.id}`,id:t.id,type:'LEGACY',title:t.name,code:t.code||'原库存',tool:t,warnings:[]})
  }
  const warehouseRows=entries.filter(e=>!v.warehouse||e.warehouseId===Number(v.warehouse))
  const counts=Object.fromEntries(Object.keys(ledgerTypes).map(type=>[type,type==='ALL'?warehouseRows.length:warehouseRows.filter(e=>e.type===type).length]))
  const rows=warehouseRows.filter(e=>(!v.ledgerType||v.ledgerType==='ALL'||e.type===v.ledgerType)&&(!v.ledgerStatus||e.asset?.status===v.ledgerStatus)&&(!v.borrowType||(e.balance?.loans||e.loans||[]).some(l=>l.borrowType===v.borrowType))&&(!v.query||[e.title,e.code,e.asset?.tag,name(m.warehouses,e.warehouseId),...(e.balance?.loans||e.loans||[]).map(l=>l.borrower)].join(' ').toLocaleLowerCase().includes(v.query.toLocaleLowerCase()))&&(!v.quickFilter||v.quickFilter==='borrowed'&&(e.balance?.borrowed>0||e.loans?.length>0)||v.quickFilter==='inspection'&&e.warnings.some(w=>/到期|检定/.test(w))||v.quickFilter==='approval'&&e.balance?.pending>0||v.quickFilter==='warnings'&&e.warnings.length>0))
  return {entries,rows,counts}
}
