import * as XLSX from '@e965/xlsx'

const headers = ['委修段','机型','机车号','计划入段时间','计划上台时间','临修内容']
const safeText = value => String(value ?? '').trim()
const excelDate = value => {
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}T${String(parsed.H).padStart(2,'0')}:${String(parsed.M).padStart(2,'0')}`
  }
  const text = safeText(value).replace(' ', 'T').replaceAll('/', '-')
  return text.length === 10 ? `${text}T00:00` : text.slice(0, 16)
}

function csvRows(buffer) {
  let text = buffer.toString('utf8').replace(/^\uFEFF/, '')
  const rows = [], row = []; let value = '', quoted = false
  const push = () => { row.push(value); value = '' }
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '"' && quoted && text[i + 1] === '"') { value += '"'; i += 1 }
    else if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) push()
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && text[i + 1] === '\n') i += 1; push(); if (row.some(cell => cell !== '')) rows.push(row.splice(0)); }
    else value += char
  }
  if (value || row.length) { push(); rows.push(row) }
  return rows
}

export function parseTemporaryRepairFile({ filename, contentBase64 }) {
  if (!/\.(csv|xlsx|xls)$/i.test(filename || '')) throw Object.assign(new Error('仅支持CSV、XLSX、XLS文件'), { status:400 })
  const buffer = Buffer.from(String(contentBase64 || ''), 'base64')
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) throw Object.assign(new Error('导入文件为空或超过5MB'), { status:400 })
  let matrix
  try {
    if (/\.csv$/i.test(filename)) matrix = csvRows(buffer)
    else {
      const workbook = XLSX.read(buffer, { type:'buffer', cellDates:false })
      matrix = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header:1, raw:true, defval:'' })
    }
  } catch { throw Object.assign(new Error('文件无法解析，请检查格式是否损坏'), { status:400 }) }
  const first = matrix.findIndex(row => row.some(cell => safeText(cell)))
  if (first < 0) throw Object.assign(new Error('导入文件没有数据'), { status:400 })
  const incoming = matrix[first].map(safeText)
  const missing = headers.filter(name => !incoming.includes(name))
  if (missing.length) throw Object.assign(new Error(`缺少必填列：${missing.join('、')}`), { status:400 })
  const index = Object.fromEntries(headers.map(name => [name, incoming.indexOf(name)]))
  return matrix.slice(first + 1).filter(row => row.some(cell => safeText(cell))).map((row, offset) => ({
    rowNumber:first + offset + 2,
    ownerDepot:safeText(row[index['委修段']]), modelName:safeText(row[index['机型']]), locomotiveNo:safeText(row[index['机车号']]),
    plannedEntryAt:excelDate(row[index['计划入段时间']]), plannedPlatformAt:excelDate(row[index['计划上台时间']]), content:safeText(row[index['临修内容']]),
  }))
}

export const temporaryRepairTemplateCsv = `\uFEFF${headers.join(',')}\r\n模拟检修段,HXD1C,HXD1C-LX001,2026-11-08 08:00,2026-11-08 10:00,走行部异响检查与处理\r\n`

const componentHeaders=['配件名称','适用机型','配件序列号','规格型号','计划入段时间','临修内容']
export function parseComponentTemporaryFile({filename,contentBase64}){
 if(!/\.(csv|xlsx|xls)$/i.test(filename||''))throw Object.assign(new Error('仅支持CSV、XLSX、XLS文件'),{status:400})
 const buffer=Buffer.from(String(contentBase64||''),'base64');if(!buffer.length||buffer.length>5*1024*1024)throw Object.assign(new Error('导入文件为空或超过5MB'),{status:400})
 let matrix
 try{if(/\.csv$/i.test(filename))matrix=csvRows(buffer);else{const workbook=XLSX.read(buffer,{type:'buffer',cellDates:false});matrix=XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{header:1,raw:true,defval:''})}}catch{throw Object.assign(new Error('文件无法解析，请检查格式是否损坏'),{status:400})}
 const first=matrix.findIndex(row=>row.some(cell=>safeText(cell)));if(first<0)throw Object.assign(new Error('导入文件没有数据'),{status:400})
 const incoming=matrix[first].map(safeText),missing=componentHeaders.filter(name=>!incoming.includes(name));if(missing.length)throw Object.assign(new Error(`缺少必填列：${missing.join('、')}`),{status:400})
 const index=Object.fromEntries(componentHeaders.map(name=>[name,incoming.indexOf(name)]))
 return matrix.slice(first+1).filter(row=>row.some(cell=>safeText(cell))).map((row,offset)=>({rowNumber:first+offset+2,name:safeText(row[index['配件名称']]),modelName:safeText(row[index['适用机型']]),serialNo:safeText(row[index['配件序列号']]),specification:safeText(row[index['规格型号']]),plannedEntryAt:excelDate(row[index['计划入段时间']]),content:safeText(row[index['临修内容']])}))
}
export const componentTemporaryTemplateCsv=`\uFEFF${componentHeaders.join(',')}\r\n车轴,HXD1C,CX-LX-001,HXD1C轮对车轴,2026-11-10 08:00,轴颈擦伤临修处理\r\n`

const componentMonthlyHeaders=['月份','方向','配件名称','计划数量','测算数量','匹配公里']
export function parseComponentMonthlyFile({filename,contentBase64}){
 if(!/\.(csv|xlsx|xls)$/i.test(filename||''))throw Object.assign(new Error('仅支持CSV、XLSX、XLS文件'),{status:400});const buffer=Buffer.from(String(contentBase64||''),'base64');if(!buffer.length||buffer.length>5*1024*1024)throw Object.assign(new Error('导入文件为空或超过5MB'),{status:400})
 let matrix;try{if(/\.csv$/i.test(filename))matrix=csvRows(buffer);else{const workbook=XLSX.read(buffer,{type:'buffer'});matrix=XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{header:1,raw:true,defval:''})}}catch{throw Object.assign(new Error('文件无法解析'),{status:400})}
 const first=matrix.findIndex(row=>row.some(cell=>safeText(cell))),incoming=matrix[first]?.map(safeText)||[],missing=componentMonthlyHeaders.filter(x=>!incoming.includes(x));if(missing.length)throw Object.assign(new Error(`缺少必填列：${missing.join('、')}`),{status:400});const index=Object.fromEntries(componentMonthlyHeaders.map(x=>[x,incoming.indexOf(x)]))
 return matrix.slice(first+1).filter(row=>row.some(cell=>safeText(cell))).map((row,offset)=>({rowNumber:first+offset+2,month:safeText(row[index['月份']]),direction:safeText(row[index['方向']]),componentName:safeText(row[index['配件名称']]),planned:safeText(row[index['计划数量']]),calculated:safeText(row[index['测算数量']]),mileageKm:safeText(row[index['匹配公里']])}))
}
export const componentMonthlyTemplateCsv=`\uFEFF${componentMonthlyHeaders.join(',')}\r\n2026-11,上车,车轮,4,4,500000\r\n`
