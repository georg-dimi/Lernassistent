/* Lernassistent – Single-Page-App (Vanilla JS) */

const view = document.getElementById('view');
const examNav = document.getElementById('examNav');

let appState = { exams: [], hasApiKey: false, model: '' };

/* ---------- Hilfsfunktionen ---------- */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 5000);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* leer */ }
  if (!res.ok) throw new Error(data.error || `Fehler (${res.status})`);
  return data;
}

// Button während einer Aktion sperren und Spinner zeigen.
async function withBusy(btn, fn) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> ${btn.dataset.busy || 'Einen Moment …'}`;
  try {
    return await fn();
  } catch (err) {
    toast(err.message, true);
    throw err;
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' });
}

function fmtDateLong(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

const TYPE_LABEL = { lernen: '📖 Lernen', wiederholen: '🔄 Wiederholen', abfragen: '✍️ Abfragen' };

/* ---------- Mini-Markdown-Renderer ---------- */

function inlineMd(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function md(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { out.push(`<h${h[1].length}>${inlineMd(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${buf.map(inlineMd).join('<br>')}</blockquote>`);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\s*[-*+]\s+/, ''));
      out.push(`<ul>${buf.map((x) => `<li>${inlineMd(x)}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''));
      out.push(`<ol>${buf.map((x) => `<li>${inlineMd(x)}</li>`).join('')}</ol>`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const header = line.split('|').slice(1, -1).map((c) => c.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        rows.push(lines[i++].split('|').slice(1, -1).map((c) => c.trim()));
      }
      out.push(
        `<table><thead><tr>${header.map((c) => `<th>${inlineMd(c)}</th>`).join('')}</tr></thead><tbody>` +
        rows.map((r) => `<tr>${r.map((c) => `<td>${inlineMd(c)}</td>`).join('')}</tr>`).join('') +
        '</tbody></table>'
      );
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^(#|```|>|\s*[-*+]\s|\s*\d+[.)]\s|\|)/.test(lines[i])) {
      buf.push(lines[i++]);
    }
    out.push(`<p>${buf.map(inlineMd).join('<br>')}</p>`);
  }
  return out.join('\n');
}

/* ---------- Navigation / Router ---------- */

async function refreshState() {
  appState = await api('/api/state');
  renderSidebar();
}

function renderSidebar() {
  examNav.innerHTML = appState.exams
    .map((e) => `<a href="#/klausur/${e.id}" data-nav="exam-${e.id}">📝 ${esc(e.title)}</a>`)
    .join('') || '<span class="meta" style="padding:4px 12px;display:block">Noch keine Klausur</span>';
  markActiveNav();
}

function markActiveNav() {
  const hash = location.hash || '#/';
  document.querySelectorAll('.sidebar a[data-nav]').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('href') === hash ||
      ((a.dataset.nav.startsWith('exam-') || a.dataset.nav === 'abi-trainer') && hash.startsWith(a.getAttribute('href'))));
  });
}

function loading(msg = 'Wird geladen …') {
  view.innerHTML = `<div class="loading-box"><div class="spinner"></div><div>${esc(msg)}</div></div>`;
}

async function route() {
  markActiveNav();
  const hash = location.hash || '#/';
  const parts = hash.slice(2).split('/').filter(Boolean);
  try {
    if (parts.length === 0) return await renderHome();
    if (parts[0] === 'neu') return renderNew();
    if (parts[0] === 'einstellungen') return renderSettings();
    if (parts[0] === 'abi-trainer') return await renderAbiTrainer(parts[1] || 'Mathe');
    if (parts[0] === 'klausur' && parts[1] && parts[2] === 'thema' && parts[3]) {
      return await renderTopic(parts[1], parts[3], parts[4] || 'lernen');
    }
    if (parts[0] === 'klausur' && parts[1]) return await renderExam(parts[1]);
    location.hash = '#/';
  } catch (err) {
    view.innerHTML = `<div class="empty"><div class="big">😕</div><p>${esc(err.message)}</p><a class="btn" href="#/">Zurück zur Startseite</a></div>`;
  }
}

window.addEventListener('hashchange', route);

/* ---------- Startseite (Heute) ---------- */

async function renderHome() {
  loading();
  const [state, today] = await Promise.all([api('/api/state'), api('/api/today')]);
  appState = state;
  renderSidebar();

  const keyNotice = state.hasApiKey ? '' :
    `<div class="notice">🔑 Es ist noch kein Anthropic-API-Schlüssel hinterlegt. <a href="#/einstellungen">Jetzt in den Einstellungen eintragen</a>, damit der Assistent Lernpläne, Lektionen und Quiz erstellen kann.</div>`;

  const sessionsHtml = today.sessions.length
    ? today.sessions.map(sessionItemHtml).join('')
    : `<p class="meta">Heute stehen keine Lerneinheiten im Plan. ${state.exams.length ? 'Zeit für eine freiwillige Wiederholung? 😉' : ''}</p>`;

  const reviewsHtml = today.reviews.length
    ? today.reviews.map((r) => `
        <div class="session-item">
          <div class="s-body">
            <div class="s-title">${esc(r.topicName)} <span class="meta">· ${esc(r.examTitle)}</span></div>
            <div class="s-note">Beherrschung: ${r.mastery}% – Wiederholung fällig seit ${fmtDate(r.due)}</div>
          </div>
          <a class="btn small primary" href="#/klausur/${r.examId}/thema/${r.topicId}/quiz">Jetzt abfragen</a>
        </div>`).join('')
    : `<p class="meta">Keine Wiederholungen fällig – dein Gedächtnis ist auf dem neuesten Stand. ✅</p>`;

  const examsHtml = state.exams.length
    ? `<div class="grid cols-2">${state.exams.map(examCardHtml).join('')}</div>`
    : `<div class="empty card"><div class="big">🎓</div>
         <h2>Willkommen bei deinem Lernassistenten!</h2>
         <p>Lege deine erste Klausur an, lade deine Unterlagen hoch (PDF, Word, PowerPoint, Fotos …)<br>und lass dir automatisch einen Lernplan erstellen.</p>
         <a class="btn primary" href="#/neu">➕ Erste Klausur anlegen</a></div>`;

  view.innerHTML = `
    ${abiturDashboardHtml(state.exams)}
    <div class="page-head">
      <h1>Heute</h1>
      <div class="sub">${fmtDateLong(today.today)}</div>
    </div>
    ${keyNotice}
    ${state.exams.length ? `
      <div class="card"><h2>📅 Heute auf dem Plan</h2>${sessionsHtml}</div>
      <div class="card"><h2>🧠 Gedächtnis-Auffrischung</h2>${reviewsHtml}</div>
      <h2 style="margin:24px 0 12px">Meine Klausuren</h2>` : ''}
    ${examsHtml}
  `;

  view.querySelectorAll('[data-toggle-session]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const { examId, date, index } = cb.dataset;
      try {
        await api(`/api/exams/${examId}/sessions/toggle`, { method: 'POST', body: { date, index: Number(index) } });
        cb.closest('.session-item').classList.toggle('done', cb.checked);
      } catch (err) { toast(err.message, true); }
    });
  });
}

