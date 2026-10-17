// Use Chromium's editing roles so selection, undo and paste events stay native.
function editMenuTemplate({isEditable=false,selectionText='',editFlags={}}={}){
  const items=[]
  if(isEditable){
    items.push({id:'edit-undo',label:'撤销',role:'undo',enabled:!!editFlags.canUndo},{id:'edit-redo',label:'重做',role:'redo',enabled:!!editFlags.canRedo},{type:'separator'})
    items.push({id:'edit-cut',label:'剪切',role:'cut',enabled:!!editFlags.canCut})
  }
  if(isEditable||selectionText)items.push({id:'edit-copy',label:'复制',role:'copy',enabled:!!editFlags.canCopy})
  if(isEditable)items.push({id:'edit-paste',label:'粘贴',role:'paste',enabled:!!editFlags.canPaste})
  if(isEditable){items.push({type:'separator'},{id:'edit-select-all',label:'全选',role:'selectAll',enabled:!!editFlags.canSelectAll})}
  return items
}
function installEditMenu(window,Menu,contents=window.webContents){
  contents.on('context-menu',(_event,params)=>{
    const template=editMenuTemplate(params)
    if(template.length)Menu.buildFromTemplate(template).popup({window,frame:params.frame||undefined,sourceType:params.menuSourceType})
  })
}
module.exports={editMenuTemplate,installEditMenu}
