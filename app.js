const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const WK='日一二三四五六';
const now=new Date();
const TODAY=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
const dayDiff=d=>Math.round((new Date(d+'T00:00')-new Date(TODAY+'T00:00'))/864e5);
const md=d=>{const x=new Date(d+'T00:00');return `${x.getMonth()+1}/${x.getDate()}`};
const wk=d=>WK[new Date(d+'T00:00').getDay()];
const ago=t=>{const x=new Date(t);return `${x.getMonth()+1}/${x.getDate()} ${pad(x.getHours())}:${pad(x.getMinutes())}`};
$('#today').textContent=`${now.getMonth()+1} 月 ${now.getDate()} 日（${WK[now.getDay()]}）`;

const S={tasks:[],events:[],anns:[],comments:[],signups:{},members:{},pending:[],roles:{},meta:{},loaded:false};
let sb=null,session=null,me={id:null,name:'',avatar:'',role:null},isOwner=false,isAdmin=false,canWrite=false,P={};
let tab=(location.hash||'#home').slice(1);if(!['home','tasks','events','board','people'].includes(tab))tab='home';
let taskFilter='all',evFilter='all',showForm=null,roll=null,confirmDel=null,showPast=false,mode='loading';

function toast(msg){const t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>t.hidden=true,3000)}
function errMsg(e){const m=(e&&(e.message||e.error_description))||'';
  if(/row-level security|permission|沒有權限/i.test(m))return '你沒有這個操作的權限。';
  if(/Failed to fetch|network/i.test(m))return '連不上伺服器，請檢查網路後再試。';
  return m?'操作沒有成功：'+m:'操作沒有成功，請再試一次。'}
async function act(fn,ok){try{const r=await fn();if(r&&r.error)throw r.error;if(ok)toast(ok);reload()}catch(e){console.warn(e);toast(errMsg(e))}}

function name(id){if(!id)return'未指定';const p=P[id];return (p&&p.name)||'成員'}
function person(id,cls=''){const p=P[id],a=p&&p.avatar;return `<span class="person ${cls}">${a?`<img src="${esc(a)}" alt="" referrerpolicy="no-referrer">`:''}${esc(name(id))}${id===me.id?'（你）':''}</span>`}

/* ---------- 非主畫面 ---------- */
function screen(html){mode='screen';$('#tabs').hidden=true;$('#view').innerHTML=`<div class="center">${html}</div>`}
function showSetup(){screen(`<h2>還差一步：連接資料庫</h2>
  <p class="muted">這個網站需要一個 Supabase 專案來存資料與登入。</p>
  <ol class="steps"><li>到 supabase.com 建立專案。</li><li>在 SQL Editor 執行 repo 裡的 <code>schema.sql</code>。</li>
  <li>把 Project URL 和 anon public key 填進 <code>config.js</code>。</li><li>照 README 開啟 Google 登入。</li></ol>`)}
function showLogin(){$('#who').innerHTML='';screen(`<h2>登入${esc(S.meta.team_name||'團隊事務台')}</h2>
  <p class="muted">用 Google 帳號登入。第一次登入需要等管理者核准。</p>
  <button class="btn pri" data-act="login">使用 Google 登入</button>`)}
function showPending(){whoBar();screen(`<h2>已送出加入申請</h2>
  <p class="muted">管理者核准後就能使用。核准後重新整理這個頁面即可。</p>
  <button class="btn" data-act="refresh">重新整理</button>`)}
function whoBar(){$('#who').innerHTML=`${me.avatar?`<img src="${esc(me.avatar)}" alt="" referrerpolicy="no-referrer">`:''}<span>${esc(me.name||'')}</span>
  <span class="chip ${isAdmin?'acc':''}">${isOwner?'負責人':isAdmin?'管理者':me.role==='member'?'成員':'待審核'}</span>
  <button class="btn sm ghost" data-act="logout">登出</button>`}

