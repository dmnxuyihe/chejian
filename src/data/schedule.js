export const vehicleRepairs = [
  {
    id: 1,
    locomotiveNo: 'HXD1C0001',
    repairProgramId: 1,
    plannedEntryAt: '2026-10-01T08:00:00',
    plannedExitAt: '2026-10-05T14:10:00',
    actualEntryAt: null,
    actualExitAt: null,
    status: 'SCHEDULED',
    approvalStatus: 'APPROVED',
    currentVersionId: 1,
    ownerBureau: '模拟局',
    ownerDepot: '模拟段',
    repairSequence: 1,
    mileageKm: 500000,
    planSource: 'MANUAL',
    priority: 100,
    remark: '仅用于构架和轮驱两个流程初始化模拟',
  }
]

export const scheduleVersions = [
  { id: 1, vehicleRepairId: 1, versionNo: 1, parentVersionId: null, reason: '初始化排程', status: 'PUBLISHED', publishedAt: '2026-09-23T19:30:00', createdAt: '2026-09-23T19:30:00' }
]

const rawSchedules = [
  [1,1001,1,'2026-10-01T08:00:00','2026-10-01T09:00:00','构架流程初始排程'],
  [2,1002,1,'2026-10-01T09:00:00','2026-10-01T12:00:00','构架流程初始排程'],
  [3,1003,1,'2026-10-01T12:00:00','2026-10-02T02:00:00','构架流程初始排程'],
  [4,1004,1,'2026-10-02T02:00:00','2026-10-02T04:00:00','构架流程初始排程'],
  [5,2001,2,'2026-10-02T04:00:00','2026-10-02T04:10:00','轮驱流程初始排程'],
  [6,2002,2,'2026-10-02T04:10:00','2026-10-02T05:10:00','轮驱流程初始排程'],
  [7,2003,2,'2026-10-02T05:10:00','2026-10-02T07:10:00','轮驱流程初始排程'],
  [8,2004,2,'2026-10-02T07:10:00','2026-10-02T09:10:00','轮驱流程初始排程'],
  [9,2005,2,'2026-10-02T09:10:00','2026-10-02T11:10:00','轮驱流程初始排程'],
  [10,2006,2,'2026-10-02T11:10:00','2026-10-02T15:10:00','轮驱流程初始排程'],
  [11,2007,2,'2026-10-02T15:10:00','2026-10-02T19:10:00','轮驱流程初始排程'],
  [12,2008,2,'2026-10-02T19:10:00','2026-10-02T20:40:00','轮驱流程初始排程'],
  [13,2009,2,'2026-10-02T20:40:00','2026-10-03T00:40:00','轮驱流程初始排程'],
  [14,2010,2,'2026-10-03T00:40:00','2026-10-03T04:40:00','轮驱流程初始排程'],
  [15,2011,2,'2026-10-03T04:40:00','2026-10-03T06:40:00','轮驱流程初始排程'],
  [16,2012,2,'2026-10-03T06:40:00','2026-10-03T07:40:00','轮驱流程初始排程'],
  [17,2013,2,'2026-10-03T07:40:00','2026-10-03T09:40:00','轮驱流程初始排程'],
  [18,2014,2,'2026-10-03T09:40:00','2026-10-03T11:10:00','轮驱流程初始排程'],
  [19,2015,2,'2026-10-05T11:10:00','2026-10-05T12:40:00','轮驱流程初始排程'],
  [20,2016,2,'2026-10-05T12:40:00','2026-10-05T14:10:00','轮驱流程初始排程'],
]

export const schedules = rawSchedules.map(([id,taskId,workstationId,start,end,remark]) => ({
  id, vehicleRepairId:1, taskId, versionId:1, workstationId,
  plannedStartAt:start, plannedEndAt:end,
  actualStartAt:null, actualEndAt:null,
  status:'NOT_STARTED', isLocked:false, delayMinutes:0, remark
}))

// 初始化数据保持原库含义：构架任务使用全部8名走行，轮驱任务主要分配走行01/02，涉及天车的任务分配天车01。
export const initialEmployeeAssignments = [
  ...[1,2,3,4].flatMap(scheduleTaskId => Array.from({length:8},(_,i)=>({ scheduleTaskId, employeeId:i+1 }))),
  ...[5,6,7,8].flatMap(scheduleTaskId => [1,2].map(employeeId => ({ scheduleTaskId, employeeId }))),
  ...Array.from({length:12},(_,idx)=>idx+9).flatMap(scheduleTaskId => [1,2,101].map(employeeId => ({ scheduleTaskId, employeeId }))),
].map((a,index)=>({ id:index+1, ...a, source:'AUTO', status:'ASSIGNED', originalEmployeeId:null, adjustedBy:null, adjustReason:'', assignedAt:'2026-09-23T19:30:00' }))

export const initialEquipmentAssignments = []

export const initialComponentAssignments = [
  { id:1, scheduleTaskId:9, componentInstanceId:1, action:'REMOVE', source:'AUTO', status:'ASSIGNED' },
  { id:2, scheduleTaskId:10, componentInstanceId:11, action:'REPAIR', source:'AUTO', status:'ASSIGNED' },
  { id:3, scheduleTaskId:13, componentInstanceId:31, action:'REPAIR', source:'AUTO', status:'ASSIGNED' },
  { id:4, scheduleTaskId:13, componentInstanceId:32, action:'REPAIR', source:'AUTO', status:'ASSIGNED' },
  { id:5, scheduleTaskId:14, componentInstanceId:21, action:'REPAIR', source:'AUTO', status:'ASSIGNED' },
  { id:6, scheduleTaskId:14, componentInstanceId:22, action:'REPAIR', source:'AUTO', status:'ASSIGNED' },
  { id:7, scheduleTaskId:15, componentInstanceId:31, action:'INSTALL', source:'AUTO', status:'ASSIGNED' },
  { id:8, scheduleTaskId:15, componentInstanceId:32, action:'INSTALL', source:'AUTO', status:'ASSIGNED' },
  { id:9, scheduleTaskId:17, componentInstanceId:11, action:'INSTALL', source:'AUTO', status:'ASSIGNED' },
  { id:10, scheduleTaskId:17, componentInstanceId:21, action:'INSTALL', source:'AUTO', status:'ASSIGNED' },
  { id:11, scheduleTaskId:17, componentInstanceId:22, action:'INSTALL', source:'AUTO', status:'ASSIGNED' },
]

export const initialExceptions = []
