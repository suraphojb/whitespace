/* Whitespace — matching engine (no DOM). Depends on data.js. */

const rx = (frag, flags = "g") => new RegExp("\\b(?:" + frag + ")", flags);
const compile = kw => Object.entries(kw).map(([k, w]) => ({ re: rx(k), w }));
for (const r of Object.values(ROLES)) { r._kw = compile(r.kw); r._musts = r.musts.map(([label, f]) => ({ label, re: rx(f, "") })); }
for (const m of Object.values(MODELS)) m._kw = compile(m.kw);
for (const s of STARTUPS) s._tags = rx(s.tags, "");

const countHits = (re, text) => { re.lastIndex = 0; const m = text.match(re); return m ? m.length : 0; };
/* Weighted keyword score with diminishing returns on repeats. */
const kwScore = (kws, text) => kws.reduce((sum, { re, w }) => {
  const c = countHits(re, text);
  return c ? sum + w * Math.min(1 + 0.5 * (c - 1), 2) : sum;
}, 0);
const saturate = (score, half) => 1 - Math.exp(-score / half);
const lowerFirst = t => t.charAt(0).toLowerCase() + t.slice(1);

/* ───────── Resume → profile ───────── */

const BULLET = /^[•▪●◦‣–\-*·o]\s+/;
const EDU = /university|college|school|\bmba\b|bachelor|\bb\.?a\.?\b|\bb\.?s\.?c?\b|master/i;

function splitBullets(text) {
  const out = [];
  let cur = null;
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (!line) { cur = null; continue; }
    if (BULLET.test(line)) { cur = { text: line.replace(BULLET, "") }; out.push(cur); }
    else if (cur && !/[.;]$/.test(cur.text) && !/(19|20)\d{2}/.test(line) && line !== line.toUpperCase()) cur.text += " " + line; // wrapped line
    else { cur = null; out.push({ text: line, plain: true }); }
  }
  // Prefer real bullets as proof points; fall back to all lines for resumes written without bullets.
  const real = out.filter(b => !b.plain);
  return (real.length >= 3 ? real : out).map(b => b.text.replace(/\s+/g, " "))
    .filter(t => t.length >= 35 && t.length <= 320 && !/^(technical )?(skills|languages|interests|tools|certifications)\b/i.test(t));
}

