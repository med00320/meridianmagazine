/* ============================================================
   MERIDIAN · Triage · pdf-extract.js
   Extracción de PDF en navegador con reconstrucción de orden de
   lectura multi-columna. pdf.js da items con coordenadas (x,y);
   este módulo agrupa por columnas, ordena por y dentro de cada
   columna y genera:
     - texto plano por página (en orden de lectura)
     - texto plano por rango (concatenado)
     - thumbnail por página (canvas → dataURL)
   Expone window.TriageExtract
   ============================================================ */
(function (global) {
  'use strict';

  const THUMB_SCALE = 0.32;       // miniatura para la rejilla
  const COLUMN_TOLERANCE = 0.18;  // % del ancho que tolera el clustering de columnas

  /* ---------- carga del PDF ---------- */
  async function openPdf(file) {
    const buf = await file.arrayBuffer();
    const task = pdfjsLib.getDocument({ data: buf, isEvalSupported: false });
    const doc = await task.promise;
    return doc;
  }

  /* ---------- thumbnails ---------- */
  async function renderThumb(page) {
    const viewport = page.getViewport({ scale: THUMB_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    return {
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height
    };
  }

  /* Renderiza una página a PNG a una resolución mayor (para usar
     como "cover" del libro reseñado en el dossier). */
  async function renderPage(page, scale) {
    scale = scale || 1.4;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/png');
  }

  /* ---------- texto en orden de lectura ----------
     Estrategia:
     1. Cogemos los textItems con su transform (x,y) y altura.
     2. Detectamos si la página es 1 / 2 / 3 columnas haciendo
        clustering simple sobre las x de inicio.
     3. Asignamos cada item a su columna por proximidad al cluster.
     4. Dentro de cada columna ordenamos por y (descendente, porque
        en pdf.js y crece hacia arriba) y agrupamos en líneas con
        tolerancia vertical = altura de fuente.
     5. Concatenamos columnas en orden izquierda→derecha y líneas
        dentro de columna en orden top→bottom. Líneas en blanco
        marcan saltos de párrafo cuando el gap vertical entre
        líneas consecutivas supera ~1.6 × altura de fuente. */

  function clusterColumns(items, pageWidth) {
    // x-inicio de cada item
    const xs = items.map(it => it.transform[4]).sort((a, b) => a - b);
    if (!xs.length) return [];

    const tol = pageWidth * COLUMN_TOLERANCE;
    const clusters = [];
    let cur = [xs[0]];
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] - cur[cur.length - 1] < tol) {
        cur.push(xs[i]);
      } else {
        clusters.push(cur);
        cur = [xs[i]];
      }
    }
    clusters.push(cur);

    // representante por cluster = mediana
    return clusters
      .map(c => c[Math.floor(c.length / 2)])
      .filter((v, i, a) => i === a.findIndex(w => Math.abs(w - v) < tol)); // dedupe
  }

  function pickColumn(item, columnAnchors, tol) {
    const x = item.transform[4];
    let best = 0, bestD = Infinity;
    for (let i = 0; i < columnAnchors.length; i++) {
      const d = Math.abs(x - columnAnchors[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return bestD < tol ? best : best; // siempre asignamos a la más cercana
  }

  async function pageToText(page) {
    const viewport = page.getViewport({ scale: 1 });
    const pageWidth = viewport.width;

    const tc = await page.getTextContent({ disableCombineTextItems: false });
    const items = (tc.items || []).filter(it => it.str && it.str.trim());
    if (!items.length) return '';

    const colAnchors = clusterColumns(items, pageWidth);
    if (!colAnchors.length) return items.map(i => i.str).join(' ');
    const tol = pageWidth * COLUMN_TOLERANCE;

    // bucket por columna
    const cols = colAnchors.map(() => []);
    items.forEach(it => {
      const idx = pickColumn(it, colAnchors, tol);
      cols[idx].push(it);
    });

    // dentro de cada columna: ordena por y desc, agrupa en líneas
    const colTexts = cols.map(colItems => {
      colItems.sort((a, b) => b.transform[5] - a.transform[5]);
      const lines = [];
      let curLine = null;
      let curY = null;
      let curHeight = 12;
      for (const it of colItems) {
        const y = it.transform[5];
        const h = it.height || it.transform[3] || 12;
        if (curLine && Math.abs(curY - y) < h * 0.6) {
          // misma línea
          curLine.parts.push(it);
        } else {
          if (curLine) lines.push(curLine);
          curLine = { y, h, parts: [it] };
          curY = y;
          curHeight = h;
        }
      }
      if (curLine) lines.push(curLine);

      // construye string con detección de párrafos por gap vertical
      const out = [];
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        // ordena partes de la línea por x ascendente
        ln.parts.sort((a, b) => a.transform[4] - b.transform[4]);
        let s = '';
        for (let j = 0; j < ln.parts.length; j++) {
          const p = ln.parts[j];
          if (j > 0) {
            const prev = ln.parts[j - 1];
            const prevEnd = prev.transform[4] + (prev.width || 0);
            const gap = p.transform[4] - prevEnd;
            if (gap > (p.height || 12) * 0.35) s += ' ';
          }
          s += p.str;
        }
        s = s.replace(/\s+/g, ' ').trim();
        if (!s) continue;

        // Reconstrucción de palabras cortadas a final de línea (con guion)
        if (out.length && /-$/.test(out[out.length - 1])) {
          out[out.length - 1] = out[out.length - 1].slice(0, -1) + s;
        } else {
          out.push(s);
        }

        // gap → marca de párrafo
        if (i < lines.length - 1) {
          const next = lines[i + 1];
          const gapY = ln.y - next.y;
          if (gapY > ln.h * 1.6) out.push(''); // separador de párrafo
        }
      }
      return out.join('\n').replace(/\n{3,}/g, '\n\n');
    });

    return colTexts.join('\n\n').trim();
  }

  /* ---------- API pública ---------- */
  async function loadFile(file, onProgress) {
    const doc = await openPdf(file);
    const numPages = doc.numPages;
    const pages = [];
    for (let i = 1; i <= numPages; i++) {
      const page = await doc.getPage(i);
      const [text, thumb] = await Promise.all([
        pageToText(page),
        renderThumb(page)
      ]);
      pages.push({
        index: i,
        text,
        words: countWords(text),
        thumb
      });
      page.cleanup && page.cleanup();
      if (onProgress) onProgress(i, numPages);
    }
    return { fileName: file.name, numPages, pages, doc };
  }

  function countWords(s) {
    if (!s) return 0;
    return (s.trim().match(/\S+/g) || []).length;
  }

  async function renderRangeAsPng(doc, pageIndex, scale) {
    const page = await doc.getPage(pageIndex);
    const url = await renderPage(page, scale || 1.4);
    page.cleanup && page.cleanup();
    return url;
  }

  function rangeText(pages, from, to) {
    return pages
      .filter(p => p.index >= from && p.index <= to)
      .map(p => `=== p.${p.index} ===\n${p.text}`)
      .join('\n\n');
  }

  global.TriageExtract = {
    loadFile,
    countWords,
    renderRangeAsPng,
    rangeText
  };
})(window);
