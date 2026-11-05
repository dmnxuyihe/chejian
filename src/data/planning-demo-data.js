const clone = value => structuredClone(value)
const attachment = name => ({ name, mimeType: 'application/pdf', bytes: 8, contentBase64: 'JVBERi0xLjQ=' })

const demoCollections = {
  annualPlanAdjustments: [
    { id: 1, year: 2026, month: 1, modelId: 1, programId: 1, baseline: 3, adjusted: 3, actual: 3, deliveryDays: 28 },
    { id: 2, year: 2026, month: 3, modelId: 1, programId: 1, baseline: 4, adjusted: 5, actual: 4, deliveryDays: 28 },
    { id: 3, year: 2026, month: 5, modelId: 1, programId: 1, baseline: 4, adjusted: 4, actual: 4, deliveryDays: 30 },
    { id: 4, year: 2026, month: 7, modelId: 1, programId: 1, baseline: 5, adjusted: 4, actual: 4, deliveryDays: 30 },
    { id: 5, year: 2026, month: 9, modelId: 1, programId: 1, baseline: 4, adjusted: 5, actual: 4, deliveryDays: 28 },
    { id: 6, year: 2026, month: 11, modelId: 1, programId: 1, baseline: 3, adjusted: 4, actual: 1, deliveryDays: 28 },
  ],
  componentMonthlyPlanRecords: [
    { id: 1, month: '2026-11', direction: 'DOWN', componentTypeId: 2, planned: 4, calculated: 4, mileageKm: 500000, status: 'DRAFT' },
    { id: 2, month: '2026-11', direction: 'DOWN', componentTypeId: 4, planned: 8, calculated: 8, mileageKm: 500000, status: 'DRAFT' },
    { id: 3, month: '2026-11', direction: 'UP', componentTypeId: 3, planned: 8, calculated: 8, mileageKm: 495000, status: 'DRAFT' },
    { id: 4, month: '2026-11', direction: 'UP', componentTypeId: 4, planned: 8, calculated: 8, mileageKm: 502000, status: 'PUBLISHED' },
  ],
  monthlyVerificationRecords: [{ id: 1, vehicleRepairId: 1, date: '2026-10-05', depot: '模拟检修段', result: 'PASSED' }],
  monthlyPlanAdjustmentHistory: [{ id: 1, vehicleRepairId: 1, reason: '根据到段时间调整上台安排', requestedAt: '2026-10-02T09:30:00', previousApprovalStatus: 'PUBLISHED' }],
  temporaryRepairPlans: [
    { id: 1, ownerDepot: '西安机务段', modelId: 1, locomotiveNo: 'HXD1C6123', plannedEntryAt: '2026-11-08T08:00:00', plannedPlatformAt: '2026-11-08T10:00:00', content: '走行部异响检查及轴箱状态确认', solutionAttachment: attachment('HXD1C6123临修方案.pdf'), status: 'SUBMITTED', createdAt: '2026-11-01T09:00:00', updatedAt: '2026-11-01T10:00:00' },
    { id: 2, ownerDepot: '新丰镇机务段', modelId: 1, locomotiveNo: 'HXD1C6188', plannedEntryAt: '2026-11-12T09:00:00', plannedPlatformAt: '2026-11-12T13:30:00', content: '制动系统压力异常排查与管路检查', solutionAttachment: null, status: 'DRAFT', createdAt: '2026-11-02T11:00:00', updatedAt: '2026-11-02T11:00:00' },
  ],
  componentTemporaryPlans: [
    { id: 1, name: '车轴', modelId: 1, serialNo: 'CX-LX-2026-011', specification: 'HXD1C轮对车轴', plannedEntryAt: '2026-11-10T08:00:00', content: '轴颈擦伤临修处理并复测尺寸', solutionAttachment: attachment('车轴CX-LX-2026-011临修方案.pdf'), status: 'SUBMITTED', createdAt: '2026-11-01T14:00:00' },
    { id: 2, name: '制动盘', modelId: 1, serialNo: 'ZDP-LX-2026-019', specification: 'HXD1C轮装制动盘', plannedEntryAt: '2026-11-14T08:30:00', content: '制动盘表面裂纹探伤和尺寸复核', solutionAttachment: null, status: 'DRAFT', createdAt: '2026-11-03T08:30:00' },
  ],
  planApprovalFlows: [
    { id: 1, entityType: 'TEMP_VEHICLE', entityId: 1, status: 'SUBMITTED', note: '技术科已上传方案并提报', submittedAt: '2026-11-01T10:00:00', updatedAt: '2026-11-01T10:00:00', history: [{ at: '2026-11-01T10:00:00', action: 'SUBMIT', comment: '整车临修方案提报' }] },
    { id: 2, entityType: 'TEMP_COMPONENT', entityId: 1, status: 'SUBMITTED', note: '配件临修方案待审核', submittedAt: '2026-11-01T15:00:00', updatedAt: '2026-11-01T15:00:00', history: [{ at: '2026-11-01T15:00:00', action: 'SUBMIT', comment: '配件临修方案提报' }] },
  ],
}

// Version 2 backfills temporary-repair samples for databases that already
// recorded the first planning demo seed before those collections were added.
export const PLANNING_DEMO_SEED_VERSION = 4

export function ensurePlanningDemoData(state) {
  const currentVersion = Number(state.planningDemoSeedVersion || 0)
  if (currentVersion >= PLANNING_DEMO_SEED_VERSION) return false
  for (const [key, rows] of Object.entries(demoCollections)) {
    if (!Array.isArray(state[key]) || state[key].length === 0) state[key] = clone(rows)
  }
  if (currentVersion < 3 && !state.temporaryRepairPlans.some(row => row.locomotiveNo === 'HXD1C6208')) {
    state.temporaryRepairPlans.push({
      id: Math.max(0, ...state.temporaryRepairPlans.map(row => Number(row.id) || 0)) + 1,
      ownerDepot: '安康机务段', modelId: 1, locomotiveNo: 'HXD1C6208',
      plannedEntryAt: '2026-11-16T08:00:00', plannedPlatformAt: '2026-11-16T10:30:00',
      content: '受电弓升降异常检查及气路密封处理',
      solutionAttachment: attachment('HXD1C6208临修方案.pdf'),
      status: 'DRAFT', createdAt: '2026-11-05T09:00:00', updatedAt: '2026-11-05T09:00:00',
    })
  }
  // Version 4 adds a real monthly-plan approval example.  The approval detail
  // resolves the vehicle's published schedule, so reviewers see exactly which
  // tasks, workstations and teams they are approving.
  if (currentVersion < 4 && !state.planApprovalFlows.some(row => row.entityType === 'MONTHLY')) {
    const vehicle = state.vehicleRepairs.find(row => row.locomotiveNo === 'HXD1C0001') || state.vehicleRepairs[0]
    if (vehicle) {
      vehicle.approvalStatus = 'SUBMITTED'
      state.planApprovalFlows.push({
        id: Math.max(0, ...state.planApprovalFlows.map(row => Number(row.id) || 0)) + 1,
        entityType: 'MONTHLY',
        entityId: vehicle.id,
        status: 'SUBMITTED',
        note: '2026年10月月度检修计划及车辆排程已完成，申请主管科长审核。',
        submittedAt: '2026-09-24T09:00:00',
        updatedAt: '2026-09-24T09:00:00',
        history: [{
          at: '2026-09-24T09:00:00',
          action: 'SUBMIT',
          comment: '已核对机车清单、20项工序排程、工位与班组安排。',
        }],
      })
    }
  }
  state.planningDemoSeedVersion = PLANNING_DEMO_SEED_VERSION
  return true
}
