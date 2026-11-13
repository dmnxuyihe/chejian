import fs from 'node:fs/promises'
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool'

const outputDir = 'G:/rail-maintenance-scheduler/outputs/monthly-import-validation-2026-12'
const headers = ['机车编号', '机型', '修程', '修次', '计划入段日期', '配属局', '配属段', '累计走行公里', '备注']

const validRows = [
  ['HXD1C-2612', 'HXD1C', 'C1', 1, '2026-12-03', '北京局', '丰台机务段', 562000, '正确示例：全部字段合法'],
  ['HXD1-0819', 'HXD1', 'C2', 2, '2026-12-08', '太原局', '湖东电力机务段', 734500.5, '正确示例：导入后成为当前角色草稿'],
  ['HXD1D-0436', 'HXD1D', 'C3', 1, '2026-12-13', '西安局', '新丰镇机务段', 418260, '正确示例：日期属于2026年12月'],
  ['HXD3C-1578', 'HXD3C', 'C4', 3, '2026-12-19', '上海局', '南京东机辆段', 906320.5, '正确示例：局段对应正确'],
  ['FXD3-J-0027', 'FXD3-J', 'C5', 1, '2026-12-25', '广州局', '广州机务段', 287410, '正确示例：允许机型及C5修程']
]

const invalidRows = [
  ['ERR-DUP-202612', 'HXD1C', 'C1', 1, '2026-12-02', '北京局', '丰台机务段', 100000, '错误：与下一行机车编号重复'],
  ['ERR-DUP-202612', 'HXD1', 'C2', 2, '2026-12-04', '太原局', '湖东电力机务段', 110000, '错误：与上一行机车编号重复'],
  ['ERR-MODEL-01', 'SS9', 'C1', 1, '2026-12-06', '北京局', '丰台机务段', 120000, '错误：机型不在允许范围'],
  ['ERR-PROGRAM-01', 'HXD1C', 'C6', 1, '2026-12-08', '北京局', '丰台机务段', 130000, '错误：修程必须为C1-C5'],
  ['ERR-DATE-01', 'HXD1D', 'C3', 1, '2026-12-32', '西安局', '新丰镇机务段', 140000, '错误：日期不合法'],
  ['ERR-MONTH-01', 'HXD3C', 'C4', 1, '2027-01-03', '上海局', '南京东机辆段', 150000, '错误：日期不属于选择的2026年12月'],
  ['ERR-BUREAU-01', 'HXD1', 'C2', 1, '2026-12-14', '示例铁路局', '丰台机务段', 160000, '错误：配属局不在可选范围'],
  ['ERR-DEPOT-01', 'FXD3-J', 'C5', 1, '2026-12-18', '北京局', '哈尔滨机务段', 170000, '错误：配属段与配属局不对应'],
  ['ERR-REQUIRED-01', 'HXD1C', 'C1', '', '2026-12-22', '北京局', '丰台机务段', '', '错误：必填的修次为空']
]

function styleSheet(sheet, rowCount, tableName, headerColor) {
  const lastRow = rowCount + 1
  const used = sheet.getRange(`A1:I${lastRow}`)
  sheet.showGridLines = false
  used.format.font = { name: 'Aptos', size: 10, color: '#1F2937' }
  used.format.verticalAlignment = 'center'
  sheet.getRange('A1:I1').format = {
    fill: headerColor,
    font: { name: 'Aptos', size: 10, bold: true, color: '#FFFFFF' },
    horizontalAlignment: 'center', verticalAlignment: 'center', rowHeight: 28,
    borders: { preset: 'outside', style: 'thin', color: headerColor }
  }
  sheet.getRange(`A2:I${lastRow}`).format.borders = { bottom: { style: 'thin', color: '#D9E2F3' } }
  sheet.getRange(`A2:A${lastRow}`).setNumberFormat('@')
  sheet.getRange(`D2:D${lastRow}`).setNumberFormat('0')
  sheet.getRange(`E2:E${lastRow}`).setNumberFormat('@')
  sheet.getRange(`H2:H${lastRow}`).setNumberFormat('#,##0.0')
  sheet.getRange(`D2:E${lastRow}`).format.horizontalAlignment = 'center'
  sheet.getRange(`H2:H${lastRow}`).format.horizontalAlignment = 'right'
  sheet.getRange(`A1:I${lastRow}`).format.rowHeight = 24
  sheet.getRange(`A1:A${lastRow}`).format.columnWidth = 20
  sheet.getRange(`B1:C${lastRow}`).format.columnWidth = 13
  sheet.getRange(`D1:D${lastRow}`).format.columnWidth = 9
  sheet.getRange(`E1:E${lastRow}`).format.columnWidth = 17
  sheet.getRange(`F1:F${lastRow}`).format.columnWidth = 14
  sheet.getRange(`G1:G${lastRow}`).format.columnWidth = 23
  sheet.getRange(`H1:H${lastRow}`).format.columnWidth = 17
  sheet.getRange(`I1:I${lastRow}`).format.columnWidth = 39
  sheet.freezePanes.freezeRows(1)
  const table = sheet.tables.add(`A1:I${lastRow}`, true, tableName)
  table.style = 'TableStyleMedium2'
  table.showBandedRows = true
  table.showFilterButton = true
}

async function createWorkbook(rows, fileName, previewName, tableName, headerColor) {
  const workbook = Workbook.create()
  const sheet = workbook.worksheets.add('导入数据')
  sheet.getRange(`A1:I${rows.length + 1}`).values = [headers, ...rows]
  styleSheet(sheet, rows.length, tableName, headerColor)
  workbook.recalculate()
  const inspection = await workbook.inspect({ kind: 'table', sheetId: sheet.sheetId, range: `A1:I${rows.length + 1}`, include: 'values,formulas', tableMaxRows: rows.length + 2, tableMaxCols: 10, maxChars: 12000 })
  console.log(inspection.ndjson)
  const errors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 100 }, summary: 'final formula error scan' })
  console.log(errors.ndjson)
  const preview = await workbook.render({ sheetName: '导入数据', range: `A1:I${rows.length + 1}`, scale: 1.3, format: 'png' })
  await fs.writeFile(`${outputDir}/${previewName}`, new Uint8Array(await preview.arrayBuffer()))
  const output = await SpreadsheetFile.exportXlsx(workbook)
  await output.save(`${outputDir}/${fileName}`)
  console.log(`OUTPUT=${outputDir}/${fileName}`)
}

await fs.mkdir(outputDir, { recursive: true })
await createWorkbook(validRows, '2026年12月月度计划导入_正确示例.xlsx', '正确示例预览.png', 'ValidMonthlyImport202612', '#1F4E78')
await createWorkbook(invalidRows, '2026年12月月度计划导入_错误示例.xlsx', '错误示例预览.png', 'InvalidMonthlyImport202612', '#A61B1B')