function sessionItemHtml(s) {
  return `
    <div class="session-item ${s.done ? 'done' : ''}">
      <input type="checkbox" ${s.done ? 'checked' : ''} data-toggle-session
             data-exam-id="${s.examId}" data-date="${s.date}" data-index="${s.index}" title="Als erledigt markieren">
      <div class="s-body">
        <div class="s-title">${esc(s.topicName)} <span class="meta">· ${esc(s.examTitle)} · ${s.minutes} Min.</span></div>
        <div class="s-note">${esc(s.note)}</div>
      </div>
      <span class="badge ${s.type}">${TYPE_LABEL[s.type] || s.type}</span>
      <a class="btn small" href="#/klausur/${s.examId}/thema/${s.topicId}/${s.type === 'abfragen' ? 'quiz' : 'lernen'}">Los geht's</a>
    </div>`;
}

function examCardHtml(e) {
  const urgent = e.daysLeft <= 3;
  return `
    <div class="card exam-card mb0" onclick="location.hash='#/klausur/${e.id}'">
      <div class="row">
        <h3>${esc(e.title)}</h3>
        <span class="days-left ${urgent ? 'urgent' : ''}">${e.daysLeft < 0 ? 'vorbei' : e.daysLeft === 0 ? '🔥 HEUTE!' : `noch ${e.daysLeft} Tag${e.daysLeft === 1 ? '' : 'e'}`}</span>
      </div>
      <div class="meta" style="margin-bottom:12px">${esc(e.subject || 'Klausur')} · ${fmtDate(e.examDate)} · ${e.materialCount} Materialien</div>
      ${e.hasPlan ? `
        <div class="meta" style="display:flex;justify-content:space-between"><span>Plan-Fortschritt</span><span>${e.progress}%</span></div>
        <div class="progress"><div style="width:${e.progress}%"></div></div>
        <div class="meta mt" style="display:flex;justify-content:space-between;margin-top:8px"><span>Beherrschung</span><span>${e.mastery}%</span></div>
        <div class="progress green"><div style="width:${e.mastery}%"></div></div>`
      : '<span class="badge neutral">Noch kein Lernplan</span>'}
    </div>`;
}

const LEISTUNGSFAECHER = ['Mathe', 'Englisch', 'Sport'];

function matchesSubject(examSubject, name) {
  const s = (examSubject || '').toLowerCase();
  if (name === 'Mathe') return s.includes('mathe');
  if (name === 'Englisch') return s.includes('englisch');
  return s.includes('sport');
}

function abiturDashboardHtml(exams) {
  const subjectRows = LEISTUNGSFAECHER.map((name) => {
    const matching = exams.filter((e) => matchesSubject(e.subject, name));
    const withPlan = matching.filter((e) => e.hasPlan);
    const avgMastery = withPlan.length
      ? Math.round(withPlan.reduce((a, e) => a + e.mastery, 0) / withPlan.length)
      : 0;
    return `
      <div class="lf-row">
        <div class="lf-name">${esc(name)}</div>
        <div class="progress"><div style="width:${avgMastery}%"></div></div>
        <div class="lf-pct">${matching.length ? `${avgMastery}%` : '–'}</div>
      </div>`;
  }).join('');

  const withPlan = exams.filter((e) => e.hasPlan);
  const overallMastery = withPlan.length
    ? Math.round(withPlan.reduce((a, e) => a + e.mastery, 0) / withPlan.length)
    : 0;
  const upcoming = exams.filter((e) => e.daysLeft >= 0).sort((a, b) => a.daysLeft - b.daysLeft)[0];

  return `
    <div class="card abi-dash abi-hero">
      <div class="abi-hero-head">
        <div class="abi-hero-emoji">🎓</div>
        <div>
          <div class="abi-hero-kicker">Mein Ziel</div>
          <h2 class="abi-hero-title">Abitur mit 1,3</h2>
        </div>
      </div>
      <div class="grid cols-3 abi-milestones">
        <div class="abi-tile">
          <div class="abi-num">${overallMastery}%</div>
          <div class="abi-label">Ø Beherrschung gesamt</div>
        </div>
        <div class="abi-tile">
          <div class="abi-num">${withPlan.length}/${exams.length || 0}</div>
          <div class="abi-label">Klausuren mit Lernplan</div>
        </div>
        <div class="abi-tile">
          <div class="abi-num">${upcoming ? (upcoming.daysLeft === 0 ? '🔥' : upcoming.daysLeft) : '–'}</div>
          <div class="abi-label">${upcoming ? `Tage bis „${esc(upcoming.title)}"` : 'Noch keine Klausur geplant'}</div>
        </div>
      </div>
      <div class="lf-list">${subjectRows}</div>
      ${exams.length === 0 ? '<p class="meta abi-hint">Lege deine erste Klausur an, um deinen Fortschritt hier zu sehen. 👇</p>' : ''}
    </div>`;
}

/* ---------- Neue Klausur ---------- */

function renderNew() {
  const minDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  view.innerHTML = `
    <div class="page-head"><h1>Neue Klausur ankündigen</h1>
      <div class="sub">Schritt 1 von 3 – danach lädst du Materialien hoch und lässt den Lernplan erstellen.</div></div>
    <div class="card" style="max-width:560px">
      <form id="newExamForm">
        <label class="field"><span>Titel der Klausur *</span>
          <input type="text" name="title" required placeholder="z.B. Bio-Klausur: Genetik"></label>
        <label class="field"><span>Fach</span>
          <input type="text" name="subject" placeholder="z.B. Biologie"></label>
        <label class="field"><span>Klausurtermin *</span>
          <input type="date" name="examDate" required min="${minDate}"></label>
        <label class="field"><span>Lernzeit pro Tag (Minuten)</span>
          <input type="number" name="dailyMinutes" value="60" min="15" max="480" step="15">
          <div class="hint">Wie viel Zeit kannst du realistisch pro Tag investieren?</div></label>
        <label class="field"><span>Hinweise für den Assistenten (optional)</span>
          <textarea name="notes" placeholder="z.B. Schwerpunkt auf Kapitel 3, Mitochondrien fallen mir schwer …"></textarea></label>
        <button class="btn primary" type="submit" data-busy="Wird angelegt …">Weiter zu den Materialien →</button>
      </form>
    </div>`;

  document.getElementById('newExamForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const body = Object.fromEntries(fd.entries());
    await withBusy(ev.target.querySelector('button'), async () => {
      const { exam } = await api('/api/exams', { method: 'POST', body });
      await refreshState();
      location.hash = `#/klausur/${exam.id}`;
    });
  });
}

