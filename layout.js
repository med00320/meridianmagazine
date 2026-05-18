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
    return `
      <article class="rep-fr">
        <header class="rep-fr-head">
          <span class="rep-fr-num">${String(i + 1).padStart(2, '0')}</span>
          <span class="rep-fr-tipo">${escapeHtml(tipo)}</span>
          ${par ? `<span class="rep-fr-par">${escapeHtml(par)}</span>` : ''}
        </header>
        <blockquote class="rep-fr-cita">${escapeHtml(f.cita || '')}</blockquote>
        <p class="rep-fr-comm">${escapeHtml(f.comentario || '')}</p>
        ${propuesta}
      </article>`;
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

  global.MesaLayout = { render, escapeHtml, verdictoMeta };
})(window);
