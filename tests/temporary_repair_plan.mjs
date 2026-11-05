import assert from 'node:assert/strict'
import * as XLSX from '@e965/xlsx'
import { createState } from '../src/core/state.js'
import { createTemporaryRepairPlan, updateTemporaryRepairPlan, deleteTemporaryRepairPlan, importTemporaryRepairRows } from '../src/core/temporary-repair-plan.js'
import { exportDemoSnapshot, parseDemoSnapshot } from '../src/core/demo-persistence.js'
import { parseTemporaryRepairFile } from '../server/temporary-repair-import.js'

const state=createState(),base={ownerDepot:'测试委修段',modelId:1,locomotiveNo:'HXD1C-LX001',plannedEntryAt:'2026-11-08T08:00',plannedPlatformAt:'2026-11-08T10:00',content:'走行部异响检查',solutionAttachment:{name:'临修方案.pdf',mimeType:'application/pdf',bytes:4,contentBase64:'JVBERg=='}}
assert.equal(createTemporaryRepairPlan(state,base).ok,true)
assert.equal(state.temporaryRepairPlans.length,1)
assert.equal(createTemporaryRepairPlan(state,base).ok,false,'duplicate temporary repair plan must be rejected')
assert.equal(updateTemporaryRepairPlan(state,1,{...base,content:'更新后的临修内容'}).ok,true)
assert.equal(parseDemoSnapshot(JSON.stringify(exportDemoSnapshot(state))).data.temporaryRepairPlans[0].content,'更新后的临修内容')

const imported=importTemporaryRepairRows(state,[{...base,locomotiveNo:'HXD1C-LX002',solutionAttachment:null},{...base,locomotiveNo:'',solutionAttachment:null}])
assert.deepEqual(imported.preview.map(row=>row.status),['ready','error'])
assert.equal(imported.commit().imported,1)
state.temporaryRepairPlans[0].status='SUBMITTED'
assert.equal(deleteTemporaryRepairPlan(state,1).ok,false)
state.temporaryRepairPlans[0].status='DRAFT'
assert.equal(deleteTemporaryRepairPlan(state,1).ok,true)

const matrix=[['委修段','机型','机车号','计划入段时间','计划上台时间','临修内容'],['Excel段','HXD1C','HXD1C-XLS001','2026-11-09 08:00','2026-11-09 09:30','Excel导入临修']]
const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(matrix),'临修计划')
const buffer=XLSX.write(book,{type:'buffer',bookType:'xlsx'})
const parsed=parseTemporaryRepairFile({filename:'临修.xlsx',contentBase64:buffer.toString('base64')})
assert.equal(parsed[0].locomotiveNo,'HXD1C-XLS001')
assert.equal(parsed[0].plannedPlatformAt,'2026-11-09T09:30')
console.log('PASS: temporary repair CRUD, attachment persistence, import correction and XLSX parsing')