/* ---------- 資料 ---------- */
async function loadAll(){
  const q=t=>sb.from(t).select('*');
  const [pr,ta,ev,si,at,an,co,se]=await Promise.all([q('profiles'),q('tasks').order('created_at',{ascending:false}),q('events').order('date'),
    q('signups'),q('attendance'),q('announcements').order('created_at',{ascending:false}).limit(100),q('comments').order('created_at').limit(1000),
    sb.from('settings').select('*').eq('id',1).maybeSingle()]);
  const bad=[pr,ta,ev,si,at,an,co].find(r=>r.error);if(bad){toast(errMsg(bad.error));}
  P={};S.members={};S.pending=[];S.roles={};
  (pr.data||[]).forEach(p=>{P[p.id]={name:p.name,avatar:p.avatar,email:p.email};
    if(p.role==='pending')S.pending.push(p);else S.members[p.id]={joinedAt:Date.parse(p.joined_at),role:p.role};
    if(p.role==='admin')S.roles[p.id]=true;
    if(p.id===me.id)me.role=p.role});
  S.tasks=(ta.data||[]).map(t=>({id:t.id,title:t.title,desc:t.descr,due:t.due||'',assignees:t.assignees||[],status:t.status,createdBy:t.created_by,createdAt:Date.parse(t.created_at)}));
  const att={};(at.data||[]).forEach(a=>{(att[a.event_id]=att[a.event_id]||{})[a.user_id]=a.present});
  S.events=(ev.data||[]).map(e=>({id:e.id,kind:e.kind,title:e.title,date:e.date,start:e.start_time,end:e.end_time,place:e.place,capacity:e.capacity,note:e.note,present:att[e.id]||{}}));
  S.signups={};(si.data||[]).forEach(s=>{((S.signups[s.user_id]=S.signups[s.user_id]||{events:{}}).events)[s.event_id]=true});
  S.anns=(an.data||[]).map(a=>({id:a.id,title:a.title,body:a.body,pinned:a.pinned,by:a.author,createdAt:Date.parse(a.created_at)}));
  S.comments=(co.data||[]).map(c=>({id:c.id,ann:c.ann_id,text:c.body,by:c.author,createdAt:Date.parse(c.created_at)}));
  S.meta=se.data||{};
  S.loaded=true;
}
let rt=null,channel=null;
function reload(){clearTimeout(rt);rt=setTimeout(async()=>{await loadAll();route()},250)}
function route(){
  isOwner=me.role==='owner';isAdmin=isOwner||me.role==='admin';canWrite=isAdmin||me.role==='member';
  $('#teamName').textContent=S.meta.team_name||'團隊事務台';document.title=S.meta.team_name||'團隊事務台';
  if(!me.role||me.role==='pending'){showPending();return}
  mode='app';$('#tabs').hidden=false;draw();
}

async function boot(){
  if(channel){sb.removeChannel(channel);channel=null}
  const st=await sb.from('settings').select('team_name').eq('id',1).maybeSingle();S.meta=st.data||{};
  $('#teamName').textContent=S.meta.team_name||'團隊事務台';
  if(!session){showLogin();return}
  const u=session.user;me={id:u.id,name:'',avatar:'',role:null};
  let p=await sb.from('profiles').select('*').eq('id',u.id).maybeSingle();
  if(!p.data){const md_=u.user_metadata||{};
    await sb.from('profiles').insert({id:u.id,name:md_.full_name||md_.name||(u.email||'').split('@')[0],avatar:md_.avatar_url||null,email:u.email,role:'pending'});
    p=await sb.from('profiles').select('*').eq('id',u.id).maybeSingle()}
  if(p.error){screen(`<h2>讀取帳號失敗</h2><p class="muted">${esc(errMsg(p.error))}</p><button class="btn" data-act="refresh">重新整理</button>`);return}
  me.name=p.data.name;me.avatar=p.data.avatar;me.role=p.data.role;
  isOwner=me.role==='owner';isAdmin=isOwner||me.role==='admin';
  whoBar();
  if(me.role==='pending'){showPending();return}
  await loadAll();route();
  channel=sb.channel('desk').on('postgres_changes',{event:'*',schema:'public'},()=>reload()).subscribe();
}

