// One snapshot in flight. A slow renderer must never accumulate full workspace
// copies for every token. ACK only schedules the latest pending state.
class StatePublisher{
  constructor({send,isVisible=()=>true,delay=120}){Object.assign(this,{send,isVisible,delay});this.dirty=false;this.sequence=0;this.pending=null;this.timer=null}
  request(){if(this.closed)return;this.dirty=true;if(!this.timer&&this.pending===null)this.timer=setTimeout(()=>{this.timer=null;this.flush()},this.delay)}
  flush(){if(!this.dirty||this.pending!==null||!this.isVisible())return;this.dirty=false;this.pending=++this.sequence;try{this.send(this.pending)}catch{this.pending=null;this.dirty=true}}
  ack(sequence){if(sequence!==this.pending)return;this.pending=null;if(this.dirty)this.request()}
  reset(){this.pending=null;this.request()}
  close(){this.closed=true;clearTimeout(this.timer);this.timer=null;this.dirty=false}
}
module.exports={StatePublisher}
