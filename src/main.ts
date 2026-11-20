import './style.css';
import { loadPolicy, type Policy } from './firebase';
import { prepareNano, probeDevice, runJson, type DeviceInfo, type StepLog } from './ai';
import { decideRoute, nanoReason, type Override, type Route, type Sensitivity } from './router';
import { analyzeLocally, chunkText, maskContacts, normalise, type LocalAnalysis } from './rules';
import { FACTS_SCHEMA, FACTS_SYSTEM, KIT_SCHEMA, KIT_SYSTEM, factsPrompt, kitPrompt, type FactsResult, type KitResult } from './prompts';
import {
  buildChecklist,
  coerceFacts,
  coerceKit,
  faqJsonLd,
  mergeFacts,
  missingTypes,
  verifyFacts,
  type CheckItem,
  type VerifiedFact,
} from './checklist';
import { SAMPLES } from './samples';

// ---------- state ----------
let policy: Policy = {
  cloudModel: 'gemini-3.5-flash-lite',
  maxDeviceChars: 12000,
  maxPrivateChunks: 6,
  maskContactsForCloud: true,
  promptVersion: 'v1',
  source: 'default',
};
let device: DeviceInfo = { nano: 'no-api', chromeVersion: null, hasPromptApi: false };
let sensitivity: Sensitivity = 'private';
let override: Override = 'auto';
let mask = true;
let busy = false;
let importedFrom = '';

// ---------- helpers ----------
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const STEP_LABEL: Record<string, string> = {
  facts: 'Extract facts',
  kit: 'Write answer kit',
};
const MODE_LABEL: Record<string, string> = {
  prefer_on_device: 'PREFER_ON_DEVICE',
  only_on_device: 'ONLY_ON_DEVICE',
  only_in_cloud: 'ONLY_IN_CLOUD',
  prefer_in_cloud: 'PREFER_IN_CLOUD',
};

// ---------- layout ----------
$('#app').innerHTML = `
<header class="top">
  <div class="brand">
    <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#2563EB"/><path d="M18 22h28M18 32h20M18 42h14" stroke="#fff" stroke-width="5" stroke-linecap="round"/><circle cx="46" cy="42" r="6" fill="none" stroke="#fff" stroke-width="4"/></svg>
    <div>
      <div class="brand-name">CiteReady</div>
      <div class="brand-sub">Is your page ready to be quoted by AI assistants?</div>
    </div>
  </div>
  <button class="device-pill" id="devicePill" type="button" aria-controls="devicePanel">Checking on-device model…</button>
</header>

<section class="device-panel" id="devicePanel" hidden></section>

<main class="grid">
  <section class="card input-card">
    <h2>Your page or draft</h2>
    <div class="samples" id="samples"></div>
    <div class="imported" id="imported" hidden></div>
    <textarea id="text" spellcheck="false" placeholder="Paste the text of a web page, product page, or an unpublished draft…"></textarea>
    <div class="meta" id="meta">0 characters</div>

    <fieldset class="seg" id="sens">
      <legend>What is this text?</legend>
      <label><input type="radio" name="sens" value="private" checked /><span><b>Private draft</b><small>Unpublished or confidential. Checked on this device; never uploaded without your OK.</small></span></label>
      <label><input type="radio" name="sens" value="public" /><span><b>Public page</b><small>Already live. On-device when it fits, cloud for long pages.</small></span></label>
    </fieldset>

    <details class="advanced">
      <summary>Routing options</summary>
      <label class="row">Route
        <select id="override">
          <option value="auto">Automatic (recommended)</option>
          <option value="device">On-device only</option>
          <option value="cloud">Cloud only</option>
        </select>
      </label>
      <label class="row check"><input type="checkbox" id="mask" checked /> Mask emails and phone numbers if a private draft goes to the cloud</label>
    </details>

    <button class="primary" id="run" type="button">Check readiness</button>
  </section>

  <section class="results" id="results">
    <div class="card empty" id="empty">
      <h2>What you get</h2>
      <ol class="what">
        <li><b>The facts an assistant would quote</b>: who, what, where, price, hours, dates, proof, contact. Each one is checked against your text.</li>
        <li><b>Missing and vague facts</b>, with a concrete fix for each.</li>
        <li><b>An answer-first summary</b> and the <b>5 questions</b> people are likely to ask an assistant, with draft answers.</li>
        <li><b>A readiness checklist</b> and FAQ structured data you can paste into the page.</li>
      </ol>
      <p class="muted">Every result shows where the AI ran — on this device with Gemini Nano, or in the cloud — and why.</p>
    </div>
    <div id="route"></div>
    <div id="consent"></div>
    <div id="out"></div>
  </section>
</main>

<footer class="foot">
  <span>Built with Firebase AI Logic hybrid inference · App Check (reCAPTCHA Enterprise) · Remote Config</span>
  <span id="policyNote"></span>
  <a href="https://github.com/Canlah-AI/citeready" target="_blank" rel="noopener">Source (Apache-2.0)</a>
  <span>Made by Canlah AI</span>
</footer>
`;

