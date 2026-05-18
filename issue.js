/* ============================================================
   MERIDIAN · issue.js
   Maquetador del número:
     - Portada editable (número, estación, año, tema, tagline,
       destacados, autor monográfico)
     - Sumario auto-generado a partir de los artículos en cola
     - Cuerpo: cada artículo con kicker, título, subtítulo,
       byline, capitular en piezas largas, intertítulos en
       small-caps, separadores · · · y diamante ◆ de cierre
     - Contraportada genérica (cita de cierre + colofón fijo)
     - Render destinado a window.print() en A5 portrait

   Expone window.MesaIssue.
   ============================================================ */
(function (global) {
  'use strict';

  const META_KEY = 'meridian-issue-meta-v1';

  /* ---------- defaults ---------- */
  const DEFAULT_META = {
    number: '01',
    season: 'Primavera',
    year:   String(new Date().getFullYear()),
    theme:        'Sin tema',           // editable
    themeAuthor:  '',                   // editable · acento ocre en portada
    tagline:      'Lectura lenta · literatura norteamericana XX y XXI',
    highlights:   [],                   // 3-4 sintagmas
    closingQuote: 'Lo que en la creación existe sin mi conocimiento existe sin mi consentimiento.',
    closingAttrib:'Cormac McCarthy',
    colophon:     '© Meridian Magazine · todos los derechos reservados',
    site:         'meridianmagazine.es'
  };

  /* ---------- persistencia ---------- */
  function loadMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (!raw) return Object.assign({}, DEFAULT_META);
      const obj = JSON.parse(raw);
      return Object.assign({}, DEFAULT_META, obj);
    } catch { return Object.assign({}, DEFAULT_META); }
  }
  function saveMeta(meta) {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta || {})); } catch {}
  }
  function resetMeta() {
    try { localStorage.removeItem(META_KEY); } catch {}
    return Object.assign({}, DEFAULT_META);
  }

  /* ---------- utilidades ---------- */
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function inlineMd(s) {
    let h = escHtml(s);
    h = h.replace(/\*\*([^*\n][^*\n]*?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(^|[^*])\*([^*\n][^*\n]*?)\*(?!\*)/g, '$1<em>$2</em>');
    return h;
  }
  function countWords(s) { return s ? (s.trim().match(/\S+/g) || []).length : 0; }

  /* ---------- copy automático del número (portada/contraportada) ---------- */
  // Pide al LLM tema + tagline + destacados + frase de cierre, en JSON.
  async function autoCopy(articles) {
    const C = global.MesaCritic;
    const B = global.MesaBrand;
    if (!C || !C.hasLLM() || !B) {
      throw new Error('Configura la IA para autocompletar el copy del número.');
    }
    const meta = loadMeta();
    const list = (articles || []).map(e => ({
      title:  (e.article && e.article.titulo)  || '',
      author: (e.article && e.article.autor)   || ''
    }));
    const prompt = await B.buildIssueCopyPrompt({
      articles: list,
      issueNumber: meta.number,
      season: meta.season,
      year: meta.year
    });
    const raw = await C.callLLM(prompt, { json: true, temperature: 0.55, max_tokens: 1200 });
    const data = C.tryParseJSON(raw);
    return {
      theme:        data.tema         || '',
      tagline:      data.tagline      || '',
      highlights:   Array.isArray(data.destacados) ? data.destacados.slice(0, 4) : [],
      closingQuote: data.contraportada || ''
    };
  }

  /* ---------- render de párrafo (markdown ligero → HTML) ---------- */
  function renderParagraph(p) {
    const t = String(p || '').trim();
    if (!t) return '';
    if (/^·\s*·\s*·$/.test(t)) return '<p class="iss-sep">· · ·</p>';
    if (/^>\s?/.test(t)) {
      // blockquote multilínea
      const body = t.split('\n').map(l => l.replace(/^>\s?/, '')).join(' ').trim();
      return '<blockquote class="iss-cita"><em>' + inlineMd(body) + '</em></blockquote>';
    }
    return '<p>' + inlineMd(t).replace(/\n/g, '<br/>') + '</p>';
  }

  /* ---------- render de un artículo ---------- */
  function renderArticle(article, opts) {
    opts = opts || {};
    const num = opts.num || 1;       // posición en el sumario
    const totalArticles = opts.total || 1;

    const kicker  = article.kicker  || '';
    const titulo  = article.titulo  || 'Sin título';
    const subtit  = article.subtitulo || '';
    const autor   = article.autor   || '';

    const totalWords = (article.stats && article.stats.words) ||
      (article.secciones || []).reduce((acc, s) =>
        acc + countWords((s.parrafos || []).join(' ')), 0);
    const useCapitular = totalWords >= 1500;

    let firstParagraphRendered = false;

    const sectionsHtml = (article.secciones || []).map((sec, i) => {
      const inter = sec.titulo
        ? '<h2 class="iss-inter">' + escHtml(sec.titulo) + '</h2>'
        : (i > 0 ? '<p class="iss-sep">· · ·</p>' : '');

      const paras = (sec.parrafos || []).map(p => {
        const html = renderParagraph(p);
        if (!html) return '';
        // Capitular: aplicada SOLO al primer <p> textual del artículo
        if (useCapitular && !firstParagraphRendered && html.startsWith('<p>')) {
          firstParagraphRendered = true;
          return html.replace('<p>', '<p class="iss-capitular">');
        }
        if (html.startsWith('<p>')) firstParagraphRendered = true;
        return html;
      }).join('\n');

      return inter + '\n' + paras;
    }).join('\n');

    return `
<article class="iss-article" data-num="${escHtml(String(num).padStart(2, '0'))}">
  <header class="iss-art-head">
    ${kicker ? '<div class="iss-kicker">' + escHtml(kicker) + '</div>' : ''}
    <h1 class="iss-title">${inlineMd(titulo)}</h1>
    ${subtit ? '<p class="iss-subtitle"><em>' + escHtml(subtit) + '</em></p>' : ''}
    ${autor ? '<p class="iss-byline">POR ' + escHtml(autor.toUpperCase()) + '</p>' : ''}
    <div class="iss-rule"></div>
  </header>
  <div class="iss-body">
    ${sectionsHtml}
    <p class="iss-diamante">◆</p>
  </div>
</article>`;
  }

  /* ---------- render de portada ---------- */
  function renderCover(meta, articles) {
    const themeAuthor = meta.themeAuthor || '';
    const themeBody = meta.theme || '';
    // Acento ocre en el nombre del autor monográfico
    const themeRendered = themeAuthor
      ? escHtml(themeBody).replace(
          new RegExp('(' + themeAuthor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'i'),
          '<span class="iss-cover-ochre">$1</span>')
      : escHtml(themeBody);

    const collaborators = (articles || [])
      .map(e => (e.article && e.article.autor) || '')
      .filter(Boolean)
      .map(a => escHtml(a.toUpperCase()))
      .filter((v, i, arr) => arr.indexOf(v) === i)   // únicos
      .join(' · ');

    const number = escHtml(meta.number || '01');
    const season = escHtml(meta.season || '');
    const year   = escHtml(meta.year   || '');
    const tagline = escHtml(meta.tagline || '');

    return `
<section class="iss-cover">
  <div class="iss-cover-grad"></div>
  <header class="iss-cover-top">
    <div class="iss-cover-folio">N.º ${number} · ${season} ${year}</div>
  </header>
  <div class="iss-cover-mid">
    <div class="iss-cover-wordmark">Meridian</div>
    <div class="iss-cover-claim">L I T E R A T U R A · N O R T E A M E R I C A N A · X X · X X I</div>
  </div>
  <div class="iss-cover-theme">
    <div class="iss-cover-kicker">EL TEMA</div>
    <h1 class="iss-cover-title"><em>${themeRendered}</em></h1>
    <p class="iss-cover-tagline"><em>${tagline}</em></p>
  </div>
  ${collaborators ? `<footer class="iss-cover-foot">
    <div class="iss-cover-collab">${collaborators}</div>
  </footer>` : ''}
</section>`;
  }

  /* ---------- render de sumario ---------- */
  function renderToc(articles, meta) {
    const items = (articles || []).map((e, i) => {
      const a = e.article || {};
      return `
        <li class="iss-toc-item">
          <span class="iss-toc-num">${String(i + 1).padStart(2, '0')}</span>
          <div class="iss-toc-body">
            <div class="iss-toc-kicker">${escHtml(a.kicker || '')}</div>
            <div class="iss-toc-title">${inlineMd(a.titulo || 'Sin título')}</div>
            ${a.autor ? `<div class="iss-toc-author">POR ${escHtml(a.autor.toUpperCase())}</div>` : ''}
          </div>
        </li>`;
    }).join('');

    return `
<section class="iss-toc">
  <header class="iss-toc-head">
    <div class="iss-toc-mark">◆</div>
    <h2 class="iss-toc-h2">Sumario</h2>
    <div class="iss-toc-folio">N.º ${escHtml(meta.number || '')} · ${escHtml(meta.season || '')} ${escHtml(meta.year || '')}</div>
  </header>
  <ol class="iss-toc-list">${items}</ol>
</section>`;
  }

  /* ---------- render de contraportada ---------- */
  function renderBack(meta) {
    const quote = escHtml(meta.closingQuote || '');
    const attrib = escHtml(meta.closingAttrib || '');
    const colophon = escHtml(meta.colophon || '');
    const site = escHtml(meta.site || '');
    return `
<section class="iss-back">
  <div class="iss-back-mid">
    <div class="iss-back-mark">◆</div>
    ${quote ? `<blockquote class="iss-back-quote"><em>${quote}</em></blockquote>` : ''}
    ${attrib ? `<div class="iss-back-attrib">— ${attrib}</div>` : ''}
  </div>
  <footer class="iss-back-foot">
    <div class="iss-back-wordmark">Meridian</div>
    <div class="iss-back-colophon">${colophon}</div>
    <div class="iss-back-site">${site}</div>
  </footer>
</section>`;
  }

  /* ---------- render del documento completo ---------- */
  /**
   * Pinta el número entero dentro de `container`.
   * @param {HTMLElement} container
   * @param {Array} articles  cola del MesaExpress.loadAll()
   * @param {object} meta     loadMeta() o uno custom
   */
  function renderIssue(container, articles, meta) {
    if (!container) return;
    const m = meta || loadMeta();
    const list = articles || [];
    if (!list.length) {
      container.innerHTML = `
        <div class="empty-state iss-empty">
          <div class="empty-mark">◆</div>
          <h3>El número está vacío</h3>
          <p>Añade artículos desde la pestaña <em>Express</em> o redacta uno con IA.
             Cuando tengas al menos uno, aparecerá la portada, el sumario y la contraportada.</p>
        </div>`;
      return;
    }
    const cover  = renderCover(m, list);
    const toc    = renderToc(list, m);
    const arts   = list.map((e, i) => renderArticle(e.article || {}, { num: i + 1, total: list.length })).join('\n');
    const back   = renderBack(m);
    container.innerHTML = `
<div class="iss-doc">
  ${cover}
  ${toc}
  ${arts}
  ${back}
</div>`;
  }

  /* ---------- estadísticas para el panel ---------- */
  function pageEstimate(articles) {
    const W_PER_PAGE = 280;
    let words = 0;
    (articles || []).forEach(e => {
      const s = (e.article && e.article.stats) || {};
      words += s.words || 0;
    });
    // 1 portada + 1 sumario + N páginas de cuerpo + 1 contraportada
    const body = Math.max(1, Math.round(words / W_PER_PAGE));
    return { body, total: 1 + 1 + body + 1, words };
  }

  /* ============================================================
     EXPOSE
     ============================================================ */
  global.MesaIssue = {
    DEFAULT_META,
    loadMeta, saveMeta, resetMeta,
    autoCopy,
    renderIssue, renderArticle, renderCover, renderToc, renderBack,
    pageEstimate
  };
})(window);
