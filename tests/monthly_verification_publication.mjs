import assert from 'node:assert/strict'
import { monthlyVerificationPage } from '../src/roles/planning/pages/monthly-verification-v4.js'

const now = new Date()
const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const state = {
  locomotiveModels: [{ id: 1, name: 'HXD1C' }],
  repairPrograms: [{ id: 1, modelId: 1, name: '高级修' }],
  schedules: [],
  monthlyVerificationRecords: [
    { id: 1, vehicleRepairId: 1, date: `${month}-08`, depot: '已发布委修段', result: 'PASSED' },
    { id: 2, vehicleRepairId: 2, date: `${month}-09`, depot: '未发布委修段', result: 'FAILED' }
  ],
  vehicleRepairs: [
    { id: 1, locomotiveNo: 'PUB-001', repairProgramId: 1, repairSequence: 1, ownerBureau: '测试局', ownerDepot: '已发布委修段', planSource: 'MONTHLY', approvalStatus: 'PUBLISHED', plannedEntryAt: `${month}-08` },
    { id: 2, locomotiveNo: 'DRAFT-002', repairProgramId: 1, repairSequence: 2, ownerBureau: '测试局', ownerDepot: '未发布委修段', planSource: 'MONTHLY', approvalStatus: 'DRAFT', plannedEntryAt: `${month}-09` }
  ]
}

const html = monthlyVerificationPage.render({ state })
assert.match(html, /PUB-001/)
assert.match(html, /DRAFT-002/)
assert.match(html, />已发布<\/span>/)
assert.match(html, />未发布<\/span>/)
assert.match(html, /data-published-count="1"/)
assert.match(html, /data-toggle-depot="已发布委修段"/)
assert.doesNotMatch(html, /data-toggle-depot="未发布委修段"/)
assert.doesNotMatch(html, /已交验|待交验|交验未通过/)
assert.doesNotMatch(html, /待审核月度计划|data-monthly-verification-todos/)
assert.match(html, /本月车辆总数[\s\S]*?stat-value[^>]*>2</)
assert.match(html, /已发布车辆[\s\S]*?stat-value[^>]*>1</)
assert.match(html, /未发布车辆[\s\S]*?stat-value[^>]*>1</)
assert.match(html, /计划发布率[\s\S]*?stat-value[^>]*>50%/)
assert.equal((html.match(/data-delivery-month/g) || []).length, 1)
assert.ok(html.indexOf('data-delivery-month') < html.indexOf('各委修段月度交验趋势'))

console.log(JSON.stringify({ passed: true, checks: ['交验页不再重复显示待审核通知', '月份筛选位于汇总和趋势上方', '本月总数、已发布、未发布及发布率正确', '趋势仅统计已发布车辆'] }, null, 2))