const ta = $<HTMLTextAreaElement>('#text');

// ---------- samples & import ----------
$('#samples').innerHTML =
  '<span class="muted">Try a sample:</span>' +
  SAMPLES.map((s) => `<button type="button" class="chip" data-sample="${s.id}">${esc(s.label)}</button>`).join('');
$('#samples').addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>('[data-sample]')?.dataset.sample;
  const s = SAMPLES.find((x) => x.id === id);
  if (!s) return;
  ta.value = s.text;
  setSensitivity(s.sensitivity);
  importedFrom = '';
  $('#imported').hidden = true;
  updateMeta();
});

function readImport() {
  // The Chrome extension opens CiteReady with the page text in the URL
  // fragment. Fragments are never sent to the server.
  const h = location.hash;
  if (!h.startsWith('#import=')) return;
  try {
    const b64 = h.slice('#import='.length).replace(/-/g, '+').replace(/_/g, '/');
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const data = JSON.parse(json) as { t?: string; u?: string; x?: string; p?: number };
    ta.value = [data.t, data.x].filter(Boolean).join('\n\n');
    importedFrom = data.u || '';
    setSensitivity(data.p ? 'private' : 'public');
    $('#imported').hidden = false;
    $('#imported').innerHTML = `Imported from the browser extension: <b>${esc(data.t || 'page')}</b><br><span class="muted">${esc(importedFrom)}</span> · ${data.p ? 'Marked private: it stays on this device unless you allow the cloud.' : 'Mark it as a private draft if it is not public yet.'}`;
  } catch {
    /* ignore malformed imports */
  }
  history.replaceState(null, '', location.pathname);
}

// ---------- inputs ----------
function setSensitivity(s: Sensitivity) {
  sensitivity = s;
  document.querySelectorAll<HTMLInputElement>('input[name="sens"]').forEach((r) => (r.checked = r.value === s));
}
$('#sens').addEventListener('change', (e) => {
  sensitivity = (e.target as HTMLInputElement).value as Sensitivity;
});
$<HTMLSelectElement>('#override').addEventListener('change', (e) => {
  override = (e.target as HTMLSelectElement).value as Override;
});
$<HTMLInputElement>('#mask').addEventListener('change', (e) => {
  mask = (e.target as HTMLInputElement).checked;
});

function updateMeta() {
  const n = ta.value.length;
  const parts = Math.max(1, Math.ceil(n / policy.maxDeviceChars));
  $('#meta').textContent = `${n.toLocaleString()} characters · about ${fmtK(Math.ceil(n / 4))} tokens${n ? ` · ${parts === 1 ? 'fits one on-device prompt' : `${parts} on-device prompts`}` : ''}`;
}
ta.addEventListener('input', updateMeta);

