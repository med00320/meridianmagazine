/* ============================================================
   MERIDIAN · readings.js
   Sugerencias de lecturas para profundizar en las fricciones
   detectadas por la Mesa. Llama al LLM con el informe + texto
   y devuelve un JSON saneado:
       {
         lecturas_clave:           [ { autor, titulo, ano, tipo, porque, ... } ],
         lecturas_complementarias: [ { ... } ],
         advertencia_revisor:      string
       }

   Importante: estas sugerencias son del modelo, no de una base
   de datos validada. Pueden incluir alucinaciones. La UI las
   pinta en una banda ocre con la advertencia bien visible.

   Expone window.MesaReadings.
   ============================================================ */
(function (global) {
  'use strict';

  const DEFAULT_WARNING = 'Sugerencias del modelo · verifica autores, títulos y fechas antes de citarlos en el artículo final.';

  /* ---------- llamada al LLM ---------- */
  async function suggest({ text, report, meta, language, onProgress }) {
    const C = global.MesaCritic;
    const B = global.MesaBrand;
    if (!C) throw new Error('MesaCritic no disponible.');
    if (!B) throw new Error('MesaBrand no disponible.');
    if (!C.hasLLM()) throw new Error('Configura la IA antes de pedir lecturas (badge arriba).');
    if (!report) throw new Error('No hay informe del que sugerir lecturas.');

    if (onProgress) onProgress({ step: 'Componiendo encargo bibliográfico…', pct: 10 });
    const prompt = await B.buildReadingsPrompt({ text, report, meta, language });

    if (onProgress) onProgress({ step: 'Pidiendo lecturas al modelo…', pct: 35 });
    const raw = await C.callLLM(prompt, {
      max_tokens: 3500,
      temperature: 0.4,    // bajo, queremos referencias estables, no creativas
      json: true
    });

    if (onProgress) onProgress({ step: 'Parseando lecturas…', pct: 80 });
    const data = C.tryParseJSON(raw);

    // Saneo
    const out = {
      lecturas_clave: Array.isArray(data.lecturas_clave) ? data.lecturas_clave : [],
      lecturas_complementarias: Array.isArray(data.lecturas_complementarias) ? data.lecturas_complementarias : [],
      advertencia_revisor: typeof data.advertencia_revisor === 'string' && data.advertencia_revisor.trim()
        ? data.advertencia_revisor.trim()
        : DEFAULT_WARNING
    };

    // Filtra entradas vacías y normaliza campos faltantes
    const norm = (e) => ({
      autor: String(e.autor || '').trim(),
      titulo: String(e.titulo || '').trim(),
      ano: String(e.ano || '').trim(),
      editorial: String(e.editorial || '').trim(),
      tipo: String(e.tipo || '').trim().toLowerCase(),
      porque: String(e.porque || '').trim(),
      fricciones_relacionadas: Array.isArray(e.fricciones_relacionadas)
        ? e.fricciones_relacionadas.filter(n => Number.isFinite(+n)).map(n => +n)
        : []
    });

    out.lecturas_clave = out.lecturas_clave.map(norm).filter(e => e.autor && e.titulo);
    out.lecturas_complementarias = out.lecturas_complementarias.map(norm).filter(e => e.autor && e.titulo);

    if (onProgress) onProgress({ step: 'Listo.', pct: 100 });
    return out;
  }

  /* ---------- render HTML para anexar al informe ---------- */
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderReadingItem(e) {
    const refs = (e.fricciones_relacionadas || []).length
      ? `<span class="rd-refs">fricciones ${e.fricciones_relacionadas.map(n => '[' + n + ']').join(' ')}</span>`
      : '';
    const tipo = e.tipo ? `<span class="rd-tipo">${escHtml(e.tipo)}</span>` : '';
    const meta = [e.ano, e.editorial].filter(Boolean).map(escHtml).join(' · ');
    return `
      <li class="rd-item">
        <div class="rd-head">
          ${tipo}
          ${refs}
        </div>
        <div class="rd-cite">
          <span class="rd-autor">${escHtml(e.autor)}</span>,
          <em class="rd-titulo">${escHtml(e.titulo)}</em>${meta ? '<span class="rd-meta"> · ' + meta + '</span>' : ''}.
        </div>
        <p class="rd-porque">${escHtml(e.porque)}</p>
      </li>`;
  }

  function renderHtml(data) {
    if (!data) return '';
    const clave = (data.lecturas_clave || []).map(renderReadingItem).join('');
    const comp  = (data.lecturas_complementarias || []).map(renderReadingItem).join('');
    if (!clave && !comp) return '';
    return `
<section class="rep-block rep-readings">
  <h2 class="rep-h2">Lecturas para profundizar</h2>
  <div class="rd-warning">
    <strong>◆ Aviso del editor:</strong> ${escHtml(data.advertencia_revisor || DEFAULT_WARNING)}
  </div>
  ${clave ? `
  <h3 class="rd-subh">Imprescindibles</h3>
  <ul class="rd-list">${clave}</ul>` : ''}
  ${comp ? `
  <h3 class="rd-subh">Para ampliar</h3>
  <ul class="rd-list rd-list-sec">${comp}</ul>` : ''}
</section>`;
  }

  /* ---------- formato markdown para exportar al .md ---------- */
  function renderMarkdown(data) {
    if (!data) return '';
    const lines = [];
    lines.push('## Lecturas para profundizar');
    lines.push('');
    lines.push(`> ${data.advertencia_revisor || DEFAULT_WARNING}`);
    lines.push('');
    const block = (title, arr) => {
      if (!arr || !arr.length) return;
      lines.push(`### ${title}`);
      lines.push('');
      arr.forEach(e => {
        const meta = [e.ano, e.editorial].filter(Boolean).join(' · ');
        lines.push(`- **${e.autor}**, *${e.titulo}*${meta ? ` (${meta})` : ''}.`);
        if (e.porque) lines.push(`  ${e.porque}`);
        if (e.fricciones_relacionadas && e.fricciones_relacionadas.length) {
          lines.push(`  *Fricciones relacionadas: ${e.fricciones_relacionadas.map(n => '[' + n + ']').join(' ')}*`);
        }
        lines.push('');
      });
    };
    block('Imprescindibles', data.lecturas_clave);
    block('Para ampliar', data.lecturas_complementarias);
    return lines.join('\n');
  }

  global.MesaReadings = { suggest, renderHtml, renderMarkdown, DEFAULT_WARNING };
})(window);
