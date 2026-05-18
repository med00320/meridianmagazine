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

    // 3) match ignorando comillas tipográficas vs rectas
    const norm = (s) => s
      .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
      .replace(/[\u2018\u2019\u2032]/g, "'");
    const textN = norm(text);
    const citaN = norm(citaNorm);
    if (textN.includes(citaN)) {
      // Reemplazamos en la versión normalizada y devolvemos esa.
      // No es perfecto (perderemos las comillas tipográficas del original
      // en esa frase), pero es mejor que dejar la fricción sin aplicar.
      return { found: true, text: textN.replace(citaN, propuesta) };
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
        // Fuentes generadas para esta fricción (si las hay)
        const fu = f._fuentes && f._fuentes.data && f._fuentes.data.fuentes;
        if (Array.isArray(fu) && fu.length) {
          lines.push('');
          lines.push(`*Fuentes sugeridas${f._fuentes.providerLabel ? ' · vía ' + f._fuentes.providerLabel : ''}:*`);
          fu.forEach((s, n) => {
            const ref = [s.autor, s.obra ? `*${s.obra}*` : '', (s['año'] && s['año'] !== '—') ? `(${s['año']})` : '']
              .filter(Boolean).join(', ');
            lines.push(`  ${String(n + 1).padStart(2, '0')}. **${(s.tipo || '').replace('_', ' ')}** · ${ref} · cert. ${s.certeza || 'media'}`);
            if (s.fragmento_o_idea) lines.push(`     > ${s.fragmento_o_idea}`);
            if (s.porque)           lines.push(`     ↳ ${s.porque}`);
          });
        } else if (f._fuentes && f._fuentes.data && f._fuentes.data.nota_general) {
          lines.push('');
          lines.push(`*Fuentes:* ${f._fuentes.data.nota_general}`);
        }
        lines.push('');
      });
    }
    return lines.join('\n');
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
    applyRewrites, buildMarkdownReport, downloadBlob, slug
  };
})(window);