// ---------- device ----------
function renderDevice() {
  const pill = $('#devicePill');
  const ready = device.nano === 'available';
  pill.className = `device-pill ${ready ? 'on' : 'off'}`;
  pill.textContent = ready ? 'Gemini Nano ready on this device' : `Gemini Nano: ${device.nano === 'no-api' ? 'not in this browser' : device.nano}`;
  const canPrepare = device.nano === 'downloadable' || device.nano === 'downloading';
  $('#devicePanel').innerHTML = `
    <div class="card">
      <h3>On-device model</h3>
      <dl class="kv">
        <dt>Browser</dt><dd>${device.chromeVersion ? `Chrome ${device.chromeVersion}` : 'Not Chrome'}</dd>
        <dt>Prompt API (LanguageModel)</dt><dd>${device.hasPromptApi ? 'present' : 'missing'}</dd>
        <dt>Gemini Nano</dt><dd><b>${esc(device.nano)}</b> — ${esc(nanoReason(device.nano))}</dd>
        <dt>Cloud fallback</dt><dd>${esc(policy.cloudModel)} via Firebase AI Logic (Gemini Developer API)</dd>
        <dt>Policy</dt><dd>${policy.source === 'remote' ? 'Remote Config' : 'built-in defaults'} · on-device slice ${policy.maxDeviceChars.toLocaleString()} chars · prompt ${esc(policy.promptVersion)}</dd>
      </dl>
      ${canPrepare ? '<button class="secondary" id="prepare" type="button">Download Gemini Nano (one time)</button><div class="progress" id="prog" hidden><span></span></div>' : ''}
      ${
        device.nano === 'available'
          ? '<p class="muted">Private drafts will be checked entirely on this device.</p>'
          : '<p class="muted">To run on-device: Chrome desktop 139 or newer, enable <code>chrome://flags/#prompt-api-for-gemini-nano-multimodal-input</code>, restart, and have enough free disk space for the model download (see Chrome\'s built-in AI requirements). Until then CiteReady uses the cloud for public pages and asks before sending a private draft.</p>'
      }
    </div>`;
  $('#prepare')?.addEventListener('click', onPrepare);
}

async function onPrepare() {
  const btn = $<HTMLButtonElement>('#prepare');
  const prog = $('#prog');
  btn.disabled = true;
  prog.hidden = false;
  btn.textContent = 'Downloading…';
  try {
    await prepareNano(policy.cloudModel, (p) => {
      (prog.firstElementChild as HTMLElement).style.width = `${Math.round(p * 100)}%`;
    });
  } catch (e) {
    btn.textContent = `Download failed: ${(e as Error).message}`;
  }
  device = await probeDevice();
  renderDevice();
}

$('#devicePill').addEventListener('click', () => {
  const p = $('#devicePanel');
  p.hidden = !p.hidden;
});

// ---------- rendering ----------
function sourceBadge(src: 'on_device' | 'in_cloud') {
  return src === 'on_device'
    ? '<span class="badge dev">On this device · Gemini Nano</span>'
    : `<span class="badge cloud">Cloud · ${esc(policy.cloudModel)}</span>`;
}

function renderRoute(route: Route, logs: StepLog[], status = '') {
  const dev = logs.filter((l) => l.source === 'on_device').length;
  const cloud = logs.length - dev;
  const sent = logs.filter((l) => l.source === 'in_cloud').reduce((a, l) => a + l.chars, 0);
  let headline: string;
  if (!logs.length) headline = route.plan === 'needs-consent' || route.plan === 'needs-device' ? 'Waiting for your choice' : 'Routing…';
  else if (!cloud) headline = 'Ran entirely on this device';
  else if (!dev) headline = 'Ran in the cloud';
  else headline = `Hybrid: ${dev} step${dev > 1 ? 's' : ''} on-device, ${cloud} in the cloud`;
  $('#route').innerHTML = `
  <div class="card route ${!logs.length ? '' : cloud ? (dev ? 'mixed' : 'is-cloud') : 'is-dev'}">
    <div class="route-head">
      <div>
        <div class="eyebrow">Where the AI ran</div>
        <div class="route-title">${esc(headline)}</div>
      </div>
      <div class="sent"><span class="big">${sent.toLocaleString()}</span><span>characters sent to the cloud</span></div>
    </div>
    <p class="reason">${esc(route.reason)}</p>
    ${status ? `<p class="status"><span class="spinner"></span>${esc(status)}</p>` : ''}
    ${
      logs.length
        ? `<table class="log"><thead><tr><th>Step</th><th>Requested mode</th><th>Ran on (inferenceSource)</th><th>Time</th></tr></thead><tbody>
      ${logs
        .map(
          (l) =>
            `<tr><td>${esc(l.step)}</td><td><code>${MODE_LABEL[l.mode]}</code></td><td>${sourceBadge(l.source)}</td><td>${(l.ms / 1000).toFixed(1)} s</td></tr>`,
        )
        .join('')}</tbody></table>`
        : ''
    }
  </div>`;
}

