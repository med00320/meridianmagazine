/* ============================================================
   MERIDIAN · Mesa · critic.js
   Adaptador 2-proveedores (Ollama / OpenAI) + función de crítica.
   Expone window.MesaCritic
   ============================================================ */
(function (global) {
  'use strict';

  /* ============================================================
     CONFIGURACIÓN PERSISTENTE
     ============================================================ */
  const STORE_KEY = 'mesa-llm-config-v1';

  const PROVIDERS = {
    ollama: {
      label: 'Local · Ollama / LM Studio',
      models: [
        { id: 'qwen3:8b',      label: 'Qwen 3 8B · ligero' },
        { id: 'qwen3:14b',     label: 'Qwen 3 14B · recomendado' },
        { id: 'qwen3:32b',     label: 'Qwen 3 32B · máxima calidad' },
        { id: 'qwen2.5:14b',   label: 'Qwen 2.5 14B' },
        { id: 'llama3.3',      label: 'Llama 3.3 70B' },
        { id: 'gemma3:27b',    label: 'Gemma 3 27B' },
        { id: '__custom__',    label: '— Otro modelo: especifícalo abajo —' }
      ],
      defaultModel: 'qwen3:14b',
      needsKey: false,
      needsBaseUrl: true,
      baseUrlDefault: 'http://localhost:11434/v1',
      baseUrlHint: 'Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1',
      docs: 'https://ollama.com'
    },
    openai: {
      label: 'OpenAI',
      models: [
        { id: 'gpt-4o',       label: 'GPT-4o · equilibrado' },
        { id: 'gpt-4o-mini',  label: 'GPT-4o mini · barato' },
        { id: 'gpt-4.1',      label: 'GPT-4.1' },
        { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
        { id: 'o3-mini',      label: 'o3-mini · razonamiento' },
        { id: '__custom__',   label: '— Otro modelo: especifícalo abajo —' }
      ],
      defaultModel: 'gpt-4o',
      needsKey: true,
      needsBaseUrl: false,
      keyHint: 'sk-…',
      docs: 'https://platform.openai.com'
    }
  };

  function getConfig() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return { provider: '', model: '', apiKey: '', baseUrl: '', customModel: '' };
  }
  function setConfig(cfg) {
    try { if (cfg) localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); else localStorage.removeItem(STORE_KEY); } catch {}
  }
  function clearConfig() { try { localStorage.removeItem(STORE_KEY); } catch {} }

  function hasLLM() {
    const c = getConfig();
    if (!c.provider) return false;
    const p = PROVIDERS[c.provider]; if (!p) return false;
    if (p.needsKey && !c.apiKey) return false;
    if (p.needsBaseUrl && !c.baseUrl) return false;
    return true;
  }

  function currentLabel() {
    const c = getConfig();
    if (!c.provider) return '';
    const p = PROVIDERS[c.provider]; if (!p) return '';
    const modelId = c.model === '__custom__' ? (c.customModel || '?') : (c.model || p.defaultModel);
    return `${p.label} · ${modelId}`;
  }

  /* ============================================================
     ADAPTADOR ÚNICO (OpenAI-compatible cubre Ollama + OpenAI)
     ============================================================ */
  async function callLLM(prompt, opts) {
    opts = opts || {};
    if (!hasLLM()) throw new Error('Sin IA configurada. Pulsa el badge "IA" arriba a la derecha.');
    const cfg = getConfig();
    const p = PROVIDERS[cfg.provider];

    const baseUrl = (cfg.provider === 'openai')
      ? 'https://api.openai.com/v1'
      : (cfg.baseUrl || p.baseUrlDefault || '').replace(/\/+$/, '');
    const url = baseUrl + '/chat/completions';

    const headers = { 'content-type': 'application/json' };
    if (cfg.apiKey) headers['authorization'] = 'Bearer ' + cfg.apiKey;

    const modelId = cfg.model === '__custom__'
      ? (cfg.customModel || p.defaultModel)
      : (cfg.model || p.defaultModel);

    const body = {
      model: modelId,
      max_tokens: opts.max_tokens || 4000,
      messages: [{ role: 'user', content: prompt }],
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.55
    };
    if (opts.json) body.response_format = { type: 'json_object' };

    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(baseUrl);
    const label = p.label;

    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (err) {
      throw new Error(diagnoseNetworkError(label, baseUrl, isLocal, err));
    }
    if (!res.ok) throw new Error(await formatHttpError(label, res));

    const d = await res.json();
    const c = d.choices?.[0]?.message?.content || '';
    const out = (typeof c === 'string' ? c : (Array.isArray(c) ? c.map(x => x.text || '').join('\n') : '')).trim();
    if (!out) throw new Error('Respuesta vacía del proveedor ' + label);
    return out;
  }

  function diagnoseNetworkError(label, baseUrl, isLocal, err) {
    const pageProto = (global.location && global.location.protocol) || '';
    const pageOrigin = (global.location && global.location.origin) || '(origen desconocido)';
    const lines = [`${label}: no se pudo conectar a ${baseUrl || '(URL vacía)'}.`];
    if (isLocal && pageProto === 'https:') {
      lines.push('',
        '⚠ Contenido mixto: la página es HTTPS y el navegador bloquea http://localhost.',
        'Soluciones:',
        '  1) Abre esta app desde http://localhost o file://, no desde un sandbox HTTPS.',
        '  2) O sirve Ollama detrás de un proxy HTTPS (ngrok / Caddy).');
    } else if (isLocal) {
      lines.push('',
        'Comprueba que el servidor local está corriendo y permite CORS:',
        '  • Ollama:   OLLAMA_ORIGINS="*" ollama serve',
        `             (o tu origen exacto: OLLAMA_ORIGINS="${pageOrigin}")`,
        '  • LM Studio: activa CORS en "Local Server".',
        '  • Verifica la URL base (ej. http://localhost:11434/v1).');
    } else {
      lines.push('', 'Posibles causas: servidor caído, URL incorrecta o CORS bloquea el origen.');
    }
    lines.push('', `Detalle técnico: ${err && err.message ? err.message : String(err)}`);
    return lines.join('\n');
  }

  async function formatHttpError(label, res) {
    // Lee el cuerpo UNA SOLA VEZ como texto. Si parece JSON, lo intentamos
    // parsear desde el string para extraer el mensaje legible. Si no, dejamos
    // el texto tal cual. Antes hacíamos res.json() y, si fallaba, res.text()
    // sobre el mismo response ya consumido — lo que disparaba
    // "body stream already read" y enmascaraba el error real.
    let detail = '';
    try { detail = await res.text(); } catch { detail = ''; }
    if (detail) {
      const trimmed = detail.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const j = JSON.parse(trimmed);
          detail = j?.error?.message || j?.error || JSON.stringify(j);
        } catch { /* deja detail como texto plano */ }
      }
    }
    if (typeof detail !== 'string') detail = JSON.stringify(detail);
    return `${label} · HTTP ${res.status}: ${detail || '(respuesta vacía)'}`;
  }

  /* ============================================================
     PARSER JSON TOLERANTE
     ============================================================ */
  function tryParseJSON(raw) {
    if (!raw) throw new Error('Respuesta vacía');
    let s = String(raw).trim();
    s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');             // DeepSeek-R1 et al.
    s = s.replace(/^```(?:json|JSON)?\s*/i, '').replace(/```\s*$/i, '');

    const first = s.indexOf('{');
    if (first === -1) throw new Error('No es JSON. Respuesta:\n' + s.slice(0, 400));

    // walk braces respetando strings
    let depth = 0, end = -1, inStr = false, esc = false;
    for (let i = first; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    const body = end !== -1 ? s.slice(first, end + 1) : s.slice(first);

    try { return JSON.parse(body); } catch (e1) {
      const fixed = body
        .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
        .replace(/[\u2018\u2019\u2032]/g, "'")
        .replace(/,\s*([}\]])/g, '$1');
      try { return JSON.parse(fixed); } catch (e2) {
        const snip = body.slice(0, 500) + (body.length > 500 ? '…' : '');
        throw new Error(
          'JSON malformado del modelo. Si usas un modelo local pequeño (<14B), prueba uno mayor.\n\n'
          + 'Texto recibido:\n' + snip);
      }
    }
  }

  /* ============================================================
     PERFILES · persona, severidad, longitud, idioma
     ============================================================ */
  const PERSONAS = {
    jefe: {
      label: 'Jefe de redacción',
      voice: 'Eres jefe de redacción de Meridian Magazine, revista de crítica literaria. Conoces a tus colaboradores y sabes pedir reescrituras concretas. Mezclas exigencia editorial con respeto por la voz del autor.'
    },
    corrector: {
      label: 'Corrector de estilo',
      voice: 'Eres corrector de estilo profesional. Te fijas en la precisión léxica, la sintaxis, la cohesión, las repeticiones, los muletillas, los anglicismos. Tu mirada es microscópica pero generosa.'
    },
    lector: {
      label: 'Lector general',
      voice: 'Eres un lector culto, suscriptor de revistas literarias. No haces correcciones técnicas: dices qué pasajes te enganchan, cuáles te expulsan, dónde pierdes el hilo. Hablas desde la experiencia de lectura, no desde la edición.'
    }
  };

  const SEVERITIES = {
    soft:     { label: 'Suave',      tone: 'Tono protector: subraya los aciertos antes de las fricciones. Las propuestas se enuncian como sugerencias, nunca como imposición.' },
    standard: { label: 'Estándar',   tone: 'Tono equilibrado: nombra las virtudes y los defectos con la misma claridad. Las propuestas son firmes pero abiertas.' },
    sharp:    { label: 'Implacable', tone: 'Tono exigente: no consiente flojedades. Cuando algo no funciona, lo dices sin envolverlo. Sin crueldad, pero sin amortiguar.' }
  };

  const LENGTHS = {
    compact:  { label: 'Ágil',     diagnosticoLen: '80-120 palabras',  fricciones: '3 a 5',  globales: '3',     veredictoLen: '1 frase',  maxTokens: 2800 },
    standard: { label: 'Estándar', diagnosticoLen: '120-180 palabras', fricciones: '5 a 8',  globales: '3 a 5', veredictoLen: '1 ó 2 frases', maxTokens: 4200 },
    extended: { label: 'Extensa',  diagnosticoLen: '180-260 palabras', fricciones: '7 a 12', globales: '4 a 6', veredictoLen: '2 frases', maxTokens: 6000 }
  };

  const LANGUAGES = {
    esES:    { label: 'es-ES',  lock: 'IDIOMA: castellano peninsular culto. Sin anglicismos, sin spanglish, sin "checar", "ahorita", "computadora"; sí "comprobar", "ahora", "ordenador".' },
    neutro:  { label: 'Neutro', lock: 'IDIOMA: español neutro internacional. Evita localismos peninsulares ("vale", "majo", "tío") y también americanismos cerrados.' }
  };

  /* ============================================================
     PROMPT · informe estructurado
     ============================================================ */
  function buildPrompt({ text, meta, persona, severity, length, language }) {
    const P = PERSONAS[persona] || PERSONAS.jefe;
    const S = SEVERITIES[severity] || SEVERITIES.standard;
    const L = LENGTHS[length] || LENGTHS.standard;
    const I = LANGUAGES[language] || LANGUAGES.esES;

    const numbered = (text || '').split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
      .map((p, i) => `§${i + 1}  ${p}`).join('\n\n');

    return `${P.voice}

${S.tone}

${I.lock}

TAREA · Vas a pasar por la mesa el siguiente texto y devolver un INFORME EDITORIAL ESTRUCTURADO en JSON.

METADATOS DECLARADOS:
- Título: ${meta.title || '(sin título)'}
- Autor: ${meta.author || '(sin firma)'}
- Sección / n.º: ${meta.issue || '—'}

TEXTO (los párrafos vienen numerados como §1, §2, … para que puedas referenciarlos en tus citas):

${numbered}

DEVUELVE JSON ESTRICTO con esta forma EXACTA:

{
  "diagnostico": "string · ${L.diagnosticoLen} · valoración general crítica del texto, su problema central, qué intenta y qué consigue",
  "tesis_detectada": "string · una sola línea: ¿qué propone realmente este texto? (no qué dice que propone)",
  "registro": { "valor": "alto | medio | bajo | mixto", "nota": "1 frase explicativa" },
  "ritmo":    { "valor": "fluido | irregular | trabado | monótono", "nota": "1 frase" },
  "lexico":   { "valor": "preciso | impreciso | tópico | cuidado | brillante", "nota": "1 frase" },
  "estructura": { "valor": "sólida | irregular | dispersa | inexistente", "nota": "1 frase" },
  "puntos_fuertes": [
    "2 a 4 frases concretas: qué SÍ funciona y por qué"
  ],
  "fricciones": [
    {
      "parrafo": 7,
      "cita": "fragmento LITERAL del texto · 8 a 30 palabras (copiado verbatim del párrafo §7)",
      "tipo": "ritmo | lexico | tono | estructura | claridad | sintaxis | coherencia | factual",
      "comentario": "qué falla aquí en 1 ó 2 frases · sin generalidades",
      "propuesta": "reescritura concreta del fragmento manteniendo voz y registro del autor (puede omitirse para fricciones que no requieren reescritura: déjalo como cadena vacía)"
    }
  ],
  "propuestas_globales": [
    "${L.globales} acciones concretas para el siguiente pase de revisión (no abstracciones tipo 'mejorar el ritmo')"
  ],
  "veredicto": "publicar | publicar_con_retoques | reescribir | descartar",
  "veredicto_nota": "${L.veredictoLen} justificando el veredicto"
}

REGLAS NO NEGOCIABLES:
- ${L.fricciones} fricciones inline. Cada cita DEBE ser literal (copia-pega del texto, no paráfrasis).
- Si propones reescritura, mantén la voz del autor: no impongas tu estilo. Conserva léxico equivalente, mismo registro, misma longitud aproximada.
- No inventes datos. No corrijas lo que no está roto.
- No abras con "Este texto…". Entra directo al diagnóstico.
- ${I.lock}
- RELLENA TODOS LOS CAMPOS DEL ESQUEMA. Reglas mínimas para que no haya huecos:
  · "diagnostico" y "tesis_detectada": SIEMPRE con contenido. Si el texto no propone tesis, dilo explícitamente ("no detecto tesis clara; el texto es puramente descriptivo").
  · "registro" / "ritmo" / "lexico" / "estructura": SIEMPRE con "valor" Y "nota" no vacíos. Elige el valor más cercano de las opciones dadas; nunca devuelvas null ni "—".
  · "puntos_fuertes": SIEMPRE 2-4 entradas. Si no hay puntos fuertes claros, escribe la valoración honesta ("ningún punto fuerte destacable; el texto se sostiene apenas en X") — pero NUNCA array vacío.
  · "propuestas_globales": SIEMPRE ${L.globales} entradas, acciones concretas y verificables (verbo + objeto).
  · "veredicto" y "veredicto_nota": ambos obligatorios. La nota justifica el veredicto en ${L.veredictoLen}.
- No envuelvas el JSON en \`\`\`json. No añadas comentarios. Devuelve SÓLO el objeto JSON.`;
  }

  /* ============================================================
     ENTRY POINT
     ============================================================ */
  async function critique({ text, meta, persona, severity, length, language, onProgress }) {
    if (!text || !text.trim()) throw new Error('No hay texto que criticar.');
    if (onProgress) onProgress({ step: 'Pasando el texto por la mesa…', pct: 15 });

    const L = LENGTHS[length] || LENGTHS.standard;
    const prompt = buildPrompt({ text, meta, persona, severity, length, language });

    if (onProgress) onProgress({ step: 'Esperando al modelo…', pct: 35 });
    const raw = await callLLM(prompt, { max_tokens: L.maxTokens, json: true, temperature: 0.5 });

    if (onProgress) onProgress({ step: 'Parseando informe…', pct: 80 });
    const data = tryParseJSON(raw);

    // Saneo mínimo
    if (!Array.isArray(data.fricciones)) data.fricciones = [];
    if (!Array.isArray(data.propuestas_globales)) data.propuestas_globales = [];
    if (!Array.isArray(data.puntos_fuertes)) data.puntos_fuertes = [];
    data.fricciones = data.fricciones.filter(f => f && (f.cita || f.comentario));

    if (onProgress) onProgress({ step: 'Listo.', pct: 100 });
    return data;
  }

  /* ============================================================
     EXPOSE
     ============================================================ */
  global.MesaCritic = {
    PROVIDERS, PERSONAS, SEVERITIES, LENGTHS, LANGUAGES,
    getConfig, setConfig, clearConfig, hasLLM, currentLabel,
    callLLM, tryParseJSON, critique, buildPrompt
  };
})(window);
