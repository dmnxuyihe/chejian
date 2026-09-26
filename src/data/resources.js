export const teams = [
  { id: 1, name: '走行班', status: 'ENABLED' },
  { id: 2, name: '天车班', status: 'ENABLED' },
]

export const employees = [
  ...Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    no: `ZX00${i + 1}`,
    name: `走行0${i + 1}`,
    teamId: 1,
    teamName: '走行班',
    status: 'ACTIVE',
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    id: 101 + i,
    no: `TC00${i + 1}`,
    name: `天车0${i + 1}`,
    teamId: 2,
    teamName: '天车班',
    status: 'ACTIVE',
  })),
]

export const employeeLeaves = []

export const workstations = [
  { id: 1, code: 'WS-GJ', name: '构架检修工位', line: '构架检修线', capacity: 1, status: 'AVAILABLE' },
  { id: 2, code: 'WS-LQ', name: '轮驱检修工位', line: '轮驱检修线', capacity: 1, status: 'AVAILABLE' },
]

export const equipment = [
  [1,'EQ001','构架清洗机','构架清洗机',1],
  [2,'EQ002','构架抛丸机','构架抛丸机',1],
  [3,'EQ003','构架翻转机','构架翻转机',1],
  [4,'EQ004','构架喷漆机','构架喷漆机',1],
  [5,'EQ005','轴箱轴承分解机','轴箱轴承分解机',2],
  [6,'EQ006','轮对退卸机','轮对退卸机',2],
  [7,'EQ007','1号天车','天车',2],
  [8,'EQ008','车轴清洗机','车轴清洗机',2],
  [9,'EQ009','车轴磁粉探伤机','车轴磁粉探伤机',2],
  [10,'EQ010','车轴相控阵超声波探伤机','车轴相控阵超声波探伤机',2],
  [11,'EQ011','车轴测量机','车轴测量机',2],
  [12,'EQ012','车轴翻转机','车轴翻转机',2],
  [13,'EQ013','抱轴箱横动量测量机','抱轴箱横动量测量机',2],
  [14,'EQ014','车轮制动盘分解机','车轮制动盘分解机',2],
  [15,'EQ015','磁粉探伤机','磁粉探伤机',2],
  [16,'EQ016','车轮制动盘自动组装机','车轮制动盘自动组装机',2],
  [17,'EQ017','静平衡机','静平衡机',2],
  [18,'EQ018','轮对压装机','轮对压装机',2],
  [19,'EQ019','轮对反压机','轮对反压机',2],
  [20,'EQ020','轮对尺寸测量机','轮对尺寸测量机',2],
].map(([id,code,name,type,workstationId]) => ({ id, code, name, type, workstationId, status: 'AVAILABLE', location: '对应检修区域' }))

export const componentTypes = [
  { id: 1, code: 'CMP-WP', name: '轮对总成', specification: 'HXD1C', unit: '件', status: 'ENABLED' },
  { id: 2, code: 'CMP-AX', name: '车轴', specification: 'HXD1C轮对车轴', unit: '件', status: 'ENABLED' },
  { id: 3, code: 'CMP-WH', name: '车轮', specification: 'HXD1C车轮', unit: '件', status: 'ENABLED' },
  { id: 4, code: 'CMP-BD', name: '制动盘', specification: 'HXD1C轮装制动盘', unit: '件', status: 'ENABLED' },
]

export const componentInstances = [
  { id: 1, typeId: 1, serialNo: 'LD-2026-0001', assetCode: 'LD0001', qrCode: 'QR-LD0001', status: 'REPAIRING', locationType: 'WORKSTATION', workstationId: 2, locomotiveNo: 'HXD1C0001', location: '轮驱检修工位' },
  { id: 2, typeId: 1, serialNo: 'LD-2026-0002', assetCode: 'LD0002', qrCode: 'QR-LD0002', status: 'AVAILABLE', locationType: 'WAREHOUSE', workstationId: null, locomotiveNo: '', location: '配件缓冲区' },
  { id: 11, typeId: 2, serialNo: 'CX-2026-0001', assetCode: 'CX0001', qrCode: 'QR-CX0001', status: 'WAIT_REPAIR', locationType: 'WORKSTATION', workstationId: 2, locomotiveNo: 'HXD1C0001', location: '轮驱检修工位' },
  { id: 12, typeId: 2, serialNo: 'CX-2026-0002', assetCode: 'CX0002', qrCode: 'QR-CX0002', status: 'AVAILABLE', locationType: 'WAREHOUSE', workstationId: null, locomotiveNo: '', location: '配件缓冲区' },
  { id: 21, typeId: 3, serialNo: 'CL-2026-0001', assetCode: 'CL0001', qrCode: 'QR-CL0001', status: 'WAIT_REPAIR', locationType: 'WORKSTATION', workstationId: 2, locomotiveNo: 'HXD1C0001', location: '轮驱检修工位' },
  { id: 22, typeId: 3, serialNo: 'CL-2026-0002', assetCode: 'CL0002', qrCode: 'QR-CL0002', status: 'WAIT_REPAIR', locationType: 'WORKSTATION', workstationId: 2, locomotiveNo: 'HXD1C0001', location: '轮驱检修工位' },
  { id: 23, typeId: 3, serialNo: 'CL-2026-0003', assetCode: 'CL0003', qrCode: 'QR-CL0003', status: 'AVAILABLE', locationType: 'WAREHOUSE', workstationId: null, locomotiveNo: '', location: '配件缓冲区' },
  { id: 24, typeId: 3, serialNo: 'CL-2026-0004', assetCode: 'CL0004', qrCode: 'QR-CL0004', status: 'AVAILABLE', locationType: 'WAREHOUSE', workstationId: null, locomotiveNo: '', location: '配件缓冲区' },
  { id: 31, typeId: 4, serialNo: 'ZDP-2026-0001', assetCode: 'ZDP0001', qrCode: 'QR-ZDP0001', status: 'WAIT_REPAIR', locationType: 'WORKSTATION', workstationId: 2, locomotiveNo: 'HXD1C0001', location: '轮驱检修工位' },
  { id: 32, typeId: 4, serialNo: 'ZDP-2026-0002', assetCode: 'ZDP0002', qrCode: 'QR-ZDP0002', status: 'WAIT_REPAIR', locationType: 'WORKSTATION', workstationId: 2, locomotiveNo: 'HXD1C0001', location: '轮驱检修工位' },
  { id: 33, typeId: 4, serialNo: 'ZDP-2026-0003', assetCode: 'ZDP0003', qrCode: 'QR-ZDP0003', status: 'AVAILABLE', locationType: 'WAREHOUSE', workstationId: null, locomotiveNo: '', location: '配件缓冲区' },
  { id: 34, typeId: 4, serialNo: 'ZDP-2026-0004', assetCode: 'ZDP0004', qrCode: 'QR-ZDP0004', status: 'AVAILABLE', locationType: 'WAREHOUSE', workstationId: null, locomotiveNo: '', location: '配件缓冲区' },
]

export const workCalendar = [
  ['2026-10-01', true], ['2026-10-02', true], ['2026-10-03', true], ['2026-10-04', true], ['2026-10-05', true],
].map(([date,isWorkday]) => ({ date, isWorkday, start: '00:00:00', end: '23:59:59', type: 'WORKDAY', remark: '本次初始化模拟连续作业' }))
