/* ============================================================
   MERIDIAN · express.js
   Mesa Express · sin revisión.
   Dos formas de entrar:
     A) Pegar/subir un texto largo → MesaSectioner lo estructura.
     B) Generar con IA desde un brief → buildArticlePrompt → texto
        largo → MesaSectioner lo estructura.
   En ambos casos el resultado es un Article (mismo contrato que
   el sectioner) que se guarda en la cola persistente del número:
   localStorage `meridian-issue-articles-v1`.

   Expone window.MesaExpress.
   ============================================================ */
(function (global) {
  'use strict';

  const STORE_KEY = 'meridian-issue-articles-v1';

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return 'art-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /* ============================================================
     COLA DEL NÚMERO · CRUD persistente
     ============================================================ */
  function loadAll() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }
  function saveAll(arr) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(arr || [])); } catch {}
  }

  function add(article, source) {
    const all = loadAll();
    const entry = {
      id: uuid(),
      ts: Date.now(),
      source: source || 'express',
      article: article
    };
    all.push(entry);
    saveAll(all);
    return entry;
  }

  function update(id, articleOrPatch) {
    const all = loadAll();
    const i = all.findIndex(e => e.id === id);
    if (i === -1) return null;
    if (articleOrPatch.secciones || articleOrPatch.titulo) {
      all[i].article = articleOrPatch;
    } else {
      all[i].article = Object.assign({}, all[i].article, articleOrPatch);
    }
    all[i].ts = Date.now();
    saveAll(all);
    return all[i];
  }

  function remove(id) {
    const all = loadAll().filter(e => e.id !== id);
    saveAll(all);
  }

  function reorder(ids) {
    const all = loadAll();
    const map = new Map(all.map(e => [e.id, e]));
    const ordered = ids.map(id => map.get(id)).filter(Boolean);
    // Conserva los que no estaban en `ids` al final (por seguridad)
    all.forEach(e => { if (!ids.includes(e.id)) ordered.push(e); });
    saveAll(ordered);
    return ordered;
  }

  function clear() { saveAll([]); }

  /* ============================================================
     A · PEGAR / SUBIR
     ============================================================ */
  /**
   * Estructura un texto ya escrito y lo añade al número.
   * @param {string} markdown   texto largo en markdown ligero
   * @param {object} opts       { meta, autoTitles, onProgress }
   * @returns {Promise<{entry, article}>}
   */
  async function importFromText(markdown, opts) {
    const S = global.MesaSectioner;
    if (!S) throw new Error('MesaSectioner no disponible.');
    const article = await S.structure(markdown, opts);
    const entry = add(article, 'paste');
    return { entry, article };
  }

  /* ============================================================
     B · GENERAR CON IA
     ============================================================ */
  /**
   * Llama al LLM con prompt de marca para redactar un artículo
   * de N palabras y lo estructura. No pasa por crítica.
   * @param {object} opts {
   *   brief, words=2000, meta:{title,author,issue}, language='esES',
   *   onProgress(step, pct) }
   * @returns {Promise<{entry, article, raw}>}
   */
  async function generateAndImport(opts) {
    opts = opts || {};
    const C = global.MesaCritic;
    const B = global.MesaBrand;
    const S = global.MesaSectioner;
    if (!C || !C.hasLLM()) throw new Error('Configura la IA antes de redactar (badge arriba a la derecha).');
    if (!B) throw new Error('MesaBrand no disponible.');
    if (!S) throw new Error('MesaSectioner no disponible.');

    const onProgress = opts.onProgress || (() => {});
    const words = Math.max(400, Math.min(6000, parseInt(opts.words, 10) || 2000));

    onProgress({ step: 'Cargando manual de marca…', pct: 5 });
    await B.loadVoice();

    onProgress({ step: 'Componiendo encargo…', pct: 12 });
    const prompt = await B.buildArticlePrompt({
      brief: opts.brief || '',
      words: words,
      meta: opts.meta || {},
      language: opts.language || 'esES'
    });

    // Tokens generosos para piezas largas: ~2k palabras ≈ 3-4k tokens en español
    // (más holgura para metadatos y reflexión interna del modelo).
    const maxTokens = Math.min(16000, Math.max(2400, Math.round(words * 2.4)));

    onProgress({ step: 'Redactando · esto puede tardar…', pct: 25 });
    const raw = await C.callLLM(prompt, {
      max_tokens: maxTokens,
      temperature: 0.65,
      json: false
    });

    // Limpieza · algunos modelos envuelven en ```markdown … ``` o añaden preámbulo
    let md = String(raw || '').trim();
    md = md.replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    md = md.replace(/^[\s\S]*?(?=^#\s)/m, ''); // si hay preámbulo antes del # título, lo corta
    md = md.trim();
    if (!md) throw new Error('El modelo devolvió vacío. Reintenta o cambia de modelo.');

    onProgress({ step: 'Estructurando en secciones…', pct: 75 });
    const article = await S.structure(md, {
      meta: opts.meta || {},
      autoTitles: true,
      onProgress: (i) => onProgress({
        step: i.step,
        pct: 75 + Math.round(((i.pct || 0) / 100) * 20)  // 75 → 95
      })
    });

    onProgress({ step: 'Guardando en el número…', pct: 96 });
    const entry = add(article, 'ai');

    onProgress({ step: 'Listo.', pct: 100 });
    return { entry, article, raw: md };
  }

  /* ============================================================
     UTILIDADES
     ============================================================ */
  function totalStats() {
    const all = loadAll();
    let words = 0, sections = 0;
    all.forEach(e => {
      const s = (e.article && e.article.stats) || {};
      words += s.words || 0;
      sections += s.sections || 0;
    });
    return {
      articles: all.length,
      words,
      sections,
      pages: Math.max(1, Math.round(words / 280))
    };
  }

  global.MesaExpress = {
    // CRUD cola
    loadAll, saveAll, add, update, remove, reorder, clear,
    // Importadores
    importFromText, generateAndImport,
    // Stats
    totalStats,
    STORE_KEY
  };
})(window);
