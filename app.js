/* Whitespace — UI. Depends on data.js and engine.js. */
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const KEY = "whitespace.resume.v1";
  const FILTERS = [["all", "All", () => true], ["early", "Seed", s => s.stage <= 1], ["a", "Series A", s => s.stage === 2], ["late", "Series B+", s => s.stage >= 3]];
  const state = { profile: null, matches: [], selected: null, filter: "all", sector: "all", backer: "all", fileName: "" };
  const backers = s => s.backers || [];
  const backerBadges = s => backers(s).map(b => `<span class="bk ${b === "a16z" ? "a16z" : "yc"}" title="Backed by ${esc(b)}">${b === "a16z" ? "a16z" : "YC"}</span>`).join("");
  const initials = name => name.replace(/\(.*?\)/g, " ").replace(/[^A-Za-z0-9 ]/g, "").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const color = s => MODELS[s.model].color;
  const matchWord = pct => pct >= 70 ? "Great match" : pct >= 55 ? "Good match" : pct >= 40 ? "Worth a look" : "Stretch";

  /* ── Reading files ── */
  async function readPdf(file) {
    if (!window.pdfjsLib) throw new Error("The PDF reader couldn't load (are you offline?). Paste your resume text instead.");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    let out = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const items = (await (await pdf.getPage(i)).getTextContent()).items;
      let lastY = null;
      for (const it of items) {
        const y = it.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 2) out += "\n";
        else if (lastY !== null && out && !/\s$/.test(out) && !/^\s/.test(it.str)) out += " ";
        out += it.str;
        lastY = y;
      }
      out += "\n";
    }
    return out;
  }

  async function readFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "pdf" || file.type === "application/pdf") return readPdf(file);
    if (ext === "docx") {
      if (!window.mammoth) throw new Error("The Word reader couldn't load (are you offline?). Paste your resume text instead.");
      return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
    }
    if (["txt", "md"].includes(ext) || file.type.startsWith("text/")) return file.text();
    throw new Error("That file type isn't supported. Upload a PDF, Word (.docx) or text resume.");
  }

  async function handleFile(file) {
    $("busy").hidden = false;
    const replacing = !!state.profile;
    try {
      useText(await readFile(file), file.name);
      if (replacing) toast("Resume updated — matches refreshed");
    } catch (e) {
      fail(e.message || "Couldn't read that file.");
    } finally {
      $("busy").hidden = true;
    }
  }

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.hidden = true), 2600);
  }

  function fail(msg) {
    if (state.profile) { toast(msg); return; }
    $("error").textContent = msg; $("error").hidden = false;
  }

  function useText(text, fileName) {
    text = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
    if (text.split(/\s+/).length < 40) throw new Error("We couldn't find enough text in that file. If it's a scanned PDF, paste the text instead.");
    try { localStorage.setItem(KEY, JSON.stringify({ text, fileName, at: Date.now() })); } catch (e) { /* storage unavailable: still works for this visit */ }
    start(text, fileName);
  }

  /* ── Views ── */
  function start(text, fileName) {
    state.profile = analyzeResume(text);
    state.matches = rankStartups(state.profile);
    state.fileName = fileName;
    state.selected = state.matches[0].startup.id;
    $("upload").hidden = true; $("app").hidden = false; $("error").hidden = true;
    renderProfile(); renderFilters(); renderList(); renderDetail();
  }

  function renderProfile() {
    const p = state.profile;
    const meta = [p.school, p.years ? `${p.years} yrs experience` : null].filter(Boolean).join(" · ");
    $("profile").innerHTML = `
      <span class="me">${esc(initials(p.name || "You"))}</span>
      <div class="who"><strong>${esc(p.name || "Your profile")}</strong><span>${esc(meta || state.fileName)}</span></div>
      <div class="tags" title="What we read from your resume">${p.strengths.map(k => `<span class="tag">${esc(ROLES[k].label)}</span>`).join("")}${p.sectors.map(k => `<span class="tag alt" style="--c:${MODELS[k].color}">${esc(k)}</span>`).join("")}</div>`;
  }

  function renderFilters() {
    $("sector").innerHTML = `<option value="all">All sectors</option>` + Object.keys(MODELS).map(k => `<option value="${esc(k)}"${state.sector === k ? " selected" : ""}>${esc(k)}</option>`).join("");
    $("filters").innerHTML = FILTERS.map(([id, label]) => `<button type="button" class="chip${state.filter === id ? " on" : ""}" data-filter="${id}" aria-pressed="${state.filter === id}">${label}</button>`).join("");
  }

  const visible = () => state.matches.filter(m => FILTERS.find(f => f[0] === state.filter)[2](m.startup) && (state.sector === "all" || m.startup.model === state.sector) && (state.backer === "all" || backers(m.startup).includes(state.backer)));

  function renderList() {
    const rows = visible();
    $("count").textContent = rows.length;
    $("list").innerHTML = rows.map(m => {
      const s = m.startup;
      return `<li><button type="button" class="row${s.id === state.selected ? " on" : ""}" data-id="${s.id}" style="--c:${color(s)}">
        <span class="logo">${esc(initials(s.name))}</span>
        <span class="row-main">
          <span class="row-top"><strong>${esc(s.name)} ${backerBadges(s)}</strong><span class="score">${m.pct}%</span></span>
          <span class="sub"><i class="dot"></i>${esc(s.model)} · ${STAGES[s.stage]}</span>
          <span class="need${m.role.signal && m.role.signal.posted ? " open" : ""}">${esc(roleTitle(m.role.id, s.stage))}${m.role.signal && m.role.signal.posted ? " · hiring" : ""}</span>
        </span></button></li>`;
    }).join("") || `<li class="empty">No startups match these filters.</li>`;
  }

  function renderDetail() {
    const m = state.matches.find(x => x.startup.id === state.selected);
    if (!m) return;
    const s = m.startup, p = state.profile, g = m.role, pitch = buildPitch(m, p);
    const fact = (k, v) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`;
    const why = [
      m.role.fit >= 0.45 ? `Your resume is a ${m.role.fit >= 0.7 ? "strong" : "solid"} fit for ${ROLES[g.id].label}` : `${ROLES[g.id].label} is the most relevant gap for your background`,
      m.sectorFit >= 0.45 ? `you have ${s.model} experience` : null,
      m.local ? `you've been based near ${s.city}` : null
    ].filter(Boolean).join(", and ");
    const mail = "mailto:?subject=" + encodeURIComponent(`An idea for ${s.name}`) + "&body=" + encodeURIComponent(pitch.opener);

    $("detail").style.setProperty("--c", color(s));
    $("detail").innerHTML = `
      <button type="button" class="back" id="back">← All matches</button>

      <div class="hero">
        <span class="logo xl">${esc(initials(s.name))}</span>
        <div class="hero-main">
          <div class="hero-tags"><span class="sector">${esc(s.model)}</span><span class="stagepill">${STAGES[s.stage]}</span>${backers(s).map(b => `<span class="stagepill">Backed by ${esc(b)}</span>`).join("")}</div>
          <h1>${esc(s.name)}</h1>
          <p class="blurb">${esc(s.blurb)}</p>
          ${s.web ? `<a class="site" href="${esc(s.web)}" target="_blank" rel="noopener">${esc(s.web.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))} ↗</a>` : ""}
        </div>
        <div class="bigscore"><b>${m.pct}%</b><span>${matchWord(m.pct)}</span></div>
      </div>
      <p class="whyline">💡 ${esc(why)}.</p>

      <dl class="facts">
        ${fact("Funding stage", STAGES[s.stage])}
        ${fact("Total raised", s.raised)}
        ${fact("Latest round", s.round)}
        ${fact("Company size", sizeBand(s.empN))}
        ${fact("Employees", s.employees)}
        ${fact("Location", s.location)}
        ${fact("CEO", s.ceo)}
        ${fact("Founded", s.founded)}
      </dl>
      <p class="source">Facts from press coverage and public directories, checked ${AS_OF}. <a href="${esc(s.src)}" target="_blank" rel="noopener">Read the source ↗</a></p>
      ${s.unsure.length ? `<div class="headsup"><strong>Heads-up</strong><ul>${s.unsure.map(u => `<li>${esc(u)}</li>`).join("")}</ul></div>` : ""}

      <section class="card gap">
        <div class="eyebrow"><span>🎯 ${pitch.posted ? "A role they're hiring for" : "The role they're probably missing"}</span><span class="badge${pitch.posted ? " open" : ""}">${pitch.posted ? "Listed · seen on a job board" : "Not posted · our inference"}</span></div>
        <h2>${esc(pitch.title)}</h2>
        <p>${esc(pitch.why)}</p>
        <div class="evidence">
          <div class="ev">
            <div class="ev-num">${Math.round(100 * g.benchmark)}%</div>
            <div><strong>Stage benchmark</strong><br>${esc(pitch.benchLine.charAt(0).toUpperCase() + pitch.benchLine.slice(1))}. ${pitch.posted ? `${esc(s.name)} is hiring for it now.` : `We found no public one at ${esc(s.name)}.`}</div>
          </div>
          ${g.signal ? `<div class="ev"><div class="ev-num sig">↗</div><div><strong>${pitch.posted ? "Job listing" : "Real signal"}</strong><br>${esc(g.signal.text)}</div></div>` : ""}
        </div>
        <div class="actions">
          <a class="btn" href="${esc(verifyUrl(s, g.id))}" target="_blank" rel="noopener">${pitch.posted ? "See who's already on the team ↗" : "Check on LinkedIn that it's open ↗"}</a>
          <span class="conf">${esc(confidence(g))}</span>
        </div>
        ${m.alternates.length ? `<p class="alts">Other gaps you could pitch: ${m.alternates.map(a => `<span>${esc(roleTitle(a.id, s.stage))}</span>`).join("")}</p>` : ""}
      </section>

      <section class="card">
        <div class="eyebrow"><span>🗣️ How to pitch yourself</span></div>
        <p class="summary">${esc(pitch.summary)}</p>
        <h3>Lead with</h3>
        <ul class="lead">${pitch.lead.map(l => `<li><span class="k">${l.kind}</span><span>${esc(l.text)}</span></li>`).join("")}</ul>
        <h3>Propose this 90-day plan</h3>
        <ol class="plan">${pitch.plan.map(x => `<li>${esc(x)}</li>`).join("")}</ol>
        <h3>Before you send</h3>
        <ul class="watch">${pitch.watch.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
      </section>

      <section class="card">
        <div class="eyebrow"><span>✉️ Message to ${esc(pitch.ceoKnown ? pitch.ceoName : "the founders")}</span></div>
        <pre id="opener" class="opener">${esc(pitch.opener)}</pre>
        <div class="actions">
          <button type="button" class="btn primary" id="copy">Copy message</button>
          <a class="btn" href="${esc(mail)}">Open in email</a>
        </div>
      </section>

      <details class="card how">
        <summary>🔍 How we worked this out</summary>
        <table class="cov">
          <thead><tr><th>Function</th><th>Startups with it by ${STAGES[s.stage]}</th><th>${esc(s.name)}</th></tr></thead>
          <tbody>${m.coverage.filter(c => c.benchmark >= 0.15 || c.has || c.signal).sort((a, b) => b.benchmark - a.benchmark).map(c => `<tr class="${c.has ? "" : c.id === g.id ? "pick" : c.strength >= 0.5 ? "miss" : "later"}">
            <td>${esc(ROLES[c.id].label)}</td>
            <td><span class="bar"><i style="width:${Math.round(100 * c.benchmark)}%"></i></span><span class="pc">${Math.round(100 * c.benchmark)}%</span></td>
            <td>${c.has ? "Owner named publicly" : c.id === g.id ? (pitch.posted ? "Hiring now" : "Your pitch") : c.strength >= 0.5 ? "No public owner found" : "Not yet typical"}</td></tr>`).join("")}</tbody>
        </table>
        ${g.peers.length ? `<p class="peers">Similar startups to compare: ${g.peers.map(x => `<button type="button" class="peer" data-id="${x.id}">${esc(x.name)}</button>`).join("")}</p>` : ""}
        <p class="fine">Benchmarks are our playbook estimates of how many startups have each function by a given stage, adjusted for headcount where known. Startup team rosters aren't public, so every gap is a hypothesis: confirm it before you pitch.</p>
      </details>`;
    $("detail").scrollTop = 0;
  }

  function select(id) {
    state.selected = id;
    if (!visible().some(m => m.startup.id === id)) { state.filter = "all"; state.sector = "all"; state.backer = "all"; $("backer").value = "all"; renderFilters(); }
    renderList(); renderDetail();
    document.body.classList.add("show-detail");
    const row = document.querySelector(".row.on");
    if (row) row.scrollIntoView({ block: "nearest" });
  }

  /* ── Events ── */
  $("drop").onclick = $("replace").onclick = () => $("file").click();
  $("file").onchange = e => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ""; };
  $("sample").onclick = () => useText(SAMPLE_RESUME, "sample-resume.txt");
  $("pasteToggle").onclick = () => { $("pasteForm").hidden = !$("pasteForm").hidden; if (!$("pasteForm").hidden) $("pasteText").focus(); };
  $("pasteForm").onsubmit = e => { e.preventDefault(); try { useText($("pasteText").value, "pasted text"); } catch (err) { fail(err.message); } };
  $("filters").onclick = e => { const b = e.target.closest("[data-filter]"); if (b) { state.filter = b.dataset.filter; renderFilters(); renderList(); } };
  $("sector").onchange = e => { state.sector = e.target.value; renderList(); };
  $("backer").onchange = e => { state.backer = e.target.value; renderList(); };
  $("list").onclick = e => { const b = e.target.closest("[data-id]"); if (b) select(b.dataset.id); };
  $("detail").onclick = e => {
    const peer = e.target.closest("[data-id]");
    if (peer) return select(peer.dataset.id);
    if (e.target.id === "back") document.body.classList.remove("show-detail");
    if (e.target.id === "copy") navigator.clipboard.writeText($("opener").textContent).then(() => toast("Message copied"), () => toast("Couldn't copy — select the text instead"));
  };

  // Drop a file anywhere, at any time, to (re)upload.
  let depth = 0;
  const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  addEventListener("dragenter", e => { if (hasFiles(e)) { depth++; $("dragveil").hidden = false; } });
  addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; $("dragveil").hidden = true; } });
  addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener("drop", e => { e.preventDefault(); depth = 0; $("dragveil").hidden = true; const f = e.dataTransfer.files[0]; if (f) handleFile(f); });

  /* ── Boot: restore the last resume if there is one ── */
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* ignore */ }
  if (saved && saved.text) start(saved.text, saved.fileName); else $("upload").hidden = false;

  window.whitespace = { handleFile, state };
})();
