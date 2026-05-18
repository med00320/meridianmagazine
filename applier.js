/* ============================================================
   MERIDIAN · Mesa · applier.js
   Aplica las propuestas de reescritura (fricción.propuesta) al
   texto original que se pasó por la mesa.
   Expone window.MesaApplier
   ============================================================ */
(function (global) {
  'use strict';

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* Busca una cita en el texto, tolerando diferencias de
     espacios/saltos. Devuelve { found, replaced } */
  function tryReplace(text, cita, propuesta) {
    if (!text || !cita) return { found: false, text };

    // 1) match literal
    if (text.includes(cita)) {
      return { found: true, text: text.replace(cita, propuesta) };
    }

    // 2) match colapsando espacios (incluyendo dentro del texto)
    const citaNorm = cita.replace(/\s+/g, ' ').trim();
    if (citaNorm.length < 6) return { found: false, text };

    const tokens = citaNorm.split(' ').filter(Boolean);
    const pattern = tokens.map(escapeRe).join('\\s+');
    try {
      const re = new RegExp(pattern);
      const m = text.match(re);
      if (m) return { found: true, text: text.replace(re, propuesta) };
    } catch {}

    // 3) match ignorando comillas tipográficas vs rectas.
    //    Normalizamos para LOCALIZAR, pero reemplazamos sólo el fragmento
    //    en el texto original sin tocar las comillas del resto.
    const norm = (s) => s
      .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
      .replace(/[\u2018\u2019\u2032]/g, "'");
    const textN = norm(text);
    const citaN = norm(citaNorm);
    const idx = textN.indexOf(citaN);
    if (idx !== -1) {
      // La normalización es 1:1 en longitud (sólo sustituye un carácter por
      // otro), así que los índices del texto normalizado coinciden con los
      // del texto original. Cortamos en esos índices y conservamos el resto.
      const before = text.slice(0, idx);
      const after  = text.slice(idx + citaN.length);
      return { found: true, text: before + propuesta + after };
    }

    return { found: false, text };
  }

  function applyRewrites(originalText, fricciones) {
    let out = String(originalText || '');
    let applied = 0;
    const skipped = [];

    (fricciones || []).forEach((f, i) => {
      const cita = (f.cita || '').trim();
      const prop = (f.propuesta || '').trim();

      // Sin propuesta → la fricción es sólo diagnóstico, no se aplica
      if (!cita || !prop) {
        skipped.push({ idx: i + 1, cita, reason: 'sin propuesta de reescritura' });
        return;
      }
      // Propuesta idéntica a la cita → no aplica
      if (prop === cita) {
        skipped.push({ idx: i + 1, cita, reason: 'propuesta idéntica al original' });
        return;
      }

      const r = tryReplace(out, cita, prop);
      if (r.found) {
        out = r.text;
        applied++;
      } else {
        skipped.push({ idx: i + 1, cita, reason: 'cita no localizada en el texto' });
      }
    });

    return { text: out, applied, skipped, total: (fricciones || []).length };
  }

  /* Construye un .md con notas al margen para que el redactor
     vea qué se cambió. Si propuesta vacía, listamos la fricción
     como sugerencia no aplicada. */
  function buildMarkdownReport(originalText, fricciones, meta, report) {
    const lines = [];
    lines.push(`# ${meta.title || 'Texto sin título'}`);
    if (meta.author) lines.push(`*${meta.author}*`);
    if (meta.issue)  lines.push(`*${meta.issue}*`);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(originalText);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Informe de Mesa');
    lines.push('');
    if (report?.diagnostico) {
      lines.push('### Diagnóstico');
      lines.push(report.diagnostico);
      lines.push('');
    }
    if (report?.veredicto) {
      lines.push(`**Veredicto:** ${String(report.veredicto).toUpperCase()}` +
        (report.veredicto_nota ? ` — ${report.veredicto_nota}` : ''));
      lines.push('');
    }
    if ((fricciones || []).length) {
      lines.push('### Fricciones detectadas');
      lines.push('');
      fricciones.forEach((f, i) => {
        lines.push(`**${String(i + 1).padStart(2, '0')} · ${(f.tipo || '').toUpperCase()}** ${f.parrafo ? `(§${f.parrafo})` : ''}`);
        if (f.cita)       lines.push(`> ${f.cita}`);
        if (f.comentario) lines.push(`${f.comentario}`);
        if (f.propuesta)  lines.push(`→ ${f.propuesta}`);
        lines.push('');
      });
    }
    return lines.join('\n');
  }

  /* ============================================================
     EXPORTADOR WORD (.doc HTML)
     ------------------------------------------------------------
     Genera un HTML autocontenido con MIME `application/msword`.
     Word (y LibreOffice) lo abren como documento editable y
     conservan títulos, cursivas, negritas, citas y separadores.
     No requiere librerías externas.

     Acepta texto en markdown ligero (lo mismo que produce Mesa
     Express y el editor enriquecido):
       # Título            → <h1>
       ## Intertítulo      → <h2>
       *cursiva*           → <em>
       **negrita**         → <strong>
       > cita              → <blockquote>
       · · ·               → separador visual
       ◆                   → diamante centrado
       Líneas en blanco    → separación de párrafos
     ============================================================ */

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function inlineMd(s) {
    // Aplica negrita y cursiva sobre texto ya escapado
    let h = escHtml(s);
    h = h.replace(/\*\*([^*\n][^*\n]*?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(^|[^*])\*([^*\n][^*\n]*?)\*(?!\*)/g, '$1<em>$2</em>');
    return h;
  }

  function mdToWordHtml(md) {
    const src = String(md || '');
    const blocks = src.split(/\n{2,}/);
    const out = [];
    for (let raw of blocks) {
      const block = raw.trim();
      if (!block) continue;

      // Diamante de cierre
      if (block === '◆' || /^◆\s*$/.test(block)) {
        out.push('<p class="diamante" align="center">◆</p>');
        continue;
      }
      // Separador estilo Meridian
      if (/^·\s*·\s*·$/.test(block)) {
        out.push('<p class="separador" align="center">· · ·</p>');
        continue;
      }
      // Cabeceras
      const h1 = block.match(/^#\s+(.+)$/);
      if (h1) { out.push('<h1 class="titulo">' + inlineMd(h1[1].trim()) + '</h1>'); continue; }
      const h2 = block.match(/^##\s+(.+)$/);
      if (h2) { out.push('<h2 class="intertitulo">' + inlineMd(h2[1].trim()) + '</h2>'); continue; }
      const h3 = block.match(/^###\s+(.+)$/);
      if (h3) { out.push('<h3>' + inlineMd(h3[1].trim()) + '</h3>'); continue; }

      // Blockquote (todas las líneas empiezan por >)
      if (/^>\s?/.test(block) && block.split('\n').every(l => /^>\s?/.test(l))) {
        const body = block.split('\n').map(l => l.replace(/^>\s?/, '')).join(' ');
        out.push('<blockquote class="cita"><em>' + inlineMd(body) + '</em></blockquote>');
        continue;
      }

      // Byline (POR NOMBRE en línea propia, mayúsculas) → metadato
      if (/^POR\s+[A-ZÁÉÍÓÚÑ][^\n]{0,80}$/.test(block)) {
        out.push('<p class="byline">' + escHtml(block) + '</p>');
        continue;
      }

      // Subtítulo (un solo párrafo en cursiva completa)
      if (/^\*[^*\n]+\*$/.test(block)) {
        out.push('<p class="subtitulo"><em>' + escHtml(block.slice(1, -1)) + '</em></p>');
        continue;
      }

      // Párrafo normal · saltos simples → <br/>
      const inner = inlineMd(block).replace(/\n/g, '<br/>');
      out.push('<p>' + inner + '</p>');
    }
    return out.join('\n');
  }

  function buildWordHtml(md, meta) {
    meta = meta || {};
    const title  = meta.title  || 'Texto';
    const author = meta.author || '';
    const issue  = meta.issue  || '';
    const body = mdToWordHtml(md);

    // Estilos inline · Word ignora hojas externas. Tipografías de fallback
    // del sistema (Word reemplaza si tiene Garamond/Inter; si no, Cambria/
    // Calibri ya cumplen el carácter Meridian: serif humanista + sans).
    return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8"/>
<title>${escHtml(title)}</title>
<!--[if gte mso 9]>
<xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml>
<![endif]-->
<style>
@page { size: A5 portrait; margin: 14mm; }
body { font-family: 'EB Garamond', Garamond, Cambria, Georgia, serif;
       font-size: 11pt; line-height: 1.55; color: #1A1714; }
h1.titulo { font-family: 'Instrument Serif', Georgia, serif;
            font-style: italic; font-size: 28pt; font-weight: normal;
            line-height: 1.05; color: #1A1714; margin: 0 0 8pt 0; }
p.subtitulo { font-family: 'EB Garamond', Garamond, Cambria, serif;
              font-style: italic; font-size: 13pt; color: #3A332B;
              margin: 0 0 12pt 0; }
p.byline { font-family: 'Inter', Calibri, Arial, sans-serif;
           font-size: 8pt; letter-spacing: 0.18em; color: #8B2D1A;
           text-transform: uppercase; margin: 0 0 18pt 0; }
h2.intertitulo { font-family: 'EB Garamond', Garamond, Cambria, serif;
                 font-variant: small-caps; font-size: 11pt;
                 font-weight: normal; color: #8B2D1A;
                 margin: 18pt 0 8pt 0; letter-spacing: 0.04em; }
h3 { font-family: 'EB Garamond', Garamond, Cambria, serif;
     font-size: 11pt; color: #1A1714; margin: 14pt 0 6pt 0; }
p { text-align: justify; margin: 0 0 8pt 0; hyphens: auto; }
blockquote.cita { border-left: 1.8pt solid #B88544;
                  padding: 4pt 10pt; margin: 12pt 18pt;
                  font-style: italic; color: #1A1714; }
p.separador { color: #B88544; letter-spacing: 1em; margin: 14pt 0; }
p.diamante { color: #8B2D1A; font-size: 14pt; margin: 18pt 0 0 0; }
.meta-foot { font-family: 'Inter', Calibri, Arial, sans-serif;
             font-size: 7pt; letter-spacing: 0.22em; color: #6B5E50;
             text-transform: uppercase; text-align: center;
             margin-top: 28pt; border-top: 0.5pt solid #DDD8C8;
             padding-top: 8pt; }
</style>
</head>
<body>
${body}
<p class="meta-foot">MERIDIAN MAGAZINE${issue ? ' · ' + escHtml(issue) : ''}${author ? ' · ' + escHtml(author) : ''}</p>
</body>
</html>`;
  }

  function exportWord(md, meta, fileBase) {
    const html = buildWordHtml(md, meta);
    const name = (fileBase || slug((meta && meta.title) || 'texto')) + '.doc';
    downloadBlob(html, name, 'application/msword;charset=utf-8');
  }

  /* ============================================================
     EXPORTADOR PDF · vía window.print()
     ------------------------------------------------------------
     Sin librerías. El stage debe estar ya renderizado por quien
     llama (renderReport / renderIssue / renderArticle). Aquí sólo
     disparamos el diálogo de impresión con un toast didáctico que
     recuerda al usuario elegir "Guardar como PDF" en Chrome.
     ============================================================ */
  function printPdf({ onBefore, onAfter, hint } = {}) {
    if (typeof onBefore === 'function') onBefore();
    // El navegador necesita un tick para asentar el layout del stage
    setTimeout(() => {
      try { window.print(); }
      finally { if (typeof onAfter === 'function') setTimeout(onAfter, 50); }
    }, 60);
    return hint || 'Elige "Guardar como PDF" en el destino de impresión.';
  }

  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 100);
  }

  function slug(s) {
    return String(s || 'texto')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  global.MesaApplier = {
    applyRewrites, buildMarkdownReport,
    exportWord, buildWordHtml, mdToWordHtml,
    printPdf,
    downloadBlob, slug
  };
})(window);
