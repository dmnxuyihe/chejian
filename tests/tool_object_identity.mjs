import assert from 'node:assert/strict'
import {createState} from '../src/core/state.js'
import {applyToolCommand,expectedToolObjects,toolObjectIdentity} from '../src/core/tool-management.js'
import {exportDemoSnapshot,parseDemoSnapshot} from '../src/core/demo-persistence.js'
import {reconcileToolSelection} from '../src/shared/tool-table-state.js'
const s=createState();let n=0
const run=(type,payload,requestId=`identity-${++n}`)=>applyToolCommand(s,{type,payload,actor:'对象验证员',requestId})
run('WAREHOUSE_STANDARDIZE',{});const warehouse=s.toolManagement.warehouses[0].id
const tool=run('TOOL_SAVE',{code:'IDENTITY-TYPE',name:'对象身份验证工具'})
const add=code=>run('ASSET_CREATE',{toolId:tool.id,warehouseId:warehouse,code,mode:'NUMBERED',quantity:1})
const a=add('IDENTITY-A');run('ASSET_DELETE',{assetId:a.id});const b=add('IDENTITY-B');assert.ok(b.id>a.id)
// Older snapshots may not have counters, but their retained command history
// still prevents recycling the highest deleted identifier.
run('ASSET_DELETE',{assetId:b.id});delete s.toolManagement.idSequences
const c=add('IDENTITY-C');assert.ok(c.id>b.id)
const object=s.toolManagement.assets.find(x=>x.id===c.id),token=toolObjectIdentity(object)
const selection={selectedKeys:[`asset:${c.id}`],selectionIdentities:{[`asset:${c.id}`]:token}}
object.identity=crypto.randomUUID()
reconcileToolSelection([{key:`asset:${c.id}`,asset:object}],selection);assert.deepEqual(selection.selectedKeys,[])
const borrow={assetId:c.id,quantity:1,borrower:'身份不符不得借出',dueAt:'2099-01-01',expectedObjects:[{kind:'asset',id:c.id,identity:token}]}
const before=JSON.stringify(s)
assert.throws(()=>run('BORROW',borrow),e=>e.toolTargetChanged&&e.status===400);assert.equal(JSON.stringify(s),before)
const good={...borrow,borrower:'身份相符',expectedObjects:expectedToolObjects(s.toolManagement,'BORROW',{assetId:c.id})}
const first=run('BORROW',good,'identity-idempotent');s.toolManagement.assets.find(a=>a.id===c.id).identity=crypto.randomUUID()
const duplicate=run('BORROW',good,'identity-idempotent');assert.equal(duplicate.id,first.id);assert.equal(duplicate.duplicate,true);assert.equal(s.toolManagement.loans.filter(l=>l.borrower==='身份相符').length,1)
const d=add('IDENTITY-D'),e=add('IDENTITY-E')
const k1=run('KIT_SAVE',{code:'IDENTITY-K1',name:'套装一',lines:[{assetId:d.id,quantity:1}]});run('KIT_DELETE',{id:k1.id})
const k2=run('KIT_SAVE',{code:'IDENTITY-K2',name:'套装二',lines:[{assetId:d.id,quantity:1}]});assert.ok(k2.id>k1.id)
const oldKit=expectedToolObjects(s.toolManagement,'BORROW',{kitId:k2.id})
run('KIT_SAVE',{id:k2.id,code:'IDENTITY-K2',name:'套装二',lines:[{assetId:e.id,quantity:1}]})
assert.throws(()=>run('BORROW',{kitId:k2.id,borrower:'组成已变更不得沿用',dueAt:'2099-01-01',expectedObjects:oldKit}),e=>e.toolTargetChanged)
const roundtrip=parseDemoSnapshot(JSON.stringify(exportDemoSnapshot(s))).data
assert.deepEqual(roundtrip.toolManagement.idSequences,s.toolManagement.idSequences)
assert.deepEqual(roundtrip.toolManagement.assets.map(a=>a.identity),s.toolManagement.assets.map(a=>a.identity))
console.log(JSON.stringify({passed:true,checks:['monotonic asset and kit identifiers','legacy counter initialization from retained history','stale selection identity removed','atomic object mismatch refusal','idempotent result retained','kit composition guarded','identity and counter snapshot roundtrip']}))
