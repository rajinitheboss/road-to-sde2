// Road to SDE-2: schedule, storage (localStorage + Supabase), rendering and events.
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
function setSync(t,c){syncNote=t;syncCls=c;document.querySelectorAll("[data-sync]").forEach(el=>{el.innerHTML='<span class="dot '+c+'"></span>'+esc(t)})}
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
function accountPanel(){
  if(!sb) return '<p class="muted" style="margin:0;font-size:13.5px">Sync is off: <span class="mono">config.js</span> has no Supabase keys yet.</p>';
  if(user) return '<div class="startform"><span class="sub">Signed in as '+esc(user.email||"you")+'</span><button class="btn ghost" id="signOut">Sign out</button></div>';
  return '<form class="startform" id="signin"><label for="email" class="sub">Email</label><input type="email" id="email" required autocomplete="email" placeholder="you@example.com"><button class="btn" type="submit">Email me a sign-in link</button></form>'+(authMsg?'<p class="muted" style="margin:0;font-size:13.5px">'+esc(authMsg)+'</p>':'');
}

// ---------- helpers ----------
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function todayISO(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function dayNum(){ if(!S.start) return 0; const [y,m,d]=S.start.split("-").map(Number); const a=Date.UTC(y,m-1,d); const t=new Date(); const b=Date.UTC(t.getFullYear(),t.getMonth(),t.getDate()); return Math.floor((b-a)/864e5)+1; }
function dateOf(n){ if(!S.start) return ""; const [y,m,d]=S.start.split("-").map(Number); const x=new Date(Date.UTC(y,m-1,d+n-1)); return x.toLocaleDateString(undefined,{weekday:"short",day:"numeric",month:"short",timeZone:"UTC"}); }
const isDone=k=>!!S.done[k];
function dayComplete(n){return itemsFor(n).every(isDone)}
function stats(){
  const solved=NC.filter(p=>isDone("p:"+p[0])).length;
  let design=0; for(let n=1;n<=TOTAL;n++) if(isDone("d"+n+":design")) design++;
  let full=0; for(let n=1;n<=TOTAL;n++) if(dayComplete(n)) full++;
  const cur=Math.min(Math.max(dayNum(),0),TOTAL);
  let due=0,doneDue=0; for(let n=1;n<=cur;n++){ itemsFor(n).forEach(k=>{due++; if(isDone(k)) doneDue++;}); }
  let streak=0; for(let n=cur;n>=1;n--){ if(dayComplete(n)) streak++; else if(n===cur) continue; else break; }
  return {solved,design,full,cur,due,doneDue,streak};
}

// ---------- rendering ----------
function chip(k){return '<span class="chip k-'+k+'">'+KLABEL[k]+'</span>'}
function probRow(i){
  const p=NC[i], k="p:"+p[0], dn=isDone(k), st=!!S.star[p[0]];
  const dl={E:"Easy",M:"Medium",H:"Hard"}[p[2]];
  return '<div class="item'+(dn?' done':'')+'"><input type="checkbox" id="cb-'+esc(k)+'" data-k="'+esc(k)+'"'+(dn?' checked':'')+' aria-label="Solved '+esc(p[1])+'">'+
  '<div><label class="ttl" for="cb-'+esc(k)+'">'+esc(p[1])+'</label><div class="meta"><span class="diff '+p[2]+'">'+dl+'</span><span>'+esc(p[3])+'</span>'+
  '<a href="'+LC(p[0])+'" target="_blank" rel="noopener">Solve on LeetCode</a><a href="'+YT(p[4])+'" target="_blank" rel="noopener">NeetCode video</a>'+
  (p[5]?'<span>LeetCode Premium. Solve free on <a href="https://neetcode.io/practice" target="_blank" rel="noopener">NeetCode</a></span>':'')+'</div></div>'+
  '<button class="star" data-star="'+esc(p[0])+'" aria-pressed="'+st+'" title="Star to re-solve later" aria-label="Star '+esc(p[1])+' to re-solve later">'+(st?'★':'☆')+'</button></div>';
}
function taskRow(key,kind,title,desc,links,qs,open){
  const dn=isDone(key);
  return '<div class="item'+(dn?' done':'')+'"><input type="checkbox" id="cb-'+key+'" data-k="'+key+'"'+(dn?' checked':'')+' aria-label="Done: '+esc(title)+'">'+
  '<div><div class="blockhead">'+chip(kind)+'<label class="ttl" for="cb-'+key+'">'+esc(title)+'</label></div>'+
  (desc?'<p class="desc">'+esc(desc)+'</p>':'')+
  (links&&links.length?'<div class="links">'+links.map(l=>'<a href="'+l[1]+'" target="_blank" rel="noopener">'+esc(l[0])+'</a>').join("")+'</div>':'')+
  (qs&&qs.length?(open?'<div class="sub" style="margin-top:8px">Check yourself, answer out loud:</div><ul class="qs">'+qs.map(q=>'<li>'+esc(q)+'</li>').join("")+'</ul>':'<details class="qd"><summary>Check-yourself questions</summary><ul class="qs">'+qs.map(q=>'<li>'+esc(q)+'</li>').join("")+'</ul></details>'):'')+
  '</div><span></span></div>';
}
function dayBlocks(n,open){
  const d=dsaFor(n), g=DESIGN[n-1];
  let h='<div class="block"><div class="blockhead">'+chip("dsa")+'<h3>DSA in C++</h3><span class="time">~90 min</span></div>';
  if(d.probs) h+=d.probs.map(probRow).join(""); else h+=taskRow("d"+n+":dsa","dsa",d.late.t,"",d.late.l,null,open);
  h+='</div><div class="block"><div class="blockhead"><h3>'+(g.k==="lld"?"Design in Java":g.k==="hld"?"System design":g.k==="res"?"Revise your own work":g.k==="beh"?"Behavioural":"Practice")+'</h3><span class="time">~80 min'+(CAREER[n]?' (incl. 20-min career task)':'')+'</span></div>';
  h+=taskRow("d"+n+":design",g.k,g.t,g.d,g.l,g.q,open);
  if(CAREER[n]) h+=taskRow("d"+n+":career","car",CAREER[n],"",n===48?[["levels.fyi","https://www.levels.fyi/"]]:[],null,open);
  return h+'</div>';
}
function startForm(label){
  return '<div class="startform"><label for="startDate" class="sub">'+label+'</label><input type="date" id="startDate" value="'+(S.start||todayISO())+'"><button class="btn" id="setStart">'+(S.start?"Change start date":"Start the plan")+'</button></div>';
}
function renderToday(){
  const el=document.getElementById("v-today"); const s=stats();
  if(!S.start){
    el.innerHTML='<div class="panel stack"><span class="eyebrow">Day 0</span><h1>60 days to an SDE-2 offer</h1><p class="prose muted">3 hours a day: about 90 minutes of DSA in C++, then about 80 minutes of design in Java, system design, or revising your own work. Pick the day you start; the page then shows you exactly what to do each day and keeps your ticks. Sign in to sync them across devices.</p>'+startForm("Start date")+accountPanel()+'<div class="status" data-sync><span class="dot '+syncCls+'"></span>'+esc(syncNote)+'</div></div>';
    return;
  }
  const n=s.cur; const pct=s.due?Math.round(100*s.doneDue/s.due):100;
  const pace = n<1?'<span class="pace">Starts '+esc(dateOf(1))+'</span>' : (s.due-s.doneDue)===0?'<span class="pace ok">On schedule</span>':'<span class="pace warn">'+(s.due-s.doneDue)+' task'+(s.due-s.doneDue>1?'s':'')+' behind</span>';
  let h='<div class="stats">'+
   '<div class="stat"><span class="eyebrow">NeetCode 150</span><div class="v mono">'+s.solved+'<span> / 150</span></div><div class="bar"><i style="width:'+(s.solved/1.5)+'%"></i></div></div>'+
   '<div class="stat"><span class="eyebrow">Design sessions</span><div class="v mono">'+s.design+'<span> / 60</span></div><div class="bar"><i style="width:'+(s.design/0.6)+'%"></i></div></div>'+
   '<div class="stat"><span class="eyebrow">Due so far, done</span><div class="v mono">'+pct+'<span>%</span></div><div class="bar"><i style="width:'+pct+'%"></i></div></div>'+
   '<div class="stat"><span class="eyebrow">Streak</span><div class="v mono">'+s.streak+'<span> day'+(s.streak===1?'':'s')+'</span></div><div class="muted" style="font-size:12.5px">full days in a row</div></div></div>';
  if(n>=1&&n<=TOTAL){
    h+='<div class="panel"><div class="dayhead"><div><span class="eyebrow">'+esc(dateOf(n))+' · Week '+Math.ceil(n/7)+'</span><h1>Day '+n+' <span class="muted" style="font-weight:500">of 60</span></h1></div>'+pace+'</div>'+dayBlocks(n,true)+'</div>';
    // catch-up list
    const missed=[]; for(let i=1;i<n;i++) if(!dayComplete(i)) missed.push(i);
    if(missed.length) h+='<div class="panel"><h2>Unfinished earlier days</h2><p class="muted" style="margin:6px 0 0">Don\'t try to clear all of these at once. Do today first; use the 10-minute warm-up and any spare time for these. Days: '+missed.slice(0,20).map(i=>'<a href="#plan" data-goto="'+i+'">'+i+'</a>').join(", ")+(missed.length>20?" …":"")+'</p></div>';
  } else if(n<1){
    h+='<div class="panel"><h1>Your plan starts '+esc(dateOf(1))+'</h1><p class="muted">Until then, read <a href="#method">How to study</a> and set up LeetCode and a Java project for LLD.</p></div>';
  } else {
    h+='<div class="panel"><h1>All 60 days are behind you</h1><p class="prose">Keep the maintenance rhythm until you sign: 2 problems, 1 design redo, and prep for the next company on your calendar. Check the <a href="#plan">plan</a> for anything unticked.</p></div>';
  }
  h+='<div class="panel stack" style="gap:10px"><h3>Your progress</h3><div class="status" data-sync><span class="dot '+syncCls+'"></span>'+esc(syncNote)+'</div>'+accountPanel()+startForm("Plan start date")+'</div>';
  el.innerHTML=h;
}
function renderPlan(){
  const el=document.getElementById("v-plan"); const cur=stats().cur;
  let h='<div class="stack" style="gap:6px"><span class="eyebrow">9 weeks · 150 DSA problems · 60 design sessions</span><h1>The 60-day plan</h1><p class="muted prose">Each day has a DSA block and one design or revision session. Weeks open by default up to the current one. Tick things off here or on Today.</p></div>';
  for(let w=1;w<=9;w++){
    const a=(w-1)*7+1,b=Math.min(w*7,TOTAL); let tot=0,dn=0; const cats=new Set(), kinds=[];
    for(let n=a;n<=b;n++){ itemsFor(n).forEach(k=>{tot++; if(isDone(k)) dn++;}); const d=dsaFor(n); if(d.probs) d.probs.forEach(i=>cats.add(NC[i][3])); }
    const open = !S.start ? w===1 : (cur>=a && cur<=b) || (cur<a && w===1);
    h+='<details class="week" '+(open?'open':'')+' data-week="'+w+'"><summary><h2>Week '+w+'</h2><span class="muted" style="font-size:13px">Days '+a+'–'+b+(cats.size?' · '+esc([...cats].join(", ")):' · timed practice and contests')+'</span><span class="wk-prog">'+dn+'/'+tot+'</span></summary>';
    for(let n=a;n<=b;n++){
      h+='<div class="dayrow'+(n===cur?' today':'')+'" id="day-'+n+'"><div class="dnum">Day<b>'+n+'</b>'+(S.start?esc(dateOf(n)):'')+(dayComplete(n)?'<div class="full">✓ done</div>':'')+'</div><div class="daycol">'+dayBlocks(n,false)+'</div></div>';
    }
    h+='</details>';
  }
  el.innerHTML=h;
}
function renderMethod(){
  document.getElementById("v-method").innerHTML=`
  <div class="stack" style="gap:6px"><span class="eyebrow">Read this once, then every Sunday</span><h1>How to study</h1></div>
  <div class="panel prose"><h2>What the SDE-2 bar is</h2>
   <ul><li><b>DSA:</b> solve an unseen Medium in about 25 minutes, explain the approach first, and state the time and space complexity.</li>
   <li><b>LLD / machine coding:</b> turn a vague problem into clean, extensible, working Java in 60–90 minutes. Indian unicorns weight this heavily.</li>
   <li><b>HLD:</b> lead a 45-minute design: requirements, API, data model, architecture, then deep dives on scale and failure. Big tech weights this heavily at SDE-2.</li>
   <li><b>Your experience:</b> explain every line on your resume in depth. Your migration and BCP work are strong material, but only if you can defend the details.</li>
   <li><b>Behavioural:</b> clear stories of ownership and impact, told with "I".</li></ul></div>
  <div class="panel"><h2>Your 3 hours</h2><table class="sched"><tbody>
   <tr><td>0:00–0:10</td><td><b>Warm-up.</b> Re-solve one ★ starred problem from memory, or skim yesterday's notes.</td></tr>
   <tr><td>0:10–1:40</td><td><b>DSA block.</b> The day's 3 problems in C++.</td></tr>
   <tr><td>1:40–1:50</td><td><b>Break.</b> Step away from the screen.</td></tr>
   <tr><td>1:50–3:00</td><td><b>Design block.</b> The day's LLD, HLD, resume or behavioural session. Career tasks (some days) take 20 minutes of this.</td></tr>
  </tbody></table></div>
  <div class="panel prose"><h2>DSA method (C++)</h2><ol>
   <li>Read the problem, write 2 edge cases, and say the brute force out loud.</li>
   <li>Give yourself <b>25 minutes</b> to code it with no help.</li>
   <li>Stuck? Watch only the first part of the NeetCode video (the idea, not the code) and try again.</li>
   <li>At <b>40 minutes</b>, watch the full solution, close it, and code it yourself from memory.</li>
   <li>If you needed help, <b>★ star</b> it. Re-solve starred problems in the warm-up 3–7 days later.</li>
   <li>Hard problems can run long. If one eats your block, move the rest to tomorrow's warm-up rather than skipping them.</li></ol>
   <p class="muted">C++ to have ready: <span class="mono">vector, unordered_map, unordered_set, map, set, priority_queue (min-heap with greater&lt;&gt;), deque, stack, sort with a lambda, pair, auto&amp;</span>.</p></div>
  <div class="panel prose"><h2>Design method (Java)</h2><ul>
   <li><b>LLD:</b> always clarify requirements first, draw the class diagram, then code. Code must run. Then ask yourself "how would I add X?" and check you'd only add classes, not edit them.</li>
   <li><b>HLD:</b> try every problem on paper for 40 minutes <b>before</b> reading the breakdown. Reading without trying first feels productive but doesn't stick.</li>
   <li><b>Your resume days:</b> read the official docs, then write answers to the check-yourself questions in your own words. Where you don't know what your team did, ask a teammate this week while you still work there.</li></ul></div>
  <div class="panel prose"><h2>When to apply</h2><p>Interview loops usually take 2–6 weeks from first call. So: practice-tier applications around <b>day 27</b>, dream-tier referrals around <b>day 34</b>. Your strongest weeks (7–9) then line up with the interviews that matter most. These steps are already in the plan as career tasks.</p></div>
  <div class="callout">If you fall behind, don't skip days to catch up. Keep going from today and fold missed problems into the warm-up. Doing every day partly beats doing some days perfectly.</div>`;
}
function renderResources(){
  const R=[
   ["dsa","NeetCode 150 + LeetCode","https://neetcode.io/practice","Your only DSA list. Every problem in the plan links to LeetCode, where you write and submit code, and to NeetCode's video for that problem. The 7 LeetCode-Premium problems can be solved free on NeetCode.","Curated by an ex-Google engineer and the most widely used interview list."],
   ["dsa","LeetCode contests and Top Interview 150",LCCON,"Used in week 8 for timed practice on unseen problems (virtual contests can be taken any time).","The standard platform interviewers draw from."],
   ["lld","Hello Interview: Low-Level Design","https://www.hellointerview.com/learn/low-level-design/in-a-hurry/introduction","OOP, design principles, the LLD interview flow, concurrency intro and some free problem breakdowns.","Written by ex-FAANG hiring managers and senior engineers."],
   ["lld","Refactoring.Guru: Design patterns","https://refactoring.guru/design-patterns/catalog","The clearest free explanation of each pattern, with Java code. Only the 12 patterns in the plan.","Long-standing, widely recommended reference."],
   ["lld","Awesome Low-Level Design (GitHub)","https://github.com/ashishps1/awesome-low-level-design","Used only for problem statements and Java reference solutions to compare against after you've written your own.","The most-starred LLD problem collection on GitHub. It's community-written, so treat its solutions as one good answer, not the only one."],
   ["lld","Jenkov: Java concurrency","https://jenkov.com/tutorials/java-concurrency/index.html","Threads, locks, executors and concurrent collections for the 'make it thread-safe' follow-ups.","A long-standing free Java reference."],
   ["hld","Hello Interview: System design","https://www.hellointerview.com/learn/system-design/in-a-hurry/introduction","Core concepts, key technologies and 13 free problem breakdowns. Your main HLD resource.","Ex-Meta and Amazon interviewers; the most up-to-date free HLD material."],
   ["res","Official docs for your own stack","https://docs.aws.amazon.com/","AWS (ECS, MSK, DocumentDB, CDK, CloudWatch, DR whitepaper), Apache Kafka, Elastic, Spring Boot, and Google's SRE book. Linked on days 27–33.","Primary sources, so nothing gets lost in a blog's retelling."],
   ["beh","Amazon Leadership Principles","https://www.amazon.jobs/content/en/our-workplace/leadership-principles","Used to shape your behavioural stories.","Amazon's official page."],
   ["mock","Pramp","https://www.pramp.com/","Free peer mock interviews (DSA, system design, behavioural). Pair it with mocks from friends who already work at your target companies.","Long-running free peer-mock service, now run by Exponent/Aced."]
  ];
  document.getElementById("v-resources").innerHTML='<div class="stack" style="gap:6px"><span class="eyebrow">Ten sources. That\'s all.</span><h1>Resources</h1><p class="muted prose">Everything you need is linked inside the daily plan, so you don\'t need to browse. This page explains why each source was picked. Optional books, only if you finish early: <i>Designing Data-Intensive Applications</i> (Kleppmann) for depth on databases and distributed systems.</p></div><div class="rgrid">'+
   R.map(r=>'<div class="panel res"><h3>'+chip(r[0])+'<a href="'+r[2]+'" target="_blank" rel="noopener">'+esc(r[1])+'</a></h3><p>'+esc(r[3])+'</p><div class="why">Why trust it: '+esc(r[4])+'</div></div>').join("")+'</div>';
}
let methodDone=false,resDone=false;
function render(){
  const v=currentView();
  if(v==="today") renderToday();
  if(v==="plan") renderPlan();
  if(v==="method"&&!methodDone){renderMethod();methodDone=true}
  if(v==="resources"&&!resDone){renderResources();resDone=true}
}
const VIEWS=["today","plan","method","resources"];
function currentView(){const h=(location.hash||"").slice(1);return VIEWS.includes(h)?h:"today"}
function show(){
  const v=currentView();
  VIEWS.forEach(x=>{document.getElementById("v-"+x).hidden=x!==v});
  document.querySelectorAll("nav.tabs a").forEach(a=>{ if(a.getAttribute("href")==="#"+v) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current"); });
  render();
}
// ---------- events ----------
document.addEventListener("change",e=>{
  const k=e.target.dataset&&e.target.dataset.k; if(!k) return;
  if(e.target.checked) S.done[k]=todayISO(); else delete S.done[k];
  save(); const y=window.scrollY; render(); window.scrollTo(0,y);
});
document.addEventListener("click",e=>{
  const st=e.target.closest("[data-star]");
  if(st){ const s=st.dataset.star; if(S.star[s]) delete S.star[s]; else S.star[s]=true; save(); const y=window.scrollY; render(); window.scrollTo(0,y); return; }
  if(e.target.id==="setStart"){ const v=document.getElementById("startDate").value; if(/^\d{4}-\d{2}-\d{2}$/.test(v)){ S.start=v; save(); render(); } return; }
  const g=e.target.closest("[data-goto]");
  if(g){ const n=+g.dataset.goto; setTimeout(()=>{ const w=document.querySelector('details[data-week="'+Math.ceil(n/7)+'"]'); if(w) w.open=true; const r=document.getElementById("day-"+n); if(r) r.scrollIntoView({block:"start"}); },50); }
});
document.addEventListener("submit",e=>{
  if(e.target.id==="signin"){ e.preventDefault(); const v=document.getElementById("email").value.trim(); if(v) signIn(v); }
});
document.addEventListener("click",async e=>{
  if(e.target.id==="signOut"&&sb){ await sb.auth.signOut(); }
});
window.addEventListener("hashchange",show);
show();
initStore();
