import { pageHeader, statCard } from '../../../shared/templates.js'
import { escapeHtml as esc, openModal, toast } from '../../../core/ui.js'
import { createTemporaryRepairPlan, updateTemporaryRepairPlan, deleteTemporaryRepairPlan, importTemporaryRepairRows } from '../../../core/temporary-repair-plan.js'
import { saveVehicleOperation } from '../../../shared/vehicle-details.js'
import { submitPlanFlow } from '../../../core/planning-json-workflow.js'

const view = { keyword:'', depot:'', status:'' }
const statusText = value => ({ DRAFT:'草稿', SUBMITTED:'已提报', APPROVED:'已审核', PUBLISHED:'已发布' })[value] || value
const mimeAccept = '.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp'

const fileBase64 = file => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(new Error('方案附件读取失败'))
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
  reader.readAsDataURL(file)
})

async function attachmentFrom(input) {
  const file = input.files?.[0]
  if (!file) return null
  if (file.size > 2 * 1024 * 1024) throw new Error('临修方案附件不能超过2MB')
  return { name:file.name.slice(0,128), mimeType:file.type, bytes:file.size, contentBase64:await fileBase64(file) }
}

function form(state, row = null) {
  const models = state.locomotiveModels.filter(item => item.status === 'ENABLED')
  return `<div class="grid grid-2 pc-temp-form">
    <div class="field"><label>委修段 *</label><input class="input" data-temp-field="ownerDepot" maxlength="64" value="${esc(row?.ownerDepot || '')}"></div>
    <div class="field"><label>机型 *</label><select class="select" data-temp-field="modelId"><option value="">请选择</option>${models.map(item => `<option value="${item.id}" ${item.id === row?.modelId ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></div>
    <div class="field"><label>机车号 *</label><input class="input" data-temp-field="locomotiveNo" maxlength="64" value="${esc(row?.locomotiveNo || '')}"></div>
    <div class="field"><label>计划入段时间 *</label><input class="input" type="datetime-local" data-temp-field="plannedEntryAt" value="${esc(row?.plannedEntryAt?.slice(0,16) || '')}"></div>
    <div class="field"><label>计划上台时间 *</label><input class="input" type="datetime-local" data-temp-field="plannedPlatformAt" value="${esc(row?.plannedPlatformAt?.slice(0,16) || '')}"></div>
    <div class="field"><label>临修方案附件</label><input class="input" type="file" accept="${mimeAccept}" data-temp-attachment><small>PDF、Word或图片，最大2MB</small>${row?.solutionAttachment ? `<small>当前：${esc(row.solutionAttachment.name)}</small><label><input type="checkbox" data-temp-remove-file> 移除当前附件</label>` : ''}</div>
    <div class="field pc-temp-content"><label>临修内容 *</label><textarea class="textarea" maxlength="1000" rows="5" data-temp-field="content">${esc(row?.content || '')}</textarea></div>
  </div><p role="alert" class="pc-error-text" data-temp-error></p>`
}

async function formValue(wrap, row = null) {
  const value = Object.fromEntries([...wrap.querySelectorAll('[data-temp-field]')].map(field => [field.dataset.tempField, field.value]))
  const uploaded = await attachmentFrom(wrap.querySelector('[data-temp-attachment]'))
  value.solutionAttachment = uploaded || (wrap.querySelector('[data-temp-remove-file]')?.checked ? null : row?.solutionAttachment || null)
  return value
}

function downloadAttachment(file) {
  const link = document.createElement('a')
  link.href = `data:${file.mimeType};base64,${file.contentBase64}`
  link.download = file.name
  link.click()
}

function filters(plans) {
  const depots = [...new Set(plans.map(row => row.ownerDepot))].sort((a,b) => a.localeCompare(b,'zh-CN'))
  return `<section class="card pc-component-toolbar"><div class="pc-annual-filterbar"><label>关键词<input class="input" type="search" value="${esc(view.keyword)}" placeholder="机车号/临修内容" data-temp-keyword></label><label>委修段<select class="select" data-temp-depot><option value="">全部委修段</option>${depots.map(value => `<option ${view.depot === value ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></label><label>状态<select class="select" data-temp-status><option value="">全部状态</option>${['DRAFT','SUBMITTED','APPROVED','PUBLISHED'].map(value => `<option value="${value}" ${view.status === value ? 'selected' : ''}>${statusText(value)}</option>`).join('')}</select></label><button type="button" class="btn btn-primary" data-temp-query>查询</button></div></section>`
}

function rows(state, plans) {
  if (!plans.length) return '<tr><td colspan="10" class="empty">暂无符合条件的整车临修计划，可新建或导入示例数据。</td></tr>'
  return plans.map(row => {
    const model = state.locomotiveModels.find(item => item.id === row.modelId)?.name || '未填写'
    return `<tr><td>${row.id}</td><td>${esc(row.ownerDepot)}</td><td>${esc(model)}</td><td class="mono">${esc(row.locomotiveNo)}</td><td>${esc(row.plannedEntryAt.replace('T',' '))}</td><td>${esc(row.plannedPlatformAt.replace('T',' '))}</td><td class="pc-temp-content-cell">${esc(row.content)}</td><td>${row.solutionAttachment ? `<button class="btn btn-sm" type="button" data-temp-download="${row.id}">${esc(row.solutionAttachment.name)}</button>` : '<span class="pc-help">待上传</span>'}</td><td><span class="pc-annual-status ${row.status === 'DRAFT' ? '' : 'pc-annual-status-published'}">${esc(statusText(row.status))}</span></td><td><div class="plan-maintenance-actions"><button class="btn btn-sm" type="button" data-temp-edit="${row.id}" ${row.status === 'DRAFT' ? '' : 'disabled'}>修改</button><button class="btn btn-sm btn-primary" type="button" data-temp-submit="${row.id}" ${row.status==='DRAFT'&&row.solutionAttachment?'':'disabled'}>提报</button><button class="btn btn-sm btn-danger" type="button" data-temp-delete="${row.id}">删除</button></div></td></tr>`
  }).join('')
}

async function openEditor(ctx, row = null) {
  openModal({ title:row ? `修改临修计划 · ${row.locomotiveNo}` : '新建整车临修计划', wide:true, body:form(ctx.state,row), confirmText:'保存计划', async onConfirm(wrap) {
    try {
      const input = await formValue(wrap,row)
      const result = await saveVehicleOperation(ctx, state => row ? updateTemporaryRepairPlan(state,row.id,input) : createTemporaryRepairPlan(state,input))
      if (!result.ok) { wrap.querySelector('[data-temp-error]').textContent = result.message; return false }
      toast(row ? '临修计划已修改' : '临修计划已新建'); ctx.rerender(false)
    } catch (error) { wrap.querySelector('[data-temp-error]').textContent = error.message; return false }
  } })
}

async function previewImport(ctx, file) {
  if (!file || !/\.(csv|xlsx|xls)$/i.test(file.name)) return toast('请选择CSV、XLSX或XLS文件','','warning')
  if (file.size > 5 * 1024 * 1024) return toast('导入文件不能超过5MB','','warning')
  const response = await fetch('/api/temporary-repair/import/preview', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ filename:file.name, contentBase64:await fileBase64(file) }) })
  const body = await response.json()
  if (!response.ok) return toast('导入预览失败',body.message,'warning')
  const normalized = body.rows.map(row => ({ ...row, modelId:ctx.state.locomotiveModels.find(model => model.name === row.modelName && model.status === 'ENABLED')?.id || 0 }))
  const importResult = importTemporaryRepairRows(ctx.state, normalized)
  const valid = importResult.preview.filter(row => row.status === 'ready').length
  const table = importResult.preview.map(row => `<tr><td>${row.rowNumber}</td><td>${esc(row.input.locomotiveNo)}</td><td>${esc(row.input.modelName)}</td><td>${esc(row.input.plannedEntryAt)}</td><td>${row.errors.length ? `<span class="pc-error-text">${esc(row.errors.join('；'))}</span>` : '<span class="pc-annual-status pc-annual-status-published">可导入</span>'}</td></tr>`).join('')
  openModal({ title:'临修计划导入预览与纠错', wide:true, body:`<p class="pc-help">共 ${importResult.preview.length} 行，可导入 ${valid} 行，错误 ${importResult.preview.length-valid} 行。错误行不会写入，请按提示修正原文件后重新上传。</p><div class="table-wrap"><table><thead><tr><th>行号</th><th>机车号</th><th>机型</th><th>计划入段</th><th>校验结果</th></tr></thead><tbody>${table}</tbody></table></div><p role="alert" class="pc-error-text" data-temp-error></p>`, confirmText:`导入 ${valid} 行`, async onConfirm(wrap) {
    if (!valid) { wrap.querySelector('[data-temp-error]').textContent='没有可导入的数据'; return false }
    const result = await saveVehicleOperation(ctx, state => importTemporaryRepairRows(state, normalized).commit(state))
    if (!result.ok) { wrap.querySelector('[data-temp-error]').textContent=result.message; return false }
    toast('临修计划导入完成',`成功导入 ${valid} 行`); ctx.rerender(false)
  } })
}

