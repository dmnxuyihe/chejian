import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

const base = 'http://127.0.0.1:5193'
const dir = 'G:/rail-maintenance-scheduler/outputs/monthly-import-validation-2026-12'
let cookie = ''

async function request(path, method = 'GET', value) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(value === undefined ? {} : { 'Content-Type': 'application/json' }),
      'x-pc1-simulated-role': 'PLANNER'
    },
    ...(value === undefined ? {} : { body: JSON.stringify(value) })
  })
  const setCookie = response.headers.getSetCookie?.()[0]
  if (setCookie) cookie = setCookie.split(';')[0]
  const body = await response.json()
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`)
  return body
}

async function preview(fileName) {
  const bytes = await fs.readFile(`${dir}/${fileName}`)
  return request('/api/planning/import/preview', 'POST', {
    filename: fileName,
    contentBase64: bytes.toString('base64'),
    importType: 'MONTHLY',
    importMode: 'MONTHLY_IMPORT',
    month: '2026-12'
  })
}

const valid = await preview('2026年12月月度计划导入_正确示例.xlsx')
assert.equal(valid.total, 5)
assert.equal(valid.importable, 5)
assert.equal(valid.errors, 0)
await request(`/api/planning/import/preview/${valid.id}`, 'DELETE')

const invalid = await preview('2026年12月月度计划导入_错误示例.xlsx')
assert.equal(invalid.total, 9)
assert.equal(invalid.importable, 0)
assert.equal(invalid.errors, 9)
const messages = invalid.rows.map(row => ({ line: row.line, locomotiveNo: row.data?.locomotiveNo, status: row.status, errors: row.errors.map(error => `${error.field}:${error.message}`) }))
await request(`/api/planning/import/preview/${invalid.id}`, 'DELETE')

console.log(JSON.stringify({ valid: { total: valid.total, importable: valid.importable, errors: valid.errors }, invalid: { total: invalid.total, importable: invalid.importable, errors: invalid.errors, rows: messages }, confirmed: false }, null, 2))