/* ---------- Klausur-Detail ---------- */

async function renderExam(examId) {
  loading();
  const { exam, summary, today } = await api(`/api/exams/${examId}`);

  const materialsHtml = (exam.materials || []).map((m) => `
    <div class="material-row">
      <span>${m.kind === 'image' ? '🖼️' : '📄'}</span>
      <span class="m-name">${esc(m.originalName)}</span>
      ${m.pending ? '<span class="badge warn">wartet auf API-Schlüssel</span>' : ''}
      <button class="btn small danger" data-del-material="${m.id}">✕</button>
    </div>`).join('') || '<p class="meta">Noch keine Materialien hochgeladen.</p>';

  const stepHint = !exam.materials.length
    ? '<div class="notice">📎 Schritt 2: Lade jetzt deine Lernunterlagen hoch – Fotos, PDFs, Word, PowerPoint …</div>'
    : !exam.plan
      ? '<div class="notice">✨ Schritt 3: Alles da? Dann lass dir jetzt deinen Lernplan erstellen!</div>'
      : '';

  view.innerHTML = `
    <div class="page-head">
      <div class="actions">
        <div>
          <h1>${esc(exam.title)}</h1>
          <div class="sub">${esc(exam.subject || 'Klausur')} · ${fmtDateLong(exam.examDate)} ·
            <strong>${summary.daysLeft < 0 ? 'vorbei' : summary.daysLeft === 0 ? 'HEUTE!' : `noch ${summary.daysLeft} Tage`}</strong>
            · ${exam.dailyMinutes} Min./Tag</div>
        </div>
        <div class="spacer"></div>
        <button class="btn danger small" id="deleteExam">🗑️ Löschen</button>
      </div>
    </div>
    ${stepHint}

    <div class="card">
      <h2>📎 Lernmaterialien <span class="meta">(${exam.materials.length})</span></h2>
      <div class="dropzone" id="dropzone">
        <div class="big">📤</div>
        <strong>Dateien hierher ziehen oder klicken</strong><br>
        <span class="meta">PDF, Word (.docx), PowerPoint (.pptx), Excel, Fotos (JPG/PNG), Textdateien … max. 30 MB pro Datei</span>
        <input type="file" id="fileInput" multiple hidden
               accept=".pdf,.docx,.pptx,.xlsx,.odt,.odp,.ods,.txt,.md,.csv,.tex,.html,.jpg,.jpeg,.png,.gif,.webp">
      </div>
      <div class="mt">${materialsHtml}</div>
    </div>

    <div class="card">
      <div class="actions">
        <h2 class="mb0" style="margin:0">🗓️ Lernplan</h2>
        <div class="spacer"></div>
        <button class="btn ${exam.plan ? '' : 'primary'}" id="genPlan"
                data-busy="Claude erstellt deinen Lernplan …" ${exam.materials.length || exam.plan ? '' : ''}>
          ${exam.plan ? '🔄 Plan neu erstellen' : '✨ Lernplan erstellen'}
        </button>
      </div>
      <div id="planArea">${exam.plan ? planHtml(exam, today) : '<p class="meta mt">Der Assistent zerlegt deine Materialien in Themen und verteilt sie auf die Tage bis zur Klausur – inklusive Wiederholungen und Generalprobe.</p>'}</div>
    </div>

    ${exam.topics.length ? `
    <div class="card">
      <h2>📚 Themen</h2>
      ${exam.topics.map((t) => topicRowHtml(exam.id, t)).join('')}
    </div>` : ''}
  `;

  bindExamHandlers(exam, examId);
}

function planHtml(exam, today) {
  const topicName = (id) => exam.topics.find((t) => t.id === id)?.name || '?';
  const days = exam.plan.days.map((d) => {
    const cls = d.date === today ? 'today' : d.date < today ? 'past' : '';
    return `
      <div class="day-block ${cls}">
        <div class="day-head">${d.date === today ? '📍 Heute' : fmtDate(d.date)} <span class="meta">${d.sessions.reduce((a, s) => a + s.minutes, 0)} Min.</span></div>
        ${d.sessions.map((s, i) => `
          <div class="session-item ${s.done ? 'done' : ''}">
            <input type="checkbox" ${s.done ? 'checked' : ''} data-toggle-session
                   data-exam-id="${exam.id}" data-date="${d.date}" data-index="${i}">
            <div class="s-body">
              <div class="s-title">${esc(topicName(s.topicId))} <span class="meta">· ${s.minutes} Min.</span></div>
              <div class="s-note">${esc(s.note)}</div>
            </div>
            <span class="badge ${s.type}">${TYPE_LABEL[s.type] || s.type}</span>
            <a class="btn small" href="#/klausur/${exam.id}/thema/${s.topicId}/${s.type === 'abfragen' ? 'quiz' : 'lernen'}">Öffnen</a>
          </div>`).join('')}
      </div>`;
  }).join('');

  return `
    <p class="mt">${esc(exam.plan.overview)}</p>
    ${exam.plan.totalEstimatedHours ? `<p class="meta">Geschätzter Gesamtaufwand: ca. ${exam.plan.totalEstimatedHours} Stunden</p>` : ''}
    ${days}`;
}

