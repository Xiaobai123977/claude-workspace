import {spawn} from 'node:child_process'
import path from 'node:path'
for(const protocol of ['anthropic','chat','responses']){
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(import.meta.dirname,'browser-real-cli-test.mjs')],{env:{...process.env,CLAUDE_GUI_TEST_PROTOCOL:protocol},stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(protocol+' browser test failed')))})
}
