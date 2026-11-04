import assert from 'node:assert/strict'
import http from 'node:http'
import { createDatabase } from '../server/database.js'
import { createHandler } from '../server/http.js'
import { loadConfig } from '../server/config.js'
import { createState } from '../src/core/state.js'
import { commitImport, parseCsv, templateCsv } from '../src/core/plan-import.js'
import { simulatePc1, pc1PreviewIssues, confirmPc1Preview } from '../src/core/pc1-simulation.js'
import { exportDemoSnapshot } from '../src/core/demo-persistence.js'

const schema = `pc1_test_workflow_${Date.now()}_${process.pid}`
let db = createDatabase({...loadConfig(),schema}), server
try {
  await db.init()
  const loaded = await db.read(), state = loaded.snapshot.data
  const { ids } = commitImport(state,parseCsv(templateCsv))
  const original = structuredClone(state.schedules)
  state.pc1SchedulePreview = simulatePc1(state,ids,'2026-11-15T18:00:00').preview
  await db.save(loaded.revision,exportDemoSnapshot(state))
  let restored = await db.read()
  assert.deepEqual(restored.snapshot.data.schedules,original)
  assert.deepEqual(pc1PreviewIssues(restored.snapshot.data),[], 'preview must stay valid after PostgreSQL roundtrip')
  const confirmed = confirmPc1Preview(restored.snapshot.data)
  assert.equal(confirmed.ok,true,JSON.stringify(confirmed))
  await db.save(restored.revision,exportDemoSnapshot(restored.snapshot.data))
  await db.close(); db = createDatabase({...loadConfig(),schema}); await db.init()
  restored = await db.read()
  assert.equal(restored.snapshot.data.pc1Dispatches.length,4)
  const task = restored.snapshot.data.schedules.find(row => row.vehicleRepairId === ids[0] && row.taskId === 1001)
  server = http.createServer(createHandler(db))
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const calendar = await (await fetch(`${base}/api/planning/calendar?from=2026-10-01&to=2026-11-15`)).json()
  for (const id of ids) {
    const vehicle = calendar.vehicles.find(row => row.id === id)
    const end = restored.snapshot.data.schedules.filter(row => row.vehicleRepairId === id && row.versionId === restored.snapshot.data.vehicleRepairs.find(car => car.id === id).currentVersionId).map(row => row.plannedEndAt).sort().at(-1)
    assert.equal(vehicle.confirmedExitDate,end.slice(0,10),'monthly exit comes from the confirmed current schedule')
    assert.equal(vehicle.versionStatus,'CURRENT')
  }
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
  const payload = {requestId:'e7a6da32-4392-4193-aad5-f599c0913f83',scheduleTaskId:task.id,submittedBy:'PC1测试人员',notes:'构架清洗记录',measurements:[{name:'温度',value:25,unit:'℃'}],attachments:[{name:'清洗照片.png',mimeType:'image/png',contentBase64:png}]}
  const submit = async (data, headers={}) => { const response = await fetch(`${base}/api/pc1/records`,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});return {status:response.status,body:await response.json()} }
  assert.equal((await submit(payload)).status,400,'unfinished tasks cannot receive completion records')
  task.status = 'COMPLETED'; task.actualStartAt = task.plannedStartAt; task.actualEndAt = task.plannedEndAt
  await db.save(restored.revision,exportDemoSnapshot(restored.snapshot.data))
  const uploaded = await submit(payload)
  assert.equal(uploaded.status,200,JSON.stringify(uploaded.body))
  assert.equal((await submit(payload)).body.duplicate,true,'record submission is idempotent')
  const file = uploaded.body.record.attachments[0]
  const response = await fetch(`${base}${file.url}`)
  assert.equal(response.headers.get('content-type'),'image/png')
  assert.equal(Buffer.from(await response.arrayBuffer()).toString('base64'),png)
  const partial = await fetch(`${base}${file.url}`,{headers:{Range:'bytes=0-7'}})
  assert.equal(partial.status,206)
  assert.equal((await partial.arrayBuffer()).byteLength,8)
  assert.equal((await fetch(`${base}${file.url}`,{headers:{Range:'bytes=999999-'}})).status,416)
  assert.equal((await fetch(`${base}/api/pc1/attachments/------------------------------------`)).status,404,'malformed UUID must not become a database failure')
  assert.equal((await submit({...payload,requestId:undefined,attachments:[{...payload.attachments[0],contentBase64:Buffer.from('<script>alert(1)</script>').toString('base64')}]})).status,400,'disguised HTML must be rejected')
  assert.equal((await submit({...payload,requestId:undefined},{Origin:'https://untrusted.example'})).status,403)
  const current = await db.read()
  assert.equal(current.snapshot.data.maintenanceRecords.length,1)
  assert.equal(current.snapshot.data.maintenanceRecords[0].measurements[0].value,25)
  console.log(JSON.stringify({passed:true,checks:['preview roundtrip with unchanged formal rows','published relational tasks and dispatches','restart recovery','completed task records','atomic/idempotent media upload','image bytes and range serving','input/origin validation']},null,2))
} finally {
  if (server) await new Promise(resolve => server.close(resolve))
  assert.ok(/^pc1_test_workflow_\d+_\d+$/.test(schema))
  await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await db.close()
}
