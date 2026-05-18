/* ============================================================
   MERIDIAN · Triage · llm.js
   Adaptador de proveedores (Ollama, OpenAI, Anthropic, Gemini)
   con persistencia INDEPENDIENTE de Mesa (mesa-triage-llm-v1).
   Parser JSON tolerante. Prompt de FICHA DE RESEÑA.
   Expone window.TriageLLM
   ============================================================ */
(function (global) {
  'use strict';

  const STORE_KEY = 'mesa-triage-llm-v1';

  const PROVIDERS = {
    ollama: {
      label: 'Local · Ollama / LM Studio',
      kind: 'openai-compat',
      models: [
        { id: 'qwen3:14b',     label: 'Qwen 3 14B · recomendado' },
        { id: 'qwen3:32b',     label: 'Qwen 3 32B · máxima calidad' },
        { id: 'qwen2.5:14b',   label: 'Qwen 2.5 14B' },
        { id: 'llama3.3',      label: 'Llama 3.3 70B' },
        { id: '__custom__',    label: '— Otro modelo: especifícalo abajo —' }
      ],
      defaultModel: 'qwen3:14b',
      needsKey: false,
      needsBaseUrl: true,
      baseUrlDefault: 'http://localhost:11434/v1',
      baseUrlHint: 'Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1',
      docs: 'https://ollama.com',
      warn: 'Modelos <14B suelen flojear en JSON-mode con textos largos.'
    },
    openai: {
      label: 'OpenAI',
      kind: 'openai-compat',
      models: [
        { id: 'gpt-4o',       label: 'GPT-4o · equilibrado' },
        { id: 'gpt-4o-mini',  label: 'GPT-4o mini · barato' },
        { id: 'gpt-4.1',      label: 'GPT-4.1' },
        { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
        { id: '__custom__',   label: '— Otro modelo: especifícalo abajo —' }
      ],
      defaultModel: 'gpt-4o',
      needsKey: true,
      needsBaseUrl: false,
      keyHint: 'sk-…',
      docs: 'https://platform.openai.com'
    },
    anthropic: {
      label: 'Claude · Anthropic',
      kind: 'anthropic',
      models: [
        { id: 'claude-opus-4-20250514',     label: 'Claude Opus 4 · máxima calidad' },
        { id: 'claude-sonnet-4-20250514',   label: 'Claude Sonnet 4 · recomendado' },
        { id: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet' },
        { id: 'claude-3-5-haiku-20241022',  label: 'Claude 3.5 Haiku · rápido' },
        { id: '__custom__',                 label: '— Otro modelo: especifícalo abajo —' }
      ],
      defaultModel: 'claude-sonnet-4-20250514',
      needsKey: true,
      needsBaseUrl: false,
      keyHint: 'sk-ant-…',
      docs: 'https://console.anthropic.com',
      warn: 'API key expuesta en el navegador (header dangerous-direct-browser-access). Sólo para tu equipo de confianza.'
    },
    gemini: {
      label: 'Gemini · Google',
      kind: 'gemini',
      models: [
        { id: 'gemini-2.5-pro',         label: 'Gemini 2.5 Pro · máxima calidad' },
        { id: 'gemini-2.5-flash',       label: 'Gemini 2.5 Flash · recomendado' },
        { id: 'gemini-2.0-flash',       label: 'Gemini 2.0 Flash' },
        { id: 'gemini-2.0-flash-lite',  label: 'Gemini 2.0 Flash Lite · barato' },
        { id: '__custom__',             label: '— Otro modelo: especifícalo abajo —' }
      ],
      defaultModel: 'gemini-2.5-flash',
      needsKey: true,
      needsBaseUrl: false,
      keyHint: 'AIza…',
      docs: 'https://aistudio.google.com/apikey',
      warn: 'API key viaja en query string. Privacidad limitada.'
    }
  };

  /* ---------- config ---------- */
  function getConfig() {
    try { const r = localStorage.getItem(STORE_KEY); if (r) return JSON.parse(r); } catch {}
    return { provider: '', model: '', apiKey: '', baseUrl: '', customModel: '' };
  }
  function setConfig(c) {
    try { c ? localStorage.setItem(STORE_KEY, JSON.stringify(c)) : localStorage.removeItem(STORE_KEY); } catch {}
  }
  function clearConfig() { try { localStorage.removeItem(STORE_KEY); } catch {} }
  function hasLLM() {
    const c = getConfig(); if (!c.provider) return false;
    const p = PROVIDERS[c.provider]; if (!p) return false;
    if (p.needsKey && !c.apiKey) return false;
    if (p.needsBaseUrl && !c.baseUrl) return false;
    return true;
  }
  function currentLabel() {
    const c = getConfig(); if (!c.provider) return '';
    const p = PROVIDERS[c.provider]; if (!p) return '';
    const m = c.model === '__custom__' ? (c.customModel || '?') : (c.model || p.defaultModel);
    return `${p.label} · ${m}`;
  }
  function resolveModelId(c, p) {
    return c.model === '__custom__' ? (c.customModel || p.defaultModel) : (c.model || p.defaultModel);
  }

  /* ---------- adaptadores ---------- */
  function isLocalUrl(u) { return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(u || ''); }

  function diagnoseNet(label, baseUrl, isLocal, err) {
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
        '  • Ollama:    OLLAMA_ORIGINS="*" ollama serve',
        `             (o tu origen exacto: OLLAMA_ORIGINS="${pageOrigin}")`,
        '  • LM Studio: activa CORS en "Local Server".',
        '  • Verifica la URL base (ej. http://localhost:11434/v1).');
    } else {
      lines.push('', 'Posibles causas: servidor caído, URL incorrecta o CORS bloquea el origen.');
    }
    lines.push('', `Detalle técnico: ${err && err.message ? err.message : String(err)}`);
    return lines.join('\n');
  }

  async function fmtHttp(label, res) {
    let detail = '';
    try { const j = await res.json(); detail = j?.error?.message || j?.error || JSON.stringify(j); }
    catch { detail = await res.text(); }
    return `${label} · HTTP ${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  }

  async function callOpenAICompat(cfg, p, prompt, opts) {
    const baseUrl = (cfg.provider === 'openai')
      ? 'https://api.openai.com/v1'
      : (cfg.baseUrl || p.baseUrlDefault || '').replace(/\/+$/, '');
    const url = baseUrl + '/chat/completions';
    const headers = { 'content-type': 'application/json' };
    if (cfg.apiKey) headers['authorization'] = 'Bearer ' + cfg.apiKey;
    const body = {
      model: resolveModelId(cfg, p),
      max_tokens: opts.max_tokens || 4000,
      messages: [{ role: 'user', content: prompt }],
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.4
    };
    if (opts.json) body.response_format = { type: 'json_object' };

    let res;
    try { res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }); }
    catch (err) { throw new Error(diagnoseNet(p.label, baseUrl, isLocalUrl(baseUrl), err)); }
    if (!res.ok) throw new Error(await fmtHttp(p.label, res));
    const d = await res.json();
    const c = d.choices?.[0]?.message?.content || '';
    return (typeof c === 'string' ? c : (Array.isArray(c) ? c.map(x => x.text || '').join('\n') : '')).trim();
  }

  async function callAnthropic(cfg, p, prompt, opts) {
    const url = 'https://api.anthropic.com/v1/messages';
    const headers = {
      'content-type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    const body = {
      model: resolveModelId(cfg, p),
      max_tokens: opts.max_tokens || 4000,
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.4,
      messages: [{ role: 'user', content: prompt }]
    };
    let res;
    try { res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }); }
    catch (err) { throw new Error(diagnoseNet(p.label, url, false, err)); }
    if (!res.ok) throw new Error(await fmtHttp(p.label, res));
    const d = await res.json();
    return (d.content || [])
      .filter(b => b && b.type === 'text')
      .map(b => b.text || '')
      .join('\n')
      .trim();
  }

  async function callGemini(cfg, p, prompt, opts) {
    const modelId = resolveModelId(cfg, p);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
    const headers = { 'content-type': 'application/json' };
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.4,
        maxOutputTokens: opts.max_tokens || 4000
      }
    };
    if (opts.json) body.generationConfig.responseMimeType = 'application/json';
    let res;
    try { res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }); }
    catch (err) { throw new Error(diagnoseNet(p.label, url.replace(/key=[^&]+/, 'key=…'), false, err)); }
    if (!res.ok) throw new Error(await fmtHttp(p.label, res));
    const d = await res.json();
    const cands = d.candidates || [];
    if (!cands.length) {
      const block = d.promptFeedback?.blockReason;
      throw new Error('Gemini no devolvió respuesta' + (block ? ` (bloqueado: ${block})` : ''));
    }
    const parts = cands[0]?.content?.parts || [];
    return parts.map(p => p.text || '').join('').trim();
  }

  async function callLLM(prompt, opts) {
    opts = opts || {};
    if (!hasLLM()) throw new Error('Sin IA configurada. Pulsa el badge "IA" arriba a la derecha.');
    const cfg = getConfig();
    const p = PROVIDERS[cfg.provider];
    if (!p) throw new Error('Proveedor desconocido: ' + cfg.provider);
    let raw;
    if (p.kind === 'openai-compat')  raw = await callOpenAICompat(cfg, p, prompt, opts);
    else if (p.kind === 'anthropic') raw = await callAnthropic(cfg, p, prompt, opts);
    else if (p.kind === 'gemini')    raw = await callGemini(cfg, p, prompt, opts);
    else throw new Error('Protocolo no soportado: ' + p.kind);
    if (!raw) throw new Error('Respuesta vacía del proveedor ' + p.label);
    return raw;
  }

  /* ---------- parser JSON tolerante ---------- */
  function tryParseJSON(raw) {
    if (!raw) throw new Error('Respuesta vacía');
    let s = String(raw).trim();
    s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
    s = s.replace(/^```(?:json|JSON)?\s*/i, '').replace(/```\s*$/i, '');
    const first = s.indexOf('{');
    if (first === -1) throw new Error('No es JSON. Respuesta:\n' + s.slice(0, 400));
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
        const snip = body.slice(0, 600) + (body.length > 600 ? '…' : '');
        throw new Error('JSON malformado del modelo. Si usas un modelo local pequeño (<14B), prueba uno mayor.\n\nTexto recibido:\n' + snip);
      }
    }
  }

  /* ============================================================
     PROMPT · FICHA DE RESEÑA (Modelo B · NO traducción íntegra)
     ============================================================ */
  function buildFichaPrompt({ texto, hint, medio, numero, fecha, urlMedio }) {
    return `Eres documentalista de Meridian Magazine, revista de crítica cultural en castellano peninsular. Estás procesando un PDF de ${medio || '(medio anglófono)'} y trabajas SÓLO sobre el fragmento que el redactor ha marcado como una RESEÑA concreta.

CONTEXTO EDITORIAL (Modelo B):
- NO traduzcas el artículo íntegro. Está prohibido por copyright.
- Extrae SOBRE QUÉ TRATA EL LIBRO RESEÑADO (el redactor de Meridian no se va a leer el libro): tema, tesis del libro, estructura, qué intenta hacer.
- Resume el ARGUMENTO CRÍTICO del autor de la reseña en voz neutra y propia, no traducción literal.
- Selecciona 2-3 citas LITERALES en inglés, ≤ 30 palabras cada una, y aporta su traducción al castellano. Marcadas como cita breve para fair use editorial.
- El redactor de Meridian usará esta ficha como insumo para escribir su propia reseña Meridian; deja un campo "meridian_sobre_esto" vacío para él.
- Lengua de salida: castellano peninsular culto.

DATOS DEL NÚMERO:
- Medio: ${medio || '(sin especificar)'}
- Número: ${numero || '(sin especificar)'}
- Fecha: ${fecha || '(sin especificar)'}
- URL del número (si la hay): ${urlMedio || '(sin URL)'}

PISTA DEL REDACTOR (no es definitiva, corrígela si el texto dice otra cosa):
- Título tentativo de la reseña: ${hint?.title || '(sin pista)'}
- Autor del libro reseñado (tentativo): ${hint?.bookAuthor || '(sin pista)'}
- Crítico (tentativo): ${hint?.critic || '(sin pista)'}

TEXTO DEL PDF (rango marcado por el redactor, puede contener artefactos de columna y partidos de palabra):
"""
${(texto || '').slice(0, 38000)}
"""

DEVUELVE JSON ESTRICTO con esta forma EXACTA:

{
  "tipo_pieza": "reseña | ensayo-reseña | nota breve | entrevista-reseña | otro",
  "libro": {
    "titulo": "título tal y como aparece en la reseña",
    "titulo_castellano_si_hay_edicion": "si hay edición publicada en castellano, su título; si no, cadena vacía",
    "autor": "Nombre Apellido",
    "editorial": "editorial original",
    "ano": "año de publicación o '—'",
    "paginas": "p.ej. 320 pp. · '—' si no consta",
    "isbn": "si aparece; cadena vacía si no",
    "es_traduccion": false,
    "lengua_original": "inglés | francés | alemán | …  · cadena vacía si no aplica",
    "tema": "1 frase: ¿de qué va el libro? (no del artículo)",
    "tesis_del_libro": "1 frase con la tesis o propósito declarado del libro",
    "estructura": "1 frase: cómo está organizado el libro (capítulos, partes, ensayos, etc.)"
  },
  "critico": {
    "nombre": "autor de la reseña en el medio",
    "perfil": "1 línea de quién es este crítico, si lo deduces del texto; cadena vacía si no"
  },
  "publicacion": {
    "medio": "${medio || ''}",
    "numero": "${numero || ''}",
    "fecha": "${fecha || ''}",
    "url": "${urlMedio || ''}",
    "titulo_resena": "el título tal y como aparece en la reseña original",
    "kicker_o_sumario": "subtítulo/kicker si lo hay; cadena vacía"
  },
  "tesis_del_critico": "1 frase: cuál es la tesis o veredicto del crítico sobre el libro",
  "argumento_critico_castellano": "Resumen propio en 4 a 6 frases · castellano peninsular · NO traducción literal · captura el razonamiento del crítico, sus ejes de juicio, qué celebra y qué objeta",
  "valoracion_global": "elogio | favorable_con_reservas | matizado | escéptico | demoledor | mixto",
  "claves_de_lectura": [
    "3 a 5 puntos concretos de por qué este libro merece atención · cada uno una frase"
  ],
  "objeciones_del_critico": [
    "0 a 4 reparos del crítico al libro · cada uno una frase · array vacío si no hay reparos"
  ],
  "citas_seleccionadas": [
    {
      "en": "cita LITERAL en inglés · máximo 30 palabras",
      "es": "traducción al castellano peninsular",
      "por_que_meridian_la_rescata": "1 frase explicando por qué este fragmento merece aparecer en la reseña Meridian"
    }
  ],
  "lecturas_relacionadas": [
    "0 a 3 referencias que el propio crítico menciona en la reseña (otros libros, otros autores, etc.) · cada una una frase"
  ],
  "atribucion_obligatoria": "Cadena lista para usarse como pie en Meridian. Formato exacto: '[Crítico], «[Título de la reseña]», [Medio], [Número], [Fecha], [Páginas].'",
  "meridian_sobre_esto": ""
}

REGLAS NO NEGOCIABLES:
- "argumento_critico_castellano" es resumen PROPIO, no traducción literal de párrafos del artículo. Es la pieza más importante: el redactor Meridian la usa para entender el libro sin haberlo leído.
- "citas_seleccionadas" tiene COMO MÁXIMO 3 entradas. Cada cita "en" tiene COMO MÁXIMO 30 palabras. Sin excepciones.
- Si la cita en inglés contiene "[…]" o supresiones, indícalo así. No fabriques citas que no estén en el texto.
- Si el texto marcado NO es una reseña (es un ensayo libre, una entrevista, una columna), pon "tipo_pieza" según corresponda y ajusta los campos coherentemente; libro.titulo y libro.autor pueden quedar vacíos.
- "meridian_sobre_esto" SIEMPRE vacío: lo escribe el redactor humano.
- Castellano peninsular: "ordenador" no "computadora", "comprobar" no "checar", "estadounidense" mejor que "americano" cuando se refiera al país.
- No envuelvas el JSON en \`\`\`json. No añadas comentarios. Devuelve SÓLO el objeto JSON.`;
  }

  /* ---------- entry point ---------- */
  async function buildFicha({ texto, hint, medio, numero, fecha, urlMedio, onProgress }) {
    if (!texto || !texto.trim()) throw new Error('No hay texto en el rango marcado.');
    if (onProgress) onProgress({ step: 'Esperando al modelo…', pct: 30 });

    const cfg = getConfig();
    const p = PROVIDERS[cfg.provider];
    const useJsonMode = p && (p.kind === 'openai-compat' || p.kind === 'gemini');

    const prompt = buildFichaPrompt({ texto, hint, medio, numero, fecha, urlMedio });
    const raw = await callLLM(prompt, { max_tokens: 4500, temperature: 0.35, json: useJsonMode });

    if (onProgress) onProgress({ step: 'Parseando ficha…', pct: 80 });
    const data = tryParseJSON(raw);

    // saneo mínimo
    data.libro = data.libro || {};
    data.critico = data.critico || {};
    data.publicacion = data.publicacion || {};
    if (!Array.isArray(data.citas_seleccionadas)) data.citas_seleccionadas = [];
    if (!Array.isArray(data.claves_de_lectura))   data.claves_de_lectura = [];
    if (!Array.isArray(data.objeciones_del_critico)) data.objeciones_del_critico = [];
    if (!Array.isArray(data.lecturas_relacionadas))  data.lecturas_relacionadas = [];

    // hard limit defensivo: máx 3 citas, máx 30 palabras cada una
    data.citas_seleccionadas = data.citas_seleccionadas
      .slice(0, 3)
      .map(q => {
        const en = (q.en || '').trim();
        const enWords = en.split(/\s+/);
        return {
          en: enWords.length > 30 ? enWords.slice(0, 30).join(' ') + ' […]' : en,
          es: (q.es || '').trim(),
          por_que_meridian_la_rescata: (q.por_que_meridian_la_rescata || '').trim()
        };
      });

    if (typeof data.meridian_sobre_esto !== 'string') data.meridian_sobre_esto = '';

    if (onProgress) onProgress({ step: 'Listo.', pct: 100 });
    return data;
  }

  global.TriageLLM = {
    PROVIDERS,
    getConfig, setConfig, clearConfig, hasLLM, currentLabel,
    callLLM, tryParseJSON, buildFicha, buildFichaPrompt
  };
})(window);
