/* ============================================================
   MERIDIAN · Mesa · sources.js
   Gestor de fuentes adjuntas para verificación/contextualización.
   El redactor adjunta PDFs, DOCX, TXT o MD adicionales que NO son
   el texto que se critica, sino bibliografía o documentación de
   apoyo. La Mesa los pasa al modelo como contexto declarado para
   que pueda contrastar afirmaciones, citas y datos del texto.

   Persiste en localStorage. Cada fuente queda con:
     { id, fileName, kind, text, words, ts }

   Ojo: el texto extraído de las fuentes vive en localStorage y
   tiene un techo práctico (~5 MB por dominio). Por eso aplicamos
   un trim agresivo (60 KB por fuente) antes de almacenar.

   Expone window.MesaSources.
   ============================================================ */
(function (global) {
  'use strict';

  const STORE_KEY = 'mesa-sources-v1';
  const MAX_TEXT_BYTES = 60 * 1024;     // 60 KB por fuente almacenado
  const MAX_TEXT_PROMPT = 18 * 1024;    // 18 KB por fuente al prompt

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return 'src-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

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

  function clip(text, maxBytes) {
    const t = String(text || '');
    if (t.length <= maxBytes) return t;
    // Recorta en límite de palabra cercano para no cortar por la mitad
    const cut = t.slice(0, maxBytes);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > maxBytes * 0.9 ? cut.slice(0, lastSpace) : cut) + '\n[…fuente recortada…]';
  }

  /* ---------- CRUD ---------- */
  async function addFromFile(file) {
    const I = global.MesaIngest;
    if (!I) throw new Error('MesaIngest no disponible.');
    const res = await I.loadFile(file);
    const text = clip(res.text || '', MAX_TEXT_BYTES);
    const entry = {
      id: uuid(),
      fileName: file.name,
      kind: res.kind,
      text,
      words: I.countWords(text),
      ts: Date.now()
    };
    const all = loadAll();
    all.push(entry);
    saveAll(all);
    return entry;
  }

  function remove(id) {
    saveAll(loadAll().filter(e => e.id !== id));
  }

  function clear() { saveAll([]); }

  function count() { return loadAll().length; }

  /* ---------- formato para el prompt de la Mesa ---------- */
  // Devuelve un bloque de texto listo para anexar al prompt del crítico
  // cuando hay fuentes adjuntas. Si no hay, devuelve cadena vacía.
  function formatForPrompt() {
    const all = loadAll();
    if (!all.length) return '';
    const blocks = all.map((e, i) => {
      const head = `[FUENTE #${i + 1} · ${e.fileName} · ${e.kind.toUpperCase()} · ${e.words} pal]`;
      const body = clip(e.text, MAX_TEXT_PROMPT);
      return head + '\n' + body;
    });
    return [
      '',
      'FUENTES DECLARADAS POR EL AUTOR · usa estas fuentes para contrastar afirmaciones,',
      'citas, datos y atribuciones del TEXTO. Si una afirmación del texto contradice',
      'lo que dice una fuente, márcalo como fricción tipo "factual". Si una cita',
      'atribuida no aparece en las fuentes adjuntas, anótalo en "comentario".',
      'NO añadas conocimiento que no esté en las fuentes ni en el texto: este',
      'apartado sirve para contrastar, no para enriquecer.',
      '',
      ...blocks,
      ''
    ].join('\n');
  }

  /* ---------- estadísticas para la UI ---------- */
  function stats() {
    const all = loadAll();
    const totalWords = all.reduce((acc, e) => acc + (e.words || 0), 0);
    return { count: all.length, words: totalWords };
  }

  global.MesaSources = {
    loadAll, addFromFile, remove, clear, count, stats,
    formatForPrompt,
    STORE_KEY
  };
})(window);
