import * as XLSX from '@e965/xlsx'

export const planFields = [
  { key: 'locomotiveNo', label: '机车编号', required: true, max: 64 },
  { key: 'modelName', label: '机型', required: true, max: 64 },
  { key: 'repairProgramName', label: '修程', required: true, max: 64 },
  { key: 'repairSequence', label: '修次', required: false },
  { key: 'plannedEntryAt', label: '计划入段日期', required: true },
  { key: 'ownerBureau', label: '配属局', required: false, max: 64 },
  { key: 'ownerDepot', label: '配属段', required: false, max: 64 },
  { key: 'mileageKm', label: '累计走行公里', required: false },
  { key: 'remark', label: '备注', required: false, max: 500 },
]

export const planHeaders = planFields.map(field => field.label)
export const templateCsv = `\uFEFF${planHeaders.join(',')}\r\n`
const byHeader = new Map(planFields.map(field => [field.label, field]))

function parseCsv(text) {
  const rows = []; let row = [], value = '', quoted = false
  text = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++ }
      else if (quoted || value === '') quoted = !quoted
      else throw new Error('CSV引号格式不正确')
    } else if (c === ',' && !quoted) { row.push(value); value = '' }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(value); rows.push(row); row = []; value = ''
    } else value += c
  }
  if (quoted) throw new Error('CSV存在未闭合的引号')
  if (value || row.length) { row.push(value); rows.push(row) }
  return rows
}

function xlsxMatrix(buffer, ext) {
  let book
  try { book = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: true, bookVBA: false }) }
  catch { throw new Error('Excel无法解析，请检查文件是否损坏') }
  const sheetName = ext === '.xlsx' || ext === '.xls' ? '导入数据' : ''
  const sheet = book.Sheets[sheetName]
  if (!sheet) throw new Error('Excel缺少“导入数据”工作表；请勿把“填写说明”作为数据表')
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1')
  if (range.e.r + 1 > 1001 || range.e.c + 1 > 100) throw new Error('文件最多1000条数据、最多100列')
  const matrix = []
  for (let r = 0; r <= range.e.r; r++) {
    const row = []
    for (let c = 0; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })]
      row[c] = cell?.v ?? ''
    }
    matrix.push(row)
  }
  const header = matrix[0] || []
  const indices = new Set(header.map((value, i) => byHeader.has(String(value ?? '').trim()) ? i : -1).filter(i => i >= 0))
  for (const cellRef of Object.keys(sheet)) {
    if (cellRef.startsWith('!')) continue
    const position = XLSX.utils.decode_cell(cellRef)
    if (position.r > 0 && indices.has(position.c) && sheet[cellRef]?.f) {
      throw new Error(`第${position.r + 1}行“${String(header[position.c])}”含公式；请粘贴为值后再导入`)
    }
  }
  if (book.Workbook?.WBProps?.date1904 === true || book.Workbook?.WBProps?.date1904 === 'true') {
    const dateColumn = header.findIndex(value => String(value ?? '').trim() === '计划入段日期')
    if (dateColumn >= 0) for (const row of matrix.slice(1)) if (typeof row[dateColumn] === 'number') row[dateColumn] += 1462
  }
  return matrix
}

export function parsePlanUpload({ filename, contentBase64 }) {
  try {
    const ext = filename?.slice(filename.lastIndexOf('.')).toLowerCase()
    if (!['.xlsx', '.xls', '.csv'].includes(ext)) throw new Error('请选择 .xlsx、.xls 或 .csv 文件')
    if (typeof contentBase64 !== 'string' || contentBase64.length > 7 * 1024 * 1024) throw new Error('文件不得超过5MB或文件内容无效')
    let buffer
    try { buffer = Buffer.from(contentBase64, 'base64') } catch { throw new Error('文件内容无效') }
    if (!buffer.length || buffer.length > 5 * 1024 * 1024) throw new Error('文件为空或超过5MB')
    if (ext === '.csv') {
      let text
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer) }
      catch { throw new Error('CSV不是有效UTF-8编码；请在表格软件中另存为“CSV UTF-8”') }
      return parseCsv(text)
    }
    return xlsxMatrix(buffer, ext)
  } catch (error) {
    if (!error.status) error.status = 400
    throw error
  }
}

export function makeTemplateXlsx() {
  const book = XLSX.utils.book_new()
  const data = XLSX.utils.aoa_to_sheet([planHeaders])
  data['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 36 }]
  data['!freeze'] = { xSplit: 0, ySplit: 1 }
  XLSX.utils.book_append_sheet(book, data, '导入数据')
  const notes = [
    ['年度/月度检修计划导入模板填写说明'],
    ['数据工作表', '请只在“导入数据”填写，每行一条检修计划；不要更改表头。'],
    ['必填字段', '机车编号、机型、修程、计划入段日期。机车编号列请设为文本，保留前导零。'],
    ['选填字段', '修次、配属局、配属段、累计走行公里、备注。修次须为正整数；公里数为非负数，最多1位小数。'],
    ['日期格式', '支持 Excel 日期、YYYY-MM-DD、YYYY/MM/DD；按上海本地业务日期处理。'],
    ['模板示例（仅说明，不会导入）', '机车编号：请填写实际机车编号；机型/修程：从系统有效字典选择；日期：2026-11-03'],
    ['限制', '年度导入的日期须在所选年份；月度导入不限制日期月份。最多1000行、5MB。'],
  ]
  const instructions = XLSX.utils.aoa_to_sheet(notes)
  instructions['!cols'] = [{ wch: 30 }, { wch: 100 }]
  XLSX.utils.book_append_sheet(book, instructions, '填写说明')
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
}

export function safeCsvCell(value) {
  const text = String(value ?? '')
  const protectedText = /^[\s\u0000-\u001f]*[=+@-]/.test(text) ? `'${text}` : text
  return `"${protectedText.replaceAll('"', '""')}"`
}

export function errorsCsv(rows) {
  const lines = [['原始行号', '字段', '错误原因']]
  for (const row of rows) for (const error of row.errors || []) lines.push([row.line, error.field, error.message])
  return `\uFEFF${lines.map(line => line.map(safeCsvCell).join(',')).join('\r\n')}\r\n`
}
