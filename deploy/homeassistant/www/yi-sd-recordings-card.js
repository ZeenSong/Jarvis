/* Camera SD playback. Metadata stays in this card; video bytes are never stored. */
class YiSDRecordingsCard extends HTMLElement {
  setConfig(config) { this.config=config; this.camera=config.cameras?.[0]?.entity; if(!this.camera)throw Error('cameras is required'); if(this.isConnected)this.render(); }
  set hass(hass) { this._hass=hass; if(this.isConnected&&!this.built)this.render(); }
  getCardSize(){return 12;}
  connectedCallback(){if(this.config&&this._hass)this.render();}
  disconnectedCallback(){this.generation=(this.generation||0)+1;if(this.video){this.video.pause();this.video.removeAttribute('src');this.video.load();}}
  render(){
    if(this.built)return;this.built=true;const root=this.attachShadow({mode:'open'});
    root.innerHTML=`<style>
    :host{display:block}*{box-sizing:border-box}ha-card{display:block;border-radius:26px;overflow:hidden;background:var(--card-background-color,#fff);color:var(--primary-text-color,#263a33)}
    .head{padding:24px 24px 16px}.eyebrow{font-size:11px;letter-spacing:2px;color:var(--secondary-text-color,#75867a)}h2{margin:8px 0;font-size:25px}.sub{font-size:13px;line-height:1.7;color:var(--secondary-text-color)}
    .bar{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}label{font-size:12px;color:var(--secondary-text-color);display:flex;gap:5px;flex-direction:column;flex:1;min-width:120px}select,input[type=date]{font:inherit;font-size:15px;color:var(--primary-text-color);background:var(--secondary-background-color,#f1f4ef);border:1px solid var(--divider-color,#ddd);border-radius:13px;padding:11px;min-width:0;width:100%}
    button{font:inherit;cursor:pointer;color:var(--primary-text-color);border:0;border-radius:13px;background:var(--secondary-background-color,#eef2eb);padding:10px 14px}button:disabled{opacity:.5;cursor:default}button:hover:not(:disabled){filter:brightness(.96)}
    .player{background:#101713;position:relative}video{display:block;width:100%;max-height:60vh;aspect-ratio:16/9;object-fit:contain}.empty-player{padding:55px 20px;text-align:center;color:#bccbc0}.player video:not([src]){display:none}.now{padding:12px 24px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--divider-color,#eee)}.now span{flex:1;font-size:14px}.tag{color:var(--primary-color,#527969);font-size:12px}
    .body{padding:20px 24px 26px}.tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.tools select{width:auto;flex:1}.track{position:relative;height:30px;background:var(--secondary-background-color,#eef2eb);border-radius:8px;margin-top:20px;overflow:hidden}.dot{position:absolute;height:16px;top:7px;width:3px;border-radius:2px;background:#92b69c}.dot.event{background:#d3a258;height:24px;top:3px;width:4px}input[type=range]{width:100%;accent-color:var(--primary-color,#527969);margin:8px 0}.axis{display:flex;justify-content:space-between;font-size:11px;color:var(--secondary-text-color)}
    .jump{display:flex;gap:10px;align-items:center;margin:14px 0}.jump input{font:inherit;border:1px solid var(--divider-color);border-radius:10px;padding:9px;background:var(--card-background-color);color:var(--primary-text-color)}.jump span{font-size:12px;color:var(--secondary-text-color)}
    .status{font-size:13px;line-height:1.7;padding:12px 0;color:var(--secondary-text-color)}.error{color:#b85e41}.list{max-height:390px;overflow:auto;display:grid;gap:7px}.row{display:flex;align-items:center;gap:10px;text-align:left;padding:13px 14px;background:var(--secondary-background-color,#f3f5f0);border-radius:13px;width:100%}.row strong{font-size:15px;min-width:76px;font-variant-numeric:tabular-nums}.row .detail{flex:1;display:flex;flex-direction:column;gap:4px;font-size:13px}.row small{color:var(--secondary-text-color)}.row.active{outline:2px solid var(--primary-color,#527969);outline-offset:-2px}.note{margin-top:15px;font-size:12px;line-height:1.7;color:var(--secondary-text-color)}
    @media(max-width:550px){.head{padding:18px 16px 14px}.body{padding:16px}.now{padding:12px 16px}h2{font-size:23px}.jump{flex-wrap:wrap}video{max-height:40vh}.list{max-height:340px}}
    </style><ha-card><div class="head"><div class="eyebrow">CAMERA SD · 摄像头存储卡</div><h2>回看家的时刻</h2><div class="sub">选择日期，按时间或事件回看。</div><div class="bar"><label>摄像头<select id="camera"></select></label><label>录像日期<select id="date"></select></label><button id="refresh" aria-label="刷新录像目录">刷新</button></div></div>
    <div class="player"><video controls playsinline preload="metadata"></video><div class="empty-player">选择一段录像开始播放</div></div><div class="now"><span id="playing">尚未选择录像</span><span class="tag">SD 卡原片 · 按需读取</span><button id="prev">上一段</button><button id="next">下一段</button></div>
    <div class="body"><div class="tools"><select id="filter" aria-label="事件筛选"><option value="all">全部录像</option><option value="motion">画面变化 / 移动</option><option value="sound">声音侦测</option><option value="cry">婴儿哭声</option></select><span class="tag" id="count"></span></div><div class="track" aria-label="全天录像与事件时间轴"></div><input id="timeline" type="range" min="0" max="86399" step="1" value="0" aria-label="录像时间"><div class="axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div><div class="jump"><input id="time" type="time" step="1" value="00:00:00" aria-label="跳转时间"><button id="jump">跳到此刻</button><span>绿点：录像起点 · 金点：事件</span></div><div class="status" role="status" aria-live="polite"></div><div class="list"></div><div class="note">录像保存在摄像头 SD 卡，服务器只做鉴权和流式转发，不保存录像副本。事件筛选使用 HA 已有记录；无事件索引的旧录像仍可按时间浏览。当前摄像头不提供人形、宠物分类。</div></div></ha-card>`;
    this.q=s=>root.querySelector(s);this.video=this.q('video');
    for(const c of this.config.cameras){const o=document.createElement('option');o.value=c.entity;o.textContent=c.name;this.q('#camera').append(o);}
    this.q('#camera').onchange=()=>{this.camera=this.q('#camera').value;this.date=null;this.stop();this.load();};
    this.q('#date').onchange=()=>{this.date=this.q('#date').value;this.stop();this.load();};
    this.q('#refresh').onclick=()=>this.load();this.q('#filter').onchange=()=>this.renderList();
    this.q('#time').oninput=()=>{this.editingTime=true;};
    this.q('#timeline').oninput=()=>{this.editingTime=true;this.q('#time').value=this.time(+this.q('#timeline').value);};
    this.q('#timeline').onchange=()=>this.jump(+this.q('#timeline').value);
    this.q('#jump').onclick=()=>this.jump(this.seconds(this.q('#time').value));
    this.q('#prev').onclick=()=>this.adjacent(-1);this.q('#next').onclick=()=>this.adjacent(1);
    this.video.ontimeupdate=()=>{if(this.current){const s=this.current.seconds+this.video.currentTime;this.q('#timeline').value=s;if(!this.editingTime)this.q('#time').value=this.time(s);}};
    this.video.onended=()=>this.adjacent(1,true);
    this.video.onerror=()=>this.message('录像暂时无法播放，可能已被 SD 卡循环覆盖，或摄像头连接中断。请刷新目录后重试。',true);
    this.clips=[];this.events=[];this.load();
  }
  stop(){this.playGeneration=(this.playGeneration||0)+1;this.editingTime=false;this.q('#playing').textContent='尚未选择录像';this.video.pause();this.video.removeAttribute('src');this.video.load();this.current=null;this.q('.empty-player').style.display='block';}
  seconds(t){const [h,m,s=0]=t.split(':').map(Number);return h*3600+m*60+s;}
  time(s){return [Math.floor(s/3600)%24,Math.floor(s/60)%60,Math.floor(s)%60].map(x=>String(x).padStart(2,'0')).join(':');}
  message(t,error=false){this.q('.status').textContent=t;this.q('.status').classList.toggle('error',error);}
  dayStart(date){let target=Date.parse(date+'T00:00:00Z'),guess=target;for(let i=0;i<2;i++){const p=this.parts(new Date(guess));const local=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);guess+=target-local;}return new Date(guess);}
  parts(d){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:this._hass.config.time_zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(d).map(p=>[p.type,p.value]));}
  async load(){
    const gen=++this.generation|| (this.generation=1);this.q('#refresh').disabled=true;this.q('#date').disabled=true;this.message('正在读取摄像头 SD 卡目录…');this.clips=[];this.events=[];this.renderList();
    try{
      const data=await this._hass.callWS({type:'yi_sd_recordings/index',entity_id:this.camera,...(this.date?{date:this.date}:{})});if(gen!==this.generation)return;
      this.date=data.date;this.q('#date').replaceChildren();for(const date of data.dates){const o=document.createElement('option');o.value=date;o.textContent=date;this.q('#date').append(o);}this.q('#date').value=this.date||'';
      this.clips=data.clips.map(c=>({...c,seconds:this.seconds(c.start.split('T')[1]),events:[]}));
      let historyError=false;
      if(this.date){try{await this.loadEvents(gen);}catch(e){historyError=true;}}
      if(gen!==this.generation)return;
      this.renderList();this.drawTrack();
      let msg=this.clips.length?`共 ${this.clips.length} 段录像，${this.events.length} 条可用事件。`:'此日期没有可读取的录像。';
      if(!this.events.length&&this.clips.length)msg+=' 没有事件索引不代表没有发生事件，可选择「全部录像」浏览。';
      if(historyError)msg+=' HA 事件历史读取失败，录像仍可播放。';
      if(data.failed_hours?.length)msg+=` ${data.failed_hours.join('、')} 时的目录读取失败，可刷新重试。`;
      this.message(msg,historyError||!!data.failed_hours?.length);
    }catch(e){if(gen===this.generation)this.message('无法读取摄像头 SD 卡，请确认摄像头在线后刷新。',true);}
    finally{if(gen===this.generation){this.q('#refresh').disabled=false;this.q('#date').disabled=false;}}
  }
  async loadEvents(gen){
    const slug=this.camera.slice(7).replace(/_camera$/,'');const defs=[['motion','画面变化 / 移动',`binary_sensor.${slug}_camera_motion_detection`],['sound','声音侦测',`binary_sensor.${slug}_camera_sound_detection`],['cry','婴儿哭声',`binary_sensor.${slug}_camera_baby_crying`]].filter(x=>this._hass.states[x[2]]);
    if(!defs.length)return;const start=this.dayStart(this.date),end=new Date(start.getTime()+86400000);
    const history=await this._hass.callApi('GET',`history/period/${start.toISOString()}?filter_entity_id=${encodeURIComponent(defs.map(x=>x[2]).join(','))}&end_time=${end.toISOString()}&minimal_response&significant_changes_only&skip_initial_state`);
    if(gen!==this.generation)return;
    for(let i=0;i<history.length;i++){const series=history[i];const entity=series[0]?.entity_id||defs[i]?.[2];const def=defs.find(x=>x[2]===entity);if(!def)continue;let prev=null;
      for(const s of series){const timestamp=s.last_changed||s.last_updated;if(s.state!=='on'||prev==='on'){prev=s.state;continue;}prev=s.state;const at=new Date(timestamp);if(!Number.isFinite(at.getTime())||at<start||at>=end)continue;const p=this.parts(at),sec=Number(p.hour)*3600+Number(p.minute)*60+Number(p.second);const clip=this.findClip(sec);const event={kind:def[0],name:def[1],seconds:sec,time:this.time(sec),clip};this.events.push(event);if(clip)clip.events.push(event);}
    }
    this.events.sort((a,b)=>a.seconds-b.seconds);
  }
  findClip(seconds){return [...this.clips].reverse().find(c=>c.seconds<=seconds&&seconds<c.seconds+60);}
  jump(seconds){const clip=this.findClip(seconds);if(!clip){this.message('这个时刻没有可定位的录像。请调整时间，或从列表选择录像。',true);return;}this.play(clip,seconds-clip.seconds);}
  drawTrack(){const track=this.q('.track');track.replaceChildren();for(const c of this.clips){const d=document.createElement('span');d.className='dot';d.style.left=c.seconds/864+'%';track.append(d);}for(const e of this.events){const d=document.createElement('span');d.className='dot event';d.style.left=e.seconds/864+'%';track.append(d);}}
  renderList(){
    const list=this.q('.list');if(!list)return;list.replaceChildren();const filter=this.q('#filter').value;const items=filter==='all'?this.clips.map(c=>({clip:c,seconds:c.seconds,name:c.events.length?c.events.map(x=>x.name).filter((v,i,a)=>a.indexOf(v)===i).join(' · '):'SD 卡录像',detail:c.events.length?'包含已记录事件':'无关联事件索引'})):this.events.filter(e=>e.kind===filter).map(e=>({...e,detail:e.clip?'点击跳到事件时刻':'此事件没有对应 SD 卡录像'}));
    this.q('#count').textContent=filter==='all'?`${items.length} 段`:`${items.length} 条`;
    if(!items.length){const empty=document.createElement('p');empty.className='sub';empty.textContent=filter==='all'?'暂无录像条目':'该日期没有此类事件记录，可切回全部录像。';list.append(empty);}
    for(const item of items){const b=document.createElement('button');b.className='row';b.disabled=!item.clip;b.classList.toggle('active',item.clip===this.current);const time=document.createElement('strong');time.textContent=this.time(item.seconds);const detail=document.createElement('span');detail.className='detail';const name=document.createElement('span');name.textContent=item.name;const sub=document.createElement('small');sub.textContent=item.detail;detail.append(name,sub);const arrow=document.createElement('span');arrow.textContent='▶';b.append(time,detail,arrow);b.onclick=()=>this.play(item.clip,item.seconds-item.clip.seconds);list.append(b);}
    this.q('#prev').disabled=!this.current||this.clips.indexOf(this.current)<=0;this.q('#next').disabled=!this.current||this.clips.indexOf(this.current)>=this.clips.length-1;
  }
  async play(clip,offset=0,autoplay=true){
    const gen=this.generation,playGen=this.playGeneration=(this.playGeneration||0)+1;this.editingTime=false;try{const result=await this._hass.callWS({type:'auth/sign_path',path:clip.path,expires:1800});if(gen!==this.generation||playGen!==this.playGeneration)return;this.current=clip;this.q('.empty-player').style.display='none';this.q('#playing').textContent=`${this.date} ${this.time(clip.seconds+offset)}`;this.video.src=result.path;
      this.video.onloadedmetadata=()=>{if(offset>=this.video.duration){this.message('该时刻超出这段录像的实际时长，请选择相邻录像。',true);this.video.pause();return;}this.video.currentTime=offset;if(autoplay)this.video.play().catch(()=>this.message('录像已载入，点击播放按钮开始。'));};
      this.video.load();this.renderList();this.message(offset?`已定位到 ${this.time(clip.seconds+offset)}，从摄像头 SD 卡播放。`:'正在从摄像头 SD 卡读取录像…');
    }catch(e){this.message('无法获取回放链接，请刷新登录状态后重试。',true);}
  }
  adjacent(delta,autoplay=true){if(!this.current)return;const c=this.clips[this.clips.indexOf(this.current)+delta];if(c)this.play(c,0,autoplay);}
}
customElements.define('yi-sd-recordings-card',YiSDRecordingsCard);
window.customCards=window.customCards||[];window.customCards.push({type:'yi-sd-recordings-card',name:'Yi SD 录像回看',description:'从摄像头 SD 卡按日期和 HA 事件回看录像，不保存录像副本。'});