function renderConsent(route: Route) {
  const canPrepare = device.nano === 'downloadable' || device.nano === 'downloading';
  const isDeviceOnly = route.plan === 'needs-device';
  $('#consent').innerHTML = `
  <div class="card consent">
    <h3>${isDeviceOnly ? 'On-device model not ready' : 'Nothing has left this device'}</h3>
    <p>${esc(route.reason)}</p>
    <div class="actions">
      ${isDeviceOnly ? '' : `<button class="primary" id="allowCloud" type="button">Send ${route.maskForCloud ? 'a masked copy' : 'it'} to the cloud</button>`}
      ${canPrepare ? '<button class="secondary" id="prepare2" type="button">Download Gemini Nano instead</button>' : ''}
      <button class="ghost" id="cancel" type="button">Cancel</button>
    </div>
    ${route.maskForCloud && !isDeviceOnly ? `<p class="muted">${maskNote(maskContacts(ta.value).masked)}</p>` : ''}
  </div>`;
  $('#allowCloud')?.addEventListener('click', () => check(true));
  $('#prepare2')?.addEventListener('click', () => {
    $('#devicePanel').hidden = false;
    renderDevice();
    $<HTMLButtonElement>('#prepare')?.click();
  });
  $('#cancel').addEventListener('click', () => {
    $('#consent').innerHTML = '';
    $('#route').innerHTML = '';
    $('#empty').hidden = false;
  });
}

function maskNote(n: number) {
  return n ? `Masking replaces ${n} email address${n === 1 ? '' : 'es'} or phone number${n === 1 ? '' : 's'} with placeholders before upload.` : 'No emails or phone numbers found to mask.';
}

function mergeVague(local: LocalAnalysis, f: FactsResult, source: string) {
  const out: Array<{ text: string; fix: string; by: string }> = [];
  const src = normalise(source);
  for (const v of local.vague) out.push({ text: v.phrase, fix: v.suggestion, by: 'rule' });
  for (const v of f.vague) {
    const n = normalise(v.text);
    // Same rule as facts: a phrase the model flags must actually appear in the text.
    if (!n || !src.includes(n)) continue;
    if (out.some((o) => n.includes(normalise(o.text)) || normalise(o.text).includes(n))) continue;
    out.push({ text: v.text, fix: v.fix, by: 'AI' });
  }
  return out;
}