/* ---------- 主畫面 ---------- */
function draw(){
  if(mode!=='app')return;
  whoBar();
  document.querySelectorAll('#tabs button').forEach(b=>b.setAttribute('aria-selected',b.dataset.tab===tab));
  $('#n-tasks').textContent=S.tasks.filter(t=>t.status!=='done').length||'';
  $('#n-events').textContent=S.events.filter(e=>dayDiff(e.date)>=0).length||'';
  $('#n-board').textContent=S.anns.length||'';
  $('#n-people').textContent=(Object.keys(S.members).length||'')+(isAdmin&&S.pending.length?` +${S.pending.length}`:'');
  const keep={};document.querySelectorAll('#view .keep').forEach(el=>{keep[el.id]=el.type==='checkbox'?el.checked:el.value});
  const fid=document.activeElement&&document.activeElement.id;
  $('#view').innerHTML=({home:vHome,tasks:vTasks,events:vEvents,board:vBoard,people:vPeople}[tab])();
  for(const k in keep){const el=document.getElementById(k);if(el){el.type==='checkbox'?el.checked=keep[k]:el.value=keep[k]}}
  if(fid){const el=document.getElementById(fid);if(el)el.focus()}
}

/* 總覽 */
function vHome(){
  const mine=S.tasks.filter(t=>t.status!=='done'&&t.assignees.includes(me.id)).sort((a,b)=>(a.due||'9')<(b.due||'9')?-1:1);
  const mySign=(S.signups[me.id]&&S.signups[me.id].events)||{};
  const myEv=S.events.filter(e=>mySign[e.id]&&dayDiff(e.date)>=0).sort(evSort);
  const pinned=S.anns.filter(a=>a.pinned)[0]||S.anns[0];
  const openEv=S.events.filter(e=>dayDiff(e.date)>=0&&!mySign[e.id]&&!(e.capacity&&count(e.id)>=e.capacity)).sort(evSort).slice(0,3);
  const nothing=!S.tasks.length&&!S.events.length&&!S.anns.length;
  return `${isAdmin&&S.pending.length?`<div class="notice"><b>${S.pending.length} 人等待核准加入。</b> <button class="btn sm" data-act="goto" data-v="people">前往審核</button></div>`:''}
  ${nothing?`<div class="notice"><b>還沒有任何資料。</b>${isAdmin?'從「排班與報名」建立第一個活動或時段、在「公告」發布消息，或到「任務」指派工作。把網址傳給成員，他們用 Google 登入後，你在「成員與出席」核准即可。':'管理者建立任務、時段或公告後，會顯示在這裡。'}</div>`:''}
  <div class="grid2">
    <section class="sec"><h2>指派給我的任務</h2>${mine.length?`<div class="list">${mine.slice(0,6).map(taskCard).join('')}</div>`:`<div class="empty">沒有待處理的任務</div>`}</section>
    <section class="sec"><h2>我報名的活動與班表</h2>${myEv.length?`<div class="list">${myEv.slice(0,5).map(evCard).join('')}</div>`:`<div class="empty">尚未報名接下來的活動</div>`}
      ${openEv.length?`<h2 style="margin-top:18px">還有名額</h2><div class="list">${openEv.map(evCard).join('')}</div>`:''}</section>
  </div>
  ${pinned?`<section class="sec"><h2>最新公告</h2>${annCard(pinned,true)}</section>`:''}`;
}

/* 任務 */
const ST={todo:'待辦',doing:'進行中',done:'完成'},ORDER=['todo','doing','done'];
function dueChip(t){if(!t.due)return'';if(t.status==='done')return `<span class="chip mono">${md(t.due)}</span>`;const d=dayDiff(t.due);
  if(d<0)return `<span class="chip bad mono">逾期 ${-d} 天</span>`;if(d===0)return `<span class="chip warn">今天到期</span>`;if(d<=3)return `<span class="chip warn mono">${d} 天後 · ${md(t.due)}</span>`;return `<span class="chip mono">${md(t.due)}（${wk(t.due)}）</span>`}
