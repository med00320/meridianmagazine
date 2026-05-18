/* ============================================================
   MERIDIAN · sectioner.js
   Convierte un texto plano o markdown en un artículo estructurado:
       { titulo, subtitulo, autor, kicker, secciones: [
           { titulo, parrafos: ['p1', 'p2', ...] }
       ] }
   - Si el texto trae cabeceras `## ` (escritas por el autor o por
     Mesa Express), las respeta como secciones.
   - Si no las trae, parte por longitud (~450-650 palabras) y le
     pide al LLM SÓLO los titulares en una llamada barata.
   - El primer párrafo en negrita o subrayado por `*subtítulo*`
     se promociona a subtítulo del artículo.
   - Detecta byline `POR NOMBRE APELLIDO` y kicker `SECCIÓN · 0X`.
   - El diamante ◆ del cierre se descarta (lo añade el render).

   Expone window.MesaSectioner.
   ============================================================ */
(function (global) {
  'use strict';

  const TARGET_WORDS_MIN = 380;
  const TARGET_WORDS_MAX = 700;

  function countWords(s) { return s ? (s.trim().match(/\S+/g) || []).length : 0; }
  function trim(s) { return String(s == null ? '' : s).trim(); }

  /* ---------- normalización ---------- */
  function normalize(md) {
    return String(md || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00ad/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /* ---------- detección del encabezado del artículo ---------- */
  // Devuelve { titulo, subtitulo, autor, kicker, body }
  function extractHeader(md) {
    const lines = md.split('\n');
    const out = { titulo: '', subtitulo: '', autor: '', kicker: '', body: md };
    let i = 0;

    // Salta líneas en blanco iniciales
    while (i < lines.length && !lines[i].trim()) i++;

    // Kicker: línea con `·`, corta, mayoritariamente en mayúsculas.
    // Acepta palabras tipo "McCARTHY", "O'BRIEN" — exigir [A-Z] estricto
    // dejaba fuera nombres propios habituales del catálogo Meridian.
    function looksLikeKicker(line) {
      const t = trim(line);
      if (!t || t.length > 80) return false;
      if (!/·/.test(t)) return false;
      if (/^[#*>]/.test(t) || /^POR\s+/i.test(t)) return false;
      if (/[.!?]$/.test(t)) return false;
      const letters = (t.match(/[A-Za-záéíóúÁÉÍÓÚñÑüÜ]/g) || []).length;
      const upper   = (t.match(/[A-ZÁÉÍÓÚÑÜ]/g) || []).length;
      if (!letters) return false;
      return (upper / letters) >= 0.65;
    }
    if (looksLikeKicker(lines[i])) {
      out.kicker = trim(lines[i]); i++;
      while (i < lines.length && !lines[i].trim()) i++;
    }

    // Título: primera línea con `# ` o, si no, primera línea de cuerpo
    if (lines[i] && /^#\s+/.test(lines[i])) {
      out.titulo = trim(lines[i].replace(/^#\s+/, ''));
      i++; while (i < lines.length && !lines[i].trim()) i++;
    }

    // Subtítulo: línea entera en cursiva `*…*` o párrafo siguiente corto
    if (lines[i] && /^\*[^*\n]+\*$/.test(trim(lines[i]))) {
      out.subtitulo = trim(lines[i]).slice(1, -1).trim();
      i++; while (i < lines.length && !lines[i].trim()) i++;
    }

    // Byline: línea que empieza por POR ...
    if (lines[i] && /^POR\s+\S/.test(trim(lines[i]))) {
      out.autor = trim(lines[i].replace(/^POR\s+/i, ''));
      i++; while (i < lines.length && !lines[i].trim()) i++;
    }

    // El resto es cuerpo
    out.body = lines.slice(i).join('\n').trim();
    return out;
  }

  /* ---------- limpieza del cierre ---------- */
  function stripDiamondTail(body) {
    return body
      .replace(/\n+\s*◆\s*$/u, '')
      .replace(/\n+\s*◆\s*\n+\s*$/u, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /* ---------- particiones ---------- */
  // Parte 1: si hay cabeceras ## las respeta
  function splitByMarkdownHeaders(body) {
    const blocks = [];
    let cur = { titulo: '', parrafos: [] };
    body.split(/\n{2,}/).forEach(p => {
      const h = p.match(/^##\s+(.+?)\s*$/);
      if (h) {
        if (cur.titulo || cur.parrafos.length) blocks.push(cur);
        cur = { titulo: trim(h[1]), parrafos: [] };
      } else {
        const t = trim(p);
        if (t) cur.parrafos.push(t);
      }
    });
    if (cur.titulo || cur.parrafos.length) blocks.push(cur);
    // Si la primera "sección" no tiene título, la dejamos como apertura
    return blocks;
  }

  // Parte 2: corta por longitud cuando no hay cabeceras
  function splitByLength(body, target) {
    const t = target || 520;
    const paragraphs = body.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
    if (!paragraphs.length) return [];

    const blocks = [];
    let cur = [];
    let acc = 0;

    for (const p of paragraphs) {
      const w = countWords(p);
      // Si ya nos pasamos del máximo, cierra el bloque antes
      if (acc + w > TARGET_WORDS_MAX && acc > TARGET_WORDS_MIN) {
        blocks.push({ titulo: '', parrafos: cur });
        cur = []; acc = 0;
      }
      cur.push(p); acc += w;
      // Si ya hemos alcanzado el target ideal, cerramos en el siguiente fin
      if (acc >= t && cur.length >= 2) {
        blocks.push({ titulo: '', parrafos: cur });
        cur = []; acc = 0;
      }
    }
    if (cur.length) {
      // Si el último bloque es muy corto y hay algún bloque previo, lo fusionamos
      if (countWords(cur.join(' ')) < 120 && blocks.length) {
        blocks[blocks.length - 1].parrafos.push(...cur);
      } else {
        blocks.push({ titulo: '', parrafos: cur });
      }
    }
    return blocks;
  }

  /* ---------- titulares automáticos ---------- */
  // Pide al LLM titulares Meridian para los bloques que no los traen.
  // Si falla (no hay IA configurada o el JSON es malo), deja "" en
  // los bloques afectados — el render entonces muestra `· · ·` entre
  // secciones en lugar de intertítulo.
  async function autoTitleBlocks(blocks, articleTitle) {
    const C = global.MesaCritic;
    const B = global.MesaBrand;
    if (!C || !C.hasLLM() || !B) return blocks;

    // Sólo necesitamos titulares para los bloques sin él Y que no sean apertura
    const targets = [];
    blocks.forEach((b, i) => {
      if (!b.titulo && i > 0) targets.push({ idx: i, text: b.parrafos.join('\n\n') });
    });
    if (!targets.length) return blocks;

    try {
      const prompt = await B.buildSectionTitlesPrompt({
        blocks: targets.map(t => t.text),
        articleTitle: articleTitle || ''
      });
      const raw = await C.callLLM(prompt, { json: true, temperature: 0.5, max_tokens: 800 });
      const data = C.tryParseJSON(raw);
      const titulos = Array.isArray(data && data.titulos) ? data.titulos : [];
      targets.forEach((t, i) => {
        const tit = trim(titulos[i] || '');
        if (tit) blocks[t.idx].titulo = tit;
      });
    } catch (err) {
      // Silencioso: no romper el flujo si la IA falla
      try { console.warn('[sectioner] auto-titulares omitidos:', err.message || err); } catch {}
    }
    return blocks;
  }

  /* ---------- entrada principal ---------- */
  /**
   * @param {string} markdown   texto del artículo (markdown ligero)
   * @param {object} opts       { meta, autoTitles=true, onProgress }
   * @returns {Promise<Article>} { titulo, subtitulo, autor, kicker, secciones }
   */
  async function structure(markdown, opts) {
    opts = opts || {};
    const meta = opts.meta || {};
    const autoTitles = opts.autoTitles !== false;
    const onProgress = opts.onProgress || (() => {});

    onProgress({ step: 'Analizando estructura…', pct: 10 });
    const md = normalize(markdown);
    if (!md) throw new Error('Texto vacío.');

    const head = extractHeader(md);
    let body = stripDiamondTail(head.body);

    onProgress({ step: 'Detectando secciones…', pct: 30 });
    const hasHeaders = /^##\s+/m.test(body);
    let blocks = hasHeaders ? splitByMarkdownHeaders(body) : splitByLength(body);

    // Limpieza · descarta bloques vacíos
    blocks = blocks.filter(b => b.titulo || (b.parrafos && b.parrafos.length));

    // Si la primera sección viene con título pero el artículo no tiene
    // apertura sin título, dejamos esa sección como apertura quitándole
    // el intertítulo: Meridian no abre con intertítulo.
    if (blocks.length && blocks[0].titulo) {
      blocks[0].titulo = '';
    }

    // Auto-titulares si procede
    if (autoTitles && !hasHeaders && blocks.length > 1) {
      onProgress({ step: 'Pidiendo intertítulos al modelo…', pct: 60 });
      blocks = await autoTitleBlocks(blocks, head.titulo || meta.title || '');
    }

    onProgress({ step: 'Cerrando estructura…', pct: 90 });
    const article = {
      titulo:    head.titulo    || meta.title  || '',
      subtitulo: head.subtitulo || '',
      autor:     head.autor     || meta.author || '',
      kicker:    head.kicker    || meta.issue  || '',
      secciones: blocks
    };

    // Estadísticas útiles para la UI
    const totalWords = blocks.reduce((acc, b) =>
      acc + countWords(b.parrafos.join(' ')), 0);
    article.stats = {
      words: totalWords,
      sections: blocks.length,
      withTitle: blocks.filter(b => b.titulo).length,
      pages: Math.max(1, Math.round(totalWords / 280))
    };

    onProgress({ step: 'Listo.', pct: 100 });
    return article;
  }

  /* ---------- serializa de vuelta a markdown editable ----------
     útil cuando el usuario quiere descargar el artículo en .md o
     reabrir un Express en modo Mesa para revisarlo.                */
  function articleToMarkdown(art) {
    const out = [];
    if (art.kicker)    out.push(art.kicker);
    if (art.titulo)    out.push('# ' + art.titulo);
    if (art.subtitulo) out.push('*' + art.subtitulo + '*');
    if (art.autor)     out.push('POR ' + String(art.autor).toUpperCase());
    out.push('');
    (art.secciones || []).forEach((s, i) => {
      if (s.titulo && i > 0) { out.push('## ' + s.titulo); }
      (s.parrafos || []).forEach(p => out.push(p));
      out.push('');
    });
    out.push('◆');
    return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  global.MesaSectioner = {
    structure, articleToMarkdown,
    extractHeader, splitByMarkdownHeaders, splitByLength
  };
})(window);
