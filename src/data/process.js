export const repairPrograms = [
  { id: 1, modelId: 1, code: 'HXD1C-HIGH', name: 'HXD1C高级修', status: 'ENABLED' },
]

export const locomotiveModels = [
  { id: 1, code: 'HXD1C', name: 'HXD1C', status: 'ENABLED' },
]

export const tasks = [
  { id:1001, process:'构架', name:'构架清洗', workstationId:1, duration:60, sequence:1 },
  { id:1002, process:'构架', name:'构架抛丸', workstationId:1, duration:180, sequence:2 },
  { id:1003, process:'构架', name:'构架探伤', workstationId:1, duration:840, sequence:3 },
  { id:1004, process:'构架', name:'构架喷漆', workstationId:1, duration:120, sequence:4 },
  { id:2001, process:'轮驱', name:'入库前轮对运用数据分析', workstationId:2, duration:10, sequence:1 },
  { id:2002, process:'轮驱', name:'轮对清洁', workstationId:2, duration:60, sequence:2 },
  { id:2003, process:'轮驱', name:'分解检查', workstationId:2, duration:120, sequence:3 },
  { id:2004, process:'轮驱', name:'轴箱轴承拆解', workstationId:2, duration:120, sequence:4 },
  { id:2005, process:'轮驱', name:'轮对分解（轮盘和车轴）', workstationId:2, duration:120, sequence:5 },
  { id:2006, process:'轮驱', name:'车轴检修', workstationId:2, duration:240, sequence:6 },
  { id:2007, process:'轮驱', name:'抱轴箱检修', workstationId:2, duration:240, sequence:7 },
  { id:2008, process:'轮驱', name:'轮盘分解（制动盘+车轮）', workstationId:2, duration:90, sequence:8 },
  { id:2009, process:'轮驱', name:'制动盘检修', workstationId:2, duration:240, sequence:9 },
  { id:2010, process:'轮驱', name:'车轮检修', workstationId:2, duration:240, sequence:10 },
  { id:2011, process:'轮驱', name:'轮盘组装', workstationId:2, duration:120, sequence:11 },
  { id:2012, process:'轮驱', name:'轮盘静平衡试验', workstationId:2, duration:60, sequence:12 },
  { id:2013, process:'轮驱', name:'轮对组装', workstationId:2, duration:120, sequence:13 },
  { id:2014, process:'轮驱', name:'轮对压装', workstationId:2, duration:90, sequence:14 },
  { id:2015, process:'轮驱', name:'轮对反压', workstationId:2, duration:90, sequence:15 },
  { id:2016, process:'轮驱', name:'轮对尺寸测量', workstationId:2, duration:90, sequence:16 },
].map(t => ({ ...t, repairProgramId: 1, isProgressNode: false, status: 'ENABLED' }))

export const dependencies = [
  [1,1001,1002,0],[2,1002,1003,0],[3,1003,1004,0],
  [4,2001,2002,0],[5,2002,2003,0],[6,2003,2004,0],[7,2004,2005,0],
  [8,2005,2006,0],[9,2006,2007,0],[10,2007,2008,0],[11,2008,2009,0],
  [12,2009,2010,0],[13,2010,2011,0],[14,2011,2012,0],[15,2012,2013,0],
  [16,2013,2014,0],[17,2014,2015,2880],[18,2015,2016,0],
].map(([id,parentTaskId,childTaskId,lagMinutes]) => ({ id, parentTaskId, childTaskId, type:'FS', lagMinutes }))

export const teamRequirements = [
  [1001,1,8],[1002,1,8],[1003,1,8],[1004,1,8],
  [2001,1,2],[2002,1,2],[2003,1,2],[2004,1,2],
  ...[2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016].flatMap(taskId => [[taskId,1,2],[taskId,2,1]])
].map(([taskId,teamId,headcount]) => ({ taskId, teamId, headcount }))