function topicRowHtml(examId, t) {
  const diffBadge = { leicht: 'ok', mittel: 'warn', schwer: 'err' }[t.difficulty] || 'neutral';
  return `
    <div class="topic-row" onclick="location.hash='#/klausur/${examId}/thema/${t.id}/lernen'">
      <div class="t-body">
        <div class="t-name">${esc(t.name)}</div>
        <div class="t-desc">${esc(t.description)}</div>
      </div>
      <span class="badge ${diffBadge}">${esc(t.difficulty || '')}</span>
      <div class="mastery-ring">
        <div class="num">Beherrschung ${t.mastery || 0}%</div>
        <div class="progress green"><div style="width:${t.mastery || 0}%"></div></div>
      </div>
    </div>`;
}

function bindExamHandlers(exam, examId) {
  const dz = document.getElementById('dropzone');
  const fi = document.getElementById('fileInput');
  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('drag');
    uploadFiles(examId, e.dataTransfer.files);
  });
  fi.addEventListener('change', () => uploadFiles(examId, fi.files));

  view.querySelectorAll('[data-del-material]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await api(`/api/exams/${examId}/materials/${btn.dataset.delMaterial}`, { method: 'DELETE' });
        renderExam(examId);
      } catch (err) { toast(err.message, true); }
    });
  });

  document.getElementById('genPlan').addEventListener('click', async (ev) => {
    if (!appState.hasApiKey) {
      toast('Bitte zuerst in den Einstellungen einen API-Schlüssel hinterlegen.', true);
      location.hash = '#/einstellungen';
      return;
    }
    await withBusy(ev.currentTarget, async () => {
      await api(`/api/exams/${examId}/plan`, { method: 'POST', body: {} });
      toast('Lernplan erstellt! 🎉');
      await refreshState();
      renderExam(examId);
    });
  });

  document.getElementById('deleteExam').addEventListener('click', async () => {
    if (!confirm(`„${exam.title}" wirklich löschen? Alle Materialien, Pläne und Lernstände gehen verloren.`)) return;
    await api(`/api/exams/${examId}`, { method: 'DELETE' });
    await refreshState();
    location.hash = '#/';
  });

  view.querySelectorAll('[data-toggle-session]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const { examId: eid, date, index } = cb.dataset;
      try {
        await api(`/api/exams/${eid}/sessions/toggle`, { method: 'POST', body: { date, index: Number(index) } });
        cb.closest('.session-item').classList.toggle('done', cb.checked);
      } catch (err) { toast(err.message, true); }
    });
  });
}

async function uploadFiles(examId, files) {
  if (!files || !files.length) return;
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  loading(`${files.length} Datei(en) werden hochgeladen und ausgelesen …`);
  try {
    const { warnings } = await api(`/api/exams/${examId}/materials`, { method: 'POST', body: fd });
    for (const w of warnings || []) toast(w, true);
    if (!warnings?.length) toast('Materialien hinzugefügt. ✅');
  } catch (err) {
    toast(err.message, true);
  }
  renderExam(examId);
}

/* ---------- Themen-Seite mit Tabs ---------- */

async function renderTopic(examId, topicId, tab) {
  loading();
  const { exam } = await api(`/api/exams/${examId}`);
  const topic = exam.topics.find((t) => t.id === topicId);
  if (!topic) throw new Error('Thema nicht gefunden.');

  const tabs = [
    ['lernen', '📖 Lernen'],
    ['quiz', '✍️ Quiz'],
    ['karten', '🃏 Karteikarten'],
    ['chat', '💬 Fragen stellen'],
  ];

  view.innerHTML = `
    <div class="page-head">
      <a href="#/klausur/${examId}" class="meta">← ${esc(exam.title)}</a>
      <h1>${esc(topic.name)}</h1>
      <div class="sub">${esc(topic.description)}</div>
      <div class="mt" style="max-width:340px">
        <div class="meta" style="display:flex;justify-content:space-between"><span>Beherrschung</span><span>${topic.mastery || 0}%</span></div>
        <div class="progress green"><div style="width:${topic.mastery || 0}%"></div></div>
      </div>
    </div>
    <div class="tabs">
      ${tabs.map(([key, label]) => `<button data-tab="${key}" class="${key === tab ? 'active' : ''}">${label}</button>`).join('')}
    </div>
    <div id="tabContent"></div>
  `;

  view.querySelectorAll('[data-tab]').forEach((b) => {
    b.addEventListener('click', () => { location.hash = `#/klausur/${examId}/thema/${topicId}/${b.dataset.tab}`; });
  });

  const content = document.getElementById('tabContent');
  if (tab === 'quiz') renderQuizTab(content, exam, topic);
  else if (tab === 'karten') renderFlashcardsTab(content, exam, topic);
  else if (tab === 'chat') renderChatTab(content, exam, topic);
  else renderLessonTab(content, exam, topic);
}

/* ----- Tab: Lektion ----- */

