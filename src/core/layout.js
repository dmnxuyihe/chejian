import { renderFunctionShell } from '../functions/index.js'
import { functionForSource } from '../functions/catalog.js'

// Compatibility for callers of the former layout module. All pages now use
// the same function navigation, including legacy deep links.
export function renderShell({role,page,pageHtml}) {
  return renderFunctionShell({entry:functionForSource(role.id,page),pageHtml})
}
