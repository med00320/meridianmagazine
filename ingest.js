/* ============================================================
   MERIDIAN · Mesa · ingest.js
   Carga PDF / DOCX / TXT / MD del navegador a texto plano.
   Expone window.MesaIngest
   ============================================================ */
(function (global) {
  'use strict';

  const pdfjs = global.pdfjsLib || null;
  const mammoth = global.mammoth || null;

  function cleanText(raw) {
    if (!raw) return '';
    return String(raw)
      .replace(/\u00ad/g, '')          // soft hyphens
      .replace(/-\s*\n\s*/g, '')       // word break en finales de línea
      .replace(/[ \t]+\n/g, '\n')      // trailing spaces antes de salto
      .replace(/\n{3,}/g, '\n\n')      // múltiples saltos → doble
      .replace(/[ \t]{2,}/g, ' ')      // espacios múltiples
      .trim();
  }

  function countWords(s) {
    return s ? (s.trim().match(/\S+/g) || []).length : 0;
  }

  /* --- PDF: rejunta líneas por su coordenada Y --- */
  async function loadPdf(file, onProgress) {
    if (!pdfjs) throw new Error('pdf.js no disponible en este entorno.');
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    const chunks = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const p = await pdf.getPage(i);
      const tc = await p.getTextContent();
      let lastY = null, line = [], lines = [];
      for (const it of tc.items) {
        const y = it.transform ? Math.round(it.transform[5]) : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) {
          lines.push(line.join(' ')); line = [];
        }
        line.push(it.str);
        lastY = y;
      }
      if (line.length) lines.push(line.join(' '));
      chunks.push(lines.join('\n'));
      if (onProgress) onProgress(i, pdf.numPages);
    }
    return cleanText(chunks.join('\n\n'));
  }

  /* --- DOCX --- */
  async function loadDocx(file) {
    if (!mammoth) throw new Error('mammoth.js no disponible.');
    const buf = await file.arrayBuffer();
    const res = await mammoth.extractRawText({ arrayBuffer: buf });
    return cleanText(res.value || '');
  }

  /* --- TXT --- */
  async function loadTxt(file) {
    return cleanText(await file.text());
  }

  /* --- Markdown: quitamos el azúcar pero conservamos párrafos --- */
  async function loadMarkdown(file) {
    const raw = await file.text();
    // Strip muy ligero: cabeceras, listas, énfasis. No queremos perder contenido.
    const stripped = raw
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')   // # cabeceras
      .replace(/^\s{0,3}>\s?/gm, '')        // > blockquotes
      .replace(/^\s*[-*+]\s+/gm, '· ')      // listas → bullet visible
      .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')// código inline
      .replace(/\*\*([^*]+)\*\*/g, '$1')    // **bold**
      .replace(/\*([^*]+)\*/g, '$1')        // *italic*
      .replace(/_([^_]+)_/g, '$1');         // _italic_
    return cleanText(stripped);
  }

  async function loadFile(file, onProgress) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf')                       return { kind: 'pdf',  text: await loadPdf(file, onProgress) };
    if (ext === 'docx')                      return { kind: 'docx', text: await loadDocx(file) };
    if (ext === 'md' || ext === 'markdown')  return { kind: 'md',   text: await loadMarkdown(file) };
    if (ext === 'txt')                       return { kind: 'txt',  text: await loadTxt(file) };
    throw new Error('Formato no soportado: .' + ext);
  }

  /* Particiona el texto en párrafos numerados (para que la crítica pueda
     referenciar [§7] sin enviar el texto entero descontextualizado). */
  function paragraphs(text) {
    const t = cleanText(text);
    const parts = t.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
    return parts.map((p, i) => ({ idx: i + 1, text: p, words: countWords(p) }));
  }

  global.MesaIngest = { loadFile, cleanText, countWords, paragraphs };
})(window);
