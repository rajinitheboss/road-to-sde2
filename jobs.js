// Road to SDE-2 · /jobs: your private job leads.
// Nothing here is in the repo: postings live in the Supabase table `jobs` and resumes in the private
// storage bucket `resumes`, both readable only by your signed-in account (see supabase/migrations/002_jobs.sql).
// You fill them with "Import from laptop", which reads the folder made by ~/Documents/sde2-prep/jobs/tailor.py.

const STATUSES = [["new", "New"], ["applied", "Applied"], ["interviewing", "Interviewing"], ["offer", "Offer"], ["rejected", "Rejected"], ["skipped", "Not applying"]];
const FILTERS = [["all", "All open"], ["fresh", "New this search"], ["hyd", "Hyderabad"], ["remote", "Remote"], ["pay", "Pay ≥ ₹34L (stated or likely)"], ["new", "Not applied yet"], ["active", "Applied / interviewing"], ["closed", "Closed"]];
const REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

let sb = null, user = null, rows = [], loading = true, authMsg = "", importing = "", filter = "all", query = "";

// ---------- helpers ----------
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = u => (/^https?:\/\//i.test(u || "") ? u : "");
let snackT = 0;
function snack(msg, icon) {
  const el = document.getElementById("snackbar");
  el.innerHTML = (icon ? `<span class="icon">${icon}</span>` : "") + `<span>${esc(msg)}</span>`;
  el.classList.add("show"); clearTimeout(snackT); snackT = setTimeout(() => el.classList.remove("show"), 3800);
}
async function hashKey(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ---------- data ----------
async function load() {
  loading = true; render();
  const { data, error } = await sb.from("jobs").select("key,data,status,notes,updated_at");
  loading = false;
  if (error) { rows = []; render(); snack("Couldn't load your jobs: " + error.message, "error"); return; }
  rows = data.sort((a, b) => (!!a.data.closed - !!b.data.closed) || (a.data.id || 999) - (b.data.id || 999));
  render();
}
async function setStatus(key, status) {
  const r = rows.find(x => x.key === key); if (!r) return;
  const old = r.status; r.status = status; render();
  const { error } = await sb.from("jobs").update({ status, updated_at: new Date().toISOString() }).eq("user_id", user.id).eq("key", key);
  if (error) { r.status = old; render(); snack("Couldn't save: " + error.message, "error"); }
  else snack(`${r.data.company}: ${STATUSES.find(s => s[0] === status)[1]}`, "check_circle");
}
async function setNotes(key, notes) {
  const r = rows.find(x => x.key === key); if (!r || r.notes === notes) return;
  r.notes = notes;
  const { error } = await sb.from("jobs").update({ notes, updated_at: new Date().toISOString() }).eq("user_id", user.id).eq("key", key);
  snack(error ? "Couldn't save the note: " + error.message : "Note saved", error ? "error" : "edit_note");
}
async function openResume(path) {
  const w = window.open("", "_blank"); // open now so pop-up blockers allow it
  const { data, error } = await sb.storage.from("resumes").createSignedUrl(path, 600);
  if (error || !data) { if (w) w.close(); snack("Couldn't open the resume: " + (error ? error.message : "not found"), "error"); return; }
  if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
}

// Import: pick the ~/Documents/sde2-prep/jobs folder; uploads jobs.json data, resume PDFs and email drafts.
async function importFolder(fileList) {
  const files = [...fileList];
  const byPath = new Map(files.map(f => [f.webkitRelativePath || f.name, f]));
  const jsonFile = files.filter(f => f.name === "jobs.json").sort((a, b) => (a.webkitRelativePath || "").length - (b.webkitRelativePath || "").length)[0];
  if (!jsonFile) { snack("No jobs.json in that folder. Pick ~/Documents/sde2-prep/jobs.", "error"); return; }
  const root = (jsonFile.webkitRelativePath || "").replace(/jobs\.json$/, "");
  let jobs;
  try { jobs = JSON.parse(await jsonFile.text()); } catch (e) { snack("jobs.json couldn't be read.", "error"); return; }
  if (!Array.isArray(jobs) || !jobs.length) { snack("jobs.json has no jobs.", "error"); return; }

  const out = []; let done = 0, missing = 0;
  for (const j of jobs) {
    importing = `Uploading ${++done} of ${jobs.length}…`; render();
    const key = j.url;
    if (!key) continue;
    const data = { ...j }; delete data._file;
    const pdf = byPath.get(root + (j.resume || ""));
    if (pdf) {
      const path = `${user.id}/${await hashKey(key)}.pdf`;
      const { error } = await sb.storage.from("resumes").upload(path, pdf, { upsert: true, contentType: "application/pdf" });
      if (error) { importing = ""; render(); snack("Upload failed: " + error.message, "error"); return; }
      data.resume_path = path; data.resume_name = j.resume.split("/").pop();
    } else missing++;
    const cov = j.cover_pdf && byPath.get(root + j.cover_pdf);
    if (cov) {
      const path = `${user.id}/${await hashKey(key)}-cover.pdf`;
      const { error } = await sb.storage.from("resumes").upload(path, cov, { upsert: true, contentType: "application/pdf" });
      if (error) { importing = ""; render(); snack("Upload failed: " + error.message, "error"); return; }
      data.cover_path = path;
    }
    const mail = j.email_draft && byPath.get(root + j.email_draft);
    if (mail) data.email_text = await mail.text();
    out.push({ user_id: user.id, key, data, imported_at: new Date().toISOString() });
  }
  // Postings you imported before that the latest build dropped (closed, stale…) are marked closed, keeping your status and notes.
  const dropFile = byPath.get(root + "dropped.json");
  if (dropFile) {
    let dropped = [];
    try { dropped = JSON.parse(await dropFile.text()); } catch (e) {}
    const inImport = new Set(out.map(o => o.key));
    for (const x of Array.isArray(dropped) ? dropped : []) {
      const old = x && x.url && !inImport.has(x.url) && rows.find(r => r.key === x.url);
      if (old && !old.data.closed) out.push({ user_id: user.id, key: old.key, data: { ...old.data, closed: (x.why || []).join("; ") || "dropped", new_this_run: false }, imported_at: new Date().toISOString() });
    }
  }
  importing = "Saving the list…"; render();
  for (let i = 0; i < out.length; i += 50) {
    // status and notes aren't sent, so re-importing keeps them
    const { error } = await sb.from("jobs").upsert(out.slice(i, i + 50), { onConflict: "user_id,key" });
    if (error) { importing = ""; render(); snack("Saving failed: " + error.message, "error"); return; }
  }
  importing = "";
  snack(`Imported ${jobs.length} jobs` + (missing ? ` (${missing} without a resume file)` : ""), "cloud_done");
  await load();
}

// ---------- rendering ----------
function matches(r) {
  const d = r.data, loc = (d.location || "").toLowerCase();
  if ((filter === "closed") !== !!d.closed) return false;
  if (filter === "fresh" && !d.new_this_run) return false;
  if (filter === "hyd" && !loc.includes("hyderabad")) return false;
  if (filter === "remote" && d.work_mode !== "remote") return false;
  if (filter === "pay" && !["yes", "likely"].includes(d.pay_meets_34L)) return false;
  if (filter === "new" && r.status !== "new") return false;
  if (filter === "active" && !["applied", "interviewing", "offer"].includes(r.status)) return false;
  if (query) {
    const hay = [d.company, d.title, d.location, (d.fit && d.fit.matched || []).join(" ")].join(" ").toLowerCase();
    if (!query.toLowerCase().split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}
function payPill(d) {
  const v = d.pay_meets_34L || "unknown";
  const cls = v === "yes" ? "ok" : v === "likely" ? "likely" : "unk";
  const label = v === "yes" ? "Pay ≥ ₹34L stated" : v === "likely" ? "Pay likely ≥ ₹34L" : "Pay unknown";
  return `<span class="jpill ${cls}">${label}</span>`;
}
function jobCard(r) {
  const d = r.data, fit = d.fit || { matched: [], gaps: [], match_pct: null };
  const url = safeUrl(d.url), apply = safeUrl(d.apply_url), paySrc = safeUrl(d.pay_estimate_source);
  const hyd = (d.location || "").toLowerCase().includes("hyderabad");
  return `<article class="jcard${hyd ? " hyd" : ""}" data-key="${esc(r.key)}">
  <div class="jtop">
    <div class="jlogo">${esc((d.company || "?").trim()[0])}</div>
    <div class="jhead">
      <span class="label">${d.closed ? '<span class="jpill unk">Closed</span> ' : d.new_this_run ? '<span class="jpill ok">New</span> ' : ""}${esc(d.company)}${hyd ? ' · <span style="color:var(--primary)">Hyderabad</span>' : ""}</span>
      <h3 class="title">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(d.title)}</a>` : esc(d.title)}</h3>
      <div class="tmeta"><span><span class="icon" style="font-size:16px;vertical-align:-3px">location_on</span> ${esc(d.location)}</span><span>${esc(d.work_mode || "")}</span><span>${esc(d.years_text || (d.min_years != null ? d.min_years + "+ yrs" : ""))}</span><span>posted ${esc(d.posted || "?")}</span>${d.first_seen ? `<span>found ${esc(d.first_seen)}</span>` : ""}</div>
    </div>
    <div class="jmatch" title="Share of the posting's skills that are on your resume">${fit.match_pct != null ? fit.match_pct + "%" : "–"}<small>match</small></div>
  </div>
  ${d.closed ? `<div class="callout" style="padding:10px 14px"><span class="icon fill">block</span><span>No longer listed: ${esc(d.closed)}</span></div>` : ""}
  ${d.warning ? `<div class="callout" style="padding:10px 14px"><span class="icon fill">warning</span><span>${esc(d.warning)}</span></div>` : ""}
  <div class="jrow">${payPill(d)}<span class="body-s">${esc(d.pay_stated || d.pay_estimate || "No pay information")}${paySrc ? ` · <a href="${esc(paySrc)}" target="_blank" rel="noopener">source</a>` : ""}</span></div>
  <div class="jrow"><span class="jpill ${d.india_eligible === "yes" ? "ok" : "unk"}">India: ${esc(d.india_eligible)}</span><span class="body-s q">${esc(d.eligibility_evidence)}</span></div>
  ${fit.gaps && fit.gaps.length ? `<div class="jrow"><span class="body-s">Not on your resume:</span>${fit.gaps.map(g => `<span class="tag k-mock">${esc(g)}</span>`).join("")}</div>` : ""}
  ${d.notes ? `<details class="quiz"><summary><span class="icon" style="font-size:18px">info</span>Search notes<span class="icon chev">expand_more</span></summary><p class="body-s" style="margin:0;padding:4px 14px 12px">${esc(d.notes)}</p></details>` : ""}
  ${d.cover_letter ? `<details class="quiz"><summary><span class="icon" style="font-size:18px">edit_note</span>Cover letter for this job${(d.cover_check || []).length ? ' <span class="jpill unk">read before sending</span>' : ""}<span class="icon chev">expand_more</span></summary>${(d.cover_check || []).length ? `<p class="body-s" style="margin:0;padding:4px 14px 0;color:var(--error, #b3261e)">Check: ${esc(d.cover_check.join("; "))}</p>` : ""}<pre class="jmail letter">${esc(d.cover_letter)}</pre><div style="padding:0 12px 12px"><button class="btn tonal ripple" data-copy="${esc(r.key)}" data-what="cover_letter"><span class="icon">content_copy</span>Copy text</button></div></details>`
    : d.cover_note ? `<details class="quiz"><summary><span class="icon" style="font-size:18px">edit_note</span>Short note (for a referral request)<span class="icon chev">expand_more</span></summary><pre class="jmail">${esc(d.cover_note)}</pre><div style="padding:0 12px 12px"><button class="btn tonal ripple" data-copy="${esc(r.key)}" data-what="cover_note"><span class="icon">content_copy</span>Copy text</button></div></details>` : ""}
  ${d.email_text ? `<details class="quiz"><summary><span class="icon" style="font-size:18px">mail</span>Email draft to ${esc(d.contact_email)}<span class="icon chev">expand_more</span></summary><pre class="jmail">${esc(d.email_text)}</pre><div style="padding:0 12px 12px"><button class="btn tonal ripple" data-copy="${esc(r.key)}" data-what="email_text"><span class="icon">content_copy</span>Copy text</button></div></details>` : ""}
  ${(d.referrals || []).length ? `<div class="jrow"><span class="body-s">Ask for a referral:</span>${d.referrals.filter(x => safeUrl(x.url)).map(x => `<a class="chip ripple" href="${esc(x.url)}" target="_blank" rel="noopener"><span class="icon">group</span><span class="t">${esc(x.label)}</span></a>`).join("")}</div>` : ""}
  <div class="jactions">
    ${d.resume_path ? `<button class="btn filled ripple" data-resume="${esc(d.resume_path)}"><span class="icon">description</span>Tailored resume</button>` : ""}
    ${d.cover_path ? `<button class="btn tonal ripple" data-resume="${esc(d.cover_path)}"><span class="icon">article</span>Cover letter PDF</button>` : ""}
    ${url ? `<a class="btn outlined ripple" href="${esc(url)}" target="_blank" rel="noopener"><span class="icon">open_in_new</span>Posting</a>` : ""}
    ${apply && apply !== url ? `<a class="btn outlined ripple" href="${esc(apply)}" target="_blank" rel="noopener"><span class="icon">send</span>Apply</a>` : ""}
    <label class="jstatus"><span class="sr">Status</span><select class="input" data-status="${esc(r.key)}">${STATUSES.map(([v, l]) => `<option value="${v}"${r.status === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
  </div>
  <label class="field"><span class="sr">Your notes</span><textarea class="input jnotes" rows="2" placeholder="Your notes: referral asked, recruiter name, interview date…" data-notes="${esc(r.key)}">${esc(r.notes)}</textarea></label>
</article>`;
}
function signInCard() {
  if (!sb) return `<section class="card"><h2>Sync isn't set up</h2><p class="body-s">config.js has no Supabase keys, so the private jobs page can't load.</p></section>`;
  return `<section class="card" style="max-width:560px">
    <div class="secthead"><span class="icon" style="color:var(--primary)">lock</span><div><span class="label">Private</span><h1 class="headline">Your job leads</h1></div></div>
    <p class="body-s" style="margin:0 0 16px">This page only shows anything to its owner. Sign in with the email you use for your study tracker.</p>
    <form class="formrow" id="signin"><div class="field"><label for="email">Email</label><input class="input" type="email" id="email" required autocomplete="email" placeholder="you@example.com"></div><button class="btn filled ripple" type="submit"><span class="icon">mail</span>Email me a link</button></form>
    ${authMsg ? `<p class="body-s" style="margin:12px 0 0">${esc(authMsg)}</p>` : ""}
  </section>`;
}
function render() {
  const el = document.getElementById("jobsView");
  if (!user) { el.innerHTML = loading && sb ? `<p class="body-s">Loading…</p>` : signInCard(); return; }
  const open = rows.filter(r => !r.data.closed).length, fresh = rows.filter(r => !r.data.closed && r.data.new_this_run).length;
  const counts = { all: rows.length, applied: rows.filter(r => r.status === "applied").length, interviewing: rows.filter(r => r.status === "interviewing").length, offer: rows.filter(r => r.status === "offer").length };
  const shown = rows.filter(matches);
  const importBtn = `<label class="btn ${rows.length ? "outlined" : "filled"} ripple" for="folder" style="cursor:pointer"><span class="icon">drive_folder_upload</span>${rows.length ? "Re-import from laptop" : "Import from laptop"}</label><input type="file" id="folder" webkitdirectory directory multiple hidden>`;
  let h = `<section class="card">
    <div class="secthead"><span class="icon" style="color:var(--primary)">work</span><div><span class="label">Private · ${esc(user.email || "")}</span><h1 class="headline">Job leads</h1></div></div><div class="jhead-actions">${importBtn}<button class="btn outlined ripple" id="signOut"><span class="icon">logout</span>Sign out</button></div>
    ${importing ? `<div class="status"><span class="icon">cloud_upload</span><span>${esc(importing)}</span></div>` : ""}
    ${rows.length ? `<div class="jstats"><div><b>${fresh}</b><span>new</span></div><div><b>${open}</b><span>open</span></div><div><b>${counts.applied}</b><span>applied</span></div><div><b>${counts.interviewing}</b><span>interviewing</span></div><div><b>${counts.offer}</b><span>offers</span></div></div>` :
      `<p class="body-s" style="margin:0">No jobs yet. On your laptop, click <b>Import from laptop</b> and choose the folder <span class="mono">Documents/sde2-prep/jobs</span>. The list and the tailored resumes upload to your private Supabase storage, and then this page works on your phone too.</p>`}
  </section>`;
  if (rows.length) {
    h += `<div class="jfilters"><div class="tlinks">${FILTERS.map(([v, l]) => `<button class="chip ripple${filter === v ? " on" : ""}" data-filter="${v}">${filter === v ? '<span class="icon">check</span>' : ""}<span class="t">${l}</span></button>`).join("")}</div>
      <label class="field" style="flex:1 1 220px"><span class="sr">Search</span><input class="input" id="q" type="search" placeholder="Search company, role, skill…" value="${esc(query)}"></label></div>
      <p class="body-s" style="margin:0">${shown.length} of ${rows.length} shown. Pay marked “likely” is an estimate, so confirm it with the recruiter. Read each resume before you send it.</p>
      <div class="jlist">${shown.map(jobCard).join("") || '<p class="body-s">No jobs match this filter.</p>'}</div>`;
  }
  el.innerHTML = h;
}

// ---------- events ----------
document.addEventListener("submit", async e => {
  if (e.target.id !== "signin") return;
  e.preventDefault();
  const email = document.getElementById("email").value.trim(); if (!email) return;
  authMsg = "Sending…"; render();
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + "/jobs" } });
  authMsg = error ? "Couldn't send the link: " + error.message : `Check ${email} for a sign-in link, and open it in this browser.`;
  render();
});
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-resume],[data-filter],[data-copy],#signOut,[data-theme-toggle]");
  if (!t) return;
  if (t.dataset.resume) openResume(t.dataset.resume);
  else if (t.dataset.filter) { filter = t.dataset.filter; render(); }
  else if (t.dataset.copy) {
    const r = rows.find(x => x.key === t.dataset.copy);
    try { await navigator.clipboard.writeText(r.data[t.dataset.what] || ""); snack("Copied", "content_copy"); } catch (err) { snack("Copy failed: select the text instead", "error"); }
  } else if (t.id === "signOut") { await sb.auth.signOut(); }
  else if (t.hasAttribute("data-theme-toggle")) cycleTheme();
});
document.addEventListener("change", e => {
  if (e.target.dataset.status) setStatus(e.target.dataset.status, e.target.value);
  else if (e.target.dataset.notes !== undefined) setNotes(e.target.dataset.notes, e.target.value);
  else if (e.target.id === "folder" && e.target.files.length) importFolder(e.target.files);
});
document.addEventListener("input", e => {
  if (e.target.id === "q") { query = e.target.value; const pos = e.target.selectionStart; render(); const q = document.getElementById("q"); q.focus(); q.setSelectionRange(pos, pos); }
});
document.addEventListener("pointerdown", e => {
  const el = e.target.closest(".ripple"); if (!el || REDUCED) return;
  const r = el.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2.2, s = document.createElement("span");
  s.className = "rip"; s.style.width = s.style.height = size + "px"; s.style.left = (e.clientX - r.left - size / 2) + "px"; s.style.top = (e.clientY - r.top - size / 2) + "px";
  el.appendChild(s); setTimeout(() => s.remove(), 600);
});
window.addEventListener("scroll", () => document.getElementById("appbar").classList.toggle("scrolled", window.scrollY > 4), { passive: true });
function themeIcon() { const t = document.documentElement.dataset.theme; return t === "dark" ? "dark_mode" : t === "light" ? "light_mode" : "contrast"; }
function cycleTheme() {
  const t = document.documentElement.dataset.theme, next = !t ? "light" : t === "light" ? "dark" : "";
  if (next) document.documentElement.dataset.theme = next; else delete document.documentElement.dataset.theme;
  try { next ? localStorage.setItem("sde2-theme", next) : localStorage.removeItem("sde2-theme"); } catch (e) {}
  document.querySelectorAll("[data-theme-toggle] .icon").forEach(i => i.textContent = themeIcon());
}

// ---------- start ----------
(async function init() {
  document.querySelectorAll("[data-theme-toggle] .icon").forEach(i => i.textContent = themeIcon());
  const c = window.SDE2_CONFIG || {};
  if (!(c.supabaseUrl && c.supabaseAnonKey && window.supabase)) { loading = false; render(); return; }
  sb = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, { auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true } });
  sb.auth.onAuthStateChange((event, session) => {
    const u = session && session.user || null;
    if ((u && u.id) === (user && user.id)) return;
    user = u; rows = [];
    setTimeout(() => { if (user) load(); else { loading = false; render(); } }, 0); // don't call Supabase inside this callback
  });
  const { data } = await sb.auth.getSession();
  if (/[?&]code=/.test(location.search)) history.replaceState(null, "", location.pathname);
  if (!data.session) { loading = false; render(); }
})();
