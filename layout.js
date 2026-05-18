/* ============================================================
   MERIDIAN · Mesa · layout.js
   Render del informe estructurado en 3 variantes visuales:
     · classic   — clásica Meridian (capitular, regla ocre, diamante)
     · modern    — moderna (sans + acentos)
     · notebook  — cuaderno de pruebas (manuscrito, marca de corrector)
   Expone window.MesaLayout
   ============================================================ */
(function (global) {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const VERDICTOS = {
    publicar:                { label: 'PUBLICAR',                tone: 'ok' },
    publicar_con_retoques:   { label: 'PUBLICAR CON RETOQUES',   tone: 'mid' },
    reescribir:              { label: 'REESCRIBIR',              tone: 'warn' },
    descartar:               { label: 'DESCARTAR',               tone: 'bad' }
  };

  function verdictoMeta(v) {
    if (!v) return { label: '—', tone: 'mid' };
    const key = String(v).toLowerCase().replace(/[\s-]/g, '_');
    return VERDICTOS[key] || { label: String(v).toUpperCase(), tone: 'mid' };
  }

  function isBlank(s) {
    if (s == null) return true;
    const t = String(s).trim();
    return !t || t === '—' || t === '-' || /^n\/?a$/i.test(t);
  }

  function fixedRow(label, obj) {
    const valor = (obj && obj.valor) || '';
    const nota  = (obj && obj.nota)  || '';
    if (isBlank(valor) && isBlank(nota)) return '';
    return `
      <div class="rep-axis-row">
        <div class="rep-axis-label">${escapeHtml(label)}</div>
        <div class="rep-axis-value">${escapeHtml(valor || '—')}</div>
        <div class="rep-axis-note">${escapeHtml(nota)}</div>
      </div>`;
  }

  function friccionCard(f, i) {
    const tipo = (f.tipo || 'observación').toString().toUpperCase();
    const par = f.parrafo ? `§${f.parrafo}` : '';
    const propuesta = f.propuesta && String(f.propuesta).trim()
      ? `<div class="rep-fr-arrow">↳</div>
         <div class="rep-fr-prop">${escapeHtml(f.propuesta)}</div>`
      : '';
    const fuentesHtml = renderFuentesBlock(f._fuentes);
    return `
      <article class="rep-fr" data-fr-idx="${i}">
        <header class="rep-fr-head">
          <span class="rep-fr-num">${String(i + 1).padStart(2, '0')}</span>
          <span class="rep-fr-tipo">${escapeHtml(tipo)}</span>
          ${par ? `<span class="rep-fr-par">${escapeHtml(par)}</span>` : ''}
        </header>
        <blockquote class="rep-fr-cita">${escapeHtml(f.cita || '')}</blockquote>
        <p class="rep-fr-comm">${escapeHtml(f.comentario || '')}</p>
        ${propuesta}
        <footer class="rep-fr-foot">
          <button type="button" class="rep-fr-srcbtn" data-act="find-sources" data-fr-idx="${i}" title="Buscar fuentes (autores, obras, paralelos) que ayuden a resolver esta fricción">◇ buscar fuentes</button>
        </footer>
        <div class="rep-fr-sources" data-fr-sources="${i}">${fuentesHtml}</div>
      </article>`;
    }

  /* ============================================================
     BLOQUE DE FUENTES POR FRICCIÓN
     ============================================================ */
  function tipoFuenteLabel(t) {
    const map = {
      cita_autoridad: 'cita de autoridad',
      contraejemplo:  'contraejemplo',
      paralelo:       'paralelo',
      factual:        'factual'
    };
    return map[t] || t || 'paralelo';
  }

  function renderFuentesBlock(state) {
    if (!state) return '';
    if (state.loading) {
      return `
        <div class="rep-srcs">
          <div class="rep-srcs-head">
            <span class="rep-srcs-kicker">FUENTES SUGERIDAS</span>
            <span class="rep-srcs-status">buscando…</span>
          </div>
          <div class="rep-srcs-loading">◇ ◇ ◇</div>
        </div>`;
    }
    if (state.error) {
      return `
        <div class="rep-srcs error">
          <div class="rep-srcs-head">
            <span class="rep-srcs-kicker">FUENTES · ERROR</span>
            <button type="button" class="rep-srcs-action" data-act="retry-sources" data-fr-idx="${state.idx}">↻ reintentar</button>
            <button type="button" class="rep-srcs-action" data-act="dismiss-sources" data-fr-idx="${state.idx}">× cerrar</button>
          </div>
          <pre class="rep-srcs-err">${escapeHtml(state.error)}</pre>
        </div>`;
    }
    const data = state.data;
    if (!data) return '';
    const items = (data.fuentes || []).map((s, n) => `
      <article class="rep-src" data-cert="${escapeHtml(s.certeza || 'media')}">
        <header class="rep-src-head">
          <span class="rep-src-n">${String(n + 1).padStart(2, '0')}</span>
          <span class="rep-src-tipo">${escapeHtml(tipoFuenteLabel(s.tipo))}</span>
          <span class="rep-src-cert" title="Certeza autodeclarada por el modelo">cert. ${escapeHtml(s.certeza || 'media')}</span>
        </header>
        <div class="rep-src-ref">
          <strong>${escapeHtml(s.autor || '—')}</strong>
          ${s.obra ? `, <em>${escapeHtml(s.obra)}</em>` : ''}
          ${s['año'] && s['año'] !== '—' ? ` <span class="rep-src-anyo">(${escapeHtml(s['año'])})</span>` : ''}
        </div>
        ${s.fragmento_o_idea ? `<blockquote class="rep-src-frag">${escapeHtml(s.fragmento_o_idea)}</blockquote>` : ''}
        ${s.porque ? `<p class="rep-src-why"><span class="rep-src-why-lbl">↳ por qué</span> ${escapeHtml(s.porque)}</p>` : ''}
      </article>`).join('');

    const empty = !items
      ? `<p class="rep-srcs-empty">${escapeHtml(data.nota_general || 'El modelo no ha encontrado fuentes útiles para esta fricción.')}</p>`
      : '';
    const nota = items && data.nota_general
      ? `<p class="rep-srcs-note">${escapeHtml(data.nota_general)}</p>`
      : '';
    const provider = state.providerLabel ? `<span class="rep-srcs-prov">vía ${escapeHtml(state.providerLabel)}</span>` : '';

    return `
      <div class="rep-srcs">
        <div class="rep-srcs-head">
          <span class="rep-srcs-kicker">FUENTES SUGERIDAS</span>
          ${provider}
          <button type="button" class="rep-srcs-action" data-act="retry-sources" data-fr-idx="${state.idx}" title="Volver a pedir fuentes">↻ regenerar</button>
          <button type="button" class="rep-srcs-action" data-act="dismiss-sources" data-fr-idx="${state.idx}" title="Quitar fuentes de esta fricción">× cerrar</button>
        </div>
        ${items}${empty}${nota}
        <div class="rep-srcs-warn">⚠ Las fuentes salen de la memoria del modelo, no de búsqueda web. Verifica autoría, edición y atribución antes de citar.</div>
      </div>`;
  }

  /* ============================================================
     RENDER PRINCIPAL · usa data-variant para conmutar visuales
     ============================================================ */
  function render(container, { report, meta, variant, providerLabel }) {
    if (!container) return;
    if (!report) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-mark">◆</div>
          <h3>Sin informe todavía</h3>
        </div>`;
      return;
    }

    const v = variant || 'classic';
    const verd = verdictoMeta(report.veredicto);
    const fricciones = (report.fricciones || []).map(friccionCard).join('');
    const fuertes = (report.puntos_fuertes || [])
      .filter(p => !isBlank(p))
      .map(p => `<li>${escapeHtml(p)}</li>`).join('');
    const globales = (report.propuestas_globales || [])
      .filter(p => !isBlank(p))
      .map(p => `<li>${escapeHtml(p)}</li>`).join('');
    const axes = [
      fixedRow('Registro',   report.registro),
      fixedRow('Ritmo',      report.ritmo),
      fixedRow('Léxico',     report.lexico),
      fixedRow('Estructura', report.estructura)
    ].filter(Boolean).join('');

    const now = new Date();
    const fecha = now.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });

    container.innerHTML = `
      <article class="report" data-variant="${v}">

        <header class="rep-head">
          <div class="rep-h-row">
            <div class="rep-h-mark">◆</div>
            <div class="rep-h-kicker">INFORME DE MESA · MERIDIAN</div>
            <div class="rep-h-fecha">${escapeHtml(fecha)}</div>
          </div>
          <h1 class="rep-title">${escapeHtml(meta.title || 'Texto sin título')}</h1>
          <div class="rep-byline">
            <span>${escapeHtml(meta.author || 'sin firma')}</span>
            ${meta.issue ? `<span class="rep-dot">·</span><span>${escapeHtml(meta.issue)}</span>` : ''}
            ${providerLabel ? `<span class="rep-dot">·</span><span class="rep-prov">${escapeHtml(providerLabel)}</span>` : ''}
          </div>
        </header>

        <section class="rep-band-verd verd-${verd.tone}">
          <div class="rep-band-lbl">VEREDICTO</div>
          <div class="rep-band-val">${escapeHtml(verd.label)}</div>
          ${isBlank(report.veredicto_nota) ? '' : `<div class="rep-band-note">${escapeHtml(report.veredicto_nota)}</div>`}
        </section>

        ${isBlank(report.diagnostico) && isBlank(report.tesis_detectada) ? '' : `
        <section class="rep-block rep-diag">
          <h2 class="rep-h2">Diagnóstico</h2>
          ${isBlank(report.diagnostico) ? '' : `<p class="rep-diag-body">${escapeHtml(report.diagnostico)}</p>`}
          ${isBlank(report.tesis_detectada) ? '' : `
            <div class="rep-tesis">
              <span class="rep-tesis-lbl">Tesis detectada</span>
              <p class="rep-tesis-txt">${escapeHtml(report.tesis_detectada)}</p>
            </div>`}
        </section>`}

        ${axes ? `
        <section class="rep-block rep-axes">
          <h2 class="rep-h2">Ejes de lectura</h2>
          <div class="rep-axes-grid">
            ${axes}
          </div>
        </section>` : ''}

        ${fuertes ? `
        <section class="rep-block rep-fuertes">
          <h2 class="rep-h2">Lo que sostiene el texto</h2>
          <ul class="rep-fuertes-list">${fuertes}</ul>
        </section>` : ''}

        ${fricciones ? `
        <section class="rep-block rep-fricciones">
          <h2 class="rep-h2">Fricciones · pasaje a pasaje</h2>
          <div class="rep-fr-grid">${fricciones}</div>
        </section>` : ''}

        ${globales ? `
        <section class="rep-block rep-globales">
          <h2 class="rep-h2">Para el siguiente pase</h2>
          <ol class="rep-globales-list">${globales}</ol>
        </section>` : ''}

        <footer class="rep-foot">
          <span class="rep-foot-mark">◆</span>
          <span>Meridian Magazine · Mesa de redacción</span>
        </footer>
      </article>`;
  }

  global.MesaLayout = { render, escapeHtml, verdictoMeta, renderFuentesBlock };
})(window);
