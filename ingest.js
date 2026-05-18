/* ============================================================
   MERIDIAN · Mesa · ingest.js
   Carga PDF / DOCX / TXT / MD del navegador a texto plano.
   Expone window.MesaIngest
   ============================================================ */
(function (global) {
  'use strict';

  const pdfjs = global.pdfjsLib || null;
  const mammoth = global.mammoth || null;

  // Límites de carga · evita colgar el navegador con archivos absurdos
  const MAX_FILE_BYTES = 25 * 1024 * 1024;   // 25 MB
  const PDF_TIMEOUT_MS = 60 * 1000;          // 60 s para parsear el PDF entero

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(
        `${label || 'Operación'} cancelada tras ${Math.round(ms / 1000)} s. ` +
        `El archivo es muy grande o el navegador está saturado.`
      )), ms);
      promise.then(v => { clearTimeout(t); resolve(v); },
                   e => { clearTimeout(t); reject(e); });
    });
  }

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
    const work = (async () => {
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
    })();
    return withTimeout(work, PDF_TIMEOUT_MS, 'Lectura del PDF');
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

  /* --- Markdown: respetamos listas, citas y cabeceras como markdown
         (los consumidores que necesiten texto plano pueden quitar
         el azúcar; conservar la estructura permite que el editor
         enriquecido pinte cursivas/negritas y que el sectioner
         encuentre `## Intertítulos` cuando vienen del autor). --- */
  async function loadMarkdown(file) {
    return cleanText(await file.text());
  }

  async function loadFile(file, onProgress) {
    if (!file) throw new Error('Sin archivo.');
    if (file.size > MAX_FILE_BYTES) {
      throw new Error(
        `Archivo demasiado grande: ${fmtBytes(file.size)}. ` +
        `Límite ${fmtBytes(MAX_FILE_BYTES)}. Trocea el documento o exporta a TXT/MD.`
      );
    }
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
