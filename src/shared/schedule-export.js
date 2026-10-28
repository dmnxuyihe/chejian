const xmlEscape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const excelSerial = value => {
  const date = new Date(value)
  return (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()) / 86400000) + 25569
}

const columnName = index => {
  let result = ''
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result
  return result
}

export function scheduleExportRows(state, rows) {
  const kindNames = { formal: '正式排程', draft: '待确认', preview: '模拟预览' }
  return [...rows].sort((a,b) => new Date(a.plannedStartAt) - new Date(b.plannedStartAt) || a.id - b.id).map(row => ({
    locomotiveNo: state.vehicleRepairs.find(item => item.id === row.vehicleRepairId)?.locomotiveNo || '未知车辆',
    taskName: state.tasks.find(item => item.id === row.taskId)?.name || '检修任务',
    planKind: kindNames[row.planKind] || row.planKind || '排程',
    status: row.status || '未填写',
    start: row.plannedStartAt,
    end: row.plannedEndAt,
    hours: Math.round((new Date(row.plannedEndAt) - new Date(row.plannedStartAt)) / 360000) / 10,
    workstation: state.workstations.find(item => item.id === row.workstationId)?.name || '未分配工位',
    locked: row.isLocked ? '是' : '否',
  }))
}

export async function createScheduleExport(state, rows) {
  await import('../../vendor/jszip.min.js')
  const zip = new globalThis.JSZip()
  const data = scheduleExportRows(state, rows)
  const headers = ['车辆编号','任务名称','排程类型','任务状态','计划开始时间','计划结束时间','时长（小时）','作业工位','是否锁定']
  const values = data.map(row => [row.locomotiveNo,row.taskName,row.planKind,row.status,row.start,row.end,row.hours,row.workstation,row.locked])
  const cell = (value, column, row) => {
    const ref = `${columnName(column)}${row}`
    if (column === 4 || column === 5) return `<c r="${ref}" s="2" t="n"><v>${excelSerial(value)}</v></c>`
    if (column === 6) return `<c r="${ref}" s="3" t="n"><v>${Number(value)}</v></c>`
    return `<c r="${ref}" s="1" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`
  }
  const rowsXml = [`<row r="1" ht="28" customHeight="1">${headers.map((value,index) => `<c r="${columnName(index)}1" s="4" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`).join('')}</row>`, ...values.map((row,index) => `<row r="${index + 2}" ht="24" customHeight="1">${row.map((value,column) => cell(value,column,index + 2)).join('')}</row>`)].join('')
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="任务明细" sheetId="1" r:id="rId1"/></sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="165" formatCode="0.0"/></numFmts><fonts count="2"><font><sz val="10"/><name val="Microsoft YaHei"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>')
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="2" width="28" customWidth="1"/><col min="3" max="4" width="15" customWidth="1"/><col min="5" max="6" width="22" customWidth="1"/><col min="7" max="7" width="14" customWidth="1"/><col min="8" max="8" width="22" customWidth="1"/><col min="9" max="9" width="12" customWidth="1"/></cols><sheetData>${rowsXml}</sheetData><autoFilter ref="A1:I${Math.max(1,data.length + 1)}"/></worksheet>`)
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' })
}
