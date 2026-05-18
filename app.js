/* ============================================================
   MERIDIAN · Mesa · app.js
   Orquestador: estado, eventos, modal de IA, tweaks, impresión.
   ============================================================ */
(function () {
  'use strict';

  const I = window.MesaIngest;
  const C = window.MesaCritic;
  const Y = window.MesaLayout;

  const $ = (id) => document.getElementById(id);

  /* ============================================================
     ESTADO
     ============================================================ */
  const TWEAK_STORE = 'mesa-tweaks-v1';
  const DEFAULT_TWEAKS = {
    persona: 'jefe',         // jefe | corrector | lector
    severity: 'standard',    // soft | standard | sharp
    length: 'standard',      // compact | standard | extended
    language: 'esES',        // esES | neutro
    variant: 'classic'       // classic | modern | notebook
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

  /* ============================================================
     AUTOGUARDADO · borrador del texto + metadatos
     ============================================================ */
  const DRAFT_STORE = 'mesa-draft-v1';
  const SAVE_DEBOUNCE_MS = 700;
  let saveTimer = null;
  let lastSavedTs = 0;

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
      // No persistas borradores triviales (solo whitespace)
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
    if (draft.text)         $('pasteText').value  = draft.text;   // setter del editor sincroniza
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

  const state = {
    source: null,       // { fileName, kind, text, words }
    pasteText: '',
    meta: { title: '', author: '', issue: '' },
    report: null,
    lastText: '',       // texto exacto que se pasó por la mesa (para aplicar reescrituras)
    tweaks: loadTweaks()
  };

  /* ============================================================
     UTILIDADES UI
     ============================================================ */
  function log(msg, kind) {
    const box = $('logBox'); if (!box) return;
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
        <div class="so-progress" style="--p: 0%"></div>
      `;
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
     INPUT · archivo + pegado
     ============================================================ */
  function bindDropzone() {
    const dz = $('dropzone');
    const inp = $('fileInput');

    dz.addEventListener('click', () => inp.click());
    dz.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); }
    });
    inp.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) loadFile(f);
      inp.value = '';
    });

    // Drag específico sobre la dropzone (el window-wide preventDefault del head
    // bloquea el drop por defecto; aquí lo reactivamos sólo para este target)
    ['dragenter', 'dragover'].forEach(ev => {
      dz.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(ev => {
      dz.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('drag'); });
    });
    dz.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });
  }

  async function loadFile(file) {
    log(`Leyendo ${file.name}…`);
    const o = showOverlay('Leyendo archivo…');
    try {
      const res = await I.loadFile(file, (i, n) => {
        if (i % 3 === 0 || i === n) updateOverlay(o, { step: `${file.name}: pág ${i}/${n}`, pct: Math.round((i / n) * 100) });
      });
      const words = I.countWords(res.text);
      state.source = { fileName: file.name, kind: res.kind, text: res.text, words };
      // Si el textarea está vacío, lo poblamos con el contenido del archivo
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
     PASTE
     ============================================================ */
  // Densidad de maquetación A5 estilo Meridian (palabras / página).
  // 280 = densidad estándar (cabecera + capitular + intertítulos + citas + márgenes).
  const A5_WORDS_PER_PAGE = 280;
  const PAGE_TARGET_MIN = 14;   // por debajo: el folleto se siente corto
  const PAGE_TARGET_MAX = 24;   // por encima: pasa de revista a opúsculo
  const PAGE_FLOOD_LIMIT = 36;  // por encima: probable que el modelo no termine bien

  function estimatePages(words) {
    if (!words) return 0;
    return Math.max(1, Math.round(words / A5_WORDS_PER_PAGE));
  }

  function updatePageEstimate(words) {
    const el = $('pageEstimate');
    if (!el) return;
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
    el.title =
      `Estimación a ${A5_WORDS_PER_PAGE} palabras/página A5 (densidad estándar Meridian).\n` +
      `Objetivo cómodo: ${PAGE_TARGET_MIN}-${PAGE_TARGET_MAX} págs · sweet spot 18-22.`;
  }

  function updatePasteStat() {
    const w = I.countWords($('pasteText').value);
    $('pasteStat').textContent = `${w} palabras`;
    state.pasteText = $('pasteText').value;
    updatePageEstimate(w);
    refreshActionState();
    scheduleSave();
  }

  function bindPaste() {
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
     ACTION STATE
     ============================================================ */
  function getActiveText() {
    // El textarea es la verdad principal; si está vacío, caemos a state.source
    const paste = $('pasteText').value.trim();
    if (paste) return paste;
    if (state.source && state.source.text) return state.source.text;
    return '';
  }

  function refreshActionState() {
    const has = !!getActiveText();
    const hasAI = C.hasLLM();
    $('btnCritique').disabled = !(has && hasAI);
    $('btnPrint').disabled = !state.report;
  }

  /* ============================================================
     PILLS · barra de acción
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
     BADGE IA + MODAL
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

    const elProv     = overlay.querySelector('#kmProvider');
    const elModel    = overlay.querySelector('#kmModel');
    const elCustomW  = overlay.querySelector('#kmCustomModelWrap');
    const elCustom   = overlay.querySelector('#kmCustomModel');
    const elBaseW    = overlay.querySelector('#kmBaseUrlWrap');
    const elBase     = overlay.querySelector('#kmBaseUrl');
    const elBaseHint = overlay.querySelector('#kmBaseUrlHint');
    const elKeyW     = overlay.querySelector('#kmKeyWrap');
    const elKey      = overlay.querySelector('#kmKey');
    const elKeyHint  = overlay.querySelector('#kmKeyHint');

    function syncProviderFields() {
      const pid = elProv.value;
      const p = providers[pid];
      if (!p) {
        elModel.innerHTML = '<option value="">—</option>';
        elBaseW.style.display = 'none';
        elKeyW.style.display  = 'none';
        elCustomW.style.display = 'none';
        return;
      }
      elModel.innerHTML = p.models.map(m =>
        `<option value="${m.id}" ${m.id === cfg.model ? 'selected' : ''}>${m.label}</option>`
      ).join('');
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

    // Restablecer URL base al valor por defecto del proveedor
    overlay.querySelector('#kmBaseUrlReset').addEventListener('click', () => {
      const p = providers[elProv.value];
      if (!p || !p.needsBaseUrl) return;
      elBase.value = p.baseUrlDefault || '';
      elBase.focus();
      elBase.select();
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
        text,
        meta: state.meta,
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
      $('btnPrint').disabled = false;
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
     IMPRIMIR
     ============================================================ */
  function doPrint() {
    if (!state.report) { toast('Genera un informe antes de imprimir', 'warn'); return; }
    renderReport();
    setTimeout(() => window.print(), 60);
  }

  /* ============================================================
     EXPORT BAR · estado y acciones
     ============================================================ */
  function renderExportBar() {
    const bar = $('exportBar');
    if (!bar) return;
    if (!state.report) { bar.hidden = true; return; }
    bar.hidden = false;

    const fricciones = state.report.fricciones || [];
    const withProp = fricciones.filter(f => (f.propuesta || '').trim()).length;
    const verd = (state.report.veredicto || '—').toUpperCase().replace(/_/g, ' ');
    $('ebStats').textContent =
      `${withProp} reescrituras propuestas · ${fricciones.length} fricciones · veredicto: ${verd}`;
  }

  function exportCorrected(format) {
    if (!state.report) { toast('Genera el informe primero', 'warn'); return; }
    const original = state.lastText || getActiveText();
    if (!original) { toast('No queda texto original que corregir', 'warn'); return; }

    const fricciones = state.report.fricciones || [];
    const A = window.MesaApplier;
    const res = A.applyRewrites(original, fricciones);

    const base = A.slug(state.meta.title || 'texto') + '-corregido';
    if (format === 'md') {
      const md = A.buildMarkdownReport(res.text, fricciones, state.meta, state.report);
      A.downloadBlob(md, base + '.md', 'text/markdown;charset=utf-8');
    } else {
      A.downloadBlob(res.text, base + '.txt', 'text/plain;charset=utf-8');
    }

    log(`Descargado · ${res.applied}/${res.total} reescrituras aplicadas`, 'ok');
    if (res.skipped.length) {
      const reasons = res.skipped.map(s => `  ${String(s.idx).padStart(2,'0')} · ${s.reason}${s.cita ? ' · "' + s.cita.slice(0, 60) + '…"' : ''}`).join('\n');
      toast(`${res.applied}/${res.total} reescrituras aplicadas.\n${res.skipped.length} no aplicadas:\n${reasons}`, 'warn', 9000);
    } else if (res.applied > 0) {
      toast(`${res.applied} reescrituras aplicadas al texto.`, 'ok', 4000);
    }
  }

  function handoffToSynth() {
    if (!state.report) { toast('Genera el informe primero', 'warn'); return; }
    const original = state.lastText || getActiveText();
    if (!original) { toast('No queda texto original que enviar', 'warn'); return; }

    const fricciones = state.report.fricciones || [];
    const res = window.MesaApplier.applyRewrites(original, fricciones);

    const payload = {
      text: res.text,
      meta: state.meta,
      fileName: (state.source && state.source.fileName) || (state.meta.title || 'Texto · Mesa'),
      mode: 'maquetar',
      appliedCount: res.applied,
      totalCount: res.total,
      skippedCount: res.skipped.length,
      timestamp: Date.now()
    };
    try {
      localStorage.setItem('meridian-mesa-handoff-v1', JSON.stringify(payload));
    } catch (err) {
      toast('No se pudo guardar el handoff: ' + err.message, 'err', 6000);
      return;
    }

    log(`Handoff al sintetizador · ${res.applied}/${res.total} reescrituras aplicadas`, 'ok');
    toast(`Abriendo el sintetizador en modo Maquetar con el texto corregido…\n${res.applied}/${res.total} reescrituras aplicadas.`, 'ok', 4500);
    // El sintetizador vive en ../index.html relativo a /mesa/
    setTimeout(() => { window.open('../index.html', '_blank'); }, 350);
  }

  /* ============================================================
     RE-CRITICAR · aplica propuestas y vuelve a pasar por la mesa
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

    const A = window.MesaApplier;
    const res = A.applyRewrites(original, fricciones);
    if (res.applied === 0) {
      toast(
        `Ninguna reescritura se pudo aplicar (las citas no coinciden con el texto).\n` +
        `Re-criticando sobre el texto original sin cambios.`, 'warn', 5000);
    } else {
      log(`Aplicadas ${res.applied}/${res.total} reescrituras antes de re-criticar`, 'ok');
    }

    // Reemplaza el texto en el editor (mantiene la cursiva/negrita del markdown)
    $('pasteText').value = res.text;
    updatePasteStat();
    if (state.source) {
      // El source en memoria queda como pegado del corregido para que la próxima
      // crítica se haga sobre ESTO y no sobre el original cargado.
      state.source = {
        fileName: '(Iteración) ' + ((state.source && state.source.fileName) || 'Texto'),
        kind: 'paste',
        text: res.text,
        words: I.countWords(res.text)
      };
      renderSourceCard();
    }

    log('Re-criticando texto corregido…', 'ok');
    // runCritique() lee getActiveText() → ya devuelve el texto nuevo
    await runCritique();
  }

  /* ============================================================
     RESET
     ============================================================ */
  function doReset() {
    if (!confirm('¿Vaciar la mesa? Se borran el texto, los metadatos y el informe (la configuración de IA y los tweaks se mantienen).')) return;
    state.source = null;
    state.pasteText = '';
    state.report = null;
    state.lastText = '';
    state.meta = { title: '', author: '', issue: '' };
    $('pasteText').value = '';
    $('metaTitle').value = '';
    $('metaAuthor').value = '';
    $('metaIssue').value = '';
    renderSourceCard();
    updatePasteStat();
    Y.render($('reportFrame'), { report: null, meta: state.meta, variant: state.tweaks.variant });
    renderExportBar();
    $('btnPrint').disabled = true;
    refreshActionState();
    clearDraft();
    log('Mesa vaciada.', 'warn');
  }

  /* ============================================================
     TWEAKS · panel host-controlled
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
        max-height: 86vh; overflow-y: auto;
      `;
      panel.innerHTML = `
        <div style="padding:12px 14px;border-bottom:0.5pt solid var(--paper3);display:flex;justify-content:space-between;align-items:center;">
          <strong style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:var(--red);">Tweaks</strong>
          <button id="__tw_close" type="button" style="background:none;border:none;font-size:16px;cursor:pointer;color:var(--ink3);">×</button>
        </div>
        <div id="__tw_sections" style="display:flex;flex-direction:column;"></div>
      `;
      document.body.appendChild(panel);
      const root = panel.querySelector('#__tw_sections');
      mountTweakSection(root, 'Persona', 'persona', [
        { id: 'jefe',      label: 'Jefe de redacción' },
        { id: 'corrector', label: 'Corrector de estilo' },
        { id: 'lector',    label: 'Lector general' }
      ]);
      mountTweakSection(root, 'Severidad', 'severity', [
        { id: 'soft',     label: 'Suave' },
        { id: 'standard', label: 'Estándar' },
        { id: 'sharp',    label: 'Implacable' }
      ]);
      mountTweakSection(root, 'Longitud', 'length', [
        { id: 'compact',  label: 'Ágil' },
        { id: 'standard', label: 'Estándar' },
        { id: 'extended', label: 'Extensa' }
      ]);
      mountTweakSection(root, 'Idioma', 'language', [
        { id: 'esES',   label: 'es-ES peninsular' },
        { id: 'neutro', label: 'Español neutro' }
      ]);
      mountTweakSection(root, 'Variante visual', 'variant', [
        { id: 'classic',  label: 'Clásica Meridian' },
        { id: 'modern',   label: 'Moderna · sans + ink' },
        { id: 'notebook', label: 'Cuaderno de pruebas' }
      ], true);
      panel.querySelector('#__tw_close').addEventListener('click', () => {
        showTweaks(false);
        try { window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*'); } catch {}
      });
    } else {
      if (panel) panel.style.display = 'none';
    }
  }

  function mountTweakSection(root, title, key, options, isVariant) {
    const sec = document.createElement('div');
    sec.style.cssText = 'padding:14px 14px;border-bottom:0.5pt solid var(--paper3);';
    sec.innerHTML = `
      <div style="font-size:9px;letter-spacing:0.22em;text-transform:uppercase;color:var(--ink3);margin-bottom:8px;">${title}</div>
      <div class="__tw_opts" style="display:flex;flex-direction:column;gap:6px;"></div>
    `;
    const optsRoot = sec.querySelector('.__tw_opts');
    options.forEach(opt => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.val = opt.id;
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
    // pintar activo inicial
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
    bindDropzone();
    bindRemoveSource();

    // Monta el editor enriquecido sobre el textarea (cursiva/negrita)
    if (window.MesaEditor) {
      try { window.MesaEditor.mount($('pasteText')); }
      catch (e) { console.warn('[mesa] editor no montado:', e); }
    }

    bindPaste();

    $('aiBadge').addEventListener('click', openKeyModal);
    $('btnCritique').addEventListener('click', runCritique);
    $('btnPrint').addEventListener('click', doPrint);
    $('btnReset').addEventListener('click', doReset);

    $('btnExportTxt').addEventListener('click', () => exportCorrected('txt'));
    $('btnExportMd').addEventListener('click',  () => exportCorrected('md'));
    $('btnReCritique').addEventListener('click', applyAndRecritique);
    $('btnHandoff').addEventListener('click', handoffToSynth);

    // Meta inputs → no leemos a tiempo real, sólo al pulsar acciones,
    // pero limpiamos el botón print cuando cambia y autoguardamos.
    ['metaTitle', 'metaAuthor', 'metaIssue'].forEach(id => {
      $(id).addEventListener('input', () => { scheduleSave(); });
    });

    refreshBadge();
    refreshPills();
    updatePasteStat();
    buildTweaksProtocol();
    restoreDraft();

    log('Mesa lista. Configura IA y carga texto.', 'ok');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
