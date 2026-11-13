import fs from 'node:fs/promises'
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool'

const outputDir = 'G:/rail-maintenance-scheduler/outputs/monthly-import-2026-12'
const outputPath = `${outputDir}/2026年12月月度检修计划导入示例.xlsx`

const workbook = Workbook.create()
const sheet = workbook.worksheets.add('导入数据')
sheet.showGridLines = false

sheet.getRange('A1:I6').values = [
  ['机车编号', '机型', '修程', '修次', '计划入段日期', '配属局', '配属段', '累计走行公里', '备注'],
  ['HXD1C-2612', 'HXD1C', 'C1', 1, '2026-12-03', '北京局', '丰台机务段', 562000, '2026年12月月度检修计划导入示例'],
  ['HXD1-0819', 'HXD1', 'C2', 2, '2026-12-08', '太原局', '湖东电力机务段', 734500.5, '按当前角色导入后形成私人草稿'],
  ['HXD1D-0436', 'HXD1D', 'C3', 1, '2026-12-13', '西安局', '新丰镇机务段', 418260, '待提交'],
  ['HXD3C-1578', 'HXD3C', 'C4', 3, '2026-12-19', '上海局', '南京东机辆段', 906320.5, '待提交'],
  ['FXD3-J-0027', 'FXD3-J', 'C5', 1, '2026-12-25', '广州局', '广州机务段', 287410, 'C5检修周期15天']
]

const used = sheet.getRange('A1:I6')
used.format.font = { name: 'Aptos', size: 10, color: '#1F2937' }
used.format.verticalAlignment = 'center'
sheet.getRange('A1:I1').format = {
  fill: '#1F4E78',
  font: { name: 'Aptos', size: 10, bold: true, color: '#FFFFFF' },
  horizontalAlignment: 'center',
  verticalAlignment: 'center',
  rowHeight: 28,
  borders: { preset: 'outside', style: 'thin', color: '#1F4E78' }
}
sheet.getRange('A2:I6').format.borders = {
  bottom: { style: 'thin', color: '#D9E2F3' }
}
sheet.getRange('A2:A6').setNumberFormat('@')
sheet.getRange('D2:D6').setNumberFormat('0')
sheet.getRange('E2:E6').setNumberFormat('yyyy-mm-dd')
sheet.getRange('H2:H6').setNumberFormat('#,##0.0')
sheet.getRange('D2:E6').format.horizontalAlignment = 'center'
sheet.getRange('H2:H6').format.horizontalAlignment = 'right'
sheet.getRange('I2:I6').format.wrapText = false
sheet.getRange('A1:I6').format.rowHeight = 24
sheet.getRange('A1:A6').format.columnWidth = 18
sheet.getRange('B1:C6').format.columnWidth = 13
sheet.getRange('D1:D6').format.columnWidth = 9
sheet.getRange('E1:E6').format.columnWidth = 16
sheet.getRange('F1:F6').format.columnWidth = 13
sheet.getRange('G1:G6').format.columnWidth = 22
sheet.getRange('H1:H6').format.columnWidth = 17
sheet.getRange('I1:I6').format.columnWidth = 36
sheet.freezePanes.freezeRows(1)

const table = sheet.tables.add('A1:I6', true, 'MonthlyImport202612')
table.style = 'TableStyleMedium2'
table.showBandedRows = true
table.showFilterButton = true

workbook.recalculate()
const inspection = await workbook.inspect({
  kind: 'table',
  sheetId: sheet.sheetId,
  range: 'A1:I6',
  include: 'values,formulas',
  tableMaxRows: 8,
  tableMaxCols: 10,
  maxChars: 8000
})
console.log(inspection.ndjson)

const errors = await workbook.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',
  options: { useRegex: true, maxResults: 100 },
  summary: 'final formula error scan'
})
console.log(errors.ndjson)

await fs.mkdir(outputDir, { recursive: true })
const preview = await workbook.render({ sheetName: '导入数据', range: 'A1:I6', scale: 1.5, format: 'png' })
await fs.writeFile(`${outputDir}/preview.png`, new Uint8Array(await preview.arrayBuffer()))
const output = await SpreadsheetFile.exportXlsx(workbook)
await output.save(outputPath)
console.log(`OUTPUT=${outputPath}`)
