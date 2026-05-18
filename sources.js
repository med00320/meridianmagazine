/* ============================================================
   MERIDIAN · Mesa · sources.js
   Búsqueda de fuentes por fricción.
   Adaptadores nativos: Ollama, OpenAI, Anthropic (Claude), Google (Gemini).
   Configuración INDEPENDIENTE de la crítica (dos registros).
   Expone window.MesaSources
   ============================================================ */
(function (global) {
  'use strict';

  const STORE_KEY = 'mesa-sources-config-v1';

  const PROVIDERS = {
    ollama: {
      label: 'Local · Ollama / LM Studio',
      kind: 'openai-compat',
      models: [
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
      docs: 'https://ollama.com',
      warn: 'Sin acceso a la web: las fuentes salen del entrenamiento del modelo. Modelos <14B suelen alucinar atribuciones.'
    },
    openai: {
      label: 'OpenAI',
      kind: 'openai-compat',
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
      docs: 'https://platform.openai.com',
      warn: 'Sin búsqueda web: las fuentes vienen del entrenamiento. Verifica antes de citar.'
    },
    anthropic: {
      label: 'Claude · Anthropic',
      kind: 'anthropic',
      models: [
        { id: 'claude-opus-4-20250514',         label: 'Claude Opus 4 · máxima calidad' },
        { id: 'claude-sonnet-4-20250514',       label: 'Claude Sonnet 4 · recomendado' },
        { id: 'claude-3-7-sonnet-20250219',     label: 'Claude 3.7 Sonnet' },
        { id: 'claude-3-5-haiku-20241022',      label: 'Claude 3.5 Haiku · rápido' },
        { id: '__custom__',                     label: '— Otro modelo: especifícalo abajo —' }
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
      warn: 'API key viaja en la URL (query string). Privacidad limitada.'
    }
  };

  /* ============================================================
     CONFIG PERSISTENTE
     ============================================================ */
  function getConfig() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return { provider: '', model: '', apiKey: '', baseUrl: '', customModel: '' };
  }
  function setConfig(cfg) {
    try {
      if (cfg) localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
      else localStorage.removeItem(STORE_KEY);
    } catch {}
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
     ADAPTADORES POR PROTOCOLO
     ============================================================ */
  function pageOrigin() {
    return (global.location && global.location.origin) || '(origen desconocido)';
  }
  function isLocalUrl(u) {
    return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(u || '');
  }

  // Reutiliza diagnóstico de critic.js si está, si no fallback genérico
  function diagnoseNet(label, baseUrl, isLocal, err) {
    if (global.MesaCritic && typeof global.MesaCritic.diagnoseNetworkError === 'function') {
      return global.MesaCritic.diagnoseNetworkError(label, baseUrl, isLocal, err);
    }
    return `${label}: no se pudo conectar a ${baseUrl}. Detalle: ${err && err.message ? err.message : err}`;
  }
  async function fmtHttp(label, res) {
    if (global.MesaCritic && typeof global.MesaCritic.formatHttpError === 'function') {
      return global.MesaCritic.formatHttpError(label, res);
    }
    let detail = '';
    try { const j = await res.json(); detail = j?.error?.message || JSON.stringify(j); }
    catch { detail = await res.text(); }
    return `${label} · HTTP ${res.status}: ${detail}`;
  }

  async function callOpenAICompat(cfg, p, prompt, opts) {
    const baseUrl = (cfg.provider === 'openai')
      ? 'https://api.openai.com/v1'
      : (cfg.baseUrl || p.baseUrlDefault || '').replace(/\/+$/, '');
    const url = baseUrl + '/chat/completions';
    const headers = { 'content-type': 'application/json' };
    if (cfg.apiKey) headers['authorization'] = 'Bearer ' + cfg.apiKey;
    const modelId = resolveModelId(cfg, p);
    const body = {
      model: modelId,
      max_tokens: opts.max_tokens || 2000,
      messages: [{ role: 'user', content: prompt }],
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.4
    };
    if (opts.json) body.response_format = { type: 'json_object' };

    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (err) {
      throw new Error(diagnoseNet(p.label, baseUrl, isLocalUrl(baseUrl), err));
    }
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
      // Sin esto, Anthropic rechaza llamadas desde browser:
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    const modelId = resolveModelId(cfg, p);
    const body = {
      model: modelId,
      max_tokens: opts.max_tokens || 2000,
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.4,
      messages: [{ role: 'user', content: prompt }]
    };
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (err) {
      throw new Error(diagnoseNet(p.label, url, false, err));
    }
    if (!res.ok) throw new Error(await fmtHttp(p.label, res));
    const d = await res.json();
    // d.content = [{ type: 'text', text: '...' }, ...]
    const out = (d.content || [])
      .filter(b => b && b.type === 'text')
      .map(b => b.text || '')
      .join('\n')
      .trim();
    return out;
  }

  async function callGemini(cfg, p, prompt, opts) {
    const modelId = resolveModelId(cfg, p);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
    const headers = { 'content-type': 'application/json' };
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.4,
        maxOutputTokens: opts.max_tokens || 2000
      }
    };
    if (opts.json) body.generationConfig.responseMimeType = 'application/json';

    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (err) {
      throw new Error(diagnoseNet(p.label, url.replace(/key=[^&]+/, 'key=…'), false, err));
    }
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

  function resolveModelId(cfg, p) {
    return cfg.model === '__custom__'
      ? (cfg.customModel || p.defaultModel)
      : (cfg.model || p.defaultModel);
  }

  async function callLLM(prompt, opts) {
    opts = opts || {};
    if (!hasLLM()) throw new Error('Sin IA de fuentes configurada. Pulsa "Buscar fuentes" sobre una fricción y configura el proveedor.');
    const cfg = getConfig();
    const p = PROVIDERS[cfg.provider];
    if (!p) throw new Error('Proveedor desconocido: ' + cfg.provider);

    let raw;
    if (p.kind === 'openai-compat')      raw = await callOpenAICompat(cfg, p, prompt, opts);
    else if (p.kind === 'anthropic')     raw = await callAnthropic(cfg, p, prompt, opts);
    else if (p.kind === 'gemini')        raw = await callGemini(cfg, p, prompt, opts);
    else throw new Error('Protocolo no soportado: ' + p.kind);

    if (!raw) throw new Error('Respuesta vacía del proveedor ' + p.label);
    return raw;
  }

  /* ============================================================
     PROMPT · búsqueda de fuentes para una fricción
     ============================================================ */
  function buildSourcesPrompt({ friccion, meta, contextoTexto }) {
    const tipo = (friccion.tipo || 'observación').toString();
    const par = friccion.parrafo ? `§${friccion.parrafo}` : '(párrafo no localizado)';

    return `Eres documentalista de Meridian Magazine, revista de crítica literaria. Tu trabajo: encontrar 3 a 6 fuentes ÚTILES, contextualizadas a UNA fricción concreta de un texto en revisión.

CONTEXTO EDITORIAL DEL TEXTO:
- Título: ${meta.title || '(sin título)'}
- Autor: ${meta.author || '(sin firma)'}
- Sección: ${meta.issue || '—'}

LA FRICCIÓN SOBRE LA QUE BUSCAR FUENTES:
- Párrafo: ${par}
- Tipo de fricción: ${tipo}
- Cita literal del texto:
"""
${friccion.cita || '(sin cita)'}
"""
- Diagnóstico de la mesa:
"""
${friccion.comentario || '(sin comentario)'}
"""
${friccion.propuesta && String(friccion.propuesta).trim() ? `- Propuesta de reescritura ya hecha por la mesa:
"""
${friccion.propuesta}
"""` : ''}

${contextoTexto ? `PASAJE EXTENDIDO (para entorno):
"""
${contextoTexto}
"""

` : ''}TAREA:
Devuelve fuentes que ayuden al redactor a RESOLVER esta fricción concreta. Útiles, no decorativas. Privilegia:
- citas de autoridad (otro autor que ha pensado lo mismo mejor),
- contraejemplos (otro autor que lo resuelve diferente),
- paralelos literarios (texto que toca el mismo tema/tropo),
- en fricciones tipo "factual": referencias factuales (libro, artículo académico, dato verificable).

REGLAS NO NEGOCIABLES:
- Las fuentes son las que CONOCES POR ENTRENAMIENTO. No inventes atribuciones.
- Marca tu nivel de certeza: "alta" (lo recuerdas con claridad), "media" (lo recuerdas pero podría confundir edición/año), "baja" (te suena, hay que verificar).
- Si NO conoces nada útil, devuelve "fuentes": [] y explica en "nota_general" por qué.
- Para cada fuente, "porque" debe explicar la conexión con ESTA fricción concreta, no con el tema en abstracto.
- No repitas autores: una entrada por autor/obra.
- Idioma: castellano peninsular culto.

DEVUELVE JSON ESTRICTO con esta forma EXACTA:

{
  "fuentes": [
    {
      "tipo": "cita_autoridad | contraejemplo | paralelo | factual",
      "autor": "Nombre Apellido",
      "obra": "Título de la obra (libro / ensayo / artículo)",
      "año": "1985 (o '—' si no recuerdas)",
      "fragmento_o_idea": "lo que dice el autor que viene a cuento (1-3 líneas) — paráfrasis si no recuerdas la cita literal; entrecomilla SÓLO si estás seguro de la literalidad",
      "porque": "por qué esta fuente ayuda a resolver esta fricción concreta · 1 frase",
      "certeza": "alta | media | baja"
    }
  ],
  "nota_general": "string vacío si todo bien, o explicación si no hay fuentes / si todas son baja certeza"
}

No envuelvas el JSON en \`\`\`json. No añadas comentarios. Devuelve SÓLO el objeto JSON.`;
  }

  /* ============================================================
     PARSER · reusa el de critic si está disponible
     ============================================================ */
  function tryParse(raw) {
    if (global.MesaCritic && typeof global.MesaCritic.tryParseJSON === 'function') {
      return global.MesaCritic.tryParseJSON(raw);
    }
    return JSON.parse(raw);
  }

  /* ============================================================
     ENTRY POINT
     ============================================================ */
  async function findSources({ friccion, meta, contextoTexto }) {
    if (!friccion) throw new Error('Falta la fricción.');
    const prompt = buildSourcesPrompt({ friccion, meta: meta || {}, contextoTexto: contextoTexto || '' });
    const cfg = getConfig();
    const p = PROVIDERS[cfg.provider];
    // gemini admite JSON-mode; openai-compat también; anthropic no via flag, lo pedimos en el prompt.
    const useJsonMode = p && (p.kind === 'openai-compat' || p.kind === 'gemini');
    const raw = await callLLM(prompt, {
      max_tokens: 1800,
      temperature: 0.35,
      json: useJsonMode
    });
    let data;
    try {
      data = tryParse(raw);
    } catch (err) {
      throw new Error(err.message || 'JSON malformado del proveedor de fuentes.');
    }
    if (!data || typeof data !== 'object') throw new Error('Respuesta sin estructura.');
    if (!Array.isArray(data.fuentes)) data.fuentes = [];
    // Saneo mínimo
    data.fuentes = data.fuentes
      .filter(f => f && (f.autor || f.obra || f.fragmento_o_idea))
      .map(f => ({
        tipo: f.tipo || 'paralelo',
        autor: f.autor || '',
        obra: f.obra || '',
        año: f['año'] || f.anio || '—',
        fragmento_o_idea: f.fragmento_o_idea || f.fragmento || '',
        porque: f.porque || '',
        certeza: ['alta','media','baja'].includes((f.certeza || '').toLowerCase())
          ? (f.certeza || '').toLowerCase()
          : 'media'
      }));
    if (typeof data.nota_general !== 'string') data.nota_general = '';
    return data;
  }

  /* ============================================================
     EXPOSE
     ============================================================ */
  global.MesaSources = {
    PROVIDERS,
    getConfig, setConfig, clearConfig, hasLLM, currentLabel,
    callLLM, findSources, buildSourcesPrompt
  };
})(window);
