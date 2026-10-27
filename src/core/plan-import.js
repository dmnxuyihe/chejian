import { addPlan } from './actions.js'

const aliases = {
  locomotiveNo: ['机车号', '车辆编号', '车号', 'locomotiveNo'],
  plannedEntryAt: ['入段日期', '计划入段', '计划进场', 'plannedEntryAt'],
  plannedExitAt: ['最晚完成日期', '要求出段日期', '计划交车', 'plannedExitAt'],
  priority: ['优先级', 'priority'], mileageKm: ['累计走行公里', '里程', 'mileageKm'], remark: ['备注', 'remark'],
}

export const templateCsv = '\uFEFF机车号,入段日期,最晚完成日期,优先级,累计走行公里,备注\r\nHXD1C-DEMO01,2026-10-27 08:00,2026-11-10 18:00,80,500000,演示车1\r\nHXD1C-DEMO02,2026-10-28 08:00,2026-11-11 18:00,80,480000,演示车2\r\n'

export function parseCsv(text) {
  const result = []; let row = [], value = '', quoted = false
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
      row.push(value); result.push(row); row = []; value = ''
    } else value += c
  }
  if (quoted) throw new Error('CSV存在未闭合的引号')
  if (value || row.length) { row.push(value); result.push(row) }
  return result
}

function normalizedDate(value, end = false) {
  if (typeof value === 'number') {
    // Excel's 1900 date system, expressed as local wall time rather than UTC.
    if (!Number.isFinite(value) || value < 1 || value > 110000) return ''
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000))
    value = d.toISOString().slice(0, Number.isInteger(value) ? 10 : 19)
  }
  const match = String(value ?? '').trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (!match) return ''
  const [, year, month, day, hour, minute, second] = match
  const parts = [Number(year), Number(month), Number(day), Number(hour ?? (end ? 18 : 8)), Number(minute ?? 0), Number(second ?? 0)]
  const d = new Date(parts[0], parts[1] - 1, ...parts.slice(2))
  if (parts[0] < 1900 || parts[0] > 2199 || d.getFullYear() !== parts[0] || d.getMonth() + 1 !== parts[1] ||
    d.getDate() !== parts[2] || d.getHours() !== parts[3] || d.getMinutes() !== parts[4] || d.getSeconds() !== parts[5]) return ''
  return `${year}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}T${String(parts[3]).padStart(2, '0')}:${String(parts[4]).padStart(2, '0')}:${String(parts[5]).padStart(2, '0')}`
}