function taskCard(t){
  const d=t.due?dayDiff(t.due):99,cls=t.status==='done'?'done':d<0?'overdue':d<=3?'soon':'';
  const i=ORDER.indexOf(t.status||'todo'),as=t.assignees;
  const canDel=isAdmin||t.createdBy===me.id;
  return `<article class="item ${cls}"><div class="head"><h3>${esc(t.title)}</h3>${dueChip(t)}</div>
  ${t.desc?`<p class="muted" style="font-size:14px">${esc(t.desc)}</p>`:''}
  <div class="people">${as.length?as.map(a=>person(a)).join(''):'<span class="chip warn">尚無負責人</span>'}</div>
  <div class="actions">
    ${!as.includes(me.id)?`<button class="btn sm" data-act="claim" data-id="${t.id}">我來負責</button>`:''}
    ${i>0?`<button class="btn sm" data-act="mv" data-id="${t.id}" data-to="${ORDER[i-1]}">← ${ST[ORDER[i-1]]}</button>`:''}
    ${i<2?`<button class="btn sm pri" data-act="mv" data-id="${t.id}" data-to="${ORDER[i+1]}">${ST[ORDER[i+1]]} →</button>`:''}
    ${canDel?`<button class="btn sm ghost danger" data-act="delTask" data-id="${t.id}">${confirmDel===t.id?'確定刪除？':'刪除'}</button>`:''}
  </div></article>`}
function memberChecks(prefix){const ids=Object.keys(S.members);
  return ids.sort((a,b)=>name(a).localeCompare(name(b))).map(id=>`<label><input type="checkbox" class="keep" id="${prefix}-${id}" data-uid="${id}">${esc(name(id))}</label>`).join('')}
function vTasks(){
  let list=S.tasks;
  if(taskFilter==='mine')list=list.filter(t=>t.assignees.includes(me.id));
  if(taskFilter==='none')list=list.filter(t=>!t.assignees.length);
  const by=s=>list.filter(t=>(t.status||'todo')===s).sort((a,b)=>(a.due||'9999')<(b.due||'9999')?-1:1);
  return `<div class="bar"><div class="seg" role="group" aria-label="篩選">
    ${[['all','全部'],['mine','我的'],['none','未分配']].map(([k,l])=>`<button data-act="tf" data-v="${k}" aria-pressed="${taskFilter===k}">${l}</button>`).join('')}</div>
    <button class="btn pri" data-act="form" data-v="task">${showForm==='task'?'收起':'＋ 新增任務'}</button></div>
  ${showForm==='task'?`<form class="panel form" data-form="task">
    <label>任務名稱<input type="text" id="t-title" class="keep" required maxlength="120" placeholder="例：聯絡場地、整理報名表"></label>
    <div class="row"><label>截止日<input type="date" id="t-due" class="keep"></label></div>
    <label>說明（選填）<textarea id="t-desc" class="keep" maxlength="2000"></textarea></label>
    <label>負責人<div class="checks">${memberChecks('ta')}</div></label>
    <div class="actions"><button class="btn pri" type="submit">建立任務</button></div></form>`:''}
  ${!S.tasks.length?`<div class="empty">還沒有任務。按「新增任務」建立第一項，指派負責人與截止日。</div>`:
  `<div class="board">${ORDER.map(s=>{const l=by(s);return `<section class="col"><header><span>${ST[s]}</span><span class="mono muted">${l.length}</span></header>${l.map(taskCard).join('')||'<div class="muted" style="font-size:13px;padding:4px">—</div>'}</section>`}).join('')}</div>`}`;
}

