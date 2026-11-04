import { randomUUID } from 'node:crypto'
import { formatLocalDateTime } from '../src/core/derived.js'

const invalid = message => { throw Object.assign(new Error(message), { status: 400 }) }
const text = (value, limit) => typeof value === 'string' && value.length <= limit
const allowed = new Set(['image/png','image/jpeg','image/webp','video/mp4','video/webm'])

export function prepareMaintenanceRecord(data, input) {
  const schedule = data.schedules.find(row => row.id === Number(input.scheduleTaskId))
  const version = data.scheduleVersions.find(row => row.id === schedule?.versionId)
  if (!schedule || schedule.status !== 'COMPLETED' || !version || !['PUBLISHED','ARCHIVED'].includes(version.status)) invalid('只能为已发布且已完成的检修任务提交记录')
  if (!text(input.submittedBy, 80) || !input.submittedBy.trim() || !text(input.notes ?? '', 5000)) invalid('请填写提交人，作业说明最多5000字')
  const measurements = input.measurements ?? []
  if (!Array.isArray(measurements) || measurements.length > 100 || measurements.some(row => !row || !text(row.name, 120) || !row.name.trim() || !['string','number'].includes(typeof row.value) || (typeof row.value === 'number' && !Number.isFinite(row.value)) || String(row.value).length > 250 || !text(row.unit ?? '', 30))) invalid('测量数据应包含项目、数值和计量单位，最多100项')
  if (!Array.isArray(input.attachments ?? []) || (input.attachments ?? []).length > 12) invalid('每份记录最多上传12个图片或视频')
  let bytes = 0
  const files = (input.attachments ?? []).map(file => {
    if (!file || !text(file.name, 180) || !file.name.trim() || !allowed.has(file.mimeType) || typeof file.contentBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.contentBase64)) invalid('仅支持PNG、JPEG、WebP图片及MP4、WebM视频')
    const content = Buffer.from(file.contentBase64, 'base64')
    bytes += content.length
    if (!content.length || bytes > 8 * 1024 * 1024) invalid('单次提交的图片和视频总大小不得超过8MB')
    const signatures = {
      'image/png': content.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
      'image/jpeg': content[0] === 255 && content[1] === 216 && content[2] === 255,
      'image/webp': content.toString('ascii', 0, 4) === 'RIFF' && content.toString('ascii', 8, 12) === 'WEBP',
      'video/mp4': content.toString('ascii', 4, 8) === 'ftyp',
      'video/webm': content.subarray(0, 4).equals(Buffer.from([26,69,223,163])),
    }
    if (!signatures[file.mimeType]) invalid('附件内容与声明的图片或视频类型不一致')
    return { id: randomUUID(), name: file.name.replace(/[\x00-\x1f\x7f]/g, ''), mimeType: file.mimeType, content }
  })
  const record = {
    id: Math.max(0, ...(data.maintenanceRecords || []).map(row => row.id)) + 1,
    requestId: /^[a-f0-9-]{36}$/.test(input.requestId || '') ? input.requestId : randomUUID(),
    scheduleTaskId: schedule.id, vehicleRepairId: schedule.vehicleRepairId, taskId: schedule.taskId,
    submittedAt: formatLocalDateTime(new Date()), submittedBy: input.submittedBy.trim(), notes: input.notes || '',
    measurements: measurements.map(row => ({ name: row.name.trim(), value: row.value, unit: row.unit || '' })),
    attachments: files.map(file => ({ id: file.id, name: file.name, mimeType: file.mimeType, bytes: file.content.length, url: `/api/pc1/attachments/${file.id}` })),
  }
  return { record, files }
}
