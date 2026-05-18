/* ============================================================
   MERIDIAN · Triage · app.js
   Orquestador: carga PDF, marcado de reseñas, generación de
   fichas con LLM, render del dossier y export.
   ============================================================ */
(function () {
  'use strict';

  const X = window.TriageExtract;
  const L = window.TriageLLM;
  const D = window.TriageDossier;
  const $ = (id) => document.getElementById(id);

  /* ============================================================
     ESTADO
     ============================================================ */
  const state = {
    pdfDoc: null,           // pdfjs document object
    pdfFile: null,          // File
    pages: [],              // [{index, text, words, thumb:{dataUrl,width,height}}]
    picks: [],              // [{ id, from, to, hint:{title,bookAuthor,critic}, coverPage, ficha?, status }]
    fichas: [],             // [ficha JSON ya generada]
    selFrom: null,          // página inicial seleccionada (en marcado)
    selTo: null,            // página final seleccionada
    meta: { medio: '', medioOtro: '', numero: '', fecha: '', url: '' }
  };

  let pickIdSeq = 1;

  /* ============================================================
     UI · helpers
     ============================================================ */
  function log(msg, kind) {
    const box = $('logBox'); if (!box) return;
    const ln = document.createElement('div');
    ln.className = 'log-line ' + (kind || 'ok');
    ln.textContent = '› ' + msg;
    box.appendChild(ln);
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
  function escapeAttr(s) { return D.escapeHtml(s); }

  /* ============================================================
     META · lectura desde sidebar
     ============================================================ */
  function readMeta() {
    state.meta.medio    = $('metaMedio').value.trim();
    state.meta.medioOtro= $('metaMedioOtro').value.trim();
    state.meta.numero   = $('metaNumero').value.trim();
    state.meta.fecha    = $('metaFecha').value.trim();
    state.meta.url      = $('metaUrl').value.trim();
  }
  function medioLabel() {
    const map = {
      NYRB: 'The New York Review of Books',
      TLS:  'The Times Literary Supplement',
      LRB:  'London Review of Books',
      NR:   'The New Republic',
      FA:   'Foreign Affairs',
      NYer: 'The New Yorker',
      HARP: 'Harper\'s Magazine',
      ATL:  'The Atlantic'
    };
    if (state.meta.medio === 'OTRO') return state.meta.medioOtro || 'Medio sin nombre';
    return map[state.meta.medio] || '';
  }

  /* ============================================================
     SIDEBAR · medio "otro" toggle + estado IA
     ============================================================ */
  function bindSidebar() {
    $('metaMedio').addEventListener('change', () => {
      $('metaMedioOtroWrap').hidden = ($('metaMedio').value !== 'OTRO');
    });
  }

  /* ============================================================
     IA · badge + modal (mismo patrón que Mesa)
     ============================================================ */
  function refreshBadge() {
    const b = $('aiBadge');
    b.classList.remove('ok','warn');
    if (L.hasLLM()) {
      const lbl = L.currentLabel();
      const short = lbl.split('·').slice(0,1).join('').trim().toUpperCase();
      b.textContent = 'IA · ' + short;
      b.classList.add('ok');
      b.title = 'IA activa: ' + lbl + '. Pulsa para cambiar.';
    } else {
      b.textContent = 'IA · CONFIGURAR';
      b.classList.add('warn');
      b.title = 'Sin IA configurada. Pulsa para elegir Ollama / OpenAI / Claude / Gemini.';
    }
    $('amProvider').textContent = L.hasLLM()
      ? L.currentLabel().split('·').slice(0,1).join('').trim().toUpperCase()
      : 'SIN IA';
    refreshActionState();
  }

  function openKeyModal(onSavedCb) {
    const cfg = Object.assign({ provider: '', model: '', apiKey: '', baseUrl: '', customModel: '' }, L.getConfig());
    const providers = L.PROVIDERS;

    const overlay = document.createElement('div');
    overlay.className = 'key-modal-overlay';
    overlay.innerHTML = `
      <div class="key-modal">
        <div class="km-kicker">CONFIGURACIÓN · IA</div>
        <h3>Proveedor para Triage</h3>
        <div class="km-mode ${L.hasLLM() ? 'ok' : ''}">
          ${L.hasLLM() ? 'Activo · ' + L.currentLabel() : 'Sin IA · elige proveedor abajo'}
        </div>
        <p class="km-helper" style="margin:6px 0 12px;font-style:italic;color:var(--ink3);">
          Recomendación para triage de revistas en inglés: Claude Sonnet 4 o GPT-4o. Modelos pequeños (&lt;14B) flojean en JSON sobre textos largos.
        </p>

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
          <input id="kmCustomModel" type="text" placeholder="ej. claude-3-7-sonnet-latest" value="${escapeAttr(cfg.customModel || '')}" />
        </div>

        <div class="field" id="kmBaseUrlWrap" style="display:none;">
          <label for="kmBaseUrl">URL base del servidor</label>
          <input id="kmBaseUrl" type="text" placeholder="http://localhost:11434/v1" value="${escapeAttr(cfg.baseUrl || '')}" />
          <div class="km-helper" id="kmBaseUrlHint"></div>
        </div>

        <div class="field" id="kmKeyWrap" style="display:none;">
          <label>API key</label>
          <input id="kmKey" type="password" placeholder="(pega tu clave)" value="${escapeAttr(cfg.apiKey || '')}" autocomplete="off" />
          <div class="km-helper" id="kmKeyHint"></div>
        </div>

        <div class="km-warn" id="kmProvWarn" style="display:none;"></div>
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
    const elCustom  = overlay.querySelector('#kmCustomModel');
    const elBaseW = overlay.querySelector('#kmBaseUrlWrap');
    const elBase  = overlay.querySelector('#kmBaseUrl');
    const elBaseHint = overlay.querySelector('#kmBaseUrlHint');
    const elKeyW = overlay.querySelector('#kmKeyWrap');
    const elKey  = overlay.querySelector('#kmKey');
    const elKeyHint = overlay.querySelector('#kmKeyHint');
    const elWarn = overlay.querySelector('#kmProvWarn');

    function syncFields() {
      const pid = elProv.value;
      const p = providers[pid];
      if (!p) {
        elModel.innerHTML = '<option value="">—</option>';
        elBaseW.style.display = 'none';
        elKeyW.style.display = 'none';
        elCustomW.style.display = 'none';
        elWarn.style.display = 'none';
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
          ? `Tu clave en <a href="${p.docs}" target="_blank" rel="noopener">${p.docs.replace(/^https?:\/\//,'')}</a>`
          : '';
      } else { elKeyW.style.display = 'none'; }

      if (p.warn) {
        elWarn.style.display = '';
        elWarn.innerHTML = `<strong>Sobre ${p.label}:</strong> ${p.warn}`;
      } else { elWarn.style.display = 'none'; }

      syncCustom();
    }
    function syncCustom() {
      elCustomW.style.display = (elModel.value === '__custom__') ? '' : 'none';
    }
    elProv.addEventListener('change', () => { cfg.model = ''; syncFields(); });
    elModel.addEventListener('change', syncCustom);
    syncFields();

    function close() { overlay.remove(); }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
    overlay.querySelector('[data-act="clear"]').addEventListener('click', () => {
      L.clearConfig(); refreshBadge(); toast('Config borrada', 'ok'); close();
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
      L.setConfig(newCfg);
      refreshBadge();
      toast('Configuración guardada', 'ok');
      close();
      if (typeof onSavedCb === 'function') onSavedCb();
    });
  }

  /* ============================================================
     INPUT · dropzone
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
    ['dragenter','dragover'].forEach(ev =>
      dz.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); dz.classList.add('drag'); }));
    ['dragleave','drop'].forEach(ev =>
      dz.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });

    $('srcRm').addEventListener('click', () => {
      doReset(false);
      log('Número descartado.', 'warn');
    });
  }

  async function loadFile(file) {
    if (!/\.pdf$/i.test(file.name)) {
      toast('Triage v1 sólo acepta PDF digital. Si es un escaneo, no hay OCR en cliente.', 'err', 6000);
      return;
    }
    log(`Leyendo ${file.name}…`);
    const o = showOverlay('Disecando el número…');
    try {
      const res = await X.loadFile(file, (i, n) => {
        updateOverlay(o, { step: `${file.name}: pág ${i}/${n}`, pct: Math.round((i / n) * 100) });
      });
      state.pdfFile = file;
      state.pdfDoc = res.doc;
      state.pages = res.pages;
      hideOverlay();
      renderSourceCard();
      renderPagesGrid();
      $('pagesBlock').hidden = false;
      $('emptyState').hidden = true;
      log(`${file.name} · ${res.numPages} páginas leídas`, 'ok');
      refreshActionState();
    } catch (err) {
      hideOverlay();
      console.error('[triage]', err);
      log('Error: ' + (err.message || err), 'err');
      toast(`Error leyendo ${file.name}:\n${err.message || err}`, 'err', 7000);
    }
  }

  function renderSourceCard() {
    const wrap = $('srcCardWrap');
    if (!state.pdfFile) { wrap.hidden = true; return; }
    wrap.hidden = false;
    $('srcKind').textContent = 'PDF';
    $('srcName').textContent = state.pdfFile.name;
    const totalWords = state.pages.reduce((s, p) => s + (p.words || 0), 0);
    $('srcMeta').textContent = `${state.pages.length} páginas · ${totalWords.toLocaleString('es-ES')} palabras`;
  }

  /* ============================================================
     RENDER · grid de páginas + selección de rango
     ============================================================ */
  function renderPagesGrid() {
    const grid = $('pagesGrid');
    grid.innerHTML = state.pages.map(p => `
      <button class="t-page-thumb" type="button" data-page="${p.index}" title="Página ${p.index} · ${p.words} palabras">
        <img src="${p.thumb.dataUrl}" alt="Página ${p.index}" />
        <span class="t-page-thumb-num">p. ${p.index}</span>
        <span class="t-page-thumb-words">${p.words} palabras</span>
      </button>`).join('');
    grid.addEventListener('click', onThumbClick);
    refreshThumbState();
  }

  function onThumbClick(e) {
    const btn = e.target.closest('.t-page-thumb');
    if (!btn) return;
    const n = Number(btn.dataset.page);
    if (!Number.isFinite(n)) return;

    if (state.selFrom == null) {
      state.selFrom = n; state.selTo = null;
    } else if (state.selTo == null) {
      if (n < state.selFrom) { state.selTo = state.selFrom; state.selFrom = n; }
      else                   { state.selTo = n; }
    } else {
      // empieza una nueva selección
      state.selFrom = n; state.selTo = null;
    }
    refreshThumbState();
    refreshActionState();
  }

  function refreshThumbState() {
    const grid = $('pagesGrid');
    if (!grid) return;
    const from = state.selFrom, to = state.selTo;
    grid.querySelectorAll('.t-page-thumb').forEach(t => {
      const n = Number(t.dataset.page);
      t.classList.toggle('is-from', n === from);
      t.classList.toggle('is-to',   to != null && n === to);
      t.classList.toggle('in-range', from != null && to != null && n > from && n < to);
    });
    const hint = $('pickHint');
    if (from == null)        hint.textContent = 'Selecciona la página inicial de una reseña.';
    else if (to == null)     hint.textContent = `Página inicial: p. ${from}. Selecciona la página final.`;
    else                     hint.textContent = `Rango p. ${from}-${to}. Pulsa "+ Marcar reseña".`;
    $('btnAddRange').disabled = !(from != null && to != null);
  }

  /* ============================================================
     PICKS · marcar y editar reseñas
     ============================================================ */
  function addRange() {
    if (state.selFrom == null || state.selTo == null) return;
    const pick = {
      id: pickIdSeq++,
      from: state.selFrom,
      to:   state.selTo,
      hint: { title: '', bookAuthor: '', critic: '' },
      coverPage: state.selFrom,   // por defecto la página inicial sirve de cover
      ficha: null,
      status: ''
    };
    state.picks.push(pick);
    state.selFrom = null; state.selTo = null;
    refreshThumbState();
    renderPicks();
    refreshActionState();
    log(`Reseña marcada · pp. ${pick.from}-${pick.to}`, 'ok');
  }

  function removePick(id) {
    state.picks = state.picks.filter(p => p.id !== id);
    renderPicks();
    refreshActionState();
  }

  function renderPicks() {
    $('picksBlock').hidden = state.picks.length === 0;
    const root = $('picksList');
    root.innerHTML = state.picks.map((p, i) => {
      const pages = Array.from({ length: p.to - p.from + 1 }, (_, k) => p.from + k);
      const coverOpts = pages.map(n => `<option value="${n}" ${n === p.coverPage ? 'selected' : ''}>p. ${n}</option>`).join('');
      const statusClass = p.status?.kind || '';
      const statusText  = p.status?.text || '';
      return `
        <article class="t-pick" data-pick-id="${p.id}">
          <header class="t-pick-h">
            <span class="t-pick-n">${String(i + 1).padStart(2,'0')}</span>
            <span class="t-pick-pp">pp. ${p.from}-${p.to}</span>
            <span>${(rangeWords(p)).toLocaleString('es-ES')} palabras</span>
            <button type="button" class="t-pick-rm" data-act="rm">× quitar</button>
          </header>
          <div class="t-pick-fields">
            <div class="field">
              <label>Título tentativo de la reseña</label>
              <input type="text" data-fld="title" value="${D.escapeHtml(p.hint.title || '')}" placeholder="ej. Sebald entre el archivo y el sueño" />
            </div>
            <div class="field">
              <label>Autor del libro reseñado (tentativo)</label>
              <input type="text" data-fld="bookAuthor" value="${D.escapeHtml(p.hint.bookAuthor || '')}" placeholder="ej. W. G. Sebald" />
            </div>
            <div class="field">
              <label>Crítico (tentativo)</label>
              <input type="text" data-fld="critic" value="${D.escapeHtml(p.hint.critic || '')}" placeholder="ej. James Wood" />
            </div>
          </div>
          <div class="t-pick-cover">
            <span>Cover · página</span>
            <select data-fld="coverPage">${coverOpts}</select>
          </div>
          ${statusText ? `<div class="t-pick-status ${statusClass}">${D.escapeHtml(statusText)}</div>` : ''}
        </article>`;
    }).join('');

    // bindings
    root.querySelectorAll('.t-pick').forEach(card => {
      const id = Number(card.dataset.pickId);
      card.querySelector('[data-act="rm"]').addEventListener('click', () => removePick(id));
      card.querySelectorAll('input[data-fld], select[data-fld]').forEach(el => {
        el.addEventListener('input', () => {
          const p = state.picks.find(x => x.id === id);
          if (!p) return;
          const fld = el.dataset.fld;
          if (fld === 'coverPage') p.coverPage = Number(el.value) || p.from;
          else p.hint[fld] = el.value;
        });
      });
    });

    $('amPicked').textContent =
      state.picks.length === 0 ? '0 reseñas marcadas'
      : (state.picks.length === 1 ? '1 reseña marcada' : `${state.picks.length} reseñas marcadas`);
  }

  function rangeWords(p) {
    let w = 0;
    state.pages.forEach(pg => { if (pg.index >= p.from && pg.index <= p.to) w += (pg.words || 0); });
    return w;
  }

  /* ============================================================
     ACTION STATE
     ============================================================ */
  function refreshActionState() {
    const canRun = state.picks.length > 0 && L.hasLLM();
    $('btnRunAll').disabled = !canRun;
    $('btnPrint').disabled = state.fichas.length === 0;
  }

  /* ============================================================
     RUN · genera todas las fichas en paralelo
     ============================================================ */
  async function runAll() {
    if (!state.picks.length) { toast('Marca al menos una reseña', 'warn'); return; }
    if (!L.hasLLM()) { toast('Configura IA primero', 'err'); openKeyModal(); return; }
    readMeta();

    const o = showOverlay('Generando fichas…');
    updateOverlay(o, { step: `0/${state.picks.length}`, pct: 0 });

    let done = 0;
    const total = state.picks.length;
    state.picks.forEach(p => { p.status = { kind: 'busy', text: 'Esperando IA…' }; });
    renderPicks();

    const tasks = state.picks.map(async (p) => {
      try {
        const texto = X.rangeText(state.pages, p.from, p.to);
        const ficha = await L.buildFicha({
          texto,
          hint: p.hint,
          medio: medioLabel(),
          numero: state.meta.numero,
          fecha: state.meta.fecha,
          urlMedio: state.meta.url
        });
        // cover
        try {
          ficha._coverDataUrl = await X.renderRangeAsPng(state.pdfDoc, p.coverPage, 1.4);
          ficha._coverPage = p.coverPage;
        } catch (e) {
          console.warn('[triage] cover render falló p.' + p.coverPage, e);
        }
        // si la pista del usuario aporta y la IA dejó vacío, rellenar
        if (p.hint?.title && !ficha.publicacion?.titulo_resena) {
          ficha.publicacion = ficha.publicacion || {};
          ficha.publicacion.titulo_resena = p.hint.title;
        }
        if (p.hint?.bookAuthor && !ficha.libro?.autor) {
          ficha.libro = ficha.libro || {};
          ficha.libro.autor = p.hint.bookAuthor;
        }
        if (p.hint?.critic && !ficha.critico?.nombre) {
          ficha.critico = ficha.critico || {};
          ficha.critico.nombre = p.hint.critic;
        }
        p.ficha = ficha;
        p.status = { kind: 'ok', text: 'Ficha generada' };
      } catch (err) {
        console.error('[triage] pick falló', p.id, err);
        p.status = { kind: 'err', text: 'Error: ' + (err.message || err) };
      } finally {
        done++;
        updateOverlay(o, {
          step: `${done}/${total} reseñas procesadas`,
          pct: Math.round((done / total) * 100)
        });
        renderPicks();
      }
    });

    await Promise.allSettled(tasks);
    hideOverlay();

    state.fichas = state.picks.map(p => p.ficha).filter(Boolean);
    renderDossier();
    refreshActionState();

    const ok = state.fichas.length;
    const fail = state.picks.length - ok;
    log(`Fichas generadas: ${ok}/${state.picks.length}` + (fail ? ` · ${fail} con error` : ''), fail ? 'warn' : 'ok');
    if (fail) toast(`${fail} ficha(s) con error. Revisa el listado de reseñas marcadas.`, 'warn', 6000);
  }

  function renderDossier() {
    if (!state.fichas.length) {
      $('dossierBlock').hidden = true;
      return;
    }
    $('dossierBlock').hidden = false;
    const extras = {
      medioNumero: medioLabel(),
      numeroNumero: state.meta.numero,
      fechaNumero: state.meta.fecha
    };
    D.render($('dossierFrame'), state.fichas, extras);
    D.render($('printStage'), state.fichas, extras);

    // Bind editable "Meridian sobre esto"
    $('dossierFrame').querySelectorAll('.t-meridian-slot').forEach(slot => {
      const idx = Number(slot.dataset.fichaIdx);
      slot.addEventListener('focus', () => slot.dataset.empty = 'false');
      slot.addEventListener('input', () => {
        const f = state.fichas[idx]; if (!f) return;
        f.meridian_sobre_esto = slot.innerText.trim();
      });
      slot.addEventListener('blur', () => {
        if (!slot.innerText.trim()) slot.dataset.empty = 'true';
      });
    });
  }

  /* ============================================================
     EXPORT
     ============================================================ */
  function exportMd() {
    if (!state.fichas.length) { toast('Genera fichas primero', 'warn'); return; }
    const extras = {
      medioNumero: medioLabel(),
      numeroNumero: state.meta.numero,
      fechaNumero: state.meta.fecha
    };
    const md = D.buildMarkdown(state.fichas, extras);
    const base = D.slug([medioLabel(), state.meta.numero || 'sin-numero', 'dossier'].filter(Boolean).join(' '));
    D.downloadBlob(md, base + '.md', 'text/markdown;charset=utf-8');
    log(`Descargado dossier · ${state.fichas.length} fichas`, 'ok');
  }
  function exportJson() {
    if (!state.fichas.length) { toast('Genera fichas primero', 'warn'); return; }
    const payload = {
      medio: medioLabel(),
      numero: state.meta.numero,
      fecha: state.meta.fecha,
      url: state.meta.url,
      fichas: state.fichas
    };
    const base = D.slug([medioLabel(), state.meta.numero || 'sin-numero', 'dossier'].filter(Boolean).join(' '));
    D.downloadBlob(JSON.stringify(payload, null, 2), base + '.json', 'application/json;charset=utf-8');
  }
  function doPrint() {
    if (!state.fichas.length) { toast('Genera fichas primero', 'warn'); return; }
    setTimeout(() => window.print(), 60);
  }

  /* ============================================================
     RESET
     ============================================================ */
  function doReset(askConfirm) {
    if (askConfirm !== false) {
      if (!confirm('¿Vaciar el triaje? Se descartan el PDF, las reseñas marcadas y las fichas generadas.')) return;
    }
    state.pdfDoc = null;
    state.pdfFile = null;
    state.pages = [];
    state.picks = [];
    state.fichas = [];
    state.selFrom = null; state.selTo = null;
    $('pagesBlock').hidden = true;
    $('picksBlock').hidden = true;
    $('dossierBlock').hidden = true;
    $('emptyState').hidden = false;
    $('pagesGrid').innerHTML = '';
    $('picksList').innerHTML = '';
    $('dossierFrame').innerHTML = '';
    $('printStage').innerHTML = '';
    renderSourceCard();
    refreshActionState();
    $('amPicked').textContent = '0 reseñas marcadas';
  }

  /* ============================================================
     INIT
     ============================================================ */
  function init() {
    bindDropzone();
    bindSidebar();

    $('aiBadge').addEventListener('click', () => openKeyModal());
    $('btnRunAll').addEventListener('click', runAll);
    $('btnAddRange').addEventListener('click', addRange);
    $('btnReset').addEventListener('click', () => doReset(true));
    $('btnPrint').addEventListener('click', doPrint);
    $('btnExportMd').addEventListener('click', exportMd);
    $('btnExportJson').addEventListener('click', exportJson);

    refreshBadge();
    refreshActionState();
    log('Triage listo. Configura IA y carga PDF del número.', 'ok');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
