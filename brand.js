/* ============================================================
   MERIDIAN · brand.js
   Cargador del Manual de voz + composición de prompts según tarea:
     · redactar artículo de ~N palabras
     · seccionar texto largo en subsecciones con titulares
     · redactar copy de portada y contraportada del número

   El manual de voz vive en brand/voice.md (editable en frío). Este
   módulo lo carga una vez y lo embebe como prefacio en los prompts.
   Si el fetch falla (file://), usa un fallback muy resumido.

   Expone window.MesaBrand
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- voz embebida (fallback si fetch falla) ---------- */
  const VOICE_FALLBACK = `
Meridian es revista de lectura lenta dedicada a literatura norteamericana
de los siglos XX y XXI. Voz culta y reposada, frase media larga (22-32
palabras), subordinación clásica española, sin anglicismos. Apertura sin
precalentamiento, tesis a la vista en el primer tercio, avance por escenas
o argumentos, citas como apoyo no como relleno, cierre con cifra (no
recapitulación), diamante ◆ al final. Capitular sólo en piezas >1500
palabras. Intertítulos breves en versalitas. Castellano peninsular:
"comprobar", "ordenador", "ahora". Evita "te contamos", "en estos tiempos
en que", listas en bullets, adjetivación enfática sin sustento.
`.trim();

  let _voice = null;     // texto del manual cargado
  let _loadPromise = null;

  async function loadVoice() {
    if (_voice) return _voice;
    if (_loadPromise) return _loadPromise;
    _loadPromise = (async () => {
      try {
        const res = await fetch('brand/voice.md', { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const txt = (await res.text()).trim();
        if (txt.length > 200) { _voice = txt; return _voice; }
        throw new Error('voice.md vacío');
      } catch {
        _voice = VOICE_FALLBACK;
        return _voice;
      }
    })();
    return _loadPromise;
  }

  /* ---------- helpers ---------- */
  function fmtMeta(meta) {
    meta = meta || {};
    const out = [];
    if (meta.title)  out.push(`Título sugerido: ${meta.title}`);
    if (meta.author) out.push(`Firma: ${meta.author}`);
    if (meta.issue)  out.push(`Sección / n.º: ${meta.issue}`);
    return out.length ? out.join('\n') : '(sin metadatos)';
  }

  /* ============================================================
     PROMPT · redactar artículo Express (sin pasar por mesa)
     ============================================================ */
  async function buildArticlePrompt({ brief, words, meta, language }) {
    const voice = await loadVoice();
    const W = Math.max(400, Math.min(6000, parseInt(words, 10) || 2000));
    const langLock = (language === 'neutro')
      ? 'IDIOMA: español neutro internacional, sin localismos peninsulares ni americanismos cerrados.'
      : 'IDIOMA: castellano peninsular culto. "Comprobar" no "checar"; "ordenador" no "computadora"; "ahora" no "ahorita".';

    return `Eres redactor titular de Meridian Magazine. Conoces el manual de voz al detalle y escribes con disciplina editorial. NO eres asistente: eres firma.

=== MANUAL DE VOZ MERIDIAN ===
${voice}
=== FIN MANUAL ===

${langLock}

ENCARGO:
${(brief || '').trim() || '(sin brief: redacta un ensayo libre sobre literatura norteamericana XX-XXI)'}

METADATOS:
${fmtMeta(meta)}

REQUISITOS:
- Extensión: ${W} palabras (±10%). No menos, no mucho más.
- Estructura: apertura sin precalentamiento; tesis visible en el primer tercio; avance por argumentos/escenas; cierre con cifra (imagen, frase, conclusión afilada). NUNCA recapitulación final.
- Intertítulos: 2 a 4, breves (un sintagma, no una frase). Sintaxis: \`## Título del intertítulo\`. NO numeres los intertítulos.
- Cursivas con \`*texto*\` para títulos de obra y palabras en lengua extranjera no asimiladas. Negritas con \`**texto**\` MUY rara vez (Meridian apenas las usa).
- Citas: como párrafo aparte que empieza con \`> \` en su propia línea, en cursiva. Sin comillas decorativas.
- Separadores internos \`· · ·\` (tres puntos centrados en línea aparte) entre escenas si no procede intertítulo.
- Cierre del artículo con \`◆\` en línea aparte, centrado conceptual (sólo el carácter, sin más texto).
- NO uses bullets ni listas numeradas en el cuerpo.
- NO uses dos puntos en el título.
- NO uses fórmulas como "te contamos", "en estos tiempos en que", "no es ningún secreto".

FORMATO DE SALIDA · MARKDOWN ESTRICTO:

# Título del artículo en castellano (sin punto final, sin dos puntos)

*Subtítulo en una sola frase, complementa al título sin repetirlo.*

POR ${(meta && meta.author ? meta.author : 'NOMBRE APELLIDO').toUpperCase()}

[cuerpo del artículo siguiendo todas las reglas anteriores]

◆

Devuelve SÓLO el markdown del artículo. Sin preámbulo, sin meta-comentarios, sin "aquí tienes el texto".`;
  }

  /* ============================================================
     PROMPT · titular automático para auto-secciones
     (cuando el sectioner divide por longitud y necesitamos
      un intertítulo para cada bloque)
     ============================================================ */
  async function buildSectionTitlesPrompt({ blocks, articleTitle }) {
    const voice = await loadVoice();
    const list = blocks.map((b, i) =>
      `### Bloque ${i + 1}\n${b.slice(0, 600)}${b.length > 600 ? '…' : ''}`
    ).join('\n\n');

    return `Eres editor de Meridian Magazine. Vas a poner intertítulos a un artículo ya escrito que se ha cortado en ${blocks.length} bloques.

=== VOZ MERIDIAN (resumen) ===
${voice.slice(0, 1400)}
=== FIN ===

REGLAS PARA INTERTÍTULOS MERIDIAN:
- Un sintagma, no una frase. Sin verbo conjugado salvo que la frase lo pida.
- Versalitas (en el render salen en small-caps); aquí escríbelos en formato normal capitalizado.
- Breves: 2 a 5 palabras.
- No descriptivos, sí evocadores: "El juez como jurista", no "Holden ejerciendo de jurista".
- No numeres. No uses dos puntos.

TÍTULO DEL ARTÍCULO: ${articleTitle || '(sin título)'}

${list}

DEVUELVE JSON ESTRICTO:
{
  "titulos": [
    "intertítulo del bloque 1",
    "intertítulo del bloque 2",
    ...
  ]
}

EXACTAMENTE ${blocks.length} entradas, en el mismo orden. Si un bloque es la apertura del artículo (suele ser el primero) y no necesita intertítulo, devuelve cadena vacía "" para esa posición.`;
  }

  /* ============================================================
     PROMPT · copy del número (portada + contraportada)
     ============================================================ */
  async function buildIssueCopyPrompt({ articles, issueNumber, season, year }) {
    const voice = await loadVoice();
    const idx = articles.map((a, i) =>
      `${String(i + 1).padStart(2, '0')}. ${a.title || '(sin título)'} — ${a.author || '(sin firma)'}`
    ).join('\n');

    return `Eres director editorial de Meridian Magazine. Vas a escribir el copy de portada y contraportada del número que viene.

=== VOZ MERIDIAN (resumen) ===
${voice.slice(0, 1400)}
=== FIN ===

NÚMERO: ${issueNumber || '—'} · ${season || ''} ${year || ''}
ARTÍCULOS DEL NÚMERO:
${idx}

DEVUELVE JSON ESTRICTO:
{
  "tema": "tema del número en 2-4 palabras (ej. 'McCarthy y la frontera')",
  "tagline": "una frase Garamond italic, máx 14 palabras, que captura el espíritu del número",
  "destacados": [
    "3 a 4 titulares destacados de portada (sintagmas breves, sin verbo)"
  ],
  "contraportada": "frase de cierre del número en 1 ó 2 oraciones, Garamond italic, evocadora, no recapitulativa. Máx 35 palabras."
}

Devuelve SÓLO el JSON. Sin preámbulo.`;
  }

  /* ============================================================
     EXPOSE
     ============================================================ */
  global.MesaBrand = {
    loadVoice,
    buildArticlePrompt,
    buildSectionTitlesPrompt,
    buildIssueCopyPrompt
  };
})(window);