function renderResults(args: {
  text: string;
  facts: FactsResult;
  verified: VerifiedFact[];
  missing: string[];
  vague: Array<{ text: string; fix: string; by: string }>;
  kit: KitResult;
  checks: CheckItem[];
}) {
  const { facts, verified, missing, vague, kit, checks } = args;
  const passed = checks.filter((c) => c.pass).length;
  const unverified = verified.filter((f) => !f.verified).length;
  const factRows = verified.length
    ? verified
        .map(
          (f) => `<li class="${f.verified ? '' : 'unver'}">
        <span class="ftype">${esc(f.type)}</span>
        <span class="fval">${esc(f.value)}${f.clear ? '' : ' <em class="vague-tag">vague</em>'}</span>
        <span class="fq">${f.verified ? `“${esc(f.quote || f.value)}”` : 'Not found word-for-word in your text — ignored in the checklist'}</span>
      </li>`,
        )
        .join('')
    : '<li class="muted">No facts found.</li>';

  $('#out').innerHTML = `
  <div class="card score">
    <div class="score-head">
      <div><div class="eyebrow">Readiness</div><div class="score-big">${passed} of ${checks.length} checks pass</div></div>
      <div class="muted small">${facts.name ? `${esc(facts.name)}${facts.category ? ` · ${esc(facts.category)}` : ''}` : 'No name detected'}</div>
    </div>
    <ul class="checks">
      ${checks
        .map(
          (c) => `<li class="${c.pass ? 'pass' : 'fail'}">
        <span class="mark" aria-hidden="true">${c.pass ? '✓' : '○'}</span>
        <div><div class="clabel">${esc(c.label)}</div><div class="cev">${esc(c.evidence)}</div>${c.pass ? '' : `<div class="cfix">Fix: ${esc(c.fix)}</div>`}</div>
      </li>`,
        )
        .join('')}
    </ul>
  </div>

  <div class="card">
    <h3>Answer-first summary <button class="copy" data-copy="summary" type="button">Copy</button></h3>
    <p class="summary" id="summary">${esc(kit.summary || '—')}</p>
    <p class="muted small">Put this at the top of the page. Anything in [brackets] is a fact you still need to add.</p>
  </div>

  <div class="card">
    <h3>5 questions people will ask an assistant</h3>
    <ol class="qa">
      ${kit.questions
        .map(
          (q) => `<li class="${q.missing ? 'missing' : ''}"><div class="q">${esc(q.question)}</div><div class="a">${esc(q.answer)}</div>${q.missing ? '<div class="tag">Your page cannot answer this yet</div>' : ''}</li>`,
        )
        .join('')}
    </ol>
  </div>

  <div class="two">
    <div class="card">
      <h3>Facts an assistant could quote</h3>
      <p class="muted small">${verified.length - unverified} verified against your text${unverified ? ` · ${unverified} rejected (not in your text)` : ''}</p>
      <ul class="facts">${factRows}</ul>
    </div>
    <div class="card">
      <h3>Missing</h3>
      ${missing.length ? `<ul class="missing-list">${missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : '<p class="muted">Nothing essential missing.</p>'}
      <h3>Vague claims</h3>
      ${
        vague.length
          ? `<ul class="vague">${vague.map((v) => `<li><b>“${esc(v.text)}”</b><span>${esc(v.fix)}</span><small>${v.by === 'rule' ? 'found by a local rule' : 'found by the model'}</small></li>`).join('')}</ul>`
          : '<p class="muted">None flagged.</p>'
      }
    </div>
  </div>

  <details class="card">
    <summary><b>FAQ structured data (JSON-LD)</b> <span class="muted small">— only answers without blanks</span></summary>
    <button class="copy" data-copy="jsonld" type="button">Copy</button>
    <pre id="jsonld">${esc(faqJsonLd(kit))}</pre>
  </details>`;

  document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) =>
    b.addEventListener('click', async () => {
      const id = b.dataset.copy!;
      await navigator.clipboard.writeText($(`#${id}`).textContent || '');
      b.textContent = 'Copied';
      setTimeout(() => (b.textContent = 'Copy'), 1500);
    }),
  );
}

function friendlyError(e: unknown): string {
  const msg = (e as Error)?.message || String(e);
  if (/genai config not found/i.test(msg)) return 'Firebase AI Logic is not enabled for this Firebase project yet (Gemini Developer API not set up).';
  if (/app.?check/i.test(msg)) return 'App Check could not verify this browser, so the cloud request was refused. Reload the page and try again.';
  if (/quota|429|resource.?exhausted/i.test(msg)) return 'The free cloud quota is used up for the moment. Try again in a minute, or use the on-device model.';
  if (/ONLY_ON_DEVICE|on-device model is not available|LanguageModel/i.test(msg)) return `The on-device model could not run this request: ${msg}`;
  return msg;
}

