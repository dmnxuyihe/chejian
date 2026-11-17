import assert from 'node:assert/strict'
import * as XLSX from '@e965/xlsx'
import { createDatabase } from '../server/database.js'
import { loadConfig } from '../server/config.js'
import { createPlanningService } from '../server/planning.js'
import { createMonthlyPlanService } from '../server/monthly-plans-v2.js'

const schema = `pc1_test_import_deleted_${Date.now()}_${process.pid}`
const db = createDatabase({ ...loadConfig(), schema })
const headers = ['机车编号', '机型', '修程', '修次', '计划入段日期', '配属局', '配属段', '累计走行公里', '备注']
const rows = [
  ['HXD1C-2612', 'HXD1C', 'C1', 1, '2026-12-03', '北京局', '丰台机务段', 100000, '正确示例'],
  ['HXD1-0819', 'HXD1', 'C2', 2, '2026-12-08', '太原局', '湖东电力机务段', 200000, '正确示例'],
  ['HXD1D-0436', 'HXD1D', 'C3', 3, '2026-12-13', '西安局', '新丰镇机务段', 300000, '正确示例'],
  ['HXD3C-1578', 'HXD3C', 'C4', 4, '2026-12-19', '上海局', '南京东机辆段', 400000, '正确示例'],
  ['FXD3-J-0027', 'FXD3-J', 'C5', 5, '2026-12-25', '广州局', '广州机务段', 500000, '正确示例'],
]

function workbookBuffer() {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...rows]), '导入数据')
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
}

async function preview(planning, sessionId) {
  return planning.preview({
    sessionId,
    role: 'PLANNER',
    filename: '2026年12月月度计划导入_正确示例.xlsx',
    contentBase64: workbookBuffer().toString('base64'),
    importType: 'MONTHLY',
    importMode: 'MONTHLY_IMPORT',
    month: '2026-12',
  })
}

try {
  await db.init()
  const planning = createPlanningService(db)
  const monthly = createMonthlyPlanService(db)

  const first = await preview(planning, 'initial-import')
  assert.equal(first.importable, 5, '正确示例首次导入必须全部通过')
  await planning.confirm('initial-import', first.id)

  const activeDuplicate = await preview(planning, 'active-duplicate')
  assert.equal(activeDuplicate.errors, 5, '仍有效的五台草稿必须阻止重复导入')

  const plan = await monthly.read({ year: 2026, month: 12, role: 'PLANNER' })
  const imported = plan.draftItems.filter(item => rows.some(row => row[0] === item.locomotiveNo))
  assert.equal(imported.length, 5)
  for (const item of imported) {
    await monthly.deleteItem({
      year: 2026,
      month: 12,
      role: 'PLANNER',
      vehicleRepairId: item.vehicleRepairId,
      draftItemId: item.draftItemId,
    })
  }

  const afterDelete = await monthly.read({ year: 2026, month: 12, role: 'PLANNER' })
  assert.equal(afterDelete.draftItems.some(item => rows.some(row => row[0] === item.locomotiveNo)), false)

  const reimport = await preview(planning, 'reimport-after-delete')
  assert.equal(reimport.importable, 5, '已删除且不再有效的月度草稿不得继续占用机车编号')
  assert.equal(reimport.errors, 0)
  await planning.confirm('reimport-after-delete', reimport.id)

  const duplicateAgain = await preview(planning, 'duplicate-after-reimport')
  assert.equal(duplicateAgain.errors, 5, '重新导入形成有效草稿后仍必须阻止再次重复导入')

  console.log('PASS: 月度导入草稿删除后可重新导入；有效草稿仍阻止数据库重复')
} finally {
  await db.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await db.close()
}