/* 排班與報名 */
const evSort=(a,b)=>(a.date+(a.start||''))<(b.date+(b.start||''))?-1:1;
function signedUp(eid){return Object.keys(S.signups).filter(u=>S.signups[u].events[eid])}
function count(eid){return signedUp(eid).length}
function evCard(e){
  const ids=signedUp(e.id),n=ids.length,cap=+e.capacity||0,full=cap&&n>=cap,d=dayDiff(e.date),past=d<0;
  const mine=ids.includes(me.id),present=e.present||{};
  const attN=Object.keys(present).filter(i=>present[i]).length;
  let btn='';
  if(!past){btn=mine?`<button class="btn sm" data-act="unsign" data-id="${e.id}">取消報名</button>`:full?`<button class="btn sm" disabled>已額滿</button>`:`<button class="btn sm pri" data-act="sign" data-id="${e.id}">${e.kind==='shift'?'登記這個班':'報名'}</button>`}
  const rollIds=[...new Set([...ids,...Object.keys(S.members)])];
  return `<article class="item ev ${past?'past':''}">
   <div class="date"><b>${md(e.date)}</b><span>週${wk(e.date)}</span></div>
   <div style="display:grid;gap:6px;min-width:0">
    <div class="head"><h3>${esc(e.title)}</h3><span class="chip ${e.kind==='shift'?'':'acc'}">${e.kind==='shift'?'排班':'活動'}</span></div>
    <div class="meta">${e.start?`<span class="mono">${esc(e.start)}${e.end?'–'+esc(e.end):''}</span>`:''}${e.place?`<span>· ${esc(e.place)}</span>`:''}
      ${d===0?'<span class="chip warn">今天</span>':d>0&&d<=7?`<span class="chip">${d} 天後</span>`:''}${mine?'<span class="chip acc">已報名</span>':''}</div>
    ${e.note?`<p style="font-size:14px">${esc(e.note)}</p>`:''}
    <div class="meta"><span class="mono">${n}${cap?' / '+cap:''} 人</span>${attN?`<span>· 出席 <span class="mono">${attN}</span></span>`:''}</div>
    ${cap?`<div class="cap ${full?'full':''}"><i style="width:${Math.min(100,n/cap*100)}%"></i></div>`:''}
    ${n?`<div class="people">${ids.map(i=>person(i,present[i]?'here':'')).join('')}</div>`:''}
    ${roll===e.id?`<div class="roll"><span class="muted" style="font-size:13px">勾選實際出席的人（即時儲存）</span>${rollIds.map(i=>`<label><input type="checkbox" data-act="present" data-id="${e.id}" data-uid="${i}" ${present[i]?'checked':''}>${esc(name(i))}${ids.includes(i)?'':' <span class="chip">未報名</span>'}</label>`).join('')}</div>`:''}
    <div class="actions">${btn}
     ${isAdmin?`<button class="btn sm" data-act="roll" data-id="${e.id}">${roll===e.id?'完成點名':'點名'}</button>
     <button class="btn sm ghost danger" data-act="delEv" data-id="${e.id}">${confirmDel===e.id?'確定刪除？':'刪除'}</button>`:''}</div>
   </div></article>`}
function vEvents(){
  let l=S.events;if(evFilter!=='all')l=l.filter(e=>e.kind===evFilter);
  const up=l.filter(e=>dayDiff(e.date)>=0).sort(evSort),past=l.filter(e=>dayDiff(e.date)<0).sort(evSort).reverse();
  return `<div class="bar"><div class="seg" role="group" aria-label="類型">
   ${[['all','全部'],['event','活動報名'],['shift','排班時段']].map(([k,v])=>`<button data-act="ef" data-v="${k}" aria-pressed="${evFilter===k}">${v}</button>`).join('')}</div>
   ${isAdmin?`<button class="btn pri" data-act="form" data-v="event">${showForm==='event'?'收起':'＋ 新增活動／時段'}</button>`:''}</div>
  ${showForm==='event'?`<form class="panel form" data-form="event">
   <div class="row"><label>類型<select id="e-kind" class="keep"><option value="event">活動報名（例：社課、聚會）</option><option value="shift">排班時段（例：攤位值班）</option></select></label>
    <label>名稱<input type="text" id="e-title" class="keep" required maxlength="100" placeholder="例：週三社課、攤位 13:00 班"></label></div>
   <div class="row"><label>日期<input type="date" id="e-date" class="keep" required value="${TODAY}"></label><label>開始<input type="time" id="e-start" class="keep"></label><label>結束<input type="time" id="e-end" class="keep"></label></div>
   <div class="row"><label>地點<input type="text" id="e-place" class="keep" maxlength="80"></label><label>人數上限（0 = 不限）<input type="number" id="e-cap" class="keep" min="0" max="999" value="0"></label></div>
   <label>備註（選填）<textarea id="e-note" class="keep" maxlength="1000"></textarea></label>
   <div class="actions"><button class="btn pri" type="submit">建立</button></div></form>`:''}
  <section class="sec"><h2>接下來</h2>${up.length?`<div class="list">${up.map(evCard).join('')}</div>`:`<div class="empty">沒有即將到來的活動或時段。${isAdmin?'按「新增活動／時段」建立。':''}</div>`}</section>
  ${past.length?`<section class="sec"><div class="bar"><h2 style="margin:0">已結束 <span class="mono muted" style="font-size:13px">${past.length}</span></h2><button class="btn sm ghost" data-act="past">${showPast?'收起':'展開'}</button></div>${showPast?`<div class="list">${past.map(evCard).join('')}</div>`:''}</section>`:''}`;
}

