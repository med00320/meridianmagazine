/* ============================================================
   MERIDIAN · Mesa · app.js
   Orquestador de las tres vistas:
     · Mesa      · revisión editorial (existente)
     · Express   · sin revisión, con sectioner (nuevo)
     · Número    · maquetador editable (nuevo)
   ============================================================ */
(function () {
  'use strict';

  const I = window.MesaIngest;
  const C = window.MesaCritic;
  const Y = window.MesaLayout;
  const A = window.MesaApplier;
  const B = window.MesaBrand;
  const S = window.MesaSectioner;
  const X = window.MesaExpress;
  const Q = window.MesaIssue;

  const $ = (id) => document.getElementById(id);

  /* ============================================================
     ESTADO COMPARTIDO
     ============================================================ */
  const TWEAK_STORE = 'mesa-tweaks-v1';
  const DEFAULT_TWEAKS = {
    persona: 'jefe', severity: 'standard',
    length: 'standard', language: 'esES',
    variant: 'classic'
  };
  function loadTweaks() {
    try {
      const raw = localStorage.getItem(TWEAK_STORE);
      if (raw) return Object.assign({}, DEFAULT_TWEAKS, JSON.parse(raw));
    } catch {}
    return Object.assign({}, DEFAULT_TWEAKS);
  }
  function saveTweaks() {
    try { localStorage.setItem(TWEAK_STORE, JSON.stringify(state.tweaks)); } catch {}
  }

  const DRAFT_STORE = 'mesa-draft-v1';
  const SAVE_DEBOUNCE_MS = 700;
  let saveTimer = null;
  let lastSavedTs = 0;

  const state = {
    mode: 'mesa',          // mesa | express | issue
    source: null,
    pasteText: '',
    meta: { title: '', author: '', issue: '' },
    report: null,
    lastText: '',
    tweaks: loadTweaks(),
    expArticle: null,      // artículo previsualizado en Express (no añadido aún)
    expArticleId: null     // id si ya está en cola
  };

  /* ============================================================
     UTILIDADES UI
     ============================================================ */
  function log(msg, kind, where) {
    const box = (where === 'express') ? $('expLogBox') : $('logBox');
    if (!box) return;
    const line = document.createElement('div');
    line.className = 'log-line ' + (kind || 'ok');
    line.textContent = '› ' + msg;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }
  function toast(msg, kind, ms) {
    ms = ms || 3000;
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || 'ok');
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .25s'; }, ms);
    setTimeout(() => t.remove(), ms + 300);
  }
  function showOverlay(title) {
    let o = document.querySelector('.synth-overlay');
    if (!o) {
      o = document.createElement('div');
      o.className = 'synth-overlay';
      o.innerHTML = `
        <div class="so-mark">◆</div>
        <div class="so-title">${title || 'Trabajando…'}</div>
        <div class="so-step">Inicializando…</div>
        <div class="so-progress" style="--p: 0%"></div>`;
      document.body.appendChild(o);
    }
    return o;
  }
  function hideOverlay() {
    document.querySelectorAll('.synth-overlay').forEach(o => o.remove());
  }
  function updateOverlay(o, { step, pct }) {
    if (!o) return;
    if (step) o.querySelector('.so-step').textContent = step;
    if (typeof pct === 'number') o.querySelector('.so-progress').style.setProperty('--p', pct + '%');
  }

  /* ============================================================
     TABS · navegación entre vistas
     ============================================================ */
  function setMode(mode) {
    if (!['mesa', 'express', 'issue'].includes(mode)) mode = 'mesa';
    state.mode = mode;
    document.body.dataset.mode = mode;
    document.querySelectorAll('.hdr-tab').forEach(b => {
      const active = b.dataset.tab === mode;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-view]').forEach(v => {
      v.hidden = v.dataset.view !== mode;
    });
    refreshPrintButton();
    if (mode === 'issue') renderIssuePreview();
    if (mode === 'express') refreshExpressUI();
  }
  function bindTabs() {
    document.querySelectorAll('.hdr-tab').forEach(b => {
      b.addEventListener('click', () => setMode(b.dataset.tab));
    });
  }

  /* ============================================================
     IMPRIMIR · contextual al modo
     ============================================================ */
  function refreshPrintButton() {
    const btn = $('btnPrint'); if (!btn) return;
    if (state.mode === 'mesa')        btn.disabled = !state.report;
    else if (state.mode === 'express') btn.disabled = !state.expArticle;
    else if (state.mode === 'issue')   btn.disabled = !X.loadAll().length;
  }
  function doPrint() {
    if (state.mode === 'mesa') {
      if (!state.report) { toast('Genera un informe antes de imprimir', 'warn'); return; }
      renderReport();
      A.printPdf();
      return;
    }
    if (state.mode === 'express') {
      if (!state.expArticle) { toast('Carga o redacta un artículo primero', 'warn'); return; }
      renderExpressToPrintStage();
      A.printPdf();
      toast('Elige "Guardar como PDF" en el destino de impresión.', 'ok', 4000);
      return;
    }
    if (state.mode === 'issue') {
      const all = X.loadAll();
      if (!all.length) { toast('No hay artículos en el número', 'warn'); return; }
      Q.renderIssue($('printStage'), all, readIssueMeta(true));
      A.printPdf();
      toast('Elige "Guardar como PDF" en el destino de impresión.', 'ok', 4000);
    }
  }

  /* ============================================================
     AUTOGUARDADO MESA · borrador del texto + metadatos
     ============================================================ */
  function saveDraftNow() {
    try {
      const draft = {
        text: $('pasteText').value || '',
        meta: {
          title:  $('metaTitle').value  || '',
          author: $('metaAuthor').value || '',
          issue:  $('metaIssue').value  || ''
        },
        ts: Date.now()
      };
      if (!draft.text.trim() && !draft.meta.title && !draft.meta.author && !draft.meta.issue) {
        localStorage.removeItem(DRAFT_STORE);
        lastSavedTs = 0;
        refreshSavedIndicator();
        return;
      }
      localStorage.setItem(DRAFT_STORE, JSON.stringify(draft));
      lastSavedTs = draft.ts;
      refreshSavedIndicator();
    } catch {}
  }
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraftNow, SAVE_DEBOUNCE_MS);
  }
  function restoreDraft() {
    let draft = null;
    try {
      const raw = localStorage.getItem(DRAFT_STORE);
      if (raw) draft = JSON.parse(raw);
    } catch {}
    if (!draft) return;
    if (draft.text) $('pasteText').value = draft.text;
    if (draft.meta) {
      if (draft.meta.title)  $('metaTitle').value  = draft.meta.title;
      if (draft.meta.author) $('metaAuthor').value = draft.meta.author;
      if (draft.meta.issue)  $('metaIssue').value  = draft.meta.issue;
    }
    lastSavedTs = draft.ts || Date.now();
    refreshSavedIndicator();
    updatePasteStat();
    log('Borrador restaurado del último cierre.', 'ok');
  }
  function clearDraft() {
    try { localStorage.removeItem(DRAFT_STORE); } catch {}
    lastSavedTs = 0;
    refreshSavedIndicator();
  }
  function refreshSavedIndicator() {
    const el = $('savedIndicator');
    if (!el) return;
    if (!lastSavedTs) { el.textContent = ''; return; }
    const s = Math.round((Date.now() - lastSavedTs) / 1000);
    let label;
    if (s < 4)          label = 'Guardado';
    else if (s < 60)    label = `Guardado · ${s}s`;
    else if (s < 3600)  label = `Guardado · ${Math.floor(s/60)} min`;
    else                label = 'Guardado · ' + new Date(lastSavedTs)
                                  .toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    el.textContent = '✓ ' + label;
  }
  setInterval(refreshSavedIndicator, 20000);

  /* ============================================================
     META · lectura
     ============================================================ */
  function readMeta() {
    state.meta = {
      title:  $('metaTitle').value.trim(),
      author: $('metaAuthor').value.trim(),
      issue:  $('metaIssue').value.trim()
    };
  }

  /* ============================================================
     INPUT · archivo + pegado (vista MESA)
     ============================================================ */
  function bindDropzoneMesa() {
    const dz = $('dropzone');
    const inp = $('fileInput');

    dz.addEventListener('click', () => inp.click());
    dz.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); }
    });
    inp.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) loadFileMesa(f);
      inp.value = '';
    });

    ['dragenter', 'dragover'].forEach(ev => {
      dz.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(ev => {
      dz.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('drag'); });
    });
    dz.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFileMesa(f);
    });
  }

  async function loadFileMesa(file) {
    log(`Leyendo ${file.name}…`);
    const o = showOverlay('Leyendo archivo…');
    try {
      const res = await I.loadFile(file, (i, n) => {
        if (i % 3 === 0 || i === n) updateOverlay(o, { step: `${file.name}: pág ${i}/${n}`, pct: Math.round((i / n) * 100) });
      });
      const words = I.countWords(res.text);
      state.source = { fileName: file.name, kind: res.kind, text: res.text, words };
      if (!$('pasteText').value.trim()) {
        $('pasteText').value = res.text;
        state.pasteText = res.text;
        updatePasteStat();
      }
      renderSourceCard();
      log(`${file.name} · ${words} palabras`, 'ok');
      hideOverlay();
      refreshActionState();
    } catch (err) {
      hideOverlay();
      log(`Error en ${file.name}: ${err.message || err}`, 'err');
      toast(`Error en ${file.name}: ${err.message || err}`, 'err', 5000);
    }
  }

  function renderSourceCard() {
    const wrap = $('srcCardWrap');
    if (!state.source) { wrap.hidden = true; return; }
    wrap.hidden = false;
    $('srcKind').textContent = state.source.kind.toUpperCase();
    $('srcName').textContent = state.source.fileName;
    $('srcMeta').textContent = `${state.source.words} palabras`;
  }

  function bindRemoveSource() {
    $('srcRm').addEventListener('click', () => {
      state.source = null;
      renderSourceCard();
      log('Fuente eliminada.', 'warn');
    });
  }

  /* ============================================================
     PASTE STAT · MESA
     ============================================================ */
  const A5_WORDS_PER_PAGE = 280;
  const PAGE_TARGET_MIN = 14;
  const PAGE_TARGET_MAX = 24;
  const PAGE_FLOOD_LIMIT = 36;

  function estimatePages(words) {
    if (!words) return 0;
    return Math.max(1, Math.round(words / A5_WORDS_PER_PAGE));
  }
  function updatePageEstimate(words) {
    const el = $('pageEstimate'); if (!el) return;
    el.classList.remove('is-empty','is-short','is-ideal','is-long','is-flood');
    if (!words) { el.textContent = ''; el.classList.add('is-empty'); return; }
    const pages = estimatePages(words);
    let tone, label;
    if (pages < PAGE_TARGET_MIN)        { tone = 'is-short'; label = 'corto para A5'; }
    else if (pages <= PAGE_TARGET_MAX)  { tone = 'is-ideal'; label = 'ideal para A5'; }
    else if (pages <= PAGE_FLOOD_LIMIT) { tone = 'is-long';  label = 'largo'; }
    else                                 { tone = 'is-flood'; label = 'muy largo'; }
    el.classList.add(tone);
    el.textContent = `≈ ${pages} págs A5 · ${label}`;
  }
  function updatePasteStat() {
    const w = I.countWords($('pasteText').value);
    $('pasteStat').textContent = `${w} palabras`;
    state.pasteText = $('pasteText').value;
    updatePageEstimate(w);
    refreshActionState();
    scheduleSave();
  }
  function bindPasteMesa() {
    $('pasteText').addEventListener('input', updatePasteStat);
    $('btnLoadPaste').addEventListener('click', () => {
      const t = $('pasteText').value.trim();
      if (!t) { toast('No hay texto pegado', 'warn'); return; }
      state.source = { fileName: 'Pegado libre', kind: 'paste', text: t, words: I.countWords(t) };
      renderSourceCard();
      log(`Pegado libre cargado · ${state.source.words} palabras`, 'ok');
      refreshActionState();
    });
  }

  /* ============================================================
     ACTION STATE · MESA
     ============================================================ */
  function getActiveText() {
    const paste = $('pasteText').value.trim();
    if (paste) return paste;
    if (state.source && state.source.text) return state.source.text;
    return '';
  }
  function refreshActionState() {
    const has = !!getActiveText();
    const hasAI = C.hasLLM();
    $('btnCritique').disabled = !(has && hasAI);
    refreshPrintButton();
  }

  /* ============================================================
     PILLS
     ============================================================ */
  function refreshPills() {
    const t = state.tweaks;
    $('amProvider').textContent = C.hasLLM() ? C.currentLabel().split('·').slice(0,1).join('').trim().toUpperCase() : 'SIN IA';
    $('amPersona').textContent  = (C.PERSONAS[t.persona]   || {}).label || '—';
    $('amSeverity').textContent = (C.SEVERITIES[t.severity]|| {}).label || '—';
    $('amLength').textContent   = (C.LENGTHS[t.length]     || {}).label || '—';
    $('amLayout').textContent   = ({ classic: 'Clásica', modern: 'Moderna', notebook: 'Cuaderno' })[t.variant];
  }

  /* ============================================================
     BADGE IA + MODAL (idéntico al original)
     ============================================================ */
  function refreshBadge() {
    const b = $('aiBadge');
    b.classList.remove('ok', 'warn');
    if (C.hasLLM()) {
      const lbl = C.currentLabel();
      const short = lbl.split('·').slice(0,1).join('').trim().toUpperCase();
      b.textContent = 'IA · ' + short;
      b.classList.add('ok');
      b.title = 'IA activa: ' + lbl + '. Pulsa para cambiar.';
    } else {
      b.textContent = 'IA · CONFIGURAR';
      b.classList.add('warn');
      b.title = 'Sin IA configurada. Pulsa para elegir Ollama u OpenAI.';
    }
    refreshActionState();
    refreshPills();
  }
  function escapeAttr(s) { return Y.escapeHtml(s); }

  function openKeyModal() {
    const cfg = Object.assign({ provider: '', model: '', apiKey: '', baseUrl: '', customModel: '' }, C.getConfig());
    const providers = C.PROVIDERS;
    const overlay = document.createElement('div');
    overlay.className = 'key-modal-overlay';
    overlay.innerHTML = `
      <div class="key-modal">
        <div class="km-kicker">CONFIGURACIÓN · IA</div>
        <h3>Proveedor de modelo</h3>
        <div class="km-mode ${C.hasLLM() ? 'ok' : ''}">
          ${C.hasLLM() ? 'Activo · ' + C.currentLabel() : 'Sin IA · elige proveedor abajo'}
        </div>
        <div class="field">
          <label>Proveedor</label>
          <select id="kmProvider">
            <option value="">— Elige proveedor —</option>
            ${Object.entries(providers).map(([id, p]) =>
              `<option value="${id}" ${cfg.provider === id ? 'selected' : ''}>${p.label}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Modelo</label>
          <select id="kmModel"></select>
        </div>
        <div class="field" id="kmCustomModelWrap" style="display:none;">
          <label>Nombre del modelo (custom)</label>
          <input id="kmCustomModel" type="text" placeholder="ej. qwen2.5-coder:32b" value="${escapeAttr(cfg.customModel || '')}" />
        </div>
        <div class="field" id="kmBaseUrlWrap" style="display:none;">
          <div class="km-label-row" style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">
            <label for="kmBaseUrl" style="margin:0;">URL base del servidor</label>
            <button type="button" id="kmBaseUrlReset" class="km-reset-btn"
                    style="background:none;border:0;padding:0;font:inherit;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:var(--red,#a23);cursor:pointer;text-decoration:underline;text-underline-offset:3px;"
                    title="Restablecer al valor por defecto del proveedor">↺ Por defecto</button>
          </div>
          <input id="kmBaseUrl" type="text" placeholder="http://localhost:11434/v1" value="${escapeAttr(cfg.baseUrl || '')}" />
          <div class="km-helper" id="kmBaseUrlHint"></div>
        </div>
        <div class="field" id="kmKeyWrap" style="display:none;">
          <label>API key</label>
          <input id="kmKey" type="password" placeholder="(pega tu clave)" value="${escapeAttr(cfg.apiKey || '')}" autocomplete="off" />
          <div class="km-helper" id="kmKeyHint"></div>
        </div>
        <div class="km-warn"><strong>Aviso:</strong> la clave se guarda sin cifrar en <code>localStorage</code> de este navegador. No compartas el equipo.</div>
        <div class="km-actions">
          <button class="btn ghost" data-act="clear" type="button">Borrar config</button>
          <button class="btn ghost" data-act="cancel" type="button">Cancelar</button>
          <button class="btn primary" data-act="save" type="button">Guardar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const elProv = overlay.querySelector('#kmProvider');
    const elModel = overlay.querySelector('#kmModel');
    const elCustomW = overlay.querySelector('#kmCustomModelWrap');
    const elCustom = overlay.querySelector('#kmCustomModel');
    const elBaseW = overlay.querySelector('#kmBaseUrlWrap');
    const elBase = overlay.querySelector('#kmBaseUrl');
    const elBaseHint = overlay.querySelector('#kmBaseUrlHint');
    const elKeyW = overlay.querySelector('#kmKeyWrap');
    const elKey = overlay.querySelector('#kmKey');
    const elKeyHint = overlay.querySelector('#kmKeyHint');

    function syncProviderFields() {
      const pid = elProv.value;
      const p = providers[pid];
      if (!p) {
        elModel.innerHTML = '<option value="">—</option>';
        elBaseW.style.display = 'none'; elKeyW.style.display = 'none'; elCustomW.style.display = 'none';
        return;
      }
      elModel.innerHTML = p.models.map(m =>
        `<option value="${m.id}" ${m.id === cfg.model ? 'selected' : ''}>${m.label}</option>`).join('');
      if (!p.models.find(m => m.id === cfg.model)) elModel.value = p.defaultModel;
      if (p.needsBaseUrl) {
        elBaseW.style.display = '';
        if (!elBase.value) elBase.value = p.baseUrlDefault || '';
        elBaseHint.textContent = p.baseUrlHint || '';
      } else { elBaseW.style.display = 'none'; }
      if (p.needsKey) {
        elKeyW.style.display = '';
        elKey.placeholder = p.keyHint || '';
        elKeyHint.innerHTML = p.docs
          ? `Tu clave en <a href="${p.docs}" target="_blank" rel="noopener">${p.docs.replace(/^https?:\/\//, '')}</a>`
          : '';
      } else { elKeyW.style.display = 'none'; }
      syncCustom();
    }
    function syncCustom() {
      elCustomW.style.display = (elModel.value === '__custom__') ? '' : 'none';
    }

    elProv.addEventListener('change', () => { cfg.model = ''; syncProviderFields(); });
    elModel.addEventListener('change', syncCustom);
    overlay.querySelector('#kmBaseUrlReset').addEventListener('click', () => {
      const p = providers[elProv.value];
      if (!p || !p.needsBaseUrl) return;
      elBase.value = p.baseUrlDefault || '';
      elBase.focus(); elBase.select();
      toast(`URL base restablecida a ${p.baseUrlDefault}`, 'ok', 2500);
    });
    syncProviderFields();

    function close() { overlay.remove(); }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
    overlay.querySelector('[data-act="clear"]').addEventListener('click', () => {
      C.clearConfig(); refreshBadge(); toast('Configuración borrada', 'ok'); close();
    });
    overlay.querySelector('[data-act="save"]').addEventListener('click', () => {
      const pid = elProv.value;
      const p = providers[pid];
      if (!p) { toast('Elige proveedor', 'warn'); return; }
      const newCfg = {
        provider: pid,
        model: elModel.value,
        apiKey: p.needsKey ? elKey.value.trim() : '',
        baseUrl: p.needsBaseUrl ? elBase.value.trim() : '',
        customModel: elCustom.value.trim()
      };
      if (p.needsKey && !newCfg.apiKey) { toast('Falta la API key', 'warn'); return; }
      if (p.needsBaseUrl && !newCfg.baseUrl) { toast('Falta la URL base', 'warn'); return; }
      if (newCfg.model === '__custom__' && !newCfg.customModel) { toast('Especifica el nombre del modelo', 'warn'); return; }
      C.setConfig(newCfg);
      refreshBadge();
      toast('Configuración guardada', 'ok');
      close();
    });
  }

  /* ============================================================
     CRÍTICA · botón principal
     ============================================================ */
  async function runCritique() {
    const text = getActiveText();
    if (!text) { toast('Carga o pega un texto primero', 'warn'); return; }
    if (!C.hasLLM()) { toast('Configura IA primero (badge arriba)', 'err'); openKeyModal(); return; }
    readMeta();

    const o = showOverlay('Pasando por la mesa…');
    try {
      const report = await C.critique({
        text, meta: state.meta,
        persona: state.tweaks.persona,
        severity: state.tweaks.severity,
        length: state.tweaks.length,
        language: state.tweaks.language,
        onProgress: (info) => updateOverlay(o, info)
      });
      state.report = report;
      state.lastText = text;
      renderReport();
      renderExportBar();
      hideOverlay();
      log(`Informe listo · ${(report.fricciones || []).length} fricciones · veredicto: ${report.veredicto || '—'}`, 'ok');
      refreshPrintButton();
    } catch (err) {
      hideOverlay();
      console.error('[mesa]', err);
      log('Error: ' + (err.message || err), 'err');
      toast('No se pudo generar el informe.\n\n' + (err.message || err), 'err', 9000);
    }
  }

  function renderReport() {
    readMeta();
    const opts = {
      report: state.report,
      meta: state.meta,
      variant: state.tweaks.variant,
      providerLabel: C.hasLLM() ? C.currentLabel() : ''
    };
    Y.render($('reportFrame'), opts);
    Y.render($('printStage'), opts);
  }

  /* ============================================================
     EXPORT BAR · MESA
     ============================================================ */
  function renderExportBar() {
    const bar = $('exportBar');
    if (!bar) return;
    if (!state.report) { bar.hidden = true; return; }
    bar.hidden = false;
    const fricciones = state.report.fricciones || [];
    const withProp = fricciones.filter(f => (f.propuesta || '').trim()).length;
    const verd = (state.report.veredicto || '—').toUpperCase().replace(/_/g, ' ');
    $('ebStats').textContent = `${withProp} reescrituras propuestas · ${fricciones.length} fricciones · veredicto: ${verd}`;
  }

  function correctedText() {
    const original = state.lastText || getActiveText();
    if (!original) return null;
    const fricciones = state.report.fricciones || [];
    const res = A.applyRewrites(original, fricciones);
    return { text: res.text, applied: res.applied, total: res.total, skipped: res.skipped };
  }

  function exportCorrected(format) {
    if (!state.report) { toast('Genera el informe primero', 'warn'); return; }
    const r = correctedText();
    if (!r) { toast('No queda texto original que corregir', 'warn'); return; }
    const base = A.slug(state.meta.title || 'texto') + '-corregido';

    if (format === 'md') {
      const md = A.buildMarkdownReport(r.text, state.report.fricciones, state.meta, state.report);
      A.downloadBlob(md, base + '.md', 'text/markdown;charset=utf-8');
    } else if (format === 'doc') {
      A.exportWord(r.text, state.meta, base);
    } else if (format === 'pdf') {
      // PDF de la Mesa = informe en A5, no del texto corregido
      renderReport();
      A.printPdf();
      toast('Elige "Guardar como PDF" en el destino de impresión.', 'ok', 4000);
      return;
    } else {
      A.downloadBlob(r.text, base + '.txt', 'text/plain;charset=utf-8');
    }

    log(`Descargado · ${r.applied}/${r.total} reescrituras aplicadas`, 'ok');
    if (r.skipped.length) {
      const reasons = r.skipped.map(s => `  ${String(s.idx).padStart(2,'0')} · ${s.reason}${s.cita ? ' · "' + s.cita.slice(0, 60) + '…"' : ''}`).join('\n');
      toast(`${r.applied}/${r.total} reescrituras aplicadas.\n${r.skipped.length} no aplicadas:\n${reasons}`, 'warn', 9000);
    } else if (r.applied > 0) {
      toast(`${r.applied} reescrituras aplicadas al texto.`, 'ok', 4000);
    }
  }

  async function sendCorrectedToIssue() {
    if (!state.report) { toast('Genera el informe primero', 'warn'); return; }
    const r = correctedText();
    if (!r) { toast('No hay texto que enviar', 'warn'); return; }
    const o = showOverlay('Enviando al número…');
    try {
      const md = `${state.meta.issue ? state.meta.issue.toUpperCase() + '\n\n' : ''}` +
                 `${state.meta.title ? '# ' + state.meta.title + '\n\n' : ''}` +
                 `${state.meta.author ? 'POR ' + state.meta.author.toUpperCase() + '\n\n' : ''}` +
                 r.text;
      const { entry } = await X.importFromText(md, {
        meta: state.meta,
        autoTitles: true,
        onProgress: (i) => updateOverlay(o, i)
      });
      hideOverlay();
      log(`Artículo añadido al número · id ${entry.id.slice(-6)}`, 'ok');
      toast('Artículo añadido al número.', 'ok', 3500);
    } catch (err) {
      hideOverlay();
      toast('No se pudo enviar al número: ' + (err.message || err), 'err', 6000);
    }
  }

  /* ============================================================
     RE-CRITICAR
     ============================================================ */
  async function applyAndRecritique() {
    if (!state.report) { toast('Genera el informe primero', 'warn'); return; }
    const original = state.lastText || getActiveText();
    if (!original) { toast('No hay texto que iterar', 'warn'); return; }

    const fricciones = state.report.fricciones || [];
    const withProp = fricciones.filter(f => (f.propuesta || '').trim()).length;
    if (!withProp) {
      toast('Este informe no trae reescrituras concretas que aplicar.', 'warn', 4500);
      return;
    }
    const ok = confirm(
      `Vas a aplicar ${withProp} reescritura(s) al texto y pasarlo de nuevo por la mesa.\n\n` +
      `El texto original quedará sustituido por el corregido en el editor.\n\n¿Continuar?`
    );
    if (!ok) return;

    const res = A.applyRewrites(original, fricciones);
    if (res.applied === 0) {
      toast('Ninguna reescritura se pudo aplicar. Re-criticando sobre el texto original.', 'warn', 5000);
    } else {
      log(`Aplicadas ${res.applied}/${res.total} reescrituras antes de re-criticar`, 'ok');
    }
    $('pasteText').value = res.text;
    updatePasteStat();
    if (state.source) {
      state.source = {
        fileName: '(Iteración) ' + ((state.source && state.source.fileName) || 'Texto'),
        kind: 'paste', text: res.text, words: I.countWords(res.text)
      };
      renderSourceCard();
    }
    log('Re-criticando texto corregido…', 'ok');
    await runCritique();
  }

  /* ============================================================
     HANDOFF AL SINTETIZADOR · sólo si existe ../index.html
     ============================================================ */
  async function detectSynthesizer() {
    try {
      const res = await fetch('../index.html', { method: 'HEAD' });
      if (res.ok) $('btnHandoff').hidden = false;
    } catch { /* file:// no permite HEAD: lo dejamos oculto, que es lo seguro */ }
  }
  function handoffToSynth() {
    if (!state.report) { toast('Genera el informe primero', 'warn'); return; }
    const r = correctedText();
    if (!r) { toast('No hay texto que enviar', 'warn'); return; }
    const payload = {
      text: r.text, meta: state.meta,
      fileName: (state.source && state.source.fileName) || (state.meta.title || 'Texto · Mesa'),
      mode: 'maquetar',
      appliedCount: r.applied, totalCount: r.total, skippedCount: r.skipped.length,
      timestamp: Date.now()
    };
    try { localStorage.setItem('meridian-mesa-handoff-v1', JSON.stringify(payload)); }
    catch (err) { toast('No se pudo guardar el handoff: ' + err.message, 'err', 6000); return; }
    setTimeout(() => { window.open('../index.html', '_blank'); }, 200);
  }

  /* ============================================================
     EXPRESS · Pegar / subir
     ============================================================ */
  function bindExpressDropzone() {
    const dz = $('expDropzone'); const inp = $('expFileInput');
    dz.addEventListener('click', () => inp.click());
    dz.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); }
    });
    inp.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) loadFileExpress(f);
      inp.value = '';
    });
    ['dragenter', 'dragover'].forEach(ev => {
      dz.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(ev => {
      dz.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('drag'); });
    });
    dz.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFileExpress(f);
    });
  }

  async function loadFileExpress(file) {
    log(`Leyendo ${file.name}…`, 'ok', 'express');
    const o = showOverlay('Leyendo archivo…');
    try {
      const res = await I.loadFile(file, (i, n) => {
        if (i % 3 === 0 || i === n) updateOverlay(o, { step: `${file.name}: pág ${i}/${n}`, pct: Math.round((i / n) * 100) });
      });
      hideOverlay();
      $('expText').value = res.text;
      updateExpStat();
      if (!$('expTitle').value) $('expTitle').value = file.name.replace(/\.[^.]+$/, '');
      log(`${file.name} cargado en Express`, 'ok', 'express');
    } catch (err) {
      hideOverlay();
      toast('Error: ' + (err.message || err), 'err', 5000);
      log('Error: ' + (err.message || err), 'err', 'express');
    }
  }

  function updateExpStat() {
    const w = I.countWords($('expText').value);
    $('expPasteStat').textContent = `${w} palabras`;
  }

  function bindExpressTabs() {
    document.querySelectorAll('.exp-tab').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.exp-tab').forEach(x => x.classList.toggle('is-active', x === b));
        document.querySelectorAll('[data-exp-pane]').forEach(p => {
          p.hidden = p.dataset.expPane !== b.dataset.exp;
        });
      });
    });
  }

  function readExpressMeta() {
    return {
      title:  $('expTitle').value.trim(),
      author: $('expAuthor').value.trim(),
      issue:  $('expIssue').value.trim()
    };
  }
  function readAiMeta() {
    return {
      title:  $('aiTitle').value.trim(),
      author: $('aiAuthor').value.trim(),
      issue:  $('aiIssue').value.trim()
    };
  }

  async function expressImport() {
    const text = $('expText').value.trim();
    if (!text) { toast('Pega texto o sube un archivo primero', 'warn'); return; }
    const meta = readExpressMeta();
    if (!meta.title) {
      const proceed = confirm('No has puesto título. ¿Continuar igualmente? (puedes editarlo luego)');
      if (!proceed) return;
    }
    const o = showOverlay('Estructurando artículo…');
    try {
      // Si el texto no viene con `# Título`, lo prepuesto desde el campo de meta
      let md = text;
      if (!/^#\s+/m.test(md) && meta.title) md = '# ' + meta.title + '\n\n' + md;
      if (meta.author && !/^POR\s+/im.test(md)) md = md.replace(/^(#\s+[^\n]+\n+)/, '$1POR ' + meta.author.toUpperCase() + '\n\n');
      if (meta.issue && !new RegExp('^' + meta.issue.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'm').test(md)) {
        md = meta.issue.toUpperCase() + '\n\n' + md;
      }
      const article = await S.structure(md, {
        meta, autoTitles: true,
        onProgress: (i) => updateOverlay(o, i)
      });
      state.expArticle = article;
      state.expArticleId = null;
      renderExpressPreview(article);
      hideOverlay();
      log(`Artículo estructurado · ${article.stats.sections} secciones · ${article.stats.words} palabras`, 'ok', 'express');

      // Auto-añadir al número
      const entry = X.add(article, 'paste');
      state.expArticleId = entry.id;
      log(`Añadido al número (id ${entry.id.slice(-6)})`, 'ok', 'express');
      toast(`Artículo añadido al número · ${article.stats.sections} secciones, ${article.stats.words} palabras.`, 'ok', 4500);
      refreshExpressUI();
    } catch (err) {
      hideOverlay();
      log('Error: ' + (err.message || err), 'err', 'express');
      toast('No se pudo estructurar: ' + (err.message || err), 'err', 6000);
    }
  }

  async function expressGenerate() {
    if (!C.hasLLM()) { toast('Configura IA primero (badge arriba)', 'err'); openKeyModal(); return; }
    const brief = $('aiBrief').value.trim();
    if (!brief) { toast('Escribe el encargo (brief) antes de redactar', 'warn'); return; }
    const meta = readAiMeta();
    const words = parseInt($('aiWords').value, 10) || 2000;

    const o = showOverlay('Redactando al estilo Meridian…');
    try {
      const { entry, article } = await X.generateAndImport({
        brief, words, meta, language: state.tweaks.language,
        onProgress: (i) => updateOverlay(o, i)
      });
      state.expArticle = article;
      state.expArticleId = entry.id;
      renderExpressPreview(article);
      hideOverlay();
      log(`Artículo redactado y añadido · ${article.stats.words} palabras · ${article.stats.sections} secciones`, 'ok', 'express');
      toast(`Artículo redactado · ${article.stats.words} palabras.\nYa está en el número.`, 'ok', 5000);
      refreshExpressUI();
    } catch (err) {
      hideOverlay();
      log('Error: ' + (err.message || err), 'err', 'express');
      toast('No se pudo redactar: ' + (err.message || err), 'err', 8000);
    }
  }

  function renderExpressPreview(article) {
    const html = Q.renderArticle(article, { num: 1, total: 1 });
    $('expPreview').innerHTML = '<div class="iss-doc iss-preview-single">' + html + '</div>';
    $('expPreviewStats').textContent =
      `${article.stats.words} palabras · ${article.stats.sections} secciones · ` +
      `${article.stats.withTitle} con intertítulo · ≈ ${article.stats.pages} págs A5`;
  }

  function refreshExpressUI() {
    const has = !!state.expArticle;
    $('btnExpExportDoc').disabled = !has;
    $('btnExpExportMd').disabled  = !has;
    $('btnExpDiscard').disabled   = !has;
    $('btnExpToMesa').disabled    = !has;
    refreshPrintButton();
  }

  function expressDiscard() {
    if (!state.expArticle) return;
    if (state.expArticleId) {
      if (!confirm('Vas a quitar este artículo del número en preparación. ¿Continuar?')) return;
      X.remove(state.expArticleId);
      log(`Artículo quitado del número (id ${state.expArticleId.slice(-6)})`, 'warn', 'express');
    }
    state.expArticle = null;
    state.expArticleId = null;
    $('expPreview').innerHTML = `
      <div class="empty-state">
        <div class="empty-mark">◆</div>
        <h3>Aún no hay artículo</h3>
      </div>`;
    $('expPreviewStats').textContent = 'Aún no hay artículo cargado.';
    refreshExpressUI();
  }

  function expressExport(format) {
    if (!state.expArticle) return;
    const md = S.articleToMarkdown(state.expArticle);
    const meta = {
      title:  state.expArticle.titulo,
      author: state.expArticle.autor,
      issue:  state.expArticle.kicker
    };
    const base = A.slug(meta.title || 'articulo');
    if (format === 'md') {
      A.downloadBlob(md, base + '.md', 'text/markdown;charset=utf-8');
    } else if (format === 'doc') {
      A.exportWord(md, meta, base);
    }
    log(`Descargado ${base}.${format}`, 'ok', 'express');
  }

  function expressToMesa() {
    if (!state.expArticle) return;
    const md = S.articleToMarkdown(state.expArticle);
    setMode('mesa');
    $('pasteText').value = md;
    $('metaTitle').value  = state.expArticle.titulo  || '';
    $('metaAuthor').value = state.expArticle.autor   || '';
    $('metaIssue').value  = state.expArticle.kicker  || '';
    updatePasteStat();
    log('Artículo cargado en la Mesa para revisión.', 'ok');
    toast('Artículo en la Mesa. Pulsa "Pasar por la mesa" cuando quieras revisarlo.', 'ok', 5000);
  }

  /* ============================================================
     NÚMERO · maquetador
     ============================================================ */
  function readIssueMeta(silent) {
    const m = {
      number:        $('issNumber').value.trim(),
      season:        $('issSeason').value,
      year:          $('issYear').value.trim(),
      theme:         $('issTheme').value.trim(),
      themeAuthor:   $('issThemeAuthor').value.trim(),
      tagline:       $('issTagline').value.trim(),
      closingQuote:  $('issClosingQuote').value.trim(),
      closingAttrib: $('issClosingAttrib').value.trim(),
      colophon:      $('issColophon').value.trim(),
      site:          $('issSite').value.trim()
    };
    if (!silent) Q.saveMeta(m);
    return m;
  }
  function fillIssueForm(m) {
    $('issNumber').value        = m.number || '';
    $('issSeason').value        = m.season || 'Primavera';
    $('issYear').value          = m.year || '';
    $('issTheme').value         = m.theme || '';
    $('issThemeAuthor').value   = m.themeAuthor || '';
    $('issTagline').value       = m.tagline || '';
    $('issClosingQuote').value  = m.closingQuote || '';
    $('issClosingAttrib').value = m.closingAttrib || '';
    $('issColophon').value      = m.colophon || '';
    $('issSite').value          = m.site || '';
  }

  function bindIssueForm() {
    ['issNumber','issSeason','issYear','issTheme','issThemeAuthor','issTagline',
     'issClosingQuote','issClosingAttrib','issColophon','issSite'].forEach(id => {
      const el = $(id); if (!el) return;
      el.addEventListener('input', () => {
        readIssueMeta();
        renderIssuePreview();
      });
      el.addEventListener('change', () => {
        readIssueMeta();
        renderIssuePreview();
      });
    });
  }

  function renderIssueQueue() {
    const wrap = $('issQueue');
    const all = X.loadAll();
    if (!all.length) {
      wrap.innerHTML = '<div class="iss-queue-empty">El número está vacío. Añade artículos desde Mesa o Express.</div>';
      return;
    }
    wrap.innerHTML = all.map((e, i) => {
      const a = e.article || {};
      const w = (a.stats && a.stats.words) || 0;
      const src = e.source === 'ai' ? 'IA' : (e.source === 'paste' ? 'Pegado' : 'Mesa');
      return `
        <div class="iss-queue-item" data-id="${e.id}">
          <div class="iqi-num">${String(i + 1).padStart(2, '0')}</div>
          <div class="iqi-body">
            <div class="iqi-title">${Y.escapeHtml(a.titulo || 'Sin título')}</div>
            <div class="iqi-meta">${Y.escapeHtml(a.autor || '—')} · ${w} pal · ${src}</div>
          </div>
          <div class="iqi-actions">
            <button type="button" data-act="up"   title="Subir">↑</button>
            <button type="button" data-act="down" title="Bajar">↓</button>
            <button type="button" data-act="rm"   title="Quitar">×</button>
          </div>
        </div>`;
    }).join('');

    wrap.querySelectorAll('.iss-queue-item').forEach(item => {
      const id = item.dataset.id;
      item.querySelector('[data-act="rm"]').addEventListener('click', () => {
        if (!confirm('Quitar este artículo del número?')) return;
        X.remove(id);
        renderIssueQueue();
        renderIssuePreview();
      });
      item.querySelector('[data-act="up"]').addEventListener('click', () => moveQueue(id, -1));
      item.querySelector('[data-act="down"]').addEventListener('click', () => moveQueue(id, +1));
    });
  }

  function moveQueue(id, delta) {
    const all = X.loadAll();
    const i = all.findIndex(e => e.id === id);
    if (i === -1) return;
    const j = i + delta;
    if (j < 0 || j >= all.length) return;
    const ids = all.map(e => e.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    X.reorder(ids);
    renderIssueQueue();
    renderIssuePreview();
  }

  function renderIssuePreview() {
    const all = X.loadAll();
    const meta = readIssueMeta(true);
    Q.renderIssue($('issPreview'), all, meta);
    const est = Q.pageEstimate(all);
    $('issStats').textContent = all.length
      ? `${all.length} artículos · ${est.words} palabras · ≈ ${est.total} págs A5 (1 portada · 1 sumario · ${est.body} cuerpo · 1 contraportada)`
      : 'Sin artículos en el número.';
    renderIssueQueue();
    refreshPrintButton();
  }

  function renderExpressToPrintStage() {
    if (!state.expArticle) return;
    const html = '<div class="iss-doc">' + Q.renderArticle(state.expArticle, { num: 1, total: 1 }) + '</div>';
    $('printStage').innerHTML = html;
  }

  async function issueAutoCopy() {
    if (!C.hasLLM()) { toast('Configura IA primero', 'err'); openKeyModal(); return; }
    const all = X.loadAll();
    if (!all.length) { toast('Añade artículos al número antes de pedir copy', 'warn'); return; }
    const o = showOverlay('Pidiendo copy del número…');
    try {
      const data = await Q.autoCopy(all);
      hideOverlay();
      if (data.theme && !$('issTheme').value)        $('issTheme').value = data.theme;
      if (data.tagline)                               $('issTagline').value = data.tagline;
      if (data.closingQuote)                          $('issClosingQuote').value = data.closingQuote;
      readIssueMeta();
      renderIssuePreview();
      toast('Copy del número actualizado.', 'ok', 3500);
    } catch (err) {
      hideOverlay();
      toast('No se pudo: ' + (err.message || err), 'err', 6000);
    }
  }

  function issueClear() {
    if (!confirm('Vaciar el número entero? (los artículos individuales se borrarán)')) return;
    X.clear();
    renderIssuePreview();
  }

  function issueExportDoc() {
    const all = X.loadAll();
    if (!all.length) { toast('Sin artículos', 'warn'); return; }
    const meta = readIssueMeta(true);
    // Concatenamos todos los artículos en un solo .doc HTML
    let combined = '';
    all.forEach((e, i) => {
      const a = e.article || {};
      combined += (i ? '\n\n' : '') +
        (a.kicker ? a.kicker + '\n\n' : '') +
        (a.titulo ? '# ' + a.titulo + '\n\n' : '') +
        (a.subtitulo ? '*' + a.subtitulo + '*\n\n' : '') +
        (a.autor ? 'POR ' + a.autor.toUpperCase() + '\n\n' : '');
      (a.secciones || []).forEach((s, j) => {
        if (s.titulo && j > 0) combined += '## ' + s.titulo + '\n\n';
        combined += (s.parrafos || []).join('\n\n') + '\n\n';
      });
      combined += '◆\n\n';
    });
    const issueLabel = `Meridian N.º ${meta.number || '—'} · ${meta.season || ''} ${meta.year || ''}`.trim();
    A.exportWord(combined, { title: issueLabel, author: meta.theme || '', issue: '' },
      'meridian-' + (meta.number || 'numero') + '-' + (meta.year || ''));
    log(`Número exportado a Word`, 'ok');
  }

  /* ============================================================
     RESET (vista MESA)
     ============================================================ */
  function doReset() {
    if (state.mode !== 'mesa') {
      toast('El reinicio sólo afecta a la vista Mesa.', 'warn', 3000);
      return;
    }
    if (!confirm('¿Vaciar la mesa? Se borran el texto, los metadatos y el informe (la configuración de IA, los tweaks y el número se mantienen).')) return;
    state.source = null; state.pasteText = ''; state.report = null; state.lastText = '';
    state.meta = { title: '', author: '', issue: '' };
    $('pasteText').value = '';
    $('metaTitle').value = '';
    $('metaAuthor').value = '';
    $('metaIssue').value = '';
    renderSourceCard();
    updatePasteStat();
    Y.render($('reportFrame'), { report: null, meta: state.meta, variant: state.tweaks.variant });
    renderExportBar();
    refreshActionState();
    clearDraft();
    log('Mesa vaciada.', 'warn');
  }

  /* ============================================================
     TWEAKS · panel host-controlled (igual que antes)
     ============================================================ */
  function buildTweaksProtocol() {
    window.addEventListener('message', (e) => {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === '__activate_edit_mode')   showTweaks(true);
      if (e.data.type === '__deactivate_edit_mode') showTweaks(false);
    });
    setTimeout(() => {
      try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch {}
    }, 100);
  }
  function showTweaks(visible) {
    let panel = document.getElementById('__tweaks');
    if (visible) {
      if (panel) { panel.style.display = 'block'; return; }
      panel = document.createElement('div');
      panel.id = '__tweaks';
      panel.style.cssText = `
        position: fixed; bottom: 20px; right: 20px;
        background: var(--paper); border: 0.5pt solid var(--ink2);
        box-shadow: 0 6px 28px rgba(0,0,0,0.22);
        width: 300px; z-index: 1100; font-family: var(--f-meta);
        max-height: 86vh; overflow-y: auto;`;
      panel.innerHTML = `
        <div style="padding:12px 14px;border-bottom:0.5pt solid var(--paper3);display:flex;justify-content:space-between;align-items:center;">
          <strong style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:var(--red);">Tweaks</strong>
          <button id="__tw_close" type="button" style="background:none;border:none;font-size:16px;cursor:pointer;color:var(--ink3);">×</button>
        </div>
        <div id="__tw_sections" style="display:flex;flex-direction:column;"></div>`;
      document.body.appendChild(panel);
      const root = panel.querySelector('#__tw_sections');
      mountTweakSection(root, 'Persona', 'persona', [
        { id: 'jefe', label: 'Jefe de redacción' },
        { id: 'corrector', label: 'Corrector de estilo' },
        { id: 'lector', label: 'Lector general' }
      ]);
      mountTweakSection(root, 'Severidad', 'severity', [
        { id: 'soft', label: 'Suave' },
        { id: 'standard', label: 'Estándar' },
        { id: 'sharp', label: 'Implacable' }
      ]);
      mountTweakSection(root, 'Longitud', 'length', [
        { id: 'compact', label: 'Ágil' },
        { id: 'standard', label: 'Estándar' },
        { id: 'extended', label: 'Extensa' }
      ]);
      mountTweakSection(root, 'Idioma', 'language', [
        { id: 'esES', label: 'es-ES peninsular' },
        { id: 'neutro', label: 'Español neutro' }
      ]);
      mountTweakSection(root, 'Variante visual', 'variant', [
        { id: 'classic', label: 'Clásica Meridian' },
        { id: 'modern', label: 'Moderna · sans + ink' },
        { id: 'notebook', label: 'Cuaderno de pruebas' }
      ], true);
      panel.querySelector('#__tw_close').addEventListener('click', () => {
        showTweaks(false);
        try { window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*'); } catch {}
      });
    } else { if (panel) panel.style.display = 'none'; }
  }
  function mountTweakSection(root, title, key, options, isVariant) {
    const sec = document.createElement('div');
    sec.style.cssText = 'padding:14px 14px;border-bottom:0.5pt solid var(--paper3);';
    sec.innerHTML = `
      <div style="font-size:9px;letter-spacing:0.22em;text-transform:uppercase;color:var(--ink3);margin-bottom:8px;">${title}</div>
      <div class="__tw_opts" style="display:flex;flex-direction:column;gap:6px;"></div>`;
    const optsRoot = sec.querySelector('.__tw_opts');
    options.forEach(opt => {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.val = opt.id;
      b.style.cssText = `text-align:left;border:0.5pt solid var(--ink2);padding:8px 10px;font-family:var(--f-meta);font-size:11px;cursor:pointer;background:transparent;color:var(--ink);`;
      b.textContent = opt.label;
      b.addEventListener('click', () => {
        state.tweaks[key] = opt.id;
        saveTweaks();
        Array.from(optsRoot.children).forEach(c => {
          const active = c.dataset.val === opt.id;
          c.style.background = active ? 'var(--ink)' : 'transparent';
          c.style.color = active ? 'var(--paper)' : 'var(--ink)';
        });
        refreshPills();
        if (isVariant && state.report) renderReport();
      });
      optsRoot.appendChild(b);
    });
    Array.from(optsRoot.children).forEach(c => {
      const active = c.dataset.val === state.tweaks[key];
      c.style.background = active ? 'var(--ink)' : 'transparent';
      c.style.color      = active ? 'var(--paper)' : 'var(--ink)';
    });
    root.appendChild(sec);
  }

  /* ============================================================
     INIT
     ============================================================ */
  function init() {
    bindTabs();
    bindDropzoneMesa();
    bindRemoveSource();

    if (window.MesaEditor) {
      try { window.MesaEditor.mount($('pasteText')); }
      catch (e) { console.warn('[mesa] editor no montado:', e); }
    }
    bindPasteMesa();

    $('aiBadge').addEventListener('click', openKeyModal);
    $('btnCritique').addEventListener('click', runCritique);
    $('btnPrint').addEventListener('click', doPrint);
    $('btnReset').addEventListener('click', doReset);

    $('btnExportTxt').addEventListener('click', () => exportCorrected('txt'));
    $('btnExportMd').addEventListener('click',  () => exportCorrected('md'));
    $('btnExportDoc').addEventListener('click', () => exportCorrected('doc'));
    $('btnExportPdfMesa').addEventListener('click', () => exportCorrected('pdf'));
    $('btnReCritique').addEventListener('click', applyAndRecritique);
    $('btnSendToIssue').addEventListener('click', sendCorrectedToIssue);
    $('btnHandoff').addEventListener('click', handoffToSynth);

    ['metaTitle', 'metaAuthor', 'metaIssue'].forEach(id => {
      $(id).addEventListener('input', () => { scheduleSave(); });
    });

    // Express
    bindExpressTabs();
    bindExpressDropzone();
    $('expText').addEventListener('input', updateExpStat);
    $('btnExpImport').addEventListener('click', expressImport);
    $('btnAiGenerate').addEventListener('click', expressGenerate);
    $('btnExpExportDoc').addEventListener('click', () => expressExport('doc'));
    $('btnExpExportMd').addEventListener('click',  () => expressExport('md'));
    $('btnExpDiscard').addEventListener('click', expressDiscard);
    $('btnExpToMesa').addEventListener('click', expressToMesa);

    // Issue
    fillIssueForm(Q.loadMeta());
    bindIssueForm();
    $('btnIssRefresh').addEventListener('click', renderIssuePreview);
    $('btnIssAutoCopy').addEventListener('click', issueAutoCopy);
    $('btnIssClear').addEventListener('click', issueClear);
    $('btnIssExportDoc').addEventListener('click', issueExportDoc);
    $('btnIssPrint').addEventListener('click', () => { setMode('issue'); doPrint(); });

    refreshBadge();
    refreshPills();
    updatePasteStat();
    buildTweaksProtocol();
    restoreDraft();
    detectSynthesizer();
    refreshExpressUI();

    log('Mesa lista. Configura IA y carga texto.', 'ok');
    log('Express y Número disponibles en las pestañas de arriba.', 'ok');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