export const temporaryRepairPage = {
  render(ctx) {
    const all = ctx.state.temporaryRepairPlans || []
    const keyword = view.keyword.trim().toLocaleLowerCase()
    const filtered = all.filter(row => (!view.depot || row.ownerDepot === view.depot) && (!view.status || row.status === view.status) && (!keyword || `${row.locomotiveNo} ${row.content}`.toLocaleLowerCase().includes(keyword))).sort((a,b) => b.plannedEntryAt.localeCompare(a.plannedEntryAt))
    return `<section class="pc-component-page pc-temp-page" data-temporary-repair-page>${pageHeader('整车临修计划', '编制整车临修计划、上传临修方案，并支持查询、修改、删除、提报和批量导入', '<button type="button" class="btn" data-temp-import>Excel/CSV 导入</button><button type="button" class="btn btn-primary" data-temp-add>新建临修计划</button>')}${filters(all)}<div class="grid grid-4">${statCard('临修计划',all.length,'全部记录')}${statCard('草稿',all.filter(row=>row.status==='DRAFT').length,'可修改和删除','metric-indigo')}${statCard('已上传方案',all.filter(row=>row.solutionAttachment).length,'技术方案附件','metric-green')}${statCard('待上传方案',all.filter(row=>!row.solutionAttachment).length,'需技术科补充')}</div><section class="notice notice-info"><strong>JSON模拟流程</strong><span>上传方案后可提报；审批中心依次完成技术主管审核、主管段领导审批和发布。</span></section><section class="card"><div class="card-title-row"><div><div class="card-title">临修计划明细</div><div class="card-subtitle">删除前必须二次确认；已提交或发布的计划不能直接修改、删除。</div></div><a class="btn btn-sm" href="/api/temporary-repair/import/template.csv">下载导入模板</a></div><div class="table-wrap"><table><thead><tr><th>编号</th><th>委修段</th><th>机型</th><th>机车号</th><th>计划入段</th><th>计划上台</th><th>临修内容</th><th>临修方案</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows(ctx.state,filtered)}</tbody></table></div></section><input type="file" accept=".csv,.xlsx,.xls" hidden data-temp-import-file></section>`
  },
  mount(ctx) {
    document.querySelector('[data-temp-query]')?.addEventListener('click',()=>{ view.keyword=document.querySelector('[data-temp-keyword]').value;view.depot=document.querySelector('[data-temp-depot]').value;view.status=document.querySelector('[data-temp-status]').value;ctx.rerender(false) })
    document.querySelector('[data-temp-add]')?.addEventListener('click',()=>openEditor(ctx))
    document.querySelectorAll('[data-temp-edit]').forEach(button=>button.addEventListener('click',()=>openEditor(ctx,ctx.state.temporaryRepairPlans.find(row=>row.id===Number(button.dataset.tempEdit)))))
    document.querySelectorAll('[data-temp-download]').forEach(button=>button.addEventListener('click',()=>downloadAttachment(ctx.state.temporaryRepairPlans.find(row=>row.id===Number(button.dataset.tempDownload)).solutionAttachment)))
    document.querySelectorAll('[data-temp-submit]').forEach(button=>button.addEventListener('click',async()=>{const result=await saveVehicleOperation(ctx,state=>submitPlanFlow(state,'TEMP_VEHICLE',button.dataset.tempSubmit,'技术科临修方案提报'));toast(result.ok?'整车临修计划已提报':result.message);ctx.rerender(false)}))
    document.querySelectorAll('[data-temp-delete]').forEach(button=>button.addEventListener('click',()=>{
      const row=ctx.state.temporaryRepairPlans.find(item=>item.id===Number(button.dataset.tempDelete));if(!row)return
      openModal({title:row.status==='DRAFT'?'确认删除临修计划':'临修计划不能删除',body:row.status==='DRAFT'?`<p>确定删除 <strong>${esc(row.locomotiveNo)}</strong> 的临修计划？删除后无法恢复。</p><p role="alert" class="pc-error-text" data-temp-error></p>`:`<p>计划 ${esc(row.locomotiveNo)} 已进入${esc(statusText(row.status))}状态，不能直接删除。</p>`,confirmText:row.status==='DRAFT'?'确认删除':'知道了',async onConfirm(wrap){if(row.status!=='DRAFT')return true;const result=await saveVehicleOperation(ctx,state=>deleteTemporaryRepairPlan(state,row.id));if(!result.ok){wrap.querySelector('[data-temp-error]').textContent=result.message;return false}toast('临修计划已删除');ctx.rerender(false)}})
    }))
    const picker=document.querySelector('[data-temp-import-file]')
    document.querySelector('[data-temp-import]')?.addEventListener('click',()=>picker.click())
    picker?.addEventListener('change',()=>{const file=picker.files[0];picker.value='';previewImport(ctx,file)})
  },
}