function renderLessonTab(el, exam, topic) {
  el.innerHTML = `
    <div class="actions" style="margin-bottom:16px">
      <button class="btn ${topic.lesson ? '' : 'primary'}" id="genLesson" data-busy="Claude schreibt deine Lektion …">
        ${topic.lesson ? '🔄 Lektion neu erstellen' : '✨ Lektion erstellen'}
      </button>
      ${topic.lesson ? `<span class="meta">Erstellt am ${new Date(topic.lesson.createdAt).toLocaleDateString('de-DE')}</span>` : ''}
    </div>
    ${topic.lesson
      ? `<div class="card md">${md(topic.lesson.content)}</div>
         <div class="actions"><a class="btn primary" href="#/klausur/${exam.id}/thema/${topic.id}/quiz">Weiter zum Quiz ✍️</a></div>`
      : `<div class="empty card"><div class="big">📖</div><p>Noch keine Lektion vorhanden.<br>Der Assistent erstellt aus deinen Materialien eine strukturierte Lerneinheit – mit Beispielen, Merkkasten und Selbsttest.</p></div>`}
  `;
  document.getElementById('genLesson').addEventListener('click', async (ev) => {
    await withBusy(ev.currentTarget, async () => {
      await api(`/api/exams/${exam.id}/topics/${topic.id}/lesson`, { method: 'POST', body: {} });
      renderTopic(exam.id, topic.id, 'lernen');
    });
  });
}

/* ----- Tab: Quiz ----- */

let currentQuiz = null;

function renderQuizTab(el, exam, topic) {
  currentQuiz = null;
  el.innerHTML = `
    <div class="card">
      <h2>✍️ Wissen abfragen</h2>
      <p class="meta">Gemischte Fragetypen: Multiple Choice, Wahr/Falsch, offene Fragen und Lückentexte. Ergebnisse fließen in dein Lern-Gedächtnis ein und steuern die Wiederholungen.</p>
      <div class="actions mt">
        <label class="field mb0" style="margin:0"><span>Anzahl Fragen</span>
          <select id="quizCount" style="width:110px">
            <option>4</option><option selected>6</option><option>8</option><option>10</option><option>12</option>
          </select></label>
        <div class="spacer"></div>
        <button class="btn primary" id="startQuiz" data-busy="Fragen werden erstellt …">🚀 Quiz starten</button>
      </div>
    </div>
    <div id="quizArea"></div>`;

  document.getElementById('startQuiz').addEventListener('click', async (ev) => {
    await withBusy(ev.currentTarget, async () => {
      const count = document.getElementById('quizCount').value;
      const data = await api(`/api/exams/${exam.id}/topics/${topic.id}/quiz`, { method: 'POST', body: { count } });
      currentQuiz = data;
      renderQuizQuestions(document.getElementById('quizArea'), exam, topic);
    });
  });
}

function renderQuizQuestions(area, exam, topic) {
  area.innerHTML = currentQuiz.questions.map((q, i) => {
    let body = '';
    if (q.type === 'mc') {
      body = q.options.map((o, j) => `
        <label class="q-option"><input type="radio" name="q${i}" value="${j}"> ${esc(o)}</label>`).join('');
    } else if (q.type === 'truefalse') {
      body = `
        <label class="q-option"><input type="radio" name="q${i}" value="true"> Wahr</label>
        <label class="q-option"><input type="radio" name="q${i}" value="false"> Falsch</label>`;
    } else if (q.type === 'cloze') {
      const blanks = Math.max(q.blanks || 1, 1);
      body = Array.from({ length: blanks }, (_, j) =>
        `<input type="text" data-blank="${j}" name="q${i}" placeholder="Lücke ${j + 1}" style="margin-bottom:7px">`).join('');
    } else {
      body = `<textarea name="q${i}" placeholder="Deine Antwort …"></textarea>`;
    }
    return `
      <div class="q-card" data-q="${i}">
        <div class="q-num">Frage ${i + 1} von ${currentQuiz.questions.length} · ${{ mc: 'Multiple Choice', truefalse: 'Wahr oder falsch?', open: 'Offene Frage', cloze: 'Lückentext' }[q.type] || ''}</div>
        <div class="q-text">${esc(q.question)}</div>
        ${body}
      </div>`;
  }).join('') + `
    <div class="actions"><button class="btn primary" id="submitQuiz" data-busy="Wird ausgewertet …">✅ Auswerten</button></div>`;

  document.getElementById('submitQuiz').addEventListener('click', async (ev) => {
    const answers = currentQuiz.questions.map((q, i) => {
      if (q.type === 'mc') {
        const sel = area.querySelector(`input[name="q${i}"]:checked`);
        return sel ? Number(sel.value) : null;
      }
      if (q.type === 'truefalse') {
        const sel = area.querySelector(`input[name="q${i}"]:checked`);
        return sel ? sel.value === 'true' : null;
      }
      if (q.type === 'cloze') {
        return [...area.querySelectorAll(`input[name="q${i}"]`)].map((inp) => inp.value);
      }
      return area.querySelector(`textarea[name="q${i}"]`).value;
    });

    await withBusy(ev.currentTarget, async () => {
      const res = await api(`/api/exams/${exam.id}/topics/${topic.id}/quiz/grade`, {
        method: 'POST',
        body: { quizId: currentQuiz.quizId, answers },
      });
      showQuizResults(area, exam, topic, res);
    });
  });
}

