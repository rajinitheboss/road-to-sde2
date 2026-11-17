// Road to SDE-2: schedule, storage (browser + Supabase), Material 3 UI, routing and events.
// Loaded after data/nc.js, data/plan.js and scene3d.js (see index.html).
// ---------- build the schedule ----------
function dsaFor(n){ // returns {probs:[idx...]} or {late:{...}}
  if(n<=50) return {probs:[3*(n-1),3*(n-1)+1,3*(n-1)+2]};
  return {late:DSA_LATE[n]};
}
function itemsFor(n){ // keys tracked for day n
  const ks=[]; const d=dsaFor(n);
  if(d.probs) d.probs.forEach(i=>ks.push("p:"+NC[i][0])); else ks.push("d"+n+":dsa");
  ks.push("d"+n+":design"); if(CAREER[n]) ks.push("d"+n+":career");
  return ks;
}

// ---------- state + storage ----------
// Progress lives in two places:
//  1. localStorage (always) so the page works offline and without an account;
//  2. Supabase table `progress` (one row per signed-in user) so it syncs across devices.
let S={start:null,done:{},star:{}};
const LS_KEY="sde2-road-v1", LS_META="sde2-road-meta";  // meta = {owner: userId whose data this is, dirty: unsynced edits}
let sb=null, user=null, writing=false, queued=false, saveTimer=null, pendingSave=false;
let syncNote="Progress is saved in this browser.", syncCls="", authMsg="";
function lsGet(k){try{const v=JSON.parse(localStorage.getItem(k)||"null");return v&&typeof v==="object"?v:null}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
function lsWrite(){lsSet(LS_KEY,S)}
function meta(){return lsGet(LS_META)||{owner:null,dirty:false}}
function setMeta(p){lsSet(LS_META,{...meta(),...p})}
function norm(v){v=v||{};return {start:typeof v.start==="string"?v.start:null,done:v.done&&typeof v.done==="object"?{...v.done}:{},star:v.star&&typeof v.star==="object"?{...v.star}:{}}}
function hasData(x){return !!(x.start||Object.keys(x.done).length||Object.keys(x.star).length)}
function merge(server,local){ // union of ticks and stars; server's start date wins
  const done={...local.done}; for(const k in server.done) done[k]=done[k]&&done[k]<server.done[k]?done[k]:server.done[k];
  return {start:server.start||local.start,done,star:{...local.star,...server.star}};
}
function save(){
  lsWrite();
  if(!user){ return; }
  setMeta({owner:user.id,dirty:true});
  pendingSave=true; clearTimeout(saveTimer); saveTimer=setTimeout(()=>{saveTimer=null;flush()},600);
}
async function flush(){
  if(!user) return;
  if(writing){queued=true;return}
  writing=true; setSync("Saving…","");
  const {error}=await sb.from("progress").upsert({user_id:user.id,start:S.start,done:S.done,star:S.star,updated_at:new Date().toISOString()});
  if(error) setSync("Couldn't save to the server ("+error.message+"). Your ticks are safe in this browser and will sync next time.","warn");
  else { setSync("Synced to your account","ok"); if(!queued&&!saveTimer) setMeta({owner:user.id,dirty:false}); }
  writing=false; if(queued){queued=false;flush()} else if(!saveTimer) pendingSave=false;
}
async function loadRemote(){
  if(!user) return;
  setSync("Loading your progress…","");
  const {data,error}=await sb.from("progress").select("start,done,star").eq("user_id",user.id).maybeSingle();
  if(error){ setSync("Couldn't load from the server ("+error.message+"). Showing this browser's copy.","warn"); return; }
  if(pendingSave||writing) return; // a newer local edit is on its way up
  const local=norm(lsGet(LS_KEY)), m=meta();
  // Merge the browser copy in only if it is unsynced work by this user, or a first sign-in on this browser.
  const useLocal = hasData(local) && (m.owner===null || (m.owner===user.id && m.dirty));
  if(data){ S = useLocal ? merge(norm(data),local) : norm(data); }
  else { S = useLocal ? local : norm(null); }
  lsWrite(); setMeta({owner:user.id,dirty:false}); render();
  if(useLocal || (!data && hasData(S))) flush(); else setSync("Synced to your account","ok");
}
function configured(){const c=window.SDE2_CONFIG||{};return !!(c.supabaseUrl&&c.supabaseAnonKey&&window.supabase)}
async function initStore(){
  S=norm(lsGet(LS_KEY));
  render();
  if(!configured()){ setSync("Progress is saved in this browser only. Add your Supabase keys in config.js to sync across devices.","warn"); return; }
  const c=window.SDE2_CONFIG;
  sb=window.supabase.createClient(c.supabaseUrl,c.supabaseAnonKey,{auth:{flowType:"pkce",persistSession:true,detectSessionInUrl:true}});
  sb.auth.onAuthStateChange((event,session)=>{
    const u=session&&session.user||null;
    if((u&&u.id)===(user&&user.id)) return;
    user=u;
    // Don't call Supabase inside this callback (it can deadlock); defer it.
    setTimeout(()=>{ if(user) loadRemote(); else { S=norm(lsGet(LS_KEY)); setSync("Signed out. Progress is saved in this browser only.","warn"); } render(); },0);
  });
  const {data}=await sb.auth.getSession();
  if(/[?&]code=/.test(location.search)) history.replaceState(null,"",location.pathname+location.hash); // tidy the sign-in link
  if(!data.session) setSync("Sign in below to sync your progress across devices.","warn");
}
async function signIn(email){
  authMsg="Sending…"; render();
  const {error}=await sb.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname}});
  authMsg = error ? "Couldn't send the link: "+error.message : "Check "+email+" for a sign-in link, and open it in this browser.";
  render();
}

