import { icon } from './icons.js'
import { workspaceArt } from './workspace-art.js'

// Decorative vector drawing. Vehicle identifiers and all status values remain text.
export function locomotiveDrawing(className='') {
  return icon('train',24).replace('<svg ',`<svg class="locomotive-drawing ${className}" `)
}

export function planFlowDrawing() {
  const steps=[['file','月度计划','导入或新建机车检修计划'],['calendar','模拟排程','校验资源，调整工序时间'],['check','正式发布','下发班组任务与资源清单']]
  return `<section class="plan-flow-visual" aria-label="计划处理流程"><ol>${steps.map(([glyph,title,description],index)=>`<li><span class="flow-node ${index===0?'is-current':''}">${workspaceArt(['plan','schedule','quality'][index])}</span><div><strong>${title}</strong><span>${description}</span></div>${index<2?'<span class="flow-connector" aria-hidden="true"></span>':''}</li>`).join('')}</ol></section>`
}