function showQuizResults(area, exam, topic, res) {
  const pct = Math.round((res.score / res.total) * 100);
  const emoji = pct >= 90 ? '🏆' : pct >= 70 ? '🎉' : pct >= 50 ? '💪' : '📚';
  const msg = pct >= 90 ? 'Hervorragend!' : pct >= 70 ? 'Gut gemacht!' : pct >= 50 ? 'Solide Basis – dranbleiben!' : 'Das Thema braucht noch etwas Liebe.';

  area.querySelectorAll('.q-card').forEach((card, i) => {
    const r = res.results[i];
    if (!r) return;
    card.classList.add(r.correct ? 'correct' : 'wrong');
    card.querySelectorAll('input, textarea, select').forEach((inp) => { inp.disabled = true; });
    card.insertAdjacentHTML('beforeend', `
      <div class="q-feedback">
        <strong>${r.correct ? '✅ Richtig!' : '❌ Nicht ganz.'}</strong>
        ${!r.correct && r.correctAnswer ? `<br><strong>Lösung:</strong> ${esc(r.correctAnswer)}` : ''}
        ${r.explanation ? `<br>${esc(r.explanation)}` : ''}
      </div>`);
  });

  document.getElementById('submitQuiz')?.remove();
  area.insertAdjacentHTML('afterbegin', `
    <div class="score-banner">
      <div class="big">${emoji} ${res.score} / ${res.total}</div>
      <p>${msg}</p>
      <p class="meta">Beherrschung jetzt: ${res.mastery}% · Nächste Wiederholung: ${fmtDate(res.nextReview)}</p>
    </div>`);
  area.insertAdjacentHTML('beforeend', `
    <div class="actions mt">
      <button class="btn primary" onclick="location.hash='#/klausur/${exam.id}/thema/${topic.id}/quiz';location.reload()">🔄 Noch ein Quiz</button>
      <a class="btn" href="#/klausur/${exam.id}/thema/${topic.id}/chat">💬 Fragen zum Thema stellen</a>
      <a class="btn" href="#/klausur/${exam.id}">Zur Klausur-Übersicht</a>
    </div>`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ----- Tab: Karteikarten ----- */

function renderFlashcardsTab(el, exam, topic) {
  el.innerHTML = `
    <div class="card">
      <h2>🃏 Karteikarten</h2>
      <p class="meta">Klassisches Karteikarten-Lernen: Karte ansehen, Antwort überlegen, umdrehen, ehrlich bewerten. Das Ergebnis fließt in dein Gedächtnis ein.</p>
      <div class="actions mt">
        <label class="field mb0" style="margin:0"><span>Anzahl Karten</span>
          <select id="fcCount" style="width:110px"><option>6</option><option selected>10</option><option>15</option><option>20</option></select></label>
        <div class="spacer"></div>
        <button class="btn primary" id="startFc" data-busy="Karten werden erstellt …">🚀 Karten erstellen</button>
      </div>
    </div>
    <div id="fcArea"></div>`;

  document.getElementById('startFc').addEventListener('click', async (ev) => {
    await withBusy(ev.currentTarget, async () => {
      const count = document.getElementById('fcCount').value;
      const { cards } = await api(`/api/exams/${exam.id}/topics/${topic.id}/flashcards`, { method: 'POST', body: { count } });
      runFlashcards(document.getElementById('fcArea'), exam, topic, cards);
    });
  });
}

function runFlashcards(area, exam, topic, cards) {
  let idx = 0;
  let known = 0;
  let flipped = false;

  function draw() {
    if (idx >= cards.length) {
      const pct = Math.round((known / cards.length) * 100);
      api(`/api/exams/${exam.id}/topics/${topic.id}/flashcards/result`, {
        method: 'POST', body: { known, total: cards.length },
      }).then((r) => {
        area.querySelector('.fc-meta').textContent =
          `Beherrschung jetzt: ${r.mastery}% · Nächste Wiederholung: ${fmtDate(r.nextReview)}`;
      }).catch(() => {});
      area.innerHTML = `
        <div class="score-banner">
          <div class="big">${pct >= 80 ? '🏆' : pct >= 50 ? '💪' : '📚'} ${known} / ${cards.length} gewusst</div>
          <p class="fc-meta">Ergebnis wird gespeichert …</p>
        </div>
        <div class="actions" style="justify-content:center">
          <button class="btn primary" id="fcAgain">🔄 Nochmal</button>
          <a class="btn" href="#/klausur/${exam.id}/thema/${topic.id}/quiz">Weiter zum Quiz ✍️</a>
        </div>`;
      document.getElementById('fcAgain').addEventListener('click', () => {
        idx = 0; known = 0; flipped = false; draw();
      });
      return;
    }
    const card = cards[idx];
    area.innerHTML = `
      <div class="flashcard ${flipped ? 'back' : ''}" id="fc">${esc(flipped ? card.back : card.front)}</div>
      <div class="fc-meta">Karte ${idx + 1} von ${cards.length} · ${flipped ? 'Wusstest du es?' : 'Klicken zum Umdrehen'}</div>
      <div class="fc-controls">
        ${flipped
          ? `<button class="btn" id="fcNo" style="color:var(--err)">❌ Nicht gewusst</button>
             <button class="btn primary" id="fcYes">✅ Gewusst</button>`
          : `<button class="btn primary" id="fcFlip">🔄 Umdrehen</button>`}
      </div>`;
    document.getElementById('fc').addEventListener('click', () => { flipped = !flipped; draw(); });
    document.getElementById('fcFlip')?.addEventListener('click', () => { flipped = true; draw(); });
    document.getElementById('fcYes')?.addEventListener('click', () => { known++; idx++; flipped = false; draw(); });
    document.getElementById('fcNo')?.addEventListener('click', () => { idx++; flipped = false; draw(); });
  }
  draw();
}

/* ----- Tab: Chat ----- */

function renderChatTab(el, exam, topic) {
  el.innerHTML = `
    <div class="card chat-box">
      <div class="chat-log" id="chatLog">
        ${(topic.chat || []).map(chatMsgHtml).join('') || `
          <div class="empty"><div class="big">💬</div>
          <p>Stell mir jede Frage zu <strong>${esc(topic.name)}</strong>!<br>
          Ich kenne deine Unterlagen und weiß, was du schon gelernt hast.</p></div>`}
      </div>
      <div class="chat-input">
        <textarea id="chatInput" placeholder="Deine Frage … (Enter zum Senden, Shift+Enter für neue Zeile)"></textarea>
        <button class="btn primary" id="chatSend">Senden</button>
      </div>
    </div>`;

  const log = document.getElementById('chatLog');
  const input = document.getElementById('chatInput');
  log.scrollTop = log.scrollHeight;

  async function send() {
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    log.querySelector('.empty')?.remove();
    log.insertAdjacentHTML('beforeend', chatMsgHtml({ role: 'user', content: msg }));
    log.insertAdjacentHTML('beforeend', `<div class="chat-msg assistant" id="pendingMsg"><span class="spinner"></span> denkt nach …</div>`);
    log.scrollTop = log.scrollHeight;
    try {
      const { reply } = await api(`/api/exams/${exam.id}/topics/${topic.id}/chat`, { method: 'POST', body: { message: msg } });
      document.getElementById('pendingMsg').outerHTML = chatMsgHtml({ role: 'assistant', content: reply });
    } catch (err) {
      document.getElementById('pendingMsg').outerHTML = chatMsgHtml({ role: 'assistant', content: `⚠️ ${err.message}` });
    }
    log.scrollTop = log.scrollHeight;
  }

  document.getElementById('chatSend').addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.focus();
}

function chatMsgHtml(m) {
  return `<div class="chat-msg ${m.role}">${m.role === 'assistant' ? `<div class="md">${md(m.content)}</div>` : esc(m.content)}</div>`;
}

/* ---------- Abi-Trainer ---------- */

const ABI_SUBJECT_ICON = { Mathe: '📐', Englisch: '🇬🇧', Sport: '🏃' };
let abiTask = null; // { subject, taskId, task, maxPoints, result }

async function renderAbiTrainer(subject) {
  loading();
  const data = await api(`/api/abi-trainer/${subject}`);

  if (!abiTask || abiTask.subject !== subject) abiTask = { subject, taskId: null, task: null, maxPoints: null, result: null };

  const materialsHtml = (data.materials || []).map((m) => `
    <div class="material-row">
      <span>${m.kind === 'image' ? '🖼️' : '📄'}</span>
      <span class="m-name">${esc(m.originalName)}</span>
      <button class="btn small danger" data-del-material="${m.id}">✕</button>
    </div>`).join('') || '<p class="meta">Noch keine Altklausuren hochgeladen.</p>';

  const historyHtml = data.taskHistory.length
    ? `<p class="meta">${data.taskHistory.length} Aufgabe${data.taskHistory.length === 1 ? '' : 'n'} bearbeitet ·
        letzte: ${data.taskHistory[data.taskHistory.length - 1].points}/${data.taskHistory[data.taskHistory.length - 1].maxPoints} Punkte</p>`
    : '<p class="meta">Noch keine Aufgabe bearbeitet.</p>';

  view.innerHTML = `
    <div class="page-head">
      <h1>🎯 Abi-Trainer</h1>
      <div class="sub">Eine Abituraufgabe auf Leistungsfach-Niveau, bewertet nach dem BW-Punkteschema (0–15 Punkte).</div>
    </div>
    <div class="tabs">
      ${LEISTUNGSFAECHER.map((s) => `<button data-subject="${s}" class="${s === subject ? 'active' : ''}">${ABI_SUBJECT_ICON[s]} ${s}</button>`).join('')}
    </div>

    <div class="card">
      <h2>📎 Altklausuren <span class="meta">(${data.materials.length})</span></h2>
      <div class="dropzone" id="dropzone">
        <div class="big">📤</div>
        <strong>Dateien hierher ziehen oder klicken</strong><br>
        <span class="meta">PDF, Word, PowerPoint, Fotos … z.B. vom STARK-Verlag</span>
        <input type="file" id="fileInput" multiple hidden
               accept=".pdf,.docx,.pptx,.xlsx,.odt,.odp,.ods,.txt,.md,.csv,.tex,.html,.jpg,.jpeg,.png,.gif,.webp">
      </div>
      <div class="mt">${materialsHtml}</div>
    </div>

    <div class="card">
      <div class="actions"><h2 class="mb0">✍️ Trainingsaufgabe</h2><div class="spacer"></div></div>
      ${historyHtml}
      <div id="abiTaskArea" class="mt">${abiTaskAreaHtml()}</div>
    </div>
  `;

  view.querySelectorAll('[data-subject]').forEach((b) => {
    b.addEventListener('click', () => { location.hash = `#/abi-trainer/${b.dataset.subject}`; });
  });

  const dz = document.getElementById('dropzone');
  const fi = document.getElementById('fileInput');
  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('drag'); uploadAbiFiles(subject, e.dataTransfer.files); });
  fi.addEventListener('change', () => uploadAbiFiles(subject, fi.files));

  view.querySelectorAll('[data-del-material]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/abi-trainer/${subject}/materials/${btn.dataset.delMaterial}`, { method: 'DELETE' });
        renderAbiTrainer(subject);
      } catch (err) { toast(err.message, true); }
    });
  });

  bindAbiTaskArea(subject);
}

