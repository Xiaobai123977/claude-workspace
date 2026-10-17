const test=require('node:test'),assert=require('node:assert/strict')
const {editMenuTemplate,installEditMenu}=require('../electron/edit-menu.cjs')
test('selected read-only text offers native copy only; empty space has no edit menu',()=>{
  assert.deepEqual(editMenuTemplate(),[])
  assert.deepEqual(editMenuTemplate({selectionText:'回答',editFlags:{canCopy:true}}),[{id:'edit-copy',label:'复制',role:'copy',enabled:true}])
})
test('editable controls respect native editing flags and offer paste without a selection',()=>{
  const items=editMenuTemplate({isEditable:true,editFlags:{canPaste:true,canSelectAll:true}}).filter(i=>i.id)
  assert.deepEqual(items.map(i=>i.role),['undo','redo','cut','copy','paste','selectAll'])
  assert.equal(items.find(i=>i.role==='paste').enabled,true)
  assert.equal(items.find(i=>i.role==='cut').enabled,false)
  assert.equal(items.find(i=>i.role==='copy').enabled,false)
})
test('menu belongs to the originating window and no menu is shown for empty space',()=>{
  let handler,popups=0
  const window={webContents:{on:(event,callback)=>{assert.equal(event,'context-menu');handler=callback}}}
  installEditMenu(window,{buildFromTemplate:()=>({popup:options=>{assert.equal(options.window,window);popups++}})})
  handler({},{});assert.equal(popups,0)
  handler({},{isEditable:true});assert.equal(popups,1)
})