/* 公告 */
function annCard(a,brief){
  const cs=S.comments.filter(c=>c.ann===a.id);
  return `<article class="item">${a.pinned?'<span class="pin">置頂</span>':''}
   <div class="head"><h3>${esc(a.title)}</h3>${isAdmin&&!brief?`<span style="display:flex;gap:4px"><button class="btn sm ghost" data-act="pinAnn" data-id="${a.id}">${a.pinned?'取消置頂':'置頂'}</button><button class="btn sm ghost danger" data-act="delAnn" data-id="${a.id}">${confirmDel===a.id?'確定刪除？':'刪除'}</button></span>`:''}</div>
   <div class="meta">${person(a.by)}<span class="mono">${ago(a.createdAt)}</span></div>
   ${a.body?`<p>${esc(a.body)}</p>`:''}
   ${brief?`<div class="meta"><button class="btn sm ghost" data-act="goto" data-v="board">${cs.length?cs.length+' 則留言 · ':''}查看公告 →</button></div>`:
   `<div class="comments">${cs.map(c=>`<div class="cmt"><span class="by">${esc(name(c.by))} · <span class="mono">${ago(c.createdAt)}</span>${c.by===me.id||isAdmin?` · <button class="btn sm ghost danger" style="padding:0" data-act="delCmt" data-id="${c.id}">${confirmDel===c.id?'確定？':'刪除'}</button>`:''}</span><span style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(c.text)}</span></div>`).join('')}
    <form class="cform" data-form="cmt" data-ann="${a.id}"><input type="text" id="c-${a.id}" class="keep" maxlength="500" placeholder="留言或回覆…" aria-label="留言"><button class="btn sm" type="submit">送出</button></form></div>`}
  </article>`}
function vBoard(){
  const l=[...S.anns].sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0)||b.createdAt-a.createdAt);
  return `<div class="bar"><h2 style="margin:0">公告與討論</h2>${isAdmin?`<button class="btn pri" data-act="form" data-v="ann">${showForm==='ann'?'收起':'＋ 發布公告'}</button>`:''}</div>
  ${showForm==='ann'?`<form class="panel form" data-form="ann"><label>標題<input type="text" id="a-title" class="keep" required maxlength="120"></label>
   <label>內容<textarea id="a-body" class="keep" maxlength="5000" style="min-height:120px"></textarea></label>
   <label style="display:flex;align-items:center;gap:8px;color:var(--ink)"><input type="checkbox" id="a-pin" class="keep">置頂</label>
   <div class="actions"><button class="btn pri" type="submit">發布</button></div></form>`:''}
  ${l.length?`<div class="list">${l.map(a=>annCard(a,false)).join('')}</div>`:`<div class="empty">還沒有公告。${isAdmin?'發布第一則公告，成員可以在下方留言討論。':''}</div>`}`;
}

