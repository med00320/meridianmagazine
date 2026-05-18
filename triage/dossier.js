/* ============================================================
   MERIDIAN · Triage · dossier.js
   Render del dossier (lista de fichas) y export a Markdown / JSON.
   Expone window.TriageDossier
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
  function isBlank(s) {
    if (s == null) return true;
    const t = String(s).trim();
    return !t || t === '—' || t === '-' || /^n\/?a$/i.test(t);
  }

  /* ============================================================
     RENDER · ficha individual
     ============================================================ */
  function ficha(f, i, extras) {
    const cover = (f._coverDataUrl)
      ? `<div class="t-ficha-cover">
           <span>Cover · ${escapeHtml(f._coverPage ? 'p.' + f._coverPage : '')}</span>
           <img src="${escapeHtml(f._coverDataUrl)}" alt="Cover de ${escapeHtml(f.libro?.titulo || 'libro')}" />
         </div>`
      : `<div class="t-ficha-cover">
           <span>Cover</span>
           <div class="t-ficha-cover-empty">sin imagen</div>
         </div>`;

    const libro = f.libro || {};
    const critico = f.critico || {};
    const pub = f.publicacion || {};

    const fecha = pub.fecha || extras?.fechaNumero || '';
    const numero = pub.numero || extras?.numeroNumero || '';
    const medio = pub.medio || extras?.medioNumero || '';

    const claves = (f.claves_de_lectura || [])
      .filter(s => !isBlank(s))
      .map(s => `<li>${escapeHtml(s)}</li>`).join('');
    const objs = (f.objeciones_del_critico || [])
      .filter(s => !isBlank(s))
      .map(s => `<li>${escapeHtml(s)}</li>`).join('');
    const lecturas = (f.lecturas_relacionadas || [])
      .filter(s => !isBlank(s))
      .map(s => `<li>${escapeHtml(s)}</li>`).join('');

    const citas = (f.citas_seleccionadas || []).map((c) => `
      <article class="t-cita">
        <div class="t-cita-en">${escapeHtml(c.en || '')}<small>cita literal · uso editorial breve · § fair use art. 32 LPI</small></div>
        ${c.es ? `<div class="t-cita-es">${escapeHtml(c.es)}</div>` : ''}
        ${c.por_que_meridian_la_rescata ? `<div class="t-cita-why"><span class="t-cita-why-lbl">↳ por qué</span>${escapeHtml(c.por_que_meridian_la_rescata)}</div>` : ''}
      </article>`).join('');

    const tipoLabel = (f.tipo_pieza || 'reseña').toUpperCase();
    const titulo = pub.titulo_resena || libro.titulo || 'Reseña sin título';

    const libroMeta = [
      libro.editorial,
      libro.ano && libro.ano !== '—' ? libro.ano : '',
      libro.paginas && libro.paginas !== '—' ? libro.paginas : '',
      libro.isbn ? 'ISBN ' + libro.isbn : ''
    ].filter(Boolean).join(' · ');

    const bylineParts = [
      tipoLabel,
      critico.nombre ? `por ${critico.nombre}` : '',
      medio,
      numero,
      fecha
    ].filter(Boolean);

    const meridianContent = (typeof f.meridian_sobre_esto === 'string' && f.meridian_sobre_esto.trim())
      ? escapeHtml(f.meridian_sobre_esto)
      : '';

    const atribucion = f.atribucion_obligatoria
      || `${critico.nombre || '—'}, «${pub.titulo_resena || libro.titulo || '—'}», ${medio || '—'}, ${numero || '—'}, ${fecha || '—'}.`;

    return `
      <article class="t-ficha" data-ficha-idx="${i}">
        <header class="t-ficha-hd">
          <span class="mark">◆</span>
          <span class="kicker">FICHA DE RESEÑA · MERIDIAN · TRIAGE</span>
          <span class="fecha">${escapeHtml(fecha)}</span>
        </header>

        <h1 class="t-ficha-titulo">${escapeHtml(titulo)}</h1>
        <div class="t-ficha-byline">
          ${bylineParts.map((s, k) => `${k > 0 ? '<span class="dot">·</span>' : ''}<span>${escapeHtml(s)}</span>`).join('')}
        </div>

        <div class="t-ficha-grid">
          ${cover}
          <div class="t-ficha-libro">
            <div class="t-ficha-libro-titulo">${escapeHtml(libro.titulo || '—')}${libro.titulo_castellano_si_hay_edicion ? `<small>(en castellano: ${escapeHtml(libro.titulo_castellano_si_hay_edicion)})</small>` : ''}</div>
            ${libro.autor ? `<div class="t-ficha-libro-autor">${escapeHtml(libro.autor)}</div>` : ''}
            ${libroMeta ? `<div class="t-ficha-libro-meta">${escapeHtml(libroMeta)}</div>` : ''}
            ${libro.es_traduccion && libro.lengua_original ? `<div class="t-ficha-libro-meta">Traducido del ${escapeHtml(libro.lengua_original)}</div>` : ''}
            ${libro.tema ? `<div class="t-ficha-libro-tema"><span class="t-meta-lbl">Tema · </span>${escapeHtml(libro.tema)}</div>` : ''}
            ${libro.tesis_del_libro ? `<div class="t-ficha-libro-tema"><span class="t-meta-lbl">Tesis · </span>${escapeHtml(libro.tesis_del_libro)}</div>` : ''}
            ${libro.estructura ? `<div class="t-ficha-libro-tema"><span class="t-meta-lbl">Estructura · </span>${escapeHtml(libro.estructura)}</div>` : ''}
          </div>
        </div>

        ${f.tesis_del_critico ? `
        <section class="t-section">
          <h3 class="t-h3">Tesis del crítico</h3>
          <p class="t-tesis">${escapeHtml(f.tesis_del_critico)}</p>
        </section>` : ''}

        ${f.argumento_critico_castellano ? `
        <section class="t-section">
          <h3 class="t-h3">Argumento crítico · síntesis Meridian</h3>
          <p class="t-arg">${escapeHtml(f.argumento_critico_castellano)}</p>
          ${f.valoracion_global ? `<p class="t-val-row"><span class="t-val" data-v="${escapeHtml(f.valoracion_global)}">Valoración · ${escapeHtml(String(f.valoracion_global).replace(/_/g,' '))}</span></p>` : ''}
        </section>` : ''}

        ${claves ? `
        <section class="t-section">
          <h3 class="t-h3">Claves de lectura</h3>
          <ul class="t-list">${claves}</ul>
        </section>` : ''}

        ${objs ? `
        <section class="t-section">
          <h3 class="t-h3">Objeciones del crítico</h3>
          <ul class="t-list objs">${objs}</ul>
        </section>` : ''}

        ${citas ? `
        <section class="t-section">
          <h3 class="t-h3">Citas seleccionadas · ≤ 30 palabras</h3>
          <div class="t-citas">${citas}</div>
        </section>` : ''}

        ${lecturas ? `
        <section class="t-section">
          <h3 class="t-h3">Lecturas relacionadas que el crítico menciona</h3>
          <ul class="t-list">${lecturas}</ul>
        </section>` : ''}

        <section class="t-section">
          <h3 class="t-h3">Meridian sobre esto</h3>
          <div class="t-meridian-slot"
               contenteditable="true"
               data-ficha-idx="${i}"
               data-placeholder="Aquí escribe el redactor Meridian su mirada sobre la reseña: qué le interesa, dónde discrepa, qué prolonga, en qué tradición editorial cae el libro. Esto es lo que va a publicarse."
               data-empty="${meridianContent ? 'false' : 'true'}">${meridianContent}</div>
        </section>

        <footer class="t-ficha-foot">
          <span><strong>Atribución obligatoria.</strong> Meridian sólo glosa; no traduce ni reproduce el artículo.</span>
          <span>${escapeHtml(atribucion)}</span>
          ${pub.url ? `<span><a href="${escapeHtml(pub.url)}" target="_blank" rel="noopener">${escapeHtml(pub.url)}</a></span>` : ''}
        </footer>
      </article>`;
  }

  function render(container, fichas, extras) {
    if (!container) return;
    if (!fichas || !fichas.length) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = fichas.map((f, i) => ficha(f, i, extras)).join('');
  }

  /* ============================================================
     EXPORT · Markdown
     ============================================================ */
  function buildMarkdown(fichas, extras) {
    const lines = [];
    lines.push(`# Dossier de reseñas · Meridian Triage`);
    if (extras?.medioNumero || extras?.numeroNumero || extras?.fechaNumero) {
      const head = [extras.medioNumero, extras.numeroNumero, extras.fechaNumero].filter(Boolean).join(' · ');
      lines.push(`*${head}*`);
    }
    lines.push('');
    lines.push('> Modelo B · Meridian glosa el contenido de las reseñas, no traduce el artículo íntegro. Las citas literales son fragmentos breves (≤ 30 palabras), comentadas. Atribución obligatoria al pie de cada ficha. Cumple art. 32 LPI.');
    lines.push('');

    fichas.forEach((f, i) => {
      const libro = f.libro || {};
      const critico = f.critico || {};
      const pub = f.publicacion || {};
      lines.push(`---`);
      lines.push('');
      lines.push(`## ${String(i + 1).padStart(2, '0')} · ${pub.titulo_resena || libro.titulo || 'Reseña sin título'}`);
      lines.push('');
      const byline = [
        f.tipo_pieza || 'reseña',
        critico.nombre ? `por ${critico.nombre}` : '',
        pub.medio || extras?.medioNumero || '',
        pub.numero || extras?.numeroNumero || '',
        pub.fecha || extras?.fechaNumero || ''
      ].filter(Boolean).join(' · ');
      if (byline) lines.push(`*${byline}*`);
      lines.push('');

      lines.push('### Libro reseñado');
      const libroHead = [libro.titulo, libro.autor].filter(Boolean).join(' — ');
      if (libroHead) lines.push(`**${libroHead}**`);
      const libroMeta = [libro.editorial, libro.ano, libro.paginas, libro.isbn ? 'ISBN ' + libro.isbn : '']
        .filter(s => s && s !== '—').join(' · ');
      if (libroMeta) lines.push(libroMeta);
      if (libro.titulo_castellano_si_hay_edicion) lines.push(`*Edición en castellano:* ${libro.titulo_castellano_si_hay_edicion}`);
      if (libro.es_traduccion && libro.lengua_original) lines.push(`*Traducido del ${libro.lengua_original}.*`);
      lines.push('');
      if (libro.tema) lines.push(`**Tema:** ${libro.tema}`);
      if (libro.tesis_del_libro) lines.push(`**Tesis del libro:** ${libro.tesis_del_libro}`);
      if (libro.estructura) lines.push(`**Estructura:** ${libro.estructura}`);
      lines.push('');

      if (critico.nombre || critico.perfil) {
        lines.push('### Crítico');
        if (critico.nombre) lines.push(`**${critico.nombre}**`);
        if (critico.perfil) lines.push(`*${critico.perfil}*`);
        lines.push('');
      }

      if (f.tesis_del_critico) {
        lines.push('### Tesis del crítico');
        lines.push(`> ${f.tesis_del_critico}`);
        lines.push('');
      }

      if (f.argumento_critico_castellano) {
        lines.push('### Argumento crítico · síntesis Meridian');
        lines.push(f.argumento_critico_castellano);
        lines.push('');
      }
      if (f.valoracion_global) {
        lines.push(`**Valoración global:** ${String(f.valoracion_global).replace(/_/g, ' ').toUpperCase()}`);
        lines.push('');
      }

      if ((f.claves_de_lectura || []).length) {
        lines.push('### Claves de lectura');
        f.claves_de_lectura.forEach(s => lines.push(`- ${s}`));
        lines.push('');
      }
      if ((f.objeciones_del_critico || []).length) {
        lines.push('### Objeciones del crítico');
        f.objeciones_del_critico.forEach(s => lines.push(`- ${s}`));
        lines.push('');
      }

      if ((f.citas_seleccionadas || []).length) {
        lines.push('### Citas seleccionadas');
        lines.push('*Fragmentos literales ≤ 30 palabras, citados al amparo del derecho de cita (art. 32 LPI).*');
        lines.push('');
        f.citas_seleccionadas.forEach((c, n) => {
          lines.push(`**${String(n + 1).padStart(2, '0')}.** «${c.en}»`);
          if (c.es) lines.push(`*Trad. Meridian:* ${c.es}`);
          if (c.por_que_meridian_la_rescata) lines.push(`*Por qué:* ${c.por_que_meridian_la_rescata}`);
          lines.push('');
        });
      }

      if ((f.lecturas_relacionadas || []).length) {
        lines.push('### Lecturas relacionadas mencionadas por el crítico');
        f.lecturas_relacionadas.forEach(s => lines.push(`- ${s}`));
        lines.push('');
      }

      lines.push('### Meridian sobre esto');
      lines.push(f.meridian_sobre_esto && f.meridian_sobre_esto.trim()
        ? f.meridian_sobre_esto.trim()
        : '_[Pendiente: aquí escribe el redactor Meridian su mirada propia.]_');
      lines.push('');

      lines.push('---');
      lines.push('');
      lines.push('**Atribución obligatoria** · Meridian glosa, no reproduce.');
      const atrib = f.atribucion_obligatoria
        || `${critico.nombre || '—'}, «${pub.titulo_resena || libro.titulo || '—'}», ${pub.medio || extras?.medioNumero || '—'}, ${pub.numero || extras?.numeroNumero || '—'}, ${pub.fecha || extras?.fechaNumero || '—'}.`;
      lines.push(atrib);
      if (pub.url) lines.push(pub.url);
      lines.push('');
    });

    return lines.join('\n');
  }

  /* ============================================================
     EXPORT · helpers
     ============================================================ */
  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
  }

  function slug(s) {
    return String(s || 'dossier')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  global.TriageDossier = {
    render, buildMarkdown, downloadBlob, slug, escapeHtml
  };
})(window);
