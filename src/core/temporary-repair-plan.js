import { formatLocalDateTime } from './derived.js'

const allowedMime = new Set(['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg','image/webp'])
const fail = message => ({ ok:false, message })
const text = (input, key) => String(input[key] ?? '').trim()
const validDateTime = value => typeof value === 'string' && Number.isFinite(new Date(value).getTime())

function validate(state, input, currentId = null) {
  const ownerDepot = text(input, 'ownerDepot'), locomotiveNo = text(input, 'locomotiveNo').toUpperCase(), content = text(input, 'content')
  const modelId = Number(input.modelId), plannedEntryAt = text(input, 'plannedEntryAt'), plannedPlatformAt = text(input, 'plannedPlatformAt')
  if (!ownerDepot || ownerDepot.length > 64) return fail('委修段不能为空且最多64字')
  if (!locomotiveNo || locomotiveNo.length > 64) return fail('机车号不能为空且最多64字')
  if (!state.locomotiveModels.some(row => row.id === modelId && row.status === 'ENABLED')) return fail('请选择有效机型')
  if (!validDateTime(plannedEntryAt) || !validDateTime(plannedPlatformAt)) return fail('计划入段和计划上台时间不能为空')
  if (new Date(plannedPlatformAt) < new Date(plannedEntryAt)) return fail('计划上台时间不能早于计划入段时间')
  if (!content || content.length > 1000) return fail('临修内容不能为空且最多1000字')
  const normalizedEntry = formatLocalDateTime(plannedEntryAt), normalizedPlatform = formatLocalDateTime(plannedPlatformAt)
  if ((state.temporaryRepairPlans || []).some(row => row.id !== currentId && row.locomotiveNo.toUpperCase() === locomotiveNo && row.plannedEntryAt === normalizedEntry)) return fail('同一机车相同入段时间的临修计划已存在')
  const file = input.solutionAttachment
  if (file && (!allowedMime.has(file.mimeType) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > 2 * 1024 * 1024 || typeof file.contentBase64 !== 'string')) return fail('方案仅支持PDF、Word、PNG、JPEG、WebP，且不能超过2MB')
  return { ok:true, data:{ ownerDepot, locomotiveNo, modelId, plannedEntryAt:normalizedEntry, plannedPlatformAt:normalizedPlatform, content, solutionAttachment:file || null } }
}

export function createTemporaryRepairPlan(state, input, now = new Date()) {
  const result = validate(state, input)
  if (!result.ok) return result
  state.temporaryRepairPlans ||= []
  const id = Math.max(0, ...state.temporaryRepairPlans.map(row => Number(row.id) || 0)) + 1
  state.temporaryRepairPlans.push({ id, ...result.data, status:'DRAFT', createdAt:formatLocalDateTime(now), updatedAt:formatLocalDateTime(now) })
  return { ok:true, id }
}

export function updateTemporaryRepairPlan(state, id, input, now = new Date()) {
  const row = (state.temporaryRepairPlans || []).find(item => item.id === Number(id))
  if (!row) return fail('临修计划不存在')
  if (row.status !== 'DRAFT') return fail('只有草稿临修计划可以修改')
  const result = validate(state, input, row.id)
  if (!result.ok) return result
  Object.assign(row, result.data, { updatedAt:formatLocalDateTime(now) })
  return { ok:true }
}

export function deleteTemporaryRepairPlan(state, id) {
  const row = (state.temporaryRepairPlans || []).find(item => item.id === Number(id))
  if (!row) return fail('临修计划不存在')
  if (row.status !== 'DRAFT') return fail('计划已提交或发布，不能直接删除')
  state.temporaryRepairPlans = state.temporaryRepairPlans.filter(item => item.id !== row.id)
  return { ok:true }
}

export function importTemporaryRepairRows(state, rows, now = new Date()) {
  const preview = rows.map((input, index) => {
    const result = validate(state, input)
    return { rowNumber:index + 2, input, errors:result.ok ? [] : [result.message], status:result.ok ? 'ready' : 'error' }
  })
  const seen = new Set()
  for (const row of preview) {
    const key = `${String(row.input.locomotiveNo || '').toUpperCase()}\0${row.input.plannedEntryAt || ''}`
    if (seen.has(key)) { row.errors.push('导入文件内存在重复的机车和入段时间'); row.status = 'error' }
    seen.add(key)
  }
  return { preview, commit(target = state) { let imported = 0; for (const row of preview.filter(item => item.status === 'ready')) if (createTemporaryRepairPlan(target, row.input, now).ok) imported += 1; return { ok:true, imported, failed:preview.length - imported } } }
}
