/* ============================================================
   MERIDIAN · Mesa · editor.js
   Editor enriquecido mínimo (cursiva + negrita) que se monta
   sobre el textarea#pasteText sin cambiar el resto de app.js:
     · el textarea queda oculto y sigue siendo la fuente de verdad
       (con markdown serializado: *cursiva*, **negrita**)
     · interceptamos el setter `.value` del textarea para que cuando
       alguien escriba `pasteText.value = '...'` (loadFile / reset)
       el editor visible refleje el cambio
     · todo cambio del editor mirroreado al textarea + dispatchEvent
       'input', para que los listeners existentes se enteren
   Expone window.MesaEditor.
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- markdown ⇄ HTML (sólo *, **) ---------- */

  function escHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // markdown muy ligero → HTML editable
  function mdToHtml(md) {
    const txt = String(md == null ? '' : md);
    const paragraphs = txt.split(/\n{2,}/);
    return paragraphs.map(p => {
      if (!p.trim()) return '<p><br></p>';
      let h = escHTML(p);
      // **negrita** antes que *cursiva* para que *** funcione
      h = h.replace(/\*\*([^*\n][^*\n]*?)\*\*/g, '<strong>$1</strong>');
      h = h.replace(/(^|[^*])\*([^*\n][^*\n]*?)\*(?!\*)/g, '$1<em>$2</em>');
      // saltos simples → <br>
      h = h.replace(/\n/g, '<br>');
      return '<p>' + h + '</p>';
    }).join('');
  }

  // HTML del contenteditable → markdown plano
  function htmlToMd(root) {
    const lines = [];
    function walkInline(node) {
      let out = '';
      node.childNodes.forEach(ch => {
        if (ch.nodeType === 3) { out += ch.nodeValue; return; }
        if (ch.nodeType !== 1) return;
        const tag = ch.tagName;
        if (tag === 'BR') { out += '\n'; return; }
        if (tag === 'EM' || tag === 'I') { out += '*' + walkInline(ch) + '*'; return; }
        if (tag === 'STRONG' || tag === 'B') { out += '**' + walkInline(ch) + '**'; return; }
        // contenedor inline desconocido → recurre
        out += walkInline(ch);
      });
      return out;
    }
    function walkBlock(node) {
      node.childNodes.forEach(ch => {
        if (ch.nodeType === 3) {
          const t = ch.nodeValue;
          if (t.trim()) lines.push(t);
          return;
        }
        if (ch.nodeType !== 1) return;
        const tag = ch.tagName;
        if (tag === 'P' || tag === 'DIV') {
          const inline = walkInline(ch).replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n');
          lines.push(inline);
          return;
        }
        if (tag === 'BR') { lines.push(''); return; }
        // inline a nivel raíz → trátalo como párrafo
        lines.push(walkInline(ch));
      });
    }
    walkBlock(root);
    // colapsa párrafos vacíos múltiples
    return lines.map(s => s.replace(/\u00a0/g, ' ').trimEnd())
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /* ---------- pegado: conserva sólo cursiva y negrita ---------- */

  function sanitizePastedHtml(html) {
    // Mete el HTML en un contenedor inerte y queda con sólo lo permitido
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    // Word mete <o:p>, MsoNormal, etc. Limpia todo agresivamente.
    function clean(node) {
      const children = Array.from(node.childNodes);
      children.forEach(ch => {
        if (ch.nodeType === 3) return; // texto
        if (ch.nodeType !== 1) { node.removeChild(ch); return; }
        const tag = ch.tagName;
        const isItalic = tag === 'EM' || tag === 'I'
          || /italic/i.test(ch.getAttribute('style') || '');
        const isBold = tag === 'STRONG' || tag === 'B'
          || /font-weight\s*:\s*(bold|[6-9]\d\d)/i.test(ch.getAttribute('style') || '');
        const isBlock = /^(P|DIV|BR|H[1-6]|LI|UL|OL|BLOCKQUOTE|PRE)$/.test(tag);
        clean(ch);
        if (isItalic) {
          const em = document.createElement('em');
          while (ch.firstChild) em.appendChild(ch.firstChild);
          node.replaceChild(em, ch);
          return;
        }
        if (isBold) {
          const st = document.createElement('strong');
          while (ch.firstChild) st.appendChild(ch.firstChild);
          node.replaceChild(st, ch);
          return;
        }
        if (tag === 'BR') return;
        if (isBlock) {
          // mantén el bloque pero sustituye por <p>
          const p = document.createElement('p');
          while (ch.firstChild) p.appendChild(ch.firstChild);
          node.replaceChild(p, ch);
          return;
        }
        // span / font / etc → desempaquetar
        while (ch.firstChild) node.insertBefore(ch.firstChild, ch);
        node.removeChild(ch);
      });
    }
    clean(tmp);
    return tmp.innerHTML;
  }

  /* ---------- placeholder ---------- */

  function isEmpty(root) {
    const t = root.textContent || '';
    return !t.trim();
  }

  /* ---------- montaje ---------- */

  function mount(textarea, opts) {
    opts = opts || {};
    const placeholder = opts.placeholder || textarea.placeholder || '';

    // 1) construye el editor
    const host = document.createElement('div');
    host.className = 'rt-editor-host';
    host.innerHTML = `
      <div class="rt-toolbar" role="toolbar" aria-label="Formato">
        <button type="button" class="rt-tb-btn" data-cmd="bold"
                title="Negrita (Ctrl/Cmd+B)"><strong>B</strong></button>
        <button type="button" class="rt-tb-btn" data-cmd="italic"
                title="Cursiva (Ctrl/Cmd+I)"><em>I</em></button>
        <span class="rt-tb-sep" aria-hidden="true"></span>
        <button type="button" class="rt-tb-btn" data-cmd="clear"
                title="Quitar formato">⌫</button>
        <span class="rt-tb-hint" aria-hidden="true">
          Ctrl+B · Ctrl+I — la cursiva se conserva en el informe y la exportación.
        </span>
      </div>
      <div class="rt-editor" contenteditable="true" spellcheck="true"
           data-placeholder="${escHTML(placeholder)}"></div>
    `;
    textarea.parentNode.insertBefore(host, textarea);
    textarea.classList.add('rt-hidden-source');

    const editor = host.querySelector('.rt-editor');
    const toolbar = host.querySelector('.rt-toolbar');

    // 2) inicializar editor desde el textarea (por si ya hay contenido)
    editor.innerHTML = mdToHtml(textarea.value || '');
    refreshPlaceholder();

    // 3) interceptar lecturas/escrituras programáticas a textarea.value
    const proto = Object.getPrototypeOf(textarea);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    Object.defineProperty(textarea, 'value', {
      configurable: true,
      get() { return desc.get.call(this); },
      set(v) {
        desc.set.call(this, v == null ? '' : String(v));
        // sólo refrescar si difiere visualmente
        const cur = htmlToMd(editor);
        if ((v || '') !== cur) {
          editor.innerHTML = mdToHtml(v || '');
          refreshPlaceholder();
        }
      }
    });

    // 4) cuando el usuario edita → markdown al textarea + 'input'
    let syncTimer = null;
    function syncToTextarea() {
      const md = htmlToMd(editor);
      desc.set.call(textarea, md);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      refreshPlaceholder();
    }
    function scheduleSync() {
      if (syncTimer) cancelAnimationFrame(syncTimer);
      syncTimer = requestAnimationFrame(syncToTextarea);
    }
    editor.addEventListener('input', scheduleSync);
    editor.addEventListener('blur', syncToTextarea);

    // 5) atajos
    //    NOTA · DEUDA TÉCNICA: usamos document.execCommand('bold' / 'italic'
    //    / 'insertHTML' / 'removeFormat'). Está marcado como deprecated en
    //    el estándar pero todos los navegadores lo siguen implementando con
    //    fidelidad. La alternativa (Selection + Range + DOM surgery) implica
    //    reescribir el editor entero y es trabajo que no aporta funcionalidad
    //    visible al usuario. Mantener hasta que algún navegador retire el API.
    editor.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'i') { e.preventDefault(); document.execCommand('italic'); scheduleSync(); }
      else if (k === 'b') { e.preventDefault(); document.execCommand('bold'); scheduleSync(); }
    });

    // 6) toolbar
    toolbar.addEventListener('mousedown', (e) => {
      // mousedown (no click) para no perder la selección
      const btn = e.target.closest('.rt-tb-btn');
      if (!btn) return;
      e.preventDefault();
      const cmd = btn.dataset.cmd;
      editor.focus();
      if (cmd === 'bold') document.execCommand('bold');
      else if (cmd === 'italic') document.execCommand('italic');
      else if (cmd === 'clear') document.execCommand('removeFormat');
      // actualiza el estado pressed en la siguiente vuelta
      requestAnimationFrame(() => { refreshToolbar(); scheduleSync(); });
    });

    function refreshToolbar() {
      toolbar.querySelectorAll('.rt-tb-btn').forEach(b => {
        const cmd = b.dataset.cmd;
        let active = false;
        try {
          if (cmd === 'bold') active = document.queryCommandState('bold');
          else if (cmd === 'italic') active = document.queryCommandState('italic');
        } catch {}
        b.classList.toggle('is-active', !!active);
      });
    }
    document.addEventListener('selectionchange', () => {
      if (document.activeElement === editor) refreshToolbar();
    });

    // 7) pegado: sólo conservar cursiva/negrita
    editor.addEventListener('paste', (e) => {
      e.preventDefault();
      const dt = e.clipboardData;
      const html = dt.getData('text/html');
      const plain = dt.getData('text/plain') || '';
      let cleaned = '';
      if (html) {
        cleaned = sanitizePastedHtml(html);
      } else {
        // texto plano → convierte saltos dobles en párrafos
        cleaned = plain.split(/\n{2,}/).map(p =>
          '<p>' + escHTML(p).replace(/\n/g, '<br>') + '</p>').join('');
      }
      // insertHTML respeta selección
      document.execCommand('insertHTML', false, cleaned);
      scheduleSync();
    });

    // 8) placeholder
    function refreshPlaceholder() {
      editor.classList.toggle('rt-empty', isEmpty(editor));
    }

    return {
      get value() { return textarea.value; },
      set value(v) { textarea.value = v; },
      focus() { editor.focus(); },
      el: editor
    };
  }

  global.MesaEditor = { mount, mdToHtml, htmlToMd };
})(window);
