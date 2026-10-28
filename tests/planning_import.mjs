import assert from 'node:assert/strict'
import http from 'node:http'
import * as XLSX from '@e965/xlsx'
import { loadConfig } from '../server/config.js'
import { createDatabase } from '../server/database.js'
import { createHandler } from '../server/http.js'
import { parsePlanUpload, safeCsvCell, templateCsv } from '../server/planning-import.js'
import { submitPlan } from '../src/core/actions.js'

const schema = `pc1_test_plan_${Date.now()}_${process.pid}`
const db = createDatabase({ ...loadConfig(), schema })
let server, base
const buffers = (matrix, bookType = 'xlsx') => {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(matrix), '导入数据')
  return XLSX.write(book, { type: 'buffer', bookType })
}
const filePayload = (name, buffer, extra = {}) => ({ filename: name, contentBase64: buffer.toString('base64'), ...extra })
const mkRow = (no, date, other = {}) => [no, other.model ?? 'HXD1C', other.program ?? 'HXD1C高级修', other.sequence ?? '', date, other.bureau ?? '', other.depot ?? '', other.mileage ?? '', other.remark ?? '']

try {
  await db.init()
  server = http.createServer(createHandler(db))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
  let cookie = ''
  async function request(path, method = 'GET', value = undefined) {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(value !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(value !== undefined ? { body: JSON.stringify(value) } : {}) })
    const setCookie = response.headers.getSetCookie?.()[0]
    if (setCookie) cookie = setCookie.split(';')[0]
    const contentType = response.headers.get('content-type') || ''
    const body = contentType.includes('application/json') ? await response.json() : await response.arrayBuffer()
    return { status: response.status, body, response }
  }

  const before = await db.read()
  const beforeVehicles = (await db.pool.query(`SELECT count(*)::int AS n FROM "${schema}".vehicle_repair`)).rows[0].n
  const lookup = await request('/api/planning/lookups')
  assert.equal(lookup.status, 200)
  assert.ok(lookup.body.models.some(row => row.name === 'HXD1C'))
  assert.ok(lookup.body.programs.some(row => row.name === 'HXD1C高级修'))

  const xlsxTemplate = await request('/api/planning/import/template.xlsx')
  assert.equal(xlsxTemplate.status, 200)
  const templateMatrix = parsePlanUpload({ filename: 'template.xlsx', contentBase64: Buffer.from(xlsxTemplate.body).toString('base64') })
  assert.deepEqual(templateMatrix[0], ['机车编号', '机型', '修程', '修次', '计划入段日期', '配属局', '配属段', '累计走行公里', '备注'])
  assert.equal(templateMatrix.length, 1)
  const csvTemplate = await request('/api/planning/import/template.csv')
  assert.equal(csvTemplate.status, 200)
  assert.ok(Buffer.from(csvTemplate.body).toString('utf8').startsWith('\uFEFF'))
  assert.deepEqual(parsePlanUpload({ filename: 'template.csv', contentBase64: Buffer.from(templateCsv).toString('base64') })[0], templateMatrix[0])
  const date1904 = XLSX.utils.book_new()
  date1904.Workbook = { WBProps: { date1904: true } }
  const date1904Sheet = XLSX.utils.aoa_to_sheet([templateMatrix[0], mkRow('001905', 45077)])
  XLSX.utils.book_append_sheet(date1904, date1904Sheet, '导入数据')
  const date1904File = XLSX.write(date1904, { type: 'buffer', bookType: 'xlsx' })
  const date1904Preview = await request('/api/planning/import/preview', 'POST', filePayload('date1904.xlsx', date1904File, { importType: 'MONTHLY', month: '2027-06' }))
  assert.equal(date1904Preview.status, 200)
  assert.equal(date1904Preview.body.rows[0].data.locomotiveNo, '001905', 'text locomotive numbers retain leading zeroes')
  assert.equal(date1904Preview.body.rows[0].data.plannedEntryAt, '2027-06-01', 'Excel 1904 dates are converted without a timezone shift')
  await request(`/api/planning/import/preview/${date1904Preview.body.id}`, 'DELETE')
  const duplicateHeaders = await request('/api/planning/import/preview', 'POST', filePayload('duplicate-header.csv', Buffer.from('\uFEFF机车编号,机车编号,修程,计划入段日期\r\n'), { importType: 'ANNUAL', year: 2027 }))
  assert.equal(duplicateHeaders.status, 400)
  const missingHeader = await request('/api/planning/import/preview', 'POST', filePayload('missing-header.csv', Buffer.from('\uFEFF机车编号,修程,计划入段日期\r\n'), { importType: 'ANNUAL', year: 2027 }))
  assert.equal(missingHeader.status, 400)

  const preciseDateErrors = await request('/api/planning/import/preview', 'POST', filePayload('date-errors.csv', Buffer.from(`${templateCsv}TEST-DATE-NOT-EXIST,HXD1C,HXD1C高级修,,2026-02-30,,,,\r\nTEST-DATE-FORMAT,HXD1C,HXD1C高级修,,2026.02.28,,,,\r\nTEST-DATE-EMPTY,HXD1C,HXD1C高级修,,,,,,\r\n,NOT-A-MODEL,HXD1C高级修,,2026-02-30,,,,\r\n`), { importType: 'MONTHLY' }))
  assert.equal(preciseDateErrors.status, 200)
  assert.equal(preciseDateErrors.body.rows[0].errors.find(error => error.field === '计划入段日期')?.message, '日期不存在')
  assert.equal(preciseDateErrors.body.rows[1].errors.find(error => error.field === '计划入段日期')?.message, '日期格式不支持；请填写 YYYY-MM-DD 或 YYYY/MM/DD')
  assert.equal(preciseDateErrors.body.rows[2].errors.find(error => error.field === '计划入段日期')?.message, '日期不能为空')
  const groupedErrorCsv = Buffer.from((await request(`/api/planning/import/${preciseDateErrors.body.id}/errors.csv`)).body).toString('utf8')
  assert.ok(groupedErrorCsv.includes('机车编号；机型；计划入段日期'), 'multiple error fields must be joined in validation order')
  assert.ok(groupedErrorCsv.includes('机车编号不能为空；机型不在有效字典中；日期不存在'), 'multiple reasons must align with their fields')
  await request(`/api/planning/import/preview/${preciseDateErrors.body.id}`, 'DELETE')

  const annualBook = buffers([
    ['机车编号', '机型', '修程', '修次', '计划入段日期', '配属局', '配属段', '累计走行公里', '备注'],
    mkRow('TEST-PLAN-0001', '2027-11-03', { sequence: '2', mileage: '12345.6', bureau: '测试局', depot: '测试段' }),
    mkRow('TEST-PLAN-0002', '2027/11/04', { mileage: '0' }),
  ])
  const previewResponse = await request('/api/planning/import/preview', 'POST', filePayload('annual.xlsx', annualBook, { importType: 'ANNUAL', year: 2027 }))
  assert.equal(previewResponse.status, 200, JSON.stringify(previewResponse.body))
  const annualPreview = previewResponse.body
  assert.deepEqual([annualPreview.total, annualPreview.importable, annualPreview.errors], [2, 2, 0])
  assert.equal(annualPreview.rows[0].line, 2)
  assert.equal(annualPreview.rows[0].data.locomotiveNo, 'TEST-PLAN-0001')
  assert.equal((await db.read()).revision, before.revision, 'preview must not increment database revision')
  assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM "${schema}".vehicle_repair`)).rows[0].n, beforeVehicles, 'preview must not insert business rows')

  const cancelledPreview = await request('/api/planning/import/preview', 'POST', filePayload('cancel.csv', Buffer.from(`${templateCsv}CANCEL-01,HXD1C,HXD1C高级修,,2027-11-08,,,,\r\n`), { importType: 'MONTHLY', month: '2027-11' }))
  assert.equal(cancelledPreview.body.importable, 1)
  assert.equal((await request(`/api/planning/import/preview/${cancelledPreview.body.id}`, 'DELETE')).status, 200)
  assert.equal((await request('/api/planning/import/confirm', 'POST', { previewId: cancelledPreview.body.id })).status, 404)

  const annualConfirm = await request('/api/planning/import/confirm', 'POST', { previewId: annualPreview.id })
  assert.equal(annualConfirm.status, 200, JSON.stringify(annualConfirm.body))
  assert.equal(annualConfirm.body.imported, 2)
  const idempotentConfirm = await request('/api/planning/import/confirm', 'POST', { previewId: annualPreview.id })
  assert.equal(idempotentConfirm.status, 200)
  assert.equal(idempotentConfirm.body.imported, 2)
  assert.equal(idempotentConfirm.body.idempotent, true)
  const importedRows = await db.pool.query(`SELECT vehicle_repair_id, locomotive_no, repair_program_id, planned_entry_at, planned_exit_at, status, approval_status, current_version_id, owner_bureau, owner_depot, repair_sequence, mileage_km, plan_source, priority FROM "${schema}".vehicle_repair WHERE locomotive_no LIKE 'TEST-PLAN-%' ORDER BY planned_entry_at`)
  assert.equal(importedRows.rows.length, 2)
  assert.deepEqual(importedRows.rows.map(row => row.status), ['UNSCHEDULED', 'UNSCHEDULED'])
  assert.deepEqual(importedRows.rows.map(row => row.approval_status), ['DRAFT', 'DRAFT'])
  assert.deepEqual(importedRows.rows.map(row => row.current_version_id), [null, null])
  assert.deepEqual(importedRows.rows.map(row => row.planned_exit_at), [null, null])
  assert.deepEqual(importedRows.rows.map(row => row.plan_source), ['ANNUAL', 'ANNUAL'])
  assert.equal(Number(importedRows.rows[0].mileage_km), 12345.6)
  assert.equal(importedRows.rows[0].owner_bureau, '测试局')
  assert.equal(importedRows.rows[0].priority, 100)
  const reloadedState = (await db.read()).snapshot.data
  const importedPlan = reloadedState.vehicleRepairs.find(row => row.locomotiveNo === 'TEST-PLAN-0001')
  assert.equal(importedPlan.status, 'UNSCHEDULED')
  assert.equal(submitPlan(reloadedState, importedPlan.id), true, 'an imported UNSCHEDULED plan must enter the existing scheduling flow')
  assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM "${schema}".schedule_version WHERE vehicle_repair_id=ANY($1::bigint[])`, [importedRows.rows.map(row => Number(row.vehicle_repair_id))])).rows[0].n, 0, 'plan import must not create schedule versions')
  assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM "${schema}".vehicle_repair_schedule WHERE vehicle_repair_id=ANY($1::bigint[])`, [importedRows.rows.map(row => Number(row.vehicle_repair_id))])).rows[0].n, 0, 'plan import must not create tasks')

  const listing = await request('/api/planning/calendar?from=2027-11-01&to=2027-11-30')
  assert.equal(listing.status, 200)
  assert.ok(listing.body.vehicles.some(row => row.locomotiveNo === 'TEST-PLAN-0001' && row.entryDate === '2027-11-03' && row.confirmedExitDate == null))
  const detail = await request(`/api/planning/vehicles/${importedRows.rows[0].vehicle_repair_id}`)
  assert.equal(detail.status, 200)
  assert.equal(detail.body.planSource, 'ANNUAL')

  const duplicateSource = await request('/api/planning/import/preview', 'POST', filePayload('same-month.csv', Buffer.from(`${templateCsv}test-plan-0001,HXD1C,HXD1C高级修,,2027-11-03,,,,\r\n`), { importType: 'MONTHLY', month: '2027-11' }))
  assert.equal(duplicateSource.body.rows[0].status, 'error', 'ANNUAL/MONTHLY source must not affect the database deduplication key')
  assert.ok(duplicateSource.body.rows[0].errors.some(error => error.message.includes('数据库已存在')))
  await request(`/api/planning/import/preview/${duplicateSource.body.id}`, 'DELETE')
  const dateConflict = await request('/api/planning/import/preview', 'POST', filePayload('date-change.csv', Buffer.from(`${templateCsv}TEST-PLAN-0001,HXD1C,HXD1C高级修,,2027-11-05,,,,\r\n`), { importType: 'MONTHLY', month: '2027-11' }))
  assert.equal(dateConflict.body.rows[0].status, 'conflict', 'a different date for the same unfinished repair must not be auto-added')
  await request(`/api/planning/import/preview/${dateConflict.body.id}`, 'DELETE')

  const xlsBook = buffers([templateMatrix[0], mkRow('TEST-XLS-0001', '2027-11-12')], 'xls')
  const xlsPreview = await request('/api/planning/import/preview', 'POST', filePayload('valid.xls', xlsBook, { importType: 'MONTHLY', month: '2027-11' }))
  assert.equal(xlsPreview.status, 200, JSON.stringify(xlsPreview.body))
  assert.equal(xlsPreview.body.importable, 1)
  await request(`/api/planning/import/preview/${xlsPreview.body.id}`, 'DELETE')

  const mixed = buffers([
    templateMatrix[0],
    mkRow('TEST-DUP-01', '2027-11-20'),
    mkRow('TEST-DUP-01', '2027-11-20'),
    mkRow('TEST-CONFLICT-01', '2027-11-21'),
    mkRow('TEST-CONFLICT-01', '2027-11-22'),
    mkRow('', '2027-11-23'),
    mkRow('TEST-BAD-DATE', '11/23/2027'),
    mkRow('TEST-BAD-MODEL', '2027-11-23', { model: 'NOT-A-MODEL' }),
    mkRow('TEST-BAD-PROGRAM', '2027-11-23', { program: 'NOT-A-PROGRAM' }),
    mkRow('TEST-BAD-MILEAGE', '2027-11-23', { mileage: '-1' }),
    mkRow('TEST-OTHER-MONTH', '2028-11-23'),
  ])
  const mixedPreview = await request('/api/planning/import/preview', 'POST', filePayload('mixed.xlsx', mixed, { importType: 'MONTHLY', month: '2027-11' }))
  assert.equal(mixedPreview.status, 200, JSON.stringify(mixedPreview.body))
  const statuses = mixedPreview.body.rows.map(row => row.status)
  assert.equal(statuses[0], 'ready')
  assert.equal(statuses[1], 'duplicate')
  assert.deepEqual(statuses.slice(2, 4), ['conflict', 'conflict'])
  assert.equal(mixedPreview.body.importable, 2, 'monthly imports may include valid dates from any month')
  assert.ok(mixedPreview.body.rows[4].errors.some(error => error.field === '机车编号'))
  assert.ok(mixedPreview.body.rows[5].errors.some(error => error.field === '计划入段日期'))
  assert.ok(mixedPreview.body.rows[6].errors.some(error => error.field === '机型'))
  assert.ok(mixedPreview.body.rows[7].errors.some(error => error.field === '修程'))
  assert.ok(mixedPreview.body.rows[8].errors.some(error => error.field === '累计走行公里'))
  assert.equal(mixedPreview.body.rows[9].status, 'ready', 'a valid date outside the selected list month remains importable')
  const errorCsv = await request(`/api/planning/import/${mixedPreview.body.id}/errors.csv`)
  assert.equal(errorCsv.status, 200)
  const errorText = Buffer.from(errorCsv.body).toString('utf8')
  assert.ok(errorText.startsWith('\uFEFF'))
  assert.match(errorText, /原始行号.*原始数据.*错误字段.*错误原因/)
  assert.ok(errorText.includes('累计走行公里') && errorText.includes('-1'), 'error CSV must include the field and original invalid value')
  await request(`/api/planning/import/preview/${mixedPreview.body.id}`, 'DELETE')
  assert.equal(safeCsvCell('=SUM(1,1)'), "\"'=SUM(1,1)\"")

  const formulaBook = buffers([templateMatrix[0], ['=1+1', 'HXD1C', 'HXD1C高级修', '', '2027-11-25', '', '', '', '']])
  const formulaWorkbook = XLSX.read(formulaBook, { type: 'buffer' })
  const formulaSheet = formulaWorkbook.Sheets['导入数据']
  formulaSheet.A2 = { t: 'n', f: '1+1', v: 2 }
  const formulaBytes = XLSX.write(formulaWorkbook, { type: 'buffer', bookType: 'xlsx' })
  const formulaResult = await request('/api/planning/import/preview', 'POST', filePayload('formula.xlsx', formulaBytes, { importType: 'MONTHLY', month: '2027-11' }))
  assert.equal(formulaResult.status, 400)
  assert.match(formulaResult.body.message, /含公式/)
  const invalidCsv = await request('/api/planning/import/preview', 'POST', filePayload('bad.csv', Buffer.from([0x81, 0x30]), { importType: 'MONTHLY', month: '2027-11' }))
  assert.equal(invalidCsv.status, 400)
  assert.match(invalidCsv.body.message, /UTF-8/)

  const conflictBytes = buffers([templateMatrix[0], mkRow('TEST-LATE-CONFLICT', '2027-11-26')])
  const latePreview = await request('/api/planning/import/preview', 'POST', filePayload('late.xlsx', conflictBytes, { importType: 'MONTHLY', month: '2027-11' }))
  const lateData = latePreview.body.rows[0].data
  await db.pool.query(`INSERT INTO "${schema}".vehicle_repair(vehicle_repair_id,locomotive_no,repair_program_id,planned_entry_at,status,approval_status) VALUES ((SELECT COALESCE(MAX(vehicle_repair_id),0)+1 FROM "${schema}".vehicle_repair),$1,$2,$3,'UNSCHEDULED','DRAFT')`, [lateData.locomotiveNo, lateData.repairProgramId, lateData.plannedEntryAt])
  const revisionBeforeLateConfirm = (await db.read()).revision
  const lateConfirm = await request('/api/planning/import/confirm', 'POST', { previewId: latePreview.body.id })
  assert.equal(lateConfirm.status, 409)
  assert.equal(lateConfirm.body.preview.rows[0].status, 'error')
  assert.equal((await db.read()).revision, revisionBeforeLateConfirm)
  await request(`/api/planning/import/preview/${latePreview.body.id}`, 'DELETE')

  const concurrentBytes = buffers([templateMatrix[0], mkRow('TEST-CONCURRENT-01', '2027-11-27')])
  const previewA = await request('/api/planning/import/preview', 'POST', filePayload('same.xlsx', concurrentBytes, { importType: 'MONTHLY', month: '2027-11' }))
  const previewB = await request('/api/planning/import/preview', 'POST', filePayload('same.xlsx', concurrentBytes, { importType: 'MONTHLY', month: '2027-11' }))
  const concurrency = await Promise.all([
    request('/api/planning/import/confirm', 'POST', { previewId: previewA.body.id }),
    request('/api/planning/import/confirm', 'POST', { previewId: previewB.body.id }),
  ])
  assert.equal(concurrency.filter(item => item.status === 200).length, 1)
  assert.equal(concurrency.filter(item => item.status === 409).length, 1)
  assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM "${schema}".vehicle_repair WHERE locomotive_no='TEST-CONCURRENT-01'`)).rows[0].n, 1)

  const victim = importedRows.rows[0]
  await db.pool.query(`INSERT INTO "${schema}".schedule_version(version_id,vehicle_repair_id,version_no,status) VALUES (90001,$1,1,'DRAFT')`, [victim.vehicle_repair_id])
  await db.pool.query(`INSERT INTO "${schema}".vehicle_repair_schedule(schedule_task_id,vehicle_repair_id,task_id,version_id,workstation_id,planned_start_at,planned_end_at,status) VALUES (90001,$1,1001,90001,1,'2027-12-02 08:00','2027-12-02 09:00','NOT_STARTED')`, [victim.vehicle_repair_id])
  await db.pool.query(`UPDATE "${schema}".vehicle_repair SET current_version_id=90001 WHERE vehicle_repair_id=$1`, [victim.vehicle_repair_id])
  let december = await request('/api/planning/calendar?from=2027-12-01&to=2027-12-31')
  assert.equal(december.body.vehicles.some(row => row.id === Number(victim.vehicle_repair_id)), false, 'draft version must not produce an exit event')
  await db.pool.query(`UPDATE "${schema}".schedule_version SET status='CURRENT' WHERE version_id=90001`)
  december = await request('/api/planning/calendar?from=2027-12-01&to=2027-12-31')
  assert.equal(december.body.vehicles.find(row => row.id === Number(victim.vehicle_repair_id)).confirmedExitDate, '2027-12-02', 'current version exit must be visible across months')
  await db.pool.query(`UPDATE "${schema}".schedule_version SET status='SUPERSEDED' WHERE version_id=90001`)
  december = await request('/api/planning/calendar?from=2027-12-01&to=2027-12-31')
  assert.equal(december.body.vehicles.some(row => row.id === Number(victim.vehicle_repair_id)), false, 'superseded version exit must disappear')

  await db.pool.query(`CREATE FUNCTION "${schema}".reject_plan_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.locomotive_no='TEST-ROLLBACK-01' THEN RAISE EXCEPTION 'forced test rollback'; END IF; RETURN NEW; END $$`)
  await db.pool.query(`CREATE TRIGGER test_reject_plan BEFORE INSERT ON "${schema}".vehicle_repair FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_plan_import()`)
  const rollbackPreview = await request('/api/planning/import/preview', 'POST', filePayload('rollback.xlsx', buffers([templateMatrix[0], mkRow('TEST-ROLLBACK-01', '2027-11-28')]), { importType: 'MONTHLY', month: '2027-11' }))
  const revisionBeforeRollback = (await db.read()).revision
  const logError = console.error; console.error = () => {}
  let rollback
  try { rollback = await request('/api/planning/import/confirm', 'POST', { previewId: rollbackPreview.body.id }) }
  finally { console.error = logError }
  assert.notEqual(rollback.status, 200)
  assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM "${schema}".vehicle_repair WHERE locomotive_no='TEST-ROLLBACK-01'`)).rows[0].n, 0)
  assert.equal((await db.read()).revision, revisionBeforeRollback, 'failed batch must roll back the revision')

  console.log(JSON.stringify({ passed: true, tests: ['xlsx/xls/csv templates and parsing', 'preview performs no writes', 'range and dictionary validation', 'duplicate and conflict rows', 'annual/monthly sources and defaults', 'idempotent commit', 'cancel discards preview', 'current-version exit calendar rules', 'cross-month exits', 'confirm-time conflict refresh', 'concurrent duplicate prevention', 'formula and encoding errors', 'error CSV formula defense'] }, null, 2))
} finally {
  if (server) await new Promise(resolve => server.close(resolve))
  assert.ok(/^pc1_test_plan_\d+_\d+$/.test(schema), 'only the isolated planning test schema may be removed')
  await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await db.close()
}