/* 成員與出席 */
function vPeople(){
  const ids=Object.keys(S.members);
  const pastEv=S.events.filter(e=>dayDiff(e.date)<0&&Object.values(e.present||{}).some(Boolean));
  const rows=ids.map(id=>{
    const signed=pastEv.filter(e=>signedUp(e.id).includes(id)).length;
    const att=pastEv.filter(e=>(e.present||{})[id]).length;
    const rate=signed?Math.round(Math.min(att,signed)/signed*100):null;
    const openT=S.tasks.filter(t=>t.status!=='done'&&t.assignees.includes(id)).length;
    const up=S.events.filter(e=>dayDiff(e.date)>=0&&signedUp(e.id).includes(id)).length;
    return {id,signed,att,rate,openT,up,joined:S.members[id].joinedAt,role:S.members[id].role}}).sort((a,b)=>name(a.id).localeCompare(name(b.id)));
  const roleChip=r=>r==='owner'?' <span class="chip acc">負責人</span>':r==='admin'?' <span class="chip acc">管理者</span>':'';
  return `${isAdmin&&S.pending.length?`<section class="sec"><h2>等待核准 <span class="mono muted" style="font-size:13px">${S.pending.length}</span></h2><div class="list">
   ${S.pending.map(p=>`<div class="item"><div class="head"><div>${person(p.id)} <span class="muted" style="font-size:13px">${esc(p.email||'')}</span></div>
    <div class="actions"><button class="btn sm pri" data-act="approve" data-id="${p.id}">核准</button><button class="btn sm ghost danger" data-act="reject" data-id="${p.id}">${confirmDel===p.id?'確定拒絕？':'拒絕'}</button></div></div></div>`).join('')}</div></section>`:''}
  ${isOwner?`<form class="panel form" data-form="meta" style="margin-bottom:18px"><div class="row" style="align-items:flex-end"><label>團隊名稱（顯示在頁首與登入頁）<input type="text" id="m-name" class="keep" maxlength="40" placeholder="${esc(S.meta.team_name||'例：FinTech Lab 幹部群')}"></label><div><button class="btn" type="submit">儲存</button></div></div></form>
   <div class="notice">邀請成員：把這個網頁的網址傳給他們，用 Google 登入後會出現在上方「等待核准」。要讓某人發公告、建活動、點名，按該列的「設為管理者」。</div>`:''}
  ${rows.length?`<div class="tbl-wrap"><table><thead><tr><th>成員</th><th>加入</th><th>未完成任務</th><th>即將參加</th><th>過去出席</th><th>出席率</th>${isAdmin?'<th></th>':''}</tr></thead><tbody>
   ${rows.map(r=>{const canRm=r.id!==me.id&&r.role!=='owner'&&(isOwner||r.role==='member');
   return `<tr><td>${person(r.id)}${roleChip(r.role)}</td><td class="num">${r.joined?ago(r.joined).split(' ')[0]:'—'}</td><td class="num">${r.openT||'—'}</td><td class="num">${r.up||'—'}</td><td class="num">${r.signed?r.att+' / '+r.signed:'—'}</td>
   <td>${r.rate===null?'<span class="muted">—</span>':`<span class="chip mono ${r.rate>=80?'acc':r.rate>=50?'warn':'bad'}">${r.rate}%</span>`}</td>
   ${isAdmin?`<td>${isOwner&&r.role!=='owner'?`<button class="btn sm" data-act="role" data-id="${r.id}" data-v="${r.role==='admin'?'member':'admin'}">${r.role==='admin'?'取消管理者':'設為管理者'}</button> `:''}${canRm?`<button class="btn sm ghost danger" data-act="delMem" data-id="${r.id}">${confirmDel===r.id?'確定移除？':'移出'}</button>`:''}</td>`:''}</tr>`}).join('')}</tbody></table></div>
   <p class="muted" style="font-size:13px">出席率只計算已結束、且管理者有點名的場次：出席次數 ÷ 報名次數。</p>`:`<div class="empty">還沒有正式成員。</div>`}`;
}