export function validateImport(matrix, state) {
  if (!matrix.length) throw new Error('文件为空，请使用月度计划模板')
  if (matrix.length > 1001) throw new Error('每次最多导入1000行计划')
  const header = matrix[0].map(v => String(v ?? '').replace(/^\uFEFF/, '').trim())
  const columns = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, header.findIndex(h => names.includes(h))]))
  for (const field of ['locomotiveNo', 'plannedEntryAt']) {
    if (columns[field] < 0) throw new Error(`缺少必填列：${aliases[field][0]}`)
  }
  const seen = new Set(state.vehicleRepairs.map(v => `${v.locomotiveNo.toUpperCase().trim()}|${v.plannedEntryAt.slice(0, 10)}`))
  const rows = []
  matrix.slice(1).forEach((cells, i) => {
    if (cells.every(c => String(c ?? '').trim() === '')) return
    const get = key => cells[columns[key]] ?? ''
    const data = {
      locomotiveNo: String(get('locomotiveNo')).trim(), plannedEntryAt: normalizedDate(get('plannedEntryAt')),
      plannedExitAt: normalizedDate(get('plannedExitAt'), true),
      priority: get('priority') === '' ? 50 : Number(get('priority')),
      mileageKm: get('mileageKm') === '' ? 0 : Number(get('mileageKm')), remark: String(get('remark')).trim(),
    }
    // The existing plan API requires a requested completion date. If it is not supplied,
    // use a visible 14-day request, never an exit marker or a scheduling result.
    const defaultDeadline = String(get('plannedExitAt')).trim() === ''
    if (defaultDeadline && data.plannedEntryAt) {
      const d = new Date(`${data.plannedEntryAt.slice(0, 10)}T18:00:00`); d.setDate(d.getDate() + 14)
      data.plannedExitAt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T18:00:00`
    }
    const errors = []
    if (!data.locomotiveNo || data.locomotiveNo.length > 80) errors.push('车辆编号不能为空且不能超过80字')
    if (!data.plannedEntryAt) errors.push('入段日期无效')
    if (!data.plannedExitAt || data.plannedExitAt <= data.plannedEntryAt) errors.push('最晚完成日期须晚于入段日期')
    if (!Number.isFinite(data.priority) || data.priority < 0) errors.push('优先级须为非负数')
    if (!Number.isFinite(data.mileageKm) || data.mileageKm < 0) errors.push('里程须为非负数')
    const key = `${data.locomotiveNo.toUpperCase()}|${data.plannedEntryAt.slice(0, 10)}`
    const duplicate = seen.has(key)
    if (!errors.length) seen.add(key)
    rows.push({ line: i + 2, data, status: errors.length ? 'error' : duplicate ? 'duplicate' : 'ready', message: errors.join('；') || (duplicate ? '车辆和入段日重复，跳过' : defaultDeadline ? '可导入；未填截止日期，默认入段后14天18:00' : '可导入') })
  })
  if (!rows.length) throw new Error('文件没有计划数据')
  return rows
}

export function commitImport(state, matrix) {
  // Revalidate immediately before saving, including changes since preview.
  const rows = validateImport(matrix, state)
  const ids = []
  for (const row of rows.filter(r => r.status === 'ready')) {
    const id = addPlan(state, row.data)
    if (id == null) throw new Error(`第${row.line}行保存失败`)
    Object.assign(state.vehicleRepairs.find(v => v.id === id), { planSource: 'IMPORT', priority: row.data.priority })
    ids.push(id)
  }
  return { ids, rows }
}

let zipReady
async function readXlsx(buffer) {
  zipReady ||= import('../../vendor/jszip.min.js')
  await zipReady
  let zip
  try { zip = await globalThis.JSZip.loadAsync(buffer) }
  catch { throw new Error('Excel文件损坏或不是有效的.xlsx，请重新另存后导入') }
  async function xml(path) {
    const file = zip.file(path)
    if (!file) throw new Error(`Excel缺少工作表数据：${path}`)
    const text = await file.async('string')
    if (text.length > 10000000) throw new Error('工作表过大，请只保留月度计划')
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    if (doc.querySelector('parsererror')) throw new Error('Excel文件XML格式不正确')
    return doc
  }
  const wb = await xml('xl/workbook.xml')
  const rels = await xml('xl/_rels/workbook.xml.rels')
  const sheet = wb.getElementsByTagName('sheet')[0]
  const relId = sheet?.getAttribute('r:id')
  const target = [...rels.getElementsByTagName('Relationship')].find(r => r.getAttribute('Id') === relId)?.getAttribute('Target')
  if (!target) throw new Error('Excel没有可读取的工作表')
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
  const shared = zip.file('xl/sharedStrings.xml') ? [...(await xml('xl/sharedStrings.xml')).getElementsByTagName('si')].map(si => si.textContent) : []
  const use1904 = wb.getElementsByTagName('workbookPr')[0]?.getAttribute('date1904')
  const doc = await xml(path)
  const result = []
  for (const row of doc.getElementsByTagName('row')) {
    const cells = []
    for (const cell of row.getElementsByTagName('c')) {
      const ref = cell.getAttribute('r')?.match(/^([A-Z]+)/)?.[1]
      const index = ref ? [...ref].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1 : cells.length
      if (index > 99) throw new Error('表格列数过多，请使用月度计划模板')
      const type = cell.getAttribute('t'), raw = cell.getElementsByTagName('v')[0]?.textContent ?? ''
      let value = type === 's' ? shared[Number(raw)] ?? '' : type === 'inlineStr' ? cell.getElementsByTagName('is')[0]?.textContent ?? '' : raw
      if ((!type || type === 'n') && raw !== '') value = Number(raw)
      cells[index] = value
    }
    // Preserve worksheet row numbers for error messages, including blank rows.
    const number = Number(row.getAttribute('r') || result.length + 1)
    if (number > 1001) throw new Error('每次最多导入1000行计划')
    while (result.length < number - 1) result.push([])
    result.push(cells)
  }
  if (use1904 === '1' || use1904 === 'true') {
    const headers = result[0] || []
    const indices = ['plannedEntryAt', 'plannedExitAt'].map(k => headers.findIndex(h => aliases[k].includes(String(h).trim())))
    for (const row of result.slice(1)) for (const index of indices) if (typeof row[index] === 'number') row[index] += 1462
  }
  return result
}

export async function readPlanFile(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('文件不得超过5MB')
  const buffer = await file.arrayBuffer()
  if (/\.xlsx$/i.test(file.name)) return readXlsx(buffer)
  if (!/\.csv$/i.test(file.name)) throw new Error('请选择.xlsx或.csv文件；旧版.xls请另存为.xlsx')
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer) }
  catch { text = new TextDecoder('gb18030').decode(buffer) }
  return parseCsv(text)
}