export const equipmentRequirements = [
  [1001,'构架清洗机'],[1002,'构架抛丸机'],[1003,'构架翻转机'],[1004,'构架喷漆机'],
  [2004,'轴箱轴承分解机'],[2005,'轮对退卸机'],[2005,'天车'],
  [2006,'车轴清洗机'],[2006,'车轴磁粉探伤机'],[2006,'车轴相控阵超声波探伤机'],[2006,'车轴测量机'],[2006,'车轴翻转机'],[2006,'天车'],
  [2007,'抱轴箱横动量测量机'],[2007,'天车'],
  [2008,'车轮制动盘分解机'],[2008,'天车'],
  [2009,'磁粉探伤机'],[2009,'天车'],[2010,'磁粉探伤机'],[2010,'天车'],
  [2011,'车轮制动盘自动组装机'],[2011,'天车'],[2012,'静平衡机'],[2012,'天车'],
  [2013,'天车'],[2014,'轮对压装机'],[2014,'天车'],[2015,'轮对反压机'],[2015,'天车'],[2016,'轮对尺寸测量机'],[2016,'天车'],
].map(([taskId,equipmentType], i) => ({ id:i+1, taskId, equipmentType, quantity:1 }))

// 仅补充排程所需的配件关系，不扩展采购/仓储流程。
export const componentRequirements = [
  { id:1, taskId:2005, componentTypeId:1, quantity:1, action:'REMOVE', mandatory:true },
  { id:2, taskId:2006, componentTypeId:2, quantity:1, action:'REPAIR', mandatory:true },
  { id:3, taskId:2009, componentTypeId:4, quantity:2, action:'REPAIR', mandatory:true },
  { id:4, taskId:2010, componentTypeId:3, quantity:2, action:'REPAIR', mandatory:true },
  { id:5, taskId:2011, componentTypeId:4, quantity:2, action:'INSTALL', mandatory:true },
  { id:6, taskId:2011, componentTypeId:3, quantity:2, action:'INSTALL', mandatory:true },
  { id:7, taskId:2013, componentTypeId:2, quantity:1, action:'INSTALL', mandatory:true },
  { id:8, taskId:2013, componentTypeId:3, quantity:2, action:'INSTALL', mandatory:true },
]

export const taskStepHints = {
  1001: ['构架清洗机清洗','人工清理','确认拍照'],
  1002: ['构架抛丸机抛丸','压缩空气清洁','确认拍照'],
  1003: ['目测检查','磁粉探伤','焊修（可选）','螺孔检查','翻转后重复检查','铭牌检查'],
  1004: ['环境温湿度确认','表面清洁确认','非涂装部位防护','喷涂','确认拍照'],
  2001: ['获取车载走行部故障诊断系统检测报告'],
  2002: ['防护封堵','预人工清理','专业清洗剂涂刷'],
  2003: ['目测检查','尺寸测量并记录'],
  2004: ['拆卸轴箱端盖等','分离轴箱体','拆卸轴承内圈','分类防护与初检'],
  2005: ['启动天车','一端吊至退卸机','高压注油并压出车轴','另一端重复'],
  2006: ['除锈清洁','车轴超声波探伤','磁粉探伤','涂漆'],
  2007: ['横动量测量','补脂','磁粉探伤','裂纹变形检查','清洁','螺纹检查','更换O型圈','涂漆'],
  2008: ['轮盘清洁','拆卸紧固件','拆卸外侧制动盘','拆卸内侧制动盘','取定位销'],
  2009: ['制动盘清洗','制动盘探伤','紧固件更新'],
  2010: ['车轮清洗','磁粉探伤','超声波探伤','镟轮（可选）','尺寸复测','防护'],
  2011: ['确认检修合格','润滑涂层','确认制动盘成对','螺栓螺母浸油','组装内外侧制动盘','紧固并标记'],
  2012: ['吊至静平衡机','试验准备','确定偏重方位','试配配重','安装正式配重','提交报告'],
  2013: ['车轴清洁测量','车轮清洁测量','选配车轮','涂茶油','涂胶','预装两侧车轮'],
  2014: ['检查压装设备','压装车轮到车轴','安装注油孔螺栓','生成压装曲线','测量电阻'],
  2015: ['确认静置超过48小时','启动天车','两侧反压','紧固注油孔螺栓','提交反压报告'],
  2016: ['启动天车','吊至测量机','启动测量','提交检测报告','转至缓冲区或下一工位'],
}