/* ---------- 互動 ---------- */
document.addEventListener('click',e=>{
  const tb=e.target.closest('#tabs button');if(tb){tab=tb.dataset.tab;showForm=null;confirmDel=null;try{history.replaceState(null,'','#'+tab)}catch(_){}draw();return}
  const b=e.target.closest('[data-act]');if(!b||b.tagName==='INPUT')return;
  const {act:a,id,v}=b.dataset;
  const delStep=fn=>{if(confirmDel!==id){confirmDel=id;draw();return}confirmDel=null;fn()};
  if(!/^(del|reject)/.test(a))confirmDel=null;
  switch(a){
    case 'login':sb.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname}}).then(r=>{if(r.error)toast(errMsg(r.error))});break;
    case 'logout':sb.auth.signOut();break;
    case 'refresh':location.reload();break;
    case 'goto':tab=v;draw();break;
    case 'tf':taskFilter=v;draw();break;
    case 'ef':evFilter=v;draw();break;
    case 'past':showPast=!showPast;draw();break;
    case 'form':showForm=showForm===v?null:v;draw();if(showForm){const f=document.querySelector('[data-form] input[type=text]');f&&f.focus()}break;
    case 'roll':roll=roll===id?null:id;draw();break;
    case 'mv':act(()=>sb.from('tasks').update({status:b.dataset.to}).eq('id',id));break;
    case 'claim':{const t=S.tasks.find(x=>x.id===id);act(()=>sb.from('tasks').update({assignees:[...t.assignees,me.id]}).eq('id',id),'已接下這項任務');break}
    case 'delTask':delStep(()=>act(()=>sb.from('tasks').delete().eq('id',id),'已刪除任務'));break;
    case 'delEv':delStep(()=>act(()=>sb.from('events').delete().eq('id',id),'已刪除'));break;
    case 'delAnn':delStep(()=>act(()=>sb.from('announcements').delete().eq('id',id),'已刪除公告'));break;
    case 'delCmt':delStep(()=>act(()=>sb.from('comments').delete().eq('id',id)));break;
    case 'delMem':delStep(()=>act(()=>sb.from('profiles').update({role:'pending'}).eq('id',id),'已移出，對方需重新核准'));break;
    case 'reject':delStep(()=>act(()=>sb.from('profiles').delete().eq('id',id),'已拒絕'));break;
    case 'approve':act(()=>sb.from('profiles').update({role:'member'}).eq('id',id),'已核准');break;
    case 'role':act(()=>sb.from('profiles').update({role:v}).eq('id',id),v==='admin'?'已設為管理者':'已取消管理者');break;
    case 'pinAnn':{const x=S.anns.find(a=>a.id===id);act(()=>sb.from('announcements').update({pinned:!x.pinned}).eq('id',id));break}
    case 'sign':act(()=>sb.from('signups').insert({event_id:id,user_id:me.id}),'已報名');break;
    case 'unsign':act(()=>sb.from('signups').delete().eq('event_id',id).eq('user_id',me.id),'已取消報名');break;
  }
});
document.addEventListener('change',e=>{const c=e.target;if(c.dataset.act!=='present')return;
  act(()=>sb.from('attendance').upsert({event_id:c.dataset.id,user_id:c.dataset.uid,present:c.checked}))});
document.addEventListener('submit',e=>{e.preventDefault();const f=e.target,k=f.dataset.form,val=id=>{const el=document.getElementById(id);return el?el.value.trim():''};
  const done=()=>{f.reset();showForm=null};
  if(k==='task'){const title=val('t-title');if(!title)return;const as=[...f.querySelectorAll('input[data-uid]:checked')].map(x=>x.dataset.uid);
    act(async()=>{const r=await sb.from('tasks').insert({title,descr:val('t-desc'),due:val('t-due')||null,assignees:as});if(!r.error)done();return r},'已建立任務')}
  if(k==='event'){const title=val('e-title'),date=val('e-date');if(!title||!date)return;
    act(async()=>{const r=await sb.from('events').insert({kind:val('e-kind')||'event',title,date,start_time:val('e-start'),end_time:val('e-end'),place:val('e-place'),capacity:Math.max(0,parseInt(val('e-cap'))||0),note:val('e-note')});if(!r.error)done();return r},'已建立')}
  if(k==='ann'){const title=val('a-title');if(!title)return;
    act(async()=>{const r=await sb.from('announcements').insert({title,body:val('a-body'),pinned:document.getElementById('a-pin').checked});if(!r.error)done();return r},'已發布')}
  if(k==='cmt'){const inp=f.querySelector('input'),text=inp.value.trim();if(!text)return;
    act(async()=>{const r=await sb.from('comments').insert({ann_id:f.dataset.ann,body:text,author:me.id});if(!r.error)inp.value='';return r})}
  if(k==='meta'){const n=val('m-name');if(!n)return;act(async()=>{const r=await sb.from('settings').update({team_name:n}).eq('id',1);if(!r.error)f.reset();return r},'已更新團隊名稱')}
});

/* ---------- 啟動 ---------- */
(async()=>{
  const cfg=window.TEAM_DESK_CONFIG||{};
  if(!cfg.url||!cfg.anonKey||!window.supabase){showSetup();return}
  sb=window.supabase.createClient(cfg.url,cfg.anonKey);
  const {data}=await sb.auth.getSession();session=data.session;
  sb.auth.onAuthStateChange((_ev,s)=>{const a=session&&session.user.id,b=s&&s.user.id;session=s;if(a!==b)boot()});
  boot();
})();