const SECTION = /^(education|academic\w*|experience|work experience|professional experience|relevant experience|employment( history)?|work history|career history|summary|profile|objective|skills|technical skills|projects|leadership|activities|additional( information)?|certifications|awards|honors|publications|volunteer\w*|interests|languages)\b[\s:&a-z]*$/i;
const titleCase = t => t.toLowerCase().replace(/(^|[\s(\-'\u2019])([a-z])/g, (m, pre, c) => pre + c.toUpperCase());

/* Years of WORK experience only.
   1. If the resume states it ("8+ years of experience"), trust the candidate's own number.
   2. Otherwise add up the date ranges found under work-experience headings. Education ranges are
      never counted, and overlapping ranges (two roles with the same dates) are counted once. */
function yearsOfExperience(text) {
  const stated = text.match(/(\d{1,2})\s*\+?\s*years?['’]?\s+(?:of\s+)?(?:[a-z-]+\s+){0,3}experience/i);
  if (stated && +stated[1] > 0 && +stated[1] <= 45) return +stated[1];

  const now = new Date().getFullYear();
  // Split into sections by heading.
  const sections = [{ head: "", body: "" }];
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (line.length <= 40 && !/\d/.test(line) && SECTION.test(line)) sections.push({ head: line.toLowerCase(), body: "" });
    else sections[sections.length - 1].body += line + "\n";
  }
  const isWork = h => /experience|employment|work|career/.test(h);
  const isStudy = h => /educat|academic/.test(h);
  const hasWorkSection = sections.some(x => isWork(x.head));

  const re = /((?:19|20)\d{2})\s*[–—-]\s*(?:[A-Za-z]{3,9}\.?\s*)?((?:19|20)\d{2}|present|current|now)/gi;
  const spans = [];
  for (const sec of sections) {
    if (isStudy(sec.head) || (hasWorkSection && !isWork(sec.head))) continue;
    for (const m of sec.body.matchAll(re)) { // ranges may wrap across lines
      const lineStart = sec.body.lastIndexOf("\n", m.index) + 1;
      if (!hasWorkSection && EDU.test(sec.body.slice(lineStart, m.index))) continue; // no headings: skip school lines
      const a = +m[1], b = /^\d/.test(m[2]) ? +m[2] : now;
      if (b >= a && a > 1980 && b <= now + 1) spans.push([a, Math.max(b, a + 0.5)]);
    }
  }
  // Union of the spans, so concurrent roles aren't double-counted.
  spans.sort((x, y) => x[0] - y[0]);
  let total = 0, end = -Infinity;
  for (const [a, b] of spans) {
    if (b <= end) continue;
    total += b - Math.max(a, end);
    end = b;
  }
  return Math.min(Math.round(total), 45);
}

function analyzeResume(text) {
  const lower = text.toLowerCase();
  const lines = text.split(/\n/).map(s => s.trim()).filter(Boolean);
  const bullets = splitBullets(text);

  // Name: one of the first few lines, 2-5 words, letters only (allowing nicknames in brackets, initials, hyphens).
  const first = lines.slice(0, 6).find(l => {
    const words = l.split(/\s+/);
    return /^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ.,'’()\- ]{3,48}$/.test(l) && words.length >= 2 && words.length <= 5
      && !SECTION.test(l) && !/resume|curriculum|vitae/i.test(l);
  });
  const name = first ? titleCase(first.replace(/,\s*(mba|cfa|cpa|phd|pmp)\b.*$/i, "")) : null;
  const schoolMatch = text.match(/[A-Za-z][A-Za-z&. ]*?(?:business school|school of business|school of management)/i);
  const schoolLine = lines.find(l => /\bmba\b/i.test(l));
  const rawSchool = schoolMatch ? schoolMatch[0] : schoolLine ? schoolLine.split(/[,|–—-]/)[0] : null;
  const school = rawSchool ? titleCase(rawSchool.replace(/\d+/g, "").trim()).replace(/\b(Of|And|The)\b/g, w => w.toLowerCase()).slice(0, 50) : null;

  const fit = {}, evidence = {};
  for (const [id, r] of Object.entries(ROLES)) {
    fit[id] = saturate(kwScore(r._kw, lower), 7);
    evidence[id] = bullets
      .map(t => {
        const l = t.toLowerCase();
        const k = r._kw.reduce((s, { re, w }) => s + (countHits(re, l) ? w : 0), 0);
        return { t, k, s: k + (/\d/.test(t) ? 1.5 : 0) + (/[$%]/.test(t) ? 1 : 0) };
      })
      .filter(e => e.k >= 2)
      .sort((a, b) => b.s - a.s)
      .slice(0, 2)
      .map(e => e.t);
  }
  const sector = {};
  for (const [id, m] of Object.entries(MODELS)) sector[id] = saturate(kwScore(m._kw, lower), 5);
  const cities = Object.entries(CITIES).filter(([, f]) => rx(f, "").test(lower)).map(([c]) => c);

  const top = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]);
  return {
    name, school, years: yearsOfExperience(text), fit, sector, evidence, cities, lower,
    strengths: top(fit).filter(([, v]) => v >= 0.35).slice(0, 4).map(([k]) => k),
    sectors: top(sector).filter(([, v]) => v >= 0.3).slice(0, 3).map(([k]) => k)
  };
}

/* ───────── Startup → inferred gaps ─────────
   Hypothesis: a function that most startups have built by this funding stage, and that this
   startup shows no public owner for, is a role it will need soon — posted or not.

   benchmark = playbook share of startups with the function at this stage, nudged up or down
               when the company is large or small for its stage (when headcount is known)
   strength  = benchmark + a boost when a real, sourced signal points at that function
   Team rosters aren't public in structured form, so "no public owner" is unverified by design. */

const TYPICAL_HEADCOUNT = [5, 12, 45, 140, 350];
const SIGNAL_BOOST = 0.25;

function gapAnalysis(s) {
  const sizeNudge = s.empN ? Math.max(-0.15, Math.min(0.15, 0.1 * Math.log2(s.empN / TYPICAL_HEADCOUNT[s.stage]))) : 0;
  const peers = STARTUPS.filter(p => p !== s && p.model === s.model && Math.abs(p.stage - s.stage) <= 1);
  const skip = MODELS[s.model].skip;
  return Object.entries(ROLES).filter(([id]) => !skip.includes(id)).map(([id, r]) => {
    const benchmark = Math.max(0, Math.min(1, r.prior[s.stage] + (r.prior[s.stage] > 0 ? sizeNudge : 0)));
    const has = s.has.includes(id);
    const signal = !has && s.signal && s.signal.role === id ? s.signal : null;
    const strength = has ? 0 : Math.min(benchmark + (signal ? SIGNAL_BOOST : 0), 1);
    return { id, has, benchmark, strength, signal, peers };
  }).sort((a, b) => b.strength - a.strength);
}

const SHORT = { cos: "strategy and operations", pm: "product", growth: "growth", pmm: "product marketing", bd: "partnerships", sales: "sales", cs: "customer success", fin: "finance", revops: "revenue operations", exp: "market expansion", ops: "operations", data: "analytics", people: "people and talent", corpdev: "corporate development" };
const confidence = g => g.strength >= 0.7 ? "Strong signal" : g.strength >= 0.5 ? "Likely need" : "Early signal";
const roleTitle = (roleId, stage) => ROLES[roleId].titles[stage <= 1 ? 0 : stage === 2 ? 1 : 2];
const sizeBand = n => !n ? "Not disclosed" : n <= 10 ? "Micro (1–10)" : n <= 50 ? "Small (11–50)" : n <= 200 ? "Mid-size (51–200)" : "Large (200+)";
const verifyUrl = (s, roleId) => "https://www.linkedin.com/search/results/people/?keywords=" + encodeURIComponent(`${s.name} ${SHORT[roleId]}`);

/* ───────── Profile × startup → match ───────── */

function matchStartup(s, p) {
  const coverage = gapAnalysis(s);
  const gaps = coverage.filter(g => !g.has);
  const scored = gaps
    // A gap backed by a real, sourced signal outranks a generic benchmark gap, provided the resume has some fit for it.
    .map(g => ({ ...g, fit: p.fit[g.id], score: 0.6 * p.fit[g.id] + 0.4 * g.strength, pick: 0.5 * p.fit[g.id] + 0.5 * g.strength + (g.signal && p.fit[g.id] >= 0.3 ? 0.2 : 0) }))
    .filter(g => g.strength >= 0.3)
    .sort((a, b) => b.pick - a.pick);
  const best = scored[0] || { ...gaps[0], fit: p.fit[gaps[0].id], score: 0 };
  const tagHit = s._tags.test(p.lower);
  const local = !!s.city && p.cities.includes(s.city);
  const sectorFit = Math.max(p.sector[s.model], tagHit ? 0.6 : 0);
  const score = 0.64 * best.score + 0.26 * sectorFit + 0.05 * (tagHit ? 1 : 0) + 0.05 * (local ? 1 : 0);
  return { startup: s, coverage, role: best, alternates: scored.slice(1, 3), tagHit, local, sectorFit, pct: Math.round(100 * score) };
}

const rankStartups = p => STARTUPS.map(s => matchStartup(s, p)).sort((a, b) => b.pct - a.pct);

/* ───────── Pitch summary ───────── */

function buildPitch(m, p) {
  const s = m.startup, g = m.role, role = ROLES[g.id];
  const title = roleTitle(g.id, s.stage);
  const fn = SHORT[g.id];
  const ceoKnown = !/not confirmed/i.test(s.ceo);
  const ceoName = s.ceo.replace(/\s*\(.*\)$/, "");
  const ceoFirst = ceoKnown ? ceoName.replace(/^Dr\. /, "").split(" ")[0] : "the founders";
  const fill = t => t.replace(/\{ceo\}/g, ceoFirst).replace(/\{co\}/g, s.name);
  const ev = p.evidence[g.id];
  const pct = Math.round(100 * g.benchmark);

  const benchLine = `about ${pct}% of startups have a dedicated ${fn} owner by ${STAGES[s.stage]}`;
  const fitWord = g.fit >= 0.7 ? "strong" : g.fit >= 0.45 ? "solid" : "partial";
  const sectorKnown = m.sectorFit >= 0.45;

  const summary = `${s.name} is at ${STAGES[s.stage]} (${s.round.replace(" · ", ", ")}) and we found no public ${fn} owner, while ${benchLine}.` +
    (g.signal ? ` ${g.signal.text}` : "") +
    ` Your resume shows ${fitWord} ${fn} evidence${sectorKnown ? ` and real ${s.model.toLowerCase()} exposure` : ""}. Don't apply for a job — propose one: the ${title} role and what it delivers in 90 days.`;

  const lead = [];
  ev.forEach(t => lead.push({ kind: "Proof point", text: `“${t}”` }));
  if (!ev.length) lead.push({ kind: "Transferable", text: `Your resume has no direct ${fn} bullet. Lead with your closest result from ${p.strengths.length ? SHORT[p.strengths[0]] : "your last role"} and explain how it transfers.` });
  lead.push({ kind: "Angle", text: fill(role.angle) });
  lead.push(sectorKnown
    ? { kind: "Domain", text: `Use your ${s.model.toLowerCase()} background: you already speak the language of ${s.name}'s customers, so you ramp in weeks, not quarters.` }
    : { kind: "Domain", text: `You're coming from outside ${s.model.toLowerCase()}. Frame that as an asset: you bring a playbook from ${p.sectors[0] ? p.sectors[0].toLowerCase() : "a different industry"} — and show you've done the homework on their market.` });
  lead.push({ kind: "Stage", text: s.stage <= 1
    ? "Emphasise range and scrappiness. At this stage they need someone who does the work, not someone who manages it."
    : s.stage === 2
      ? "Emphasise zero-to-one building: first process, first playbook, first hire in the function."
      : "Emphasise scale and rigour: they have momentum and need structure that survives a doubling of headcount." });

  const watch = [`Check first that the role really is open: search LinkedIn for a ${fn} lead at ${s.name}. If one exists, pitch the next gap instead.`];
  role._musts.filter(x => !x.re.test(p.lower)).forEach(x => watch.push(`Your resume doesn't show ${x.label}. Expect the question and have an example ready.`));
  if (p.years && p.years < 3 && s.stage >= 3) watch.push("With under three years of experience, a later-stage company may scope this as a senior-manager role rather than a head-of role. Be flexible on title.");

  const who = p.school ? `an MBA candidate at ${p.school}` : "an MBA candidate";
  const exp = p.years ? ` with ${p.years} years in ${p.strengths.slice(0, 2).map(k => SHORT[k]).join(" and ") || "operating roles"}` : "";
  const opener = `Hi ${ceoKnown ? ceoFirst : "[name]"},\n\n` +
    `I'm ${who}${exp}.` + (/^YC /.test(s.round) ? "" : ` Congratulations on the ${s.round.split(" · ")[0].replace(/^\S+\s/, "")}${/Seed$/.test(s.round.split(" · ")[0]) ? " round" : ""}.`) +
    (g.signal ? ` I noticed ${g.signal.you}, and from the outside I couldn't find anyone owning ${fn} yet.` : ` From the outside I couldn't find anyone owning ${fn} at ${s.name} yet.`) + `\n\n` +
    (ev[0] ? `The closest thing I've done: ${lowerFirst(ev[0]).replace(/\.$/, "")}.\n\n` : "") +
    `I've sketched a one-page 90-day plan for what a ${title.split(" / ")[0]} could own at ${s.name}. Could I send it over, or walk you through it in 20 minutes?\n\n` +
    `${p.name || "[Your name]"}`;

  return { title, summary, lead, plan: role.plan, watch, opener, why: role.why, benchLine, ceoName, ceoKnown };
}

if (typeof module !== "undefined") module.exports = { analyzeResume, rankStartups, buildPitch, gapAnalysis };