function abiTaskAreaHtml() {
  if (abiTask.result) {
    const r = abiTask.result;
    return `
      <div class="score-banner">
        <div class="big">${r.points} / ${r.maxPoints} Punkte</div>
      </div>
      <div class="card md">${md(r.feedback)}</div>
      <h3 class="mt">Musterlösung (13–15 Punkte-Niveau)</h3>
      <div class="card md">${md(r.modelSolution)}</div>
      <button class="btn primary mt" id="abiNewTask">🎯 Neue Aufgabe stellen</button>`;
  }
  if (abiTask.task) {
    return `
      <div class="card md">${md(abiTask.task)}</div>
      <label class="field mt"><span>Deine Antwort</span>
        <textarea id="abiAnswer" rows="8" placeholder="Schreibe hier deine vollständige Lösung …"></textarea>
      </label>
      <button class="btn primary" id="abiGrade" data-busy="Wird korrigiert …">✅ Bewerten lassen</button>`;
  }
  return `
    <p class="meta">Stelle dir eine Abituraufgabe auf Leistungsfach-Niveau – vollständig, mit Musterlösung und Bewertung.</p>
    <button class="btn primary" id="abiNewTask" data-busy="Claude erstellt deine Aufgabe …">🎯 Aufgabe stellen</button>`;
}

