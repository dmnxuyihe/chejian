import { systemAdminRole } from './system-admin/index.js'
import { planningRole } from './planning/index.js'
import { schedulingRole } from './scheduling/index.js'
import { foremanRole } from './foreman/index.js'
import { workerRole } from './worker/index.js'
import { qualityRole } from './quality/index.js'
import { technicalRole } from './technical/index.js'
export const roles={
  [systemAdminRole.id]:systemAdminRole,[planningRole.id]:planningRole,[schedulingRole.id]:schedulingRole,
  [foremanRole.id]:foremanRole,[workerRole.id]:workerRole,[qualityRole.id]:qualityRole,[technicalRole.id]:technicalRole,
}