// ---------- helpers ----------
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
// Text with [label](https://…) or [label](#view) links embedded in it.
function md(s){return esc(s).replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+|#[a-z0-9-]+)\)/g,(m,t,u)=>'<a href="'+u+'"'+(u[0]==="#"?"":' target="_blank" rel="noopener"')+'>'+t+'</a>')}
function todayISO(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function dayNum(){ if(!S.start) return 0; const [y,m,d]=S.start.split("-").map(Number); const a=Date.UTC(y,m-1,d); const t=new Date(); const b=Date.UTC(t.getFullYear(),t.getMonth(),t.getDate()); return Math.floor((b-a)/864e5)+1; }
function dateOf(n){ if(!S.start) return ""; const [y,m,d]=S.start.split("-").map(Number); const x=new Date(Date.UTC(y,m-1,d+n-1)); return x.toLocaleDateString(undefined,{weekday:"short",day:"numeric",month:"short",timeZone:"UTC"}); }
const isDone=k=>!!S.done[k];
const DAY_OF={}; for(let n=1;n<=TOTAL;n++) itemsFor(n).forEach(k=>DAY_OF[k]=n);
function dayFrac(n){const ks=itemsFor(n);return ks.filter(isDone).length/ks.length}
function dayComplete(n){return itemsFor(n).every(isDone)}
function stats(){
  const solved=NC.filter(p=>isDone("p:"+p[0])).length;
  let design=0; for(let n=1;n<=TOTAL;n++) if(isDone("d"+n+":design")) design++;
  const cur=Math.min(Math.max(dayNum(),0),TOTAL);
  let due=0,doneDue=0; for(let n=1;n<=cur;n++){ itemsFor(n).forEach(k=>{due++; if(isDone(k)) doneDue++;}); }
  let streak=0; for(let n=cur;n>=1;n--){ if(dayComplete(n)) streak++; else if(n===cur) continue; else break; }
  return {solved,design,cur,due,doneDue,streak};
}
function dayState(n,cur){
  const f=dayFrac(n);
  if(f===1) return "done";
  if(S.start&&n===cur) return "today";
  if(f>0) return "part";
  if(S.start&&n<cur) return "miss";
  return "future";
}
const ICON_FOR=[[/leetcode\.com/,"code"],[/youtube\.com/,"smart_display"],[/hellointerview\.com/,"school"],[/refactoring\.guru/,"category"],
  [/github\.com/,"data_object"],[/jenkov\.com/,"menu_book"],[/(docs\.aws|aws\.amazon|kafka\.apache|elastic\.co|spring\.io|postgresql|sre\.google|learn\.microsoft)/,"description"],
  [/(linkedin|naukri|instahyre)/,"work"],[/levels\.fyi/,"payments"],[/pramp/,"groups"],[/excalidraw/,"draw"],[/amazon\.jobs/,"verified"],[/neetcode/,"route"],[/cppreference/,"terminal"]];
function iconFor(u){ if(u[0]==="#") return "arrow_forward"; for(const [re,ic] of ICON_FOR) if(re.test(u)) return ic; return "open_in_new"; }
function linkChip(label,url){
  const ext=url[0]!=="#";
  return '<a class="chip ripple" href="'+esc(url)+'"'+(ext?' target="_blank" rel="noopener"':'')+'><span class="icon">'+iconFor(url)+'</span><span class="t">'+esc(label)+'</span></a>';
}
const KICON={dsa:"code",lld:"account_tree",hld:"hub",res:"badge",beh:"forum",mock:"timer",car:"work"};
function tag(k){return '<span class="tag k-'+k+'"><span class="icon">'+KICON[k]+'</span>'+KLABEL[k]+'</span>'}

// ---------- tiles ----------
function probTile(i){
  const p=NC[i], k="p:"+p[0], dn=isDone(k), st=!!S.star[p[0]];
  const dl={E:"Easy",M:"Medium",H:"Hard"}[p[2]], id="cb-"+k;
  return '<div class="tile'+(dn?' done':'')+'" data-tile="'+esc(k)+'"><input type="checkbox" class="cb" id="'+esc(id)+'" data-k="'+esc(k)+'"'+(dn?' checked':'')+'>'+
   '<div><label class="tname" for="'+esc(id)+'">'+esc(p[1])+'</label><div class="tmeta"><span class="diff '+p[2]+'">'+dl+'</span><span>'+esc(p[3])+'</span></div>'+
   '<div class="tlinks">'+linkChip("Solve on LeetCode",LC(p[0]))+linkChip("NeetCode video",YT(p[4]))+'</div>'+
   (p[5]?'<div class="premium" style="margin-top:6px">This one is LeetCode Premium. Solve it free on <a href="https://neetcode.io/practice" target="_blank" rel="noopener">NeetCode practice</a>.</div>':'')+'</div>'+
   '<button class="ibtn star ripple" data-star="'+esc(p[0])+'" aria-pressed="'+st+'" title="'+(st?"Starred to re-solve":"Star to re-solve later")+'" aria-label="Star '+esc(p[1])+' to re-solve later"><span class="icon">star</span></button></div>';
}
function taskTile(key,kind,title,desc,links,qs,openQuiz){
  const dn=isDone(key), id="cb-"+key;
  const q=qs&&qs.length?(openQuiz
     ?'<details class="quiz" open><summary><span class="icon" style="font-size:18px">quiz</span>Check yourself: answer out loud<span class="icon chev">expand_more</span></summary><ol>'+qs.map(x=>'<li>'+md(x)+'</li>').join("")+'</ol></details>'
     :'<details class="quiz"><summary><span class="icon" style="font-size:18px">quiz</span>Check-yourself questions ('+qs.length+')<span class="icon chev">expand_more</span></summary><ol>'+qs.map(x=>'<li>'+md(x)+'</li>').join("")+'</ol></details>'):'';
  return '<div class="tile'+(dn?' done':'')+'" data-tile="'+esc(key)+'"><input type="checkbox" class="cb" id="'+esc(id)+'" data-k="'+esc(key)+'"'+(dn?' checked':'')+'>'+
   '<div><div class="blkhead">'+tag(kind)+'</div><label class="tname" for="'+esc(id)+'" style="display:block;margin-top:8px">'+md(title)+'</label>'+
   (desc?'<p class="tdesc">'+md(desc)+'</p>':'')+
   (links&&links.length?'<div class="tlinks">'+links.map(l=>linkChip(l[0],l[1])).join("")+'</div>':'')+q+'</div><span></span></div>';
}
function designLabel(k){return k==="lld"?"Design in Java":k==="hld"?"System design":k==="res"?"Revise your own work":k==="beh"?"Behavioural":"Practice"}
function dayBlocks(n,openQuiz){
  const d=dsaFor(n), g=DESIGN[n-1];
  let h='<div class="blk"><div class="blkhead">'+tag("dsa")+'<span class="t">DSA in C++</span><span class="time">~90 min</span></div><div class="tiles">';
  h+= d.probs ? d.probs.map(probTile).join("") : taskTile("d"+n+":dsa","dsa",d.late.t,"",d.late.l,null,openQuiz);
  h+='</div></div><div class="blk"><div class="blkhead">'+tag(g.k)+'<span class="t">'+designLabel(g.k)+'</span><span class="time">~80 min'+(CAREER[n]?' · incl. 20-min career task':'')+'</span></div><div class="tiles">';
  h+=taskTile("d"+n+":design",g.k,g.t,g.d,g.l,g.q,openQuiz);
  if(CAREER[n]) h+=taskTile("d"+n+":career","car",CAREER[n],"",CAREER_LINKS[n]||[],null,openQuiz);
  return h+'</div></div>';
}

// ---------- shared bits ----------
function setSync(t,c){
  syncNote=t; syncCls=c;
  const ic=c==="ok"?"cloud_done":c==="warn"?"cloud_off":"cloud_sync";
  const si=document.getElementById("syncIcon"); if(si){ si.innerHTML='<span class="icon">'+ic+'</span>'; si.title=t; si.setAttribute("aria-label",t); si.style.color=c==="ok"?"var(--success)":c==="warn"?"var(--tertiary)":""; }
  document.querySelectorAll("[data-sync]").forEach(el=>{el.className="status "+c; el.innerHTML='<span class="icon">'+ic+'</span><span>'+esc(t)+'</span>'});
}
function statusLine(){return '<div class="status '+syncCls+'" data-sync><span class="icon">'+(syncCls==="ok"?"cloud_done":syncCls==="warn"?"cloud_off":"cloud_sync")+'</span><span>'+esc(syncNote)+'</span></div>'}
function accountPanel(){
  if(!sb) return '<p class="body-s" style="margin:0">Sync is off: add your Supabase URL and anon key to <span class="mono">config.js</span> (steps in the <a href="https://github.com/rajinitheboss/road-to-sde2#connect-supabase-one-time-about-10-minutes" target="_blank" rel="noopener">README</a>).</p>';
  if(user) return '<div class="formrow" style="align-items:center"><span class="status ok"><span class="icon">account_circle</span><span>Signed in as '+esc(user.email||"you")+'</span></span><button class="btn outlined ripple" id="signOut"><span class="icon">logout</span>Sign out</button></div>';
  return '<form class="formrow" id="signin"><div class="field"><label for="email">Email for a sign-in link</label><input class="input" type="email" id="email" required autocomplete="email" placeholder="you@example.com"></div><button class="btn tonal ripple" type="submit"><span class="icon">mail</span>Email me a link</button></form>'+(authMsg?'<p class="body-s" style="margin:0">'+esc(authMsg)+'</p>':'');
}
function startForm(label){
  return '<div class="formrow"><div class="field"><label for="startDate">'+label+'</label><input class="input" type="date" id="startDate" value="'+(S.start||todayISO())+'"></div><button class="btn filled ripple" id="setStart"><span class="icon">'+(S.start?"edit_calendar":"rocket_launch")+'</span>'+(S.start?"Change start date":"Start the plan")+'</button></div>';
}
function legend(){return '<div class="legend"><span><i style="background:var(--primary)"></i>Done</span><span><i style="background:color-mix(in srgb,var(--primary) 45%,var(--surface-lowest))"></i>In progress</span><span><i style="background:var(--tertiary)"></i>Today</span><span><i style="background:color-mix(in srgb,var(--error) 65%,var(--surface-lowest))"></i>Missed</span></div>'}
function ring(p,c,inner){return '<div class="ring" style="--p:'+Math.round(p)+';--c:'+c+'">'+inner+'</div>'}
let snackT=0;
function snack(msg,icon){const el=document.getElementById("snackbar"); el.innerHTML=(icon?'<span class="icon">'+icon+'</span>':'')+'<span>'+esc(msg)+'</span>'; el.classList.add("show"); clearTimeout(snackT); snackT=setTimeout(()=>el.classList.remove("show"),3600);}

// ---------- Today ----------
function renderHero(){
  const s=stats(), n=s.cur, el=document.getElementById("heroCopy");
  if(!S.start){
    el.innerHTML='<span class="label">Your 60-day plan · 3 hours a day</span><h1 class="display">Road to SDE-2</h1><p style="margin:0;max-width:46ch">About 90 minutes of DSA in C++ and 80 minutes of design, system design or resume revision, every day. Pick your start date and this page shows exactly what to do each day.</p>'+startForm("Start date");
  } else if(n<1){
    el.innerHTML='<span class="label">Starts '+esc(dateOf(1))+'</span><h1 class="display">Day 0</h1><p style="margin:0">Until then, read the <a href="#method">method</a> and set up <a href="https://leetcode.com/" target="_blank" rel="noopener">LeetCode</a> and a Java project for LLD.</p>'+legend();
  } else if(n>TOTAL){
    el.innerHTML='<span class="label">Plan complete</span><h1 class="display">All 60 days done</h1><p style="margin:0">Keep the rhythm until you sign: 2 problems, 1 design redo, and prep for the next company on your calendar.</p>'+legend();
  } else {
    const behind=s.due-s.doneDue;
    el.innerHTML='<span class="label">'+esc(dateOf(n))+' · Week '+Math.ceil(n/7)+' of 9</span><h1 class="display">Day '+n+'<span style="opacity:.55;font-weight:600"> / 60</span></h1>'+
      (behind===0?'<span class="pacechip ok"><span class="icon fill">check_circle</span>On schedule</span>':'<span class="pacechip warn"><span class="icon fill">schedule</span>'+behind+' task'+(behind>1?'s':'')+' behind</span>')+legend();
  }
  const cur=s.cur; Scene3D.setData(Array.from({length:TOTAL},(_,i)=>({n:i+1,state:dayState(i+1,cur),frac:dayFrac(i+1)})));
}
function sceneTip(n){const ks=itemsFor(n);const d=ks.filter(isDone).length;return "Day "+n+(S.start?" · "+dateOf(n):"")+" · "+d+"/"+ks.length+" done"}
function renderTodayBody(){
  const s=stats(), n=s.cur, el=document.getElementById("todayBody");
  const pct=s.due?Math.round(100*s.doneDue/s.due):(S.start?100:0);
  let h='<div class="stats">'+
    '<div class="stat tilt">'+ring(s.solved/1.5,"var(--dsa)",'<b>'+Math.round(s.solved/1.5)+'%</b>')+'<div><div class="label">NeetCode 150</div><div class="v mono">'+s.solved+'<small> / 150</small></div></div></div>'+
    '<div class="stat tilt">'+ring(s.design/0.6,"var(--lld)",'<b>'+Math.round(s.design/0.6)+'%</b>')+'<div><div class="label">Design sessions</div><div class="v mono">'+s.design+'<small> / 60</small></div></div></div>'+
    '<div class="stat tilt">'+ring(pct,"var(--success)",'<b>'+pct+'%</b>')+'<div><div class="label">Due so far, done</div><div class="v mono">'+s.doneDue+'<small> / '+s.due+'</small></div></div></div>'+
    '<div class="stat tilt">'+ring(Math.min(100,s.streak/7*100),"var(--tertiary)",'<span class="icon fill">local_fire_department</span>')+'<div><div class="label">Streak</div><div class="v mono">'+s.streak+'<small> day'+(s.streak===1?'':'s')+'</small></div></div></div></div>';
  if(S.start&&n>=1&&n<=TOTAL){
    h+='<section class="card"><div class="secthead"><span class="icon" style="color:var(--primary)">event_available</span><h2>Today’s work</h2><span class="meta">Day '+n+' · ~3 h</span></div><div class="stack" style="gap:22px">'+dayBlocks(n,true)+'</div></section>';
  } else if(!S.start){
    h+='<section class="card"><div class="secthead"><span class="icon" style="color:var(--primary)">visibility</span><h2>Preview: day 1</h2><span class="meta">what a day looks like</span></div><div class="stack" style="gap:22px">'+dayBlocks(1,true)+'</div></section>';
  }
  const starred=NC.map((p,i)=>i).filter(i=>S.star[NC[i][0]]);
  h+='<section class="card flat" id="starred"><div class="secthead"><span class="icon fill" style="color:var(--tertiary)">star</span><h2>Re-solve list</h2><span class="meta">'+starred.length+' starred</span></div>'+
     (starred.length?'<p class="body-s" style="margin:0 0 12px">Problems you needed help with. Re-solve one in each 10-minute warm-up, 3–7 days after starring it. Un-star it once you solve it alone.</p><div class="tiles">'+starred.map(probTile).join("")+'</div>'
       :'<p class="body-s" style="margin:0">Nothing starred yet. Tap the <span class="icon" style="font-size:16px;vertical-align:-3px">star</span> on any problem you couldn’t solve alone, and it shows up here for spaced repetition.</p>')+'</section>';
  if(S.start&&n>1){
    const missed=[]; for(let i=1;i<Math.min(n,TOTAL+1);i++) if(!dayComplete(i)) missed.push(i);
    if(missed.length) h+='<section class="card flat"><div class="secthead"><span class="icon" style="color:var(--error)">history</span><h2>Unfinished earlier days</h2><span class="meta">'+missed.length+'</span></div><p class="body-s" style="margin:0 0 12px">Do today first. Clear these in the warm-up and any spare time, not by skipping ahead.</p><div class="tlinks">'+missed.slice(0,24).map(i=>'<a class="chip ripple" href="#plan" data-goto="'+i+'"><span class="icon">event</span><span class="t">Day '+i+'</span></a>').join("")+(missed.length>24?'<span class="body-s">…and '+(missed.length-24)+' more</span>':'')+'</div></section>';
  }
  h+='<section class="card outlined"><div class="secthead"><span class="icon" style="color:var(--primary)">sync</span><h2>Your progress</h2></div><div class="stack" style="gap:16px">'+statusLine()+accountPanel()+(S.start?startForm("Plan start date"):"")+'</div></section>';
  el.innerHTML=h;
}

// ---------- Plan ----------
const openWeeks=new Set(); let weeksInit=false, pendingScroll=0;
function renderPlan(){
  const cur=stats().cur, el=document.getElementById("v-plan");
  if(!weeksInit){ openWeeks.add(S.start&&cur>=1?Math.min(9,Math.ceil(Math.min(cur,TOTAL)/7)):1); weeksInit=true; }
  let heat='<div class="heat" role="list" aria-label="All 60 days">';
  for(let w=1;w<=9;w++){ heat+='<span class="wk">W'+w+'</span>'; for(let d=1;d<=7;d++){ const n=(w-1)*7+d; if(n>TOTAL){heat+='<span class="blank"></span>';continue;} const st=dayState(n,cur); heat+='<a role="listitem" href="#plan" data-goto="'+n+'" class="'+(st==="future"?"":st==="today"?"today "+(dayFrac(n)>0?"part":""):st)+'" title="'+esc(sceneTip(n))+'">'+n+'</a>'; } }
  heat+='</div>';
  let h='<section class="card"><div class="secthead"><span class="icon" style="color:var(--primary)">calendar_month</span><div><span class="label">9 weeks · 150 problems · 60 sessions</span><h1 class="headline">The 60-day plan</h1></div></div><p class="body-s" style="margin:0 0 16px;max-width:70ch">Every day has a DSA block and one design or revision session. Tap any day to jump to it.</p>'+heat+'<div style="margin-top:14px">'+legend()+'</div></section>';
  for(let w=1;w<=9;w++){
    const a=(w-1)*7+1,b=Math.min(w*7,TOTAL); let tot=0,dn=0; const cats=new Set();
    for(let n=a;n<=b;n++){ itemsFor(n).forEach(k=>{tot++; if(isDone(k)) dn++;}); const d=dsaFor(n); if(d.probs) d.probs.forEach(i=>cats.add(NC[i][3])); }
    const kinds=[...new Set(DESIGN.slice(a-1,b).map(g=>g.k))];
    h+='<details class="week" data-week="'+w+'"'+(openWeeks.has(w)?' open':'')+'><summary class="ripple"><span class="wnum">'+w+'</span><span class="winfo"><span class="title">Week '+w+' <span class="body-s">· days '+a+'–'+b+'</span></span><span class="body-s">'+esc(cats.size?[...cats].join(", "):"Timed practice and contests")+'</span><span class="tlinks" style="margin-top:6px">'+kinds.map(tag).join("")+'</span></span><span class="wprog"><span class="wbar"><i style="width:'+(100*dn/tot)+'%"></i></span>'+dn+'/'+tot+'</span><span class="icon chev">expand_more</span></summary><div class="days">';
    if(openWeeks.has(w)) for(let n=a;n<=b;n++) h+=dayRow(n,cur);
    h+='</div></details>';
  }
  el.innerHTML=h;
}
function dayRow(n,cur){
  return '<div class="day'+(n===cur?' today':'')+'" id="day-'+n+'"><div class="dlabel"><span class="label">Day</span><b>'+n+'</b><span class="body-s">'+(S.start?esc(dateOf(n)):'')+'</span>'+(dayComplete(n)?'<span class="done"><span class="icon fill" style="font-size:16px">check_circle</span>Done</span>':'')+'</div><div class="dcol">'+dayBlocks(n,false)+'</div></div>';
}
function goToDay(n){
  const w=Math.ceil(n/7); openWeeks.add(w); pendingScroll=n;
  if(currentView()!=="plan") location.hash="plan"; else { renderPlan(); scrollToPending(); }
}
function scrollToPending(){ if(!pendingScroll) return; const n=pendingScroll; pendingScroll=0; requestAnimationFrame(()=>{ const r=document.getElementById("day-"+n); if(r) r.scrollIntoView({block:"start",behavior:REDUCED?"auto":"smooth"}); }); }

// ---------- Method ----------
function renderMethod(){
  const bars=[["code","DSA","Solve an unseen Medium in about 25 minutes. Explain the approach first and state time and space complexity.","dsa"],
    ["account_tree","LLD / machine coding","Turn a vague brief into clean, extensible, working Java in 60–90 minutes. Indian unicorns weight this heavily.","lld"],
    ["hub","System design","Lead a 45-minute design: requirements, API, data model, architecture, then scale and failure deep dives.","hld"],
    ["badge","Your experience","Explain every line of your resume in depth, especially the AWS migration and the BCP work.","res"],
    ["forum","Behavioural","Clear stories of ownership and impact, told with “I”, not “we”.","beh"]];
  document.getElementById("v-method").innerHTML=
  '<section class="card"><div class="secthead"><span class="icon" style="color:var(--primary)">school</span><div><span class="label">Read once, then every Sunday</span><h1 class="headline">How to study</h1></div></div><p class="body-s" style="margin:0 0 16px">What an SDE-2 loop checks for:</p><div class="bars">'+
   bars.map(b=>'<div class="bar-card tilt"><span class="icon" style="color:var(--'+b[3]+')">'+b[0]+'</span><span class="title">'+b[1]+'</span><span class="body-s">'+b[2]+'</span></div>').join("")+'</div></section>'+
  '<section class="card"><div class="secthead"><span class="icon" style="color:var(--primary)">schedule</span><h2>Your 3 hours</h2></div><ol class="timeline">'+
   '<li><span class="when">0:00–0:10</span><span><b>Warm-up.</b> Re-solve one problem from your <a href="#starred">re-solve list</a>, or skim yesterday’s notes.</span></li>'+
   '<li><span class="when">0:10–1:40</span><span><b>DSA block.</b> The day’s 3 problems in C++ on <a href="https://leetcode.com/" target="_blank" rel="noopener">LeetCode</a>.</span></li>'+
   '<li><span class="when">1:40–1:50</span><span><b>Break.</b> Step away from the screen.</span></li>'+
   '<li><span class="when">1:50–3:00</span><span><b>Design block.</b> The day’s LLD, system design, resume or behavioural session. On career-task days, 20 minutes of this goes to the job search.</span></li></ol></section>'+
  '<section class="card prose" style="max-width:none"><div class="secthead"><span class="icon" style="color:var(--dsa)">code</span><h2>DSA method (C++)</h2></div><ol>'+
   '<li>Read the problem, write 2 edge cases, and say the brute force out loud.</li>'+
   '<li>Give yourself <b>25 minutes</b> to code it with no help.</li>'+
   '<li>Stuck? Watch only the first part of the problem’s NeetCode video (the idea, not the code) and try again.</li>'+
   '<li>At <b>40 minutes</b>, watch the full solution, close it, and code it from memory.</li>'+
   '<li>If you needed help, <b>star</b> it. Re-solve starred problems 3–7 days later.</li>'+
   '<li>Hard problems can run long. If one eats your block, move the rest to tomorrow’s warm-up instead of skipping them.</li></ol>'+
   '<p class="body-s">C++ to have ready: <span class="mono">vector, unordered_map, unordered_set, map, set, priority_queue</span> (min-heap with <span class="mono">greater&lt;&gt;</span>), <span class="mono">deque, stack</span>, <span class="mono">sort</span> with a lambda. Reference: <a href="https://en.cppreference.com/w/cpp/container" target="_blank" rel="noopener">cppreference containers</a>. Pattern overview: <a href="https://neetcode.io/roadmap" target="_blank" rel="noopener">NeetCode roadmap</a>.</p></section>'+
  '<section class="card prose" style="max-width:none"><div class="secthead"><span class="icon" style="color:var(--lld)">account_tree</span><h2>Design method</h2></div><ul>'+
   '<li><b>LLD (Java):</b> clarify requirements, draw the class diagram, then code. It must run. Then ask “how would I add X?” and check you’d only add classes, not edit them. Flow: <a href="https://www.hellointerview.com/learn/low-level-design/in-a-hurry/delivery" target="_blank" rel="noopener">LLD delivery framework</a>.</li>'+
   '<li><b>System design:</b> try every problem on paper for 40 minutes <b>before</b> reading the breakdown. Reading without trying first feels productive but doesn’t stick. Flow: <a href="https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery" target="_blank" rel="noopener">HLD delivery framework</a>.</li>'+
   '<li><b>Your resume days:</b> read the official docs, then write answers to the check-yourself questions in your own words. Where you don’t know what your team did, ask a teammate this week while you still work there.</li></ul></section>'+
  '<section class="card prose" style="max-width:none"><div class="secthead"><span class="icon" style="color:var(--car)">work</span><h2>When to apply</h2></div><p>Interview loops usually take 2–6 weeks from the first call. So send practice-tier applications around <a href="#plan" data-goto="27">day 27</a> and ask for dream-tier referrals around <a href="#plan" data-goto="34">day 34</a>. Your strongest weeks (7–9) then line up with the interviews that matter most. Practise with peers on <a href="https://www.pramp.com/" target="_blank" rel="noopener">Pramp</a>.</p></section>'+
  '<div class="callout"><span class="icon fill">lightbulb</span><span>If you fall behind, don’t skip days to catch up. Keep going from today and fold missed problems into the warm-up. Doing every day partly beats doing some days perfectly.</span></div>';
}

// ---------- Resources ----------
function renderResources(){
  const R=[
   ["dsa","NeetCode 150 + LeetCode","https://neetcode.io/practice","Your only DSA list. Every problem in the plan links to LeetCode, where you write and submit code, and to NeetCode’s video for that problem. The 7 LeetCode-Premium problems can be solved free on NeetCode.","Curated by an ex-Google engineer; the most widely used interview list."],
   ["dsa","LeetCode contests + Top Interview 150",LCCON,"Used in week 8 for timed practice on unseen problems. Virtual contests can be taken any time. [Top Interview 150]("+LCSP+") has unseen Mediums by topic.","The standard platform interview questions come from."],
   ["lld","Hello Interview: Low-Level Design","https://www.hellointerview.com/learn/low-level-design/in-a-hurry/introduction","OOP, design principles, the LLD interview flow, a concurrency intro and free problem breakdowns.","Written by ex-FAANG hiring managers and senior engineers."],
   ["lld","Refactoring.Guru: Design patterns","https://refactoring.guru/design-patterns/catalog","The clearest free explanation of each pattern, with Java code. You only need the 12 in the plan.","Long-standing, widely recommended reference."],
   ["lld","Awesome Low-Level Design","https://github.com/ashishps1/awesome-low-level-design","Problem statements and Java reference solutions to compare against only after you’ve written your own.","The most-starred LLD collection on GitHub. It’s community-written, so treat its answers as one good answer, not the only one."],
   ["lld","Jenkov: Java concurrency","https://jenkov.com/tutorials/java-concurrency/index.html","Threads, locks, executors and concurrent collections for the “make it thread-safe” follow-ups.","A long-standing free Java reference."],
   ["hld","Hello Interview: System design","https://www.hellointerview.com/learn/system-design/in-a-hurry/introduction","Core concepts, key technologies and free problem breakdowns. Your main system design resource.","Ex-Meta and Amazon interviewers; the most up-to-date free material."],
   ["res","Official docs for your own stack","https://docs.aws.amazon.com/","[ECS]("+AWS+"AmazonECS/latest/developerguide/Welcome.html), [MSK]("+AWS+"msk/latest/developerguide/what-is-msk.html), [DocumentDB]("+AWS+"documentdb/latest/devguide/what-is.html), [CDK]("+AWS+"cdk/v2/guide/home.html), [CloudWatch]("+AWS+"AmazonCloudWatch/latest/monitoring/WhatIsCloudWatch.html), [Apache Kafka](https://kafka.apache.org/intro/), [Elastic](https://www.elastic.co/docs/deploy-manage/tools/snapshot-and-restore), [Spring Boot](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html) and [Google’s SRE book](https://sre.google/sre-book/monitoring-distributed-systems/). Used on days 27–33.","Primary sources, so nothing is lost in someone else’s retelling."],
   ["beh","Amazon Leadership Principles","https://www.amazon.jobs/content/en/our-workplace/leadership-principles","Used to shape your behavioural stories for every company, not just Amazon.","Amazon’s official page."],
   ["mock","Pramp","https://www.pramp.com/","Free peer mock interviews for DSA, system design and behavioural rounds. Pair it with mocks from friends at your target companies.","Long-running free peer-mock service."]
  ];
  document.getElementById("v-resources").innerHTML='<section class="card"><div class="secthead"><span class="icon" style="color:var(--primary)">auto_stories</span><div><span class="label">Ten sources. That’s all.</span><h1 class="headline">Resources</h1></div></div><p class="body-s" style="margin:0;max-width:70ch">Everything is already linked inside the daily plan, so you never need to browse. This page explains why each source was chosen. If you finish early, the one book worth adding is <a href="https://dataintensive.net/" target="_blank" rel="noopener"><i>Designing Data-Intensive Applications</i></a> by Martin Kleppmann.</p></section><div class="rgrid">'+
   R.map(r=>'<article class="rcard tilt"><div class="top"><span class="badge k-'+r[0]+'"><span class="icon">'+KICON[r[0]]+'</span></span><div><span class="label">'+KLABEL[r[0]]+'</span><h3><a href="'+r[2]+'" target="_blank" rel="noopener">'+esc(r[1])+'</a></h3></div></div><p>'+md(r[3])+'</p><div class="why"><span class="icon">verified</span><span>'+esc(r[4])+'</span></div><div class="tlinks">'+linkChip("Open",r[2])+'</div></article>').join("")+'</div>';
}

// ---------- routing & rendering ----------
const VIEWS=["today","plan","method","resources"], TITLES={today:"Today",plan:"60-day plan",method:"How to study",resources:"Resources"};
const REDUCED=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;
function currentView(){const h=(location.hash||"").slice(1);return h==="starred"?"today":VIEWS.includes(h)?h:"today"}
let methodDone=false,resDone=false;
function render(){
  const v=currentView();
  if(v==="today"){ renderHero(); renderTodayBody(); }
  if(v==="plan"){ renderPlan(); scrollToPending(); }
  if(v==="method"&&!methodDone){renderMethod();methodDone=true}
  if(v==="resources"&&!resDone){renderResources();resDone=true}
}
function show(){
  const v=currentView();
  VIEWS.forEach(x=>{const el=document.getElementById("v-"+x); el.hidden=x!==v; if(x===v&&!REDUCED){el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter");}});
  document.querySelectorAll(".dest").forEach(a=>{ if(a.getAttribute("href")==="#"+v) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current"); });
  document.getElementById("viewTitle").textContent=TITLES[v];
  document.title=(v==="today"?"":TITLES[v]+" · ")+"Road to SDE-2";
  render();
  Scene3D.setActive(v==="today");
  if(location.hash==="#starred") requestAnimationFrame(()=>{const e=document.getElementById("starred"); if(e) e.scrollIntoView({block:"start"});});
  else if(!pendingScroll) window.scrollTo(0,0);
}
function rerenderKeepScroll(popKey){
  const y=window.scrollY; render(); window.scrollTo(0,y);
  if(popKey&&!REDUCED) document.querySelectorAll('[data-tile="'+CSS.escape(popKey)+'"]').forEach(t=>t.classList.add("pop"));
}

// ---------- theme ----------
function themeIcon(){const t=document.documentElement.dataset.theme;return t==="dark"?"dark_mode":t==="light"?"light_mode":"contrast"}
function cycleTheme(){
  const t=document.documentElement.dataset.theme, next=!t?"light":t==="light"?"dark":"";
  if(next) document.documentElement.dataset.theme=next; else delete document.documentElement.dataset.theme;
  try{ next?localStorage.setItem("sde2-theme",next):localStorage.removeItem("sde2-theme"); }catch(e){}
  document.querySelectorAll("[data-theme-toggle] .icon").forEach(i=>i.textContent=themeIcon());
  snack(next?(next==="dark"?"Dark theme":"Light theme"):"Theme follows your system","palette");
  requestAnimationFrame(()=>Scene3D.refreshColors());
}
if(window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change",()=>Scene3D.refreshColors());

// ---------- events ----------
document.addEventListener("change",e=>{
  const k=e.target.dataset&&e.target.dataset.k; if(!k) return;
  const n=DAY_OF[k], wasComplete=n&&dayComplete(n);
  if(e.target.checked) S.done[k]=todayISO(); else delete S.done[k];
  save(); rerenderKeepScroll(e.target.checked?k:null);
  if(n&&!wasComplete&&dayComplete(n)){ const st=stats().streak; snack("Day "+n+" complete"+(st>1?" · "+st+"-day streak":"")+". Nice work.","celebration"); }
});
document.addEventListener("submit",e=>{
  if(e.target.id==="signin"){ e.preventDefault(); const v=document.getElementById("email").value.trim(); if(v) signIn(v); }
});
document.addEventListener("click",async e=>{
  const st=e.target.closest("[data-star]");
  if(st){ const s=st.dataset.star; if(S.star[s]) delete S.star[s]; else S.star[s]=true; save(); rerenderKeepScroll(); snack(S.star[s]?"Starred: it’s on your re-solve list":"Removed from your re-solve list","star"); return; }
  if(e.target.closest("#setStart")){ const v=document.getElementById("startDate").value; if(/^\d{4}-\d{2}-\d{2}$/.test(v)){ S.start=v; save(); weeksInit=false; openWeeks.clear(); render(); snack("Plan starts "+dateOf(1),"event"); } return; }
  if(e.target.closest("#signOut")&&sb){ await sb.auth.signOut(); snack("Signed out","logout"); return; }
  if(e.target.closest("[data-theme-toggle]")){ cycleTheme(); return; }
  const g=e.target.closest("[data-goto]");
  if(g){ e.preventDefault(); goToDay(+g.dataset.goto); }
});
document.addEventListener("toggle",e=>{
  const d=e.target; if(!d.classList||!d.classList.contains("week")) return;
  const w=+d.dataset.week;
  if(d.open&&!openWeeks.has(w)){ openWeeks.add(w); const cur=stats().cur, a=(w-1)*7+1,b=Math.min(w*7,TOTAL); let h=""; for(let n=a;n<=b;n++) h+=dayRow(n,cur); d.querySelector(".days").innerHTML=h; }
  else if(!d.open) openWeeks.delete(w);
},true);
// Material ripple
document.addEventListener("pointerdown",e=>{
  const el=e.target.closest(".ripple"); if(!el||REDUCED) return;
  const r=el.getBoundingClientRect(), size=Math.max(r.width,r.height)*2.2, s=document.createElement("span");
  s.className="rip"; s.style.width=s.style.height=size+"px"; s.style.left=(e.clientX-r.left-size/2)+"px"; s.style.top=(e.clientY-r.top-size/2)+"px";
  el.appendChild(s); setTimeout(()=>s.remove(),600);
});
// 3D tilt on cards (mouse only)
if(!REDUCED&&window.matchMedia&&matchMedia("(hover: hover) and (pointer: fine)").matches){
  let tiltEl=null;
  document.addEventListener("pointermove",e=>{
    const el=e.target.closest&&e.target.closest(".tilt");
    if(tiltEl&&tiltEl!==el){ tiltEl.style.transform=""; tiltEl.classList.remove("tilting"); tiltEl=null; }
    if(!el) return;
    const r=el.getBoundingClientRect(), x=(e.clientX-r.left)/r.width-.5, y=(e.clientY-r.top)/r.height-.5;
    el.style.transform="perspective(900px) rotateY("+(x*7)+"deg) rotateX("+(-y*7)+"deg) translateZ(6px)"; el.classList.add("tilting"); tiltEl=el;
  });
}
window.addEventListener("scroll",()=>document.getElementById("appbar").classList.toggle("scrolled",window.scrollY>4),{passive:true});
window.addEventListener("hashchange",show);

// ---------- start ----------
document.querySelectorAll("[data-theme-toggle] .icon").forEach(i=>i.textContent=themeIcon());
Scene3D.mount(document.getElementById("scene"),document.getElementById("sceneTip"),n=>goToDay(n),sceneTip);
show();
initStore();
