import assert from 'node:assert/strict'
import { createState } from '../src/core/state.js'
import { monthlyPlanVehicles, buildComponentDownPlan, buildComponentUpPlan, adjustInstalledComponent } from '../src/core/component-monthly-plan.js'

const state = createState()
assert.equal(monthlyPlanVehicles(state, '2026-10').length, 1)

const down = buildComponentDownPlan(state, '2026-10')
assert.equal(down.rows.length, 4)
assert.equal(down.rows.reduce((sum, row) => sum + row.calculated, 0), 6)
assert.equal(down.rows.reduce((sum, row) => sum + row.assigned, 0), 6)

const up = buildComponentUpPlan(state, '2026-10')
assert.equal(up.rows.length, 7)
assert.equal(up.rows.filter(row => row.assigned).length, 5)
const missingWheel = up.rows.find(row => row.requirement.id === 6 && row.slot === 0)
assert.equal(missingWheel.recommended.serialNo, 'CL-2026-0003')

assert.deepEqual(adjustInstalledComponent(state, { vehicleId: 1, requirementId: 6, slot: 0, componentInstanceId: 23 }), { ok: true })
assert.equal(buildComponentUpPlan(state, '2026-10').rows.filter(row => row.assigned).length, 6)
assert.equal(adjustInstalledComponent(state, { vehicleId: 1, requirementId: 6, slot: 1, componentInstanceId: 23 }).ok, false)
assert.equal(buildComponentDownPlan(state, '2026-10', { typeId: 3 }).rows.length, 1)
assert.equal(buildComponentUpPlan(state, '2026-10', { typeId: 4 }).rows.length, 2)

console.log('PASS: monthly component down-plan calculation, up-plan recommendation, filtering and persisted assignment adjustment')