// ---------- main flow ----------
async function check(cloudConsent = false) {
  if (busy) return;
  const text = ta.value.trim();
  if (!text) {
    ta.focus();
    ta.classList.add('shake');
    setTimeout(() => ta.classList.remove('shake'), 400);
    return;
  }
  $('#empty').hidden = true;
  $('#consent').innerHTML = '';
  $('#out').innerHTML = '';

  const local = analyzeLocally(text);
  device = await probeDevice();
  renderDevice();

  const route = decideRoute({
    sensitivity,
    chars: text.length,
    nano: device.nano,
    maxDeviceChars: policy.maxDeviceChars,
    maxPrivateChunks: policy.maxPrivateChunks,
    override,
    cloudConsent,
    maskContactsForCloud: mask,
  });

  if (route.plan === 'needs-consent' || route.plan === 'needs-device') {
    renderRoute(route, []);
    renderConsent(route);
    return;
  }

  busy = true;
  const runBtn = $<HTMLButtonElement>('#run');
  runBtn.disabled = true;
  runBtn.textContent = 'Checking…';
  const logs: StepLog[] = [];
  const common = { cloudModel: policy.cloudModel };
  try {
    // Step 1: extract facts (reads the full text).
    const sent = route.maskForCloud ? maskContacts(text).text : text;
    let facts: FactsResult;
    if (route.factsMode === 'only_on_device' && route.chunks > 1) {
      const parts = chunkText(text, policy.maxDeviceChars);
      const results: FactsResult[] = [];
      for (let i = 0; i < parts.length; i++) {
        renderRoute(route, logs, `Reading part ${i + 1} of ${parts.length} on this device…`);
        const r = await runJson({
          ...common,
          step: `${STEP_LABEL.facts} (part ${i + 1}/${parts.length})`,
          key: 'facts',
          mode: route.factsMode,
          system: FACTS_SYSTEM,
          schema: FACTS_SCHEMA,
          prompt: factsPrompt(parts[i], { index: i + 1, total: parts.length }),
        });
        logs.push(r.log);
        results.push(coerceFacts(r.data));
      }
      facts = mergeFacts(results);
    } else {
      renderRoute(route, logs, 'Extracting facts…');
      const r = await runJson({
        ...common,
        step: STEP_LABEL.facts,
        key: 'facts',
        mode: route.factsMode,
        system: FACTS_SYSTEM,
        schema: FACTS_SCHEMA,
        prompt: factsPrompt(sent),
      });
      logs.push(r.log);
      facts = coerceFacts(r.data);
    }

    // Ground every fact in the text the model actually saw.
    const verified = verifyFacts(sent, facts);
    const missing = missingTypes(verified, local);

    // Step 2: answer kit (reads only the verified facts, which are short).
    renderRoute(route, logs, 'Writing the answer kit…');
    const r2 = await runJson({
      ...common,
      step: STEP_LABEL.kit,
      key: 'kit',
      mode: route.kitMode,
      system: KIT_SYSTEM,
      schema: KIT_SCHEMA,
      prompt: kitPrompt({ ...facts, facts: verified.filter((f) => f.verified) }, missing),
    });
    logs.push(r2.log);
    const kit = coerceKit(r2.data);

    const vague = mergeVague(local, facts, text);
    const checks = buildChecklist(sent, facts.name, verified, local, vague.length, kit);
    renderRoute(route, logs);
    renderResults({ text, facts, verified, missing, vague, kit, checks });
  } catch (e) {
    renderRoute(route, logs);
    const onDevice = route.factsMode === 'only_on_device';
    $('#out').innerHTML = `<div class="card error"><h3>Something went wrong</h3><p>${esc(friendlyError(e))}</p>${
      onDevice && sensitivity === 'private'
        ? '<div class="actions"><button class="secondary" id="retryCloud" type="button">Send a masked copy to the cloud instead</button></div>'
        : ''
    }</div>`;
    $('#retryCloud')?.addEventListener('click', () => {
      override = 'cloud';
      $<HTMLSelectElement>('#override').value = 'cloud';
      check(true);
    });
  } finally {
    busy = false;
    runBtn.disabled = false;
    runBtn.textContent = 'Check readiness';
  }
}

$('#run').addEventListener('click', () => check(false));

// ---------- boot ----------
readImport();
updateMeta();
(async () => {
  device = await probeDevice();
  renderDevice();
  policy = await loadPolicy();
  mask = policy.maskContactsForCloud;
  $<HTMLInputElement>('#mask').checked = mask;
  $('#policyNote').textContent = `Policy: ${policy.source === 'remote' ? 'Remote Config' : 'defaults'} · cloud model ${policy.cloudModel}`;
  renderDevice();
  updateMeta();
})();