function bindAbiTaskArea(subject) {
  const area = document.getElementById('abiTaskArea');
  const newTaskBtn = document.getElementById('abiNewTask');
  if (newTaskBtn) {
    newTaskBtn.addEventListener('click', async (ev) => {
      if (!appState.hasApiKey) {
        toast('Bitte zuerst in den Einstellungen einen API-Schlüssel hinterlegen.', true);
        location.hash = '#/einstellungen';
        return;
      }
      await withBusy(ev.currentTarget, async () => {
        const { taskId, task, maxPoints } = await api(`/api/abi-trainer/${subject}/task`, { method: 'POST', body: {} });
        abiTask = { subject, taskId, task, maxPoints, result: null };
        area.innerHTML = abiTaskAreaHtml();
        bindAbiTaskArea(subject);
      });
    });
  }
  const gradeBtn = document.getElementById('abiGrade');
  if (gradeBtn) {
    gradeBtn.addEventListener('click', async (ev) => {
      const answer = document.getElementById('abiAnswer').value.trim();
      await withBusy(ev.currentTarget, async () => {
        const result = await api(`/api/abi-trainer/${subject}/task/${abiTask.taskId}/grade`, { method: 'POST', body: { answer } });
        abiTask = { ...abiTask, result };
        await renderAbiTrainer(subject);
      });
    });
  }
}

async function uploadAbiFiles(subject, files) {
  if (!files || !files.length) return;
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  loading(`${files.length} Datei(en) werden hochgeladen und ausgelesen …`);
  try {
    const { warnings } = await api(`/api/abi-trainer/${subject}/materials`, { method: 'POST', body: fd });
    for (const w of warnings || []) toast(w, true);
    if (!warnings?.length) toast('Materialien hinzugefügt. ✅');
  } catch (err) {
    toast(err.message, true);
  }
  renderAbiTrainer(subject);
}

/* ---------- Einstellungen ---------- */

function renderSettings() {
  view.innerHTML = `
    <div class="page-head"><h1>Einstellungen</h1>
      <div class="sub">Der Lernassistent nutzt die Claude-API von Anthropic für Lernpläne, Lektionen, Quiz und Chat.</div></div>
    <div class="card" style="max-width:560px">
      <form id="settingsForm">
        <label class="field"><span>Anthropic-API-Schlüssel</span>
          <input type="password" name="apiKey" placeholder="${appState.hasApiKey ? '••••••••  (Schlüssel ist hinterlegt)' : 'sk-ant-…'}">
          <div class="hint">Zu bekommen unter <a href="https://console.anthropic.com/" target="_blank" rel="noopener">console.anthropic.com</a>.
          Der Schlüssel wird nur lokal auf deinem Rechner gespeichert (data/db.json). Leer lassen, um den vorhandenen zu behalten.</div></label>
        <label class="field"><span>Claude-Modell</span>
          <input type="text" name="model" value="${esc(appState.model || '')}" placeholder="claude-sonnet-5">
          <div class="hint">Standard: claude-sonnet-5 (gutes Preis-Leistungs-Verhältnis).</div></label>
        <button class="btn primary" type="submit" data-busy="Wird gespeichert …">💾 Speichern</button>
        ${appState.hasApiKey ? '<span class="badge ok" style="margin-left:10px">✓ Schlüssel aktiv</span>' : ''}
      </form>
    </div>
    <div class="card" style="max-width:560px">
      <h3>🔎 Wissenssuche (RAG)</h3>
      <p class="meta">Optional: mit einem Voyage-AI-Schlüssel durchsucht der Assistent deine hochgeladenen Materialien gezielt nach den relevantesten Abschnitten (statt alles auf einmal reinzukopieren) und kann im Chat die genaue Quelle nennen. Ohne Schlüssel funktioniert alles weiter wie bisher.</p>
      <form id="voyageForm">
        <label class="field"><span>Voyage-AI-API-Schlüssel</span>
          <input type="password" name="voyageApiKey" placeholder="${appState.hasVoyageKey ? '••••••••  (Schlüssel ist hinterlegt)' : 'pa-…'}">
          <div class="hint">Zu bekommen unter <a href="https://dashboard.voyageai.com/" target="_blank" rel="noopener">dashboard.voyageai.com</a>. Leer lassen, um den vorhandenen zu behalten.</div></label>
        <button class="btn primary" type="submit" data-busy="Wird gespeichert …">💾 Speichern</button>
        ${appState.hasVoyageKey ? '<span class="badge ok" style="margin-left:10px">✓ Schlüssel aktiv</span>' : ''}
      </form>
    </div>
    <div class="card" style="max-width:560px">
      <h3>So funktioniert der Assistent</h3>
      <ol style="padding-left:20px;margin:0">
        <li><strong>Klausur ankündigen</strong> – Titel, Fach, Termin und tägliche Lernzeit angeben.</li>
        <li><strong>Materialien hochladen</strong> – Fotos, PDFs, Word, PowerPoint & Co.</li>
        <li><strong>Lernplan erstellen lassen</strong> – Themen, Dauer und Wiederholungen bis zur Klausur.</li>
        <li><strong>Lernen & abfragen</strong> – Lektionen lesen, Quiz und Karteikarten machen, Fragen stellen.</li>
        <li><strong>Gedächtnis</strong> – der Assistent merkt sich deinen Lernstand und plant Wiederholungen (Spaced Repetition).</li>
      </ol>
    </div>`;

  document.getElementById('settingsForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const body = {};
    if (fd.get('apiKey')) body.apiKey = fd.get('apiKey');
    body.model = fd.get('model') || '';
    await withBusy(ev.target.querySelector('button'), async () => {
      await api('/api/settings', { method: 'POST', body });
      toast('Einstellungen gespeichert. ✅');
      await refreshState();
      renderSettings();
    });
  });

  document.getElementById('voyageForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    if (!fd.get('voyageApiKey')) { toast('Kein neuer Schlüssel eingegeben.', true); return; }
    await withBusy(ev.target.querySelector('button'), async () => {
      await api('/api/settings', { method: 'POST', body: { voyageApiKey: fd.get('voyageApiKey') } });
      toast('Einstellungen gespeichert. ✅');
      await refreshState();
      renderSettings();
    });
  });
}

/* ---------- Start ---------- */

refreshState().then(route).catch((err) => {
  view.innerHTML = `<div class="empty"><div class="big">😕</div><p>${esc(err.message)}</p></div>`;
});
