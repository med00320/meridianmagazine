# Meridian · Mesa de redacción

App estática de **crítica editorial** que pasa por la mesa un texto y devuelve un
informe estructurado: diagnóstico, ejes de lectura (registro · ritmo · léxico ·
estructura), puntos fuertes, fricciones pasaje a pasaje (cita literal + propuesta
de reescritura) y veredicto.

Mismo modelo de despliegue que el sintetizador del proyecto raíz: **HTML+CSS+JS
puro, sin servidor.** Se sirve desde cualquier host estático o abriendo el
`index.html` directo en el navegador (con la salvedad de Ollama sobre HTTPS,
explicada abajo).

## Cómo se usa

1. Abre `mesa/index.html` (doble clic, o `python -m http.server` en la carpeta
   raíz y entra a `http://localhost:8000/mesa/`).
2. Pulsa el badge **`IA · CONFIGURAR`** arriba a la derecha.
3. Elige proveedor:
   - **Ollama / LM Studio** (local, sin clave).
     - URL base por defecto: `http://localhost:11434/v1`.
     - Modelos sugeridos: `qwen3:14b` o superior. JSON-mode flojea por debajo
       de 14B.
     - Arranca Ollama con CORS abierto:
       `OLLAMA_ORIGINS="*" ollama serve`
   - **OpenAI** (con API key).
     - Modelos: `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini`, `o3-mini`.
4. Pega o carga texto (`.txt`, `.md`, `.docx`, `.pdf`).
5. Pulsa **Pasar por la mesa**.
6. Cuando el informe esté listo, decide qué hacer con el texto:
   - **↓ Descargar texto corregido** (`.txt`): aplica todas las propuestas de
     reescritura al texto original y te lo descarga limpio. Ideal para integrar
     en tu editor habitual y seguir trabajando.
   - **↓ Descargar .md con notas**: descarga el texto corregido + el informe
     anexado al final con todas las fricciones detalladas (incluso las que no
     llevaban propuesta). Sirve como expediente del paso por la mesa.
   - **Maquetar en el sintetizador →**: aplica las propuestas, abre el
     sintetizador en una pestaña nueva en modo "Maquetar", con el texto
     corregido ya cargado y los metadatos rellenos. Pulsas "Maquetar texto →"
     y tienes el A5 listo para Cmd+P.
7. (Opcional) **Imprimir A5** del propio informe — si quieres archivar el
   dictamen como minuta editorial.

## Tweaks (botón "Tweaks" en la barra del entorno)

- **Persona**: jefe de redacción / corrector de estilo / lector general.
- **Severidad**: suave / estándar / implacable.
- **Longitud**: ágil (~3-5 fricciones) / estándar / extensa (~12).
- **Idioma fijado**: es-ES peninsular vs español neutro.
- **Variante visual** del informe:
  - **Clásica Meridian** — Instrument Serif + Garamond + capitular roja.
  - **Moderna** — Inter + banda de veredicto negra.
  - **Cuaderno de pruebas** — fondo pautado, marca de corrector, citas tachadas.

## Despliegue (espejo del sintetizador)

```
mesa/
  index.html      ← entrada
  styles.css      ← manual de marca + 3 variantes + estilos de impresión @page A5
  ingest.js       ← lectura PDF/DOCX/TXT/MD en navegador (pdf.js + mammoth desde CDN)
  critic.js       ← adaptador Ollama + OpenAI (chat/completions OpenAI-compat),
                    schema JSON, parser tolerante, diagnóstico de red localhost/CORS
  layout.js       ← render del informe en las 3 variantes
  app.js          ← orquestador (estado, eventos, modal IA, tweaks, impresión)
```

Igual que `index.html` + `synth.js` + `app.js` + `layout.js` + `styles.css` del
sintetizador raíz. Cualquier hosting estático (Hostinger, Netlify, Pages) lo
sirve sin más. Para meterlo en `_deploy_final/` basta copiar la carpeta `mesa/`.

## Qué cambió respecto al backend original

El proyecto que subiste (`uploads/server.js`, `criticRouter.js`,
`editorialCriticLocal.js`, `index.html`) era un Express + Puppeteer con un
único frontend de 38 líneas. Lo descartamos por estas razones, cada una
respondida en esta refactorización:

| Problema en el original | Cómo se resuelve aquí |
|---|---|
| `criticRouter.js` requería `editorialCriticOpenAI` y el archivo no existía | Adaptador único en `critic.js` que maneja Ollama y OpenAI por la misma vía `chat/completions` |
| Prompt minimo ("Evalúa el texto como editor") | Prompt con persona + severidad + idioma + esquema JSON estricto + reglas anti-resumen |
| Sin schema, salida en texto libre | JSON tipado: diagnóstico / tesis / 4 ejes / puntos fuertes / fricciones con cita literal y propuesta / veredicto |
| Puppeteer (300 MB) para hacer PDFs | `@page A5` + `window.print()` — lo mismo que el sintetizador |
| `formatText` parte por `\n` simple, `sample.json` tiene `\\n` | El ingestor del navegador normaliza y respeta dobles saltos = párrafos numerados §1, §2… |
| Sin manejo de errores en frontend | Diagnóstico de red específico: mixed content HTTPS→localhost, CORS bloqueado, 401/429, JSON malformado |
| Sin manual de marca aplicado | Tres variantes visuales completas + estilos de impresión A5 |

## Gotchas que vas a encontrar

- **Mixed content**: si abres la app desde un origen `https://` y apuntas
  Ollama a `http://localhost:11434`, el navegador bloquea el fetch. Soluciones:
  abrir desde `file://` o `http://localhost`, o sirve Ollama detrás de un
  proxy HTTPS (Caddy / ngrok). El modal de error ya te lo explica con su
  comando.
- **CORS Ollama**: `OLLAMA_ORIGINS="*" ollama serve` (o tu origen exacto).
  LM Studio: activa el toggle de CORS en "Local Server".
- **JSON malformado**: modelos locales pequeños (<14B) fallan al JSON-mode.
  Sube a `qwen3:14b` o superior. El parser tolerante recoge `<think>` de R1
  y bloques ```` ```json ````, pero no salva un JSON sintácticamente roto.

## Estado y siguiente fase

Versión 1 = **un texto por sesión**. Para multi-artículo desde JSON (estilo
`sample.json` del proyecto original) la pieza que falta es:

- Componente para pegar JSON con `articulos: [{titulo, autor, contenido}]`.
- Pase de crítica por artículo con `Promise.allSettled`.
- Vista de "sumario del número" con todos los veredictos en columna.

Cuando lo necesites, dímelo y lo extendemos sobre esta misma base.
