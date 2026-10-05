// ==UserScript==
// @name         ForoCoches Premium
// @namespace    https://forocoches.com/
// @version      1.7.1
// @homepageURL  https://github.com/Adri2401/Forocoches-premium
// @supportURL   https://github.com/Adri2401/Forocoches-premium/issues
// @updateURL    https://raw.githubusercontent.com/Adri2401/Forocoches-premium/main/forocoches-premium.user.js
// @downloadURL  https://raw.githubusercontent.com/Adri2401/Forocoches-premium/main/forocoches-premium.user.js
// @description  Modo oscuro OLED (negro puro) para ForoCoches, bloqueo de anuncios, lista negra, hilos ocultos/favoritos y nick Premium.
// @match        *://forocoches.com/*
// @match        *://*.forocoches.com/*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// ==/UserScript==

/*
 * Cómo funciona
 * - No depende de las clases CSS de ForoCoches: lee los colores que la web pinta de verdad,
 *   así que sigue funcionando aunque cambien el diseño.
 * - Solo actúa con el modo oscuro activo. En modo claro no toca nada.
 * - El gris de fondo pasa a negro puro. Las superficies algo más claras (citas, botones,
 *   menús, inputs) quedan en grises muy oscuros para que se sigan distinguiendo.
 * - Bordes, separadores y sombras grises se atenúan para que no "brillen" sobre el negro.
 * - Colores, iconos, avatares e imágenes no se tocan.
 * - Recuerda el último estado para pintar de negro desde el primer instante (sin flash gris).
 */
(() => {
  'use strict';

  /* ───────────── Ajustes ───────────── */
  const CFG = {
    elevacion: false,      // false = sin grises: todo negro puro. true = citas, botones y menús en gris muy oscuro
    separadores: 'quitar', // rayas separadoras, blancas o grises: 'quitar' | 'atenuar' | 'dejar'
                           // (los recuadros completos, como los campos de texto, solo se atenúan para no perderlos)
    quitarAnuncios: true,  // oculta anuncios y deja el menú de Tampermonkey para quitar lo que se escape
    premium: true,         // tu nick en dorado con insignia Premium en el panel lateral (solo lo ves tú)
    temaDorado: true,      // detalles dorados en el modo oscuro: acentos, iconos, cabeceras y paneles del script
    pseudoElementos: true, // procesa también ::before / ::after
    barraNavegador: true,  // barra del navegador en negro (meta theme-color)
    umbralOscuro: 90,      // luminancia máx. (0-255) del fondo para considerar que el modo oscuro está activo
    tolerancia: 6,         // grises hasta N puntos más claros que el fondo pasan a negro puro
    rango: 64,             // grises hasta N puntos más claros que el fondo se tratan como superficies
    maxCroma: 20,          // diferencia máx. entre canales RGB para considerar un color "gris"
  };

  const ON = 'data-oled-on';     // interruptor general de los overrides
  const DARK = 'data-oled-dark'; // modo oscuro detectado (color-scheme para controles nativos)
  const MK = 'data-oled';        // marcas por elemento
  const LN_ATTR = 'data-fc-ln';  // ocultado por la lista negra
  const UI_ATTR = 'data-fc-ui';  // paneles propios del script
  const HID_ATTR = 'data-fc-hid'; // fila de un hilo oculto o anclado en favoritos
  const GOLD_ATTR = 'data-fc-gold';
  const BADGE_ATTR = 'data-fc-premium';
  const KEY = 'fc-oled';
  const XHTML = 'http://www.w3.org/1999/xhtml';
  const SKIP = new Set(['HTML', 'HEAD', 'BODY', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'BASE',
    'NOSCRIPT', 'TEMPLATE', 'BR', 'WBR', 'SOURCE', 'TRACK', 'PARAM']);

  // En document-start puede que <html> aún no exista: se espera a que el parser lo cree.
  const whenRoot = (fn) => {
    if (document.documentElement) { fn(); return; }
    const w = new MutationObserver(() => {
      if (document.documentElement) { w.disconnect(); fn(); }
    });
    w.observe(document, { childList: true });
  };

  whenRoot(main);

  function main() {
    const root = document.documentElement;

    /* ───────────── CSS ─────────────
     * Los valores concretos van en variables inline por elemento; aquí solo hay ~12 reglas.
     * :not(#_) x3 sube la especificidad por encima de cualquier !important normal de la web,
     * y la copia dentro de @layer gana también a reglas !important en capas.               */
    const G = `html[${ON}]:not(#_):not(#_):not(#_)`;
    const RULES = `
  ${G}, ${G} > body { background-color: #000 !important; background-image: none !important; }
  ${G} { scrollbar-color: #2a2a2a #000 !important; }
  html[${DARK}] { color-scheme: dark !important; }
  ${G} [${MK}~="bg"] { background-color: var(--oled-bg, #000) !important; }
  ${G} [${MK}~="bi"] { background-image: var(--oled-bi, none) !important; }
  ${G} [${MK}~="sh"] { box-shadow: var(--oled-sh, none) !important; }
  ${G} [${MK}~="bt"] { border-top-color: var(--oled-bt, #262626) !important; }
  ${G} [${MK}~="br"] { border-right-color: var(--oled-br, #262626) !important; }
  ${G} [${MK}~="bb"] { border-bottom-color: var(--oled-bb, #262626) !important; }
  ${G} [${MK}~="bl"] { border-left-color: var(--oled-bl, #262626) !important; }
  ${G} [${MK}~="xb"]::before { background-color: var(--oled-xb, #000) !important; }
  ${G} [${MK}~="xa"]::after { background-color: var(--oled-xa, #000) !important; }
  ${G} [${MK}~="xbd"]::before { border-color: var(--oled-xbd, transparent) !important; }
  ${G} [${MK}~="xad"]::after { border-color: var(--oled-xad, transparent) !important; }
  `;
    /* ── Anuncios: selectores de formatos publicitarios estándar ── */
    const validSel = (sel) => { try { document.createDocumentFragment().querySelector(sel); return true; } catch (_) { return false; } };
    const AD_CSS = [
      // Google AdSense / Ad Manager
      'ins.adsbygoogle', '.adsbygoogle', '[id^="div-gpt-ad"]', '[id^="google_ads_iframe"]', '[data-google-query-id]',
      'iframe[src*="googlesyndication.com"]', 'iframe[src*="doubleclick.net"]', 'iframe[id^="google_ads"]',
      // Otras redes habituales en España
      'iframe[src*="smartadserver.com"]', '[id^="sas_"]', 'iframe[src*="adnxs.com"]', 'iframe[src*="amazon-adsystem.com"]',
      'iframe[src*="criteo."]', '[id^="taboola-"]', '.trc_related_container', '.OUTBRAIN', '[id^="outbrain_widget"]',
      // Contenedores marcados como anuncio
      '[data-ad]', '[data-ad-slot]', '[data-adslot]', '[data-ad-unit]', '[data-ad-unit-path]',
      '[class~="ad"]', '[class~="ads"]', '[class~="adv"]', '[class~="advert"]', '[class~="advertisement"]',
      '[class~="ad-slot"]', '[class~="ad-container"]', '[class~="ad-wrapper"]', '[class~="ad-banner"]', '[class~="banner-ad"]',
      '[id~="ad"]', '[id^="ad-slot"]', '[id^="adslot"]',
      '[class*="publicidad" i]', '[id*="publicidad" i]', '[class*="patrocin" i]',
      // ForoCoches: avisos de vBulletin encima de los listados (banner del patrocinador, p. ej. Surfshark)
      'form#vbnotices', '.navbar_notice',
    ].filter(validSel);
    const AD_JOINED = AD_CSS.join(', ');
    const hideRules = (sels) => sels.map((sel) => `${sel} { display: none !important; }`).join('\n');
    const AD_RULES = CFG.quitarAnuncios ? hideRules([...AD_CSS, '[data-fc-ad]']) : '';

    // Almacenamiento: GM_* si Tampermonkey lo da (no lo borra la web), si no localStorage
    const store = {
      get(k, d) {
        try {
          if (typeof GM_getValue === 'function') return GM_getValue(k, d);
          const v = localStorage.getItem(`fc-oled:${k}`);
          return v == null ? d : JSON.parse(v);
        } catch (_) { return d; }
      },
      set(k, v) {
        try {
          if (typeof GM_setValue === 'function') GM_setValue(k, v);
          else localStorage.setItem(`fc-oled:${k}`, JSON.stringify(v));
        } catch (_) { /* nada */ }
      },
    };
    let ocultos = store.get('ocultos', []);       // quitados a mano con el selector
    if (!Array.isArray(ocultos)) ocultos = [];
    let aprendidos = store.get('aprendidos', []); // anuncios detectados antes: se ocultan sin esperar a detectarlos
    if (!Array.isArray(aprendidos)) aprendidos = [];
    const userStyle = document.createElement('style');
    userStyle.id = 'fc-oled-ocultos';
    const buildUserStyle = () => {
      const r = CFG.quitarAnuncios ? hideRules([...ocultos, ...aprendidos].filter(validSel)) : hideRules(ocultos.filter(validSel));
      userStyle.textContent = `@layer fc-oled {${r}}\n${r}`;
    };
    buildUserStyle();

    const style = document.createElement('style');
    style.id = 'fc-oled';
    const LN_RULES = hideRules([`[${LN_ATTR}]`, `[${HID_ATTR}]`]);
    const PREMIUM_RULES = `
  [${GOLD_ATTR}] {
    background-image: linear-gradient(100deg, #a8741c 0%, #e9c46a 20%, #fff4c8 34%, #d9ab45 50%, #f6e27a 68%, #b5832a 84%, #e9c46a 100%) !important;
    background-size: 250% 100% !important; background-color: transparent !important;
    -webkit-background-clip: text !important; background-clip: text !important;
    color: transparent !important; -webkit-text-fill-color: transparent !important;
    font-weight: 800 !important; text-shadow: none !important;
    filter: drop-shadow(0 0 7px rgba(233, 196, 106, .32));
    animation: fc-gold 6s linear infinite;
  }
  @keyframes fc-gold { from { background-position: 0% 50%; } to { background-position: 250% 50%; } }
  [${BADGE_ATTR}] {
    display: inline-flex !important; align-items: center; gap: .3em; margin-left: .5em; padding: .24em .64em .24em .52em;
    border-radius: 999px; vertical-align: middle; white-space: nowrap;
    font: 800 .6em/1.15 system-ui, -apple-system, Roboto, sans-serif; letter-spacing: .08em; text-transform: uppercase;
    color: #2a1d00 !important; -webkit-text-fill-color: #2a1d00 !important;
    background: linear-gradient(135deg, #fff1b8 0%, #f2cd5c 32%, #d4a640 62%, #b5832a 100%) !important;
    box-shadow: inset 0 0 0 1px rgba(255, 236, 170, .55), 0 2px 12px rgba(212, 166, 64, .4);
  }
  [${BADGE_ATTR}] svg { width: 1.25em; height: 1.25em; fill: currentColor; }
  @media (prefers-reduced-motion: reduce) { [${GOLD_ATTR}] { animation: none; } }
`;
    /* ── Tema dorado: solo con el modo oscuro activo. El oro queda para lo tuyo y la interfaz
     * (cabecera, botones, favoritos, paneles). Lo de los demás (nicks, hilos, mensajes) va en
     * blanco y grises: el coral de la web pasa a neutro cambiando sus variables.             ── */
    const ICONO_ORO = 'grayscale(1) brightness(1.15) sepia(1) saturate(2.4) hue-rotate(-6deg) brightness(.95)';
    const ICONO_NEUTRO = 'grayscale(1) brightness(1.5)';
    const GOLD_RULES = !CFG.temaDorado ? '' : `
  ${G} > body {
    --coral: #ededed !important; --new-primary: #b8862b !important; --new-button-red-hover: #9c7022 !important;
    --link-hover: #ffffff !important; --thread-notification-bullet-blue: #5a5a5a !important;
    --forum-title-background: transparent !important;
  }
  ${G} { scrollbar-color: #4a3812 #000 !important; accent-color: #d4a640; caret-color: #e3b552; }
  ${G} ::selection { background: rgba(212, 166, 64, .38); color: #fff; }
  ${G} #header::after {
    content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 1px; pointer-events: none;
    background: linear-gradient(90deg, transparent, rgba(212, 166, 64, .5) 18%, #f1cf72 50%, rgba(212, 166, 64, .5) 82%, transparent);
  }
  ${G} .threads-list-header {
    background: transparent !important; min-height: 0 !important; padding: 10px 0 6px !important;
    border-bottom: 1px solid rgba(212, 166, 64, .16) !important;
  }
  ${G} .threads-list-header > span {
    font: 700 11px/1 system-ui, -apple-system, Roboto, sans-serif !important; letter-spacing: .18em !important;
    text-transform: uppercase !important; color: #d4a640 !important;
  }
  ${G} .threads-list > div + div { border-top: 1px solid rgba(255, 255, 255, .06) !important; }
  ${G} [style*="5px var(--coral)"] { border-left-color: #3a3a3a !important; }
  ${G} .threads-list [style*="--message"], ${G} .threads-list [style*="--tema-participado"] { filter: ${ICONO_NEUTRO} !important; }
  ${G} [style*="--next-right-icon"], ${G} [style*="--next-left-icon"], ${G} [style*="--final-right-icon"],
  ${G} [style*="--final-left-icon"], ${G} [style*="--go-to-post"], ${G} [style*="--boton-reply"],
  ${G} .forocoches-search-icon, ${G} .subscribe-thread-icon { filter: ${ICONO_ORO} !important; }
`;
    style.textContent = `@layer fc-oled {${RULES}${AD_RULES}${LN_RULES}${PREMIUM_RULES}${GOLD_RULES}}\n${RULES}${AD_RULES}${LN_RULES}${PREMIUM_RULES}${GOLD_RULES}`;
    // Va el primero del documento: así su @layer se declara antes que cualquier capa de la web
    // y sus !important tienen prioridad sobre los de ella.
    const placeStyle = () => {
      const parent = document.head || root;
      parent.insertBefore(style, parent.firstChild);
      style.after(userStyle);
    };
    const ensureStyle = () => { if (!style.isConnected || !userStyle.isConnected) placeStyle(); };
    placeStyle();

    /* ───────────── Estado (anti-flash) ───────────── */
    const state = { dark: true, base: 45 }; // sin datos guardados se asume oscuro: negro desde el primer instante
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && typeof s === 'object') {
        state.dark = !!s.dark;
        if (Number.isFinite(s.base)) state.base = s.base;
      }
    } catch (_) { /* sin almacenamiento */ }
    if (state.dark) { root.setAttribute(DARK, ''); root.setAttribute(ON, ''); }
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) { /* nada */ } };

    /* ───────────── Colores ───────────── */
    const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/i;
    const COLOR_FN = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)/gi;
    const COLOR_ONE = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)/i;
    const CLARO = 170;               // brillo (sobre negro) a partir del cual una raya se considera "blanca"
    const T = 'rgba(0, 0, 0, 0)';
    const colorCache = new Map();
    let ctx = null;

    function parseColor(s) {
      if (!s) return null;
      const m = RGB.exec(s);
      if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[5] ? m[4] / 100 : +m[4]];
      if (colorCache.has(s)) return colorCache.get(s);
      // Colores modernos (oklch, color()…): que los resuelva el navegador
      let res = null;
      try {
        if (!ctx) {
          const c = document.createElement('canvas');
          c.width = c.height = 1;
          ctx = c.getContext('2d', { willReadFrequently: true });
        }
        ctx.fillStyle = '#010203';
        ctx.fillStyle = s;
        if (ctx.fillStyle !== '#010203') {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillRect(0, 0, 1, 1);
          const d = ctx.getImageData(0, 0, 1, 1).data;
          res = [d[0], d[1], d[2], d[3] / 255];
        }
      } catch (_) { /* color no soportado */ }
      if (colorCache.size > 500) colorCache.clear();
      colorCache.set(s, res);
      return res;
    }

    const lum = (c) => Math.round(0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]);
    const isGray = (c) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) <= CFG.maxCroma;
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const gray = (v, a = 1) => (a >= 1 ? `rgb(${v}, ${v}, ${v})` : `rgba(${v}, ${v}, ${v}, ${+a.toFixed(3)})`);

    // Superficies: el fondo base (y lo más oscuro) → negro; lo algo más claro → gris muy oscuro.
    function mapSurface(v) {
      const d = v - state.base;
      if (d <= CFG.tolerancia) return 0;
      if (d > CFG.rango || v > 150) return null; // demasiado claro: es intencionado, no se toca
      return CFG.elevacion ? clamp(Math.round(14 + d * 0.5), 14, 50) : 0;
    }

    // Bordes: si coinciden con el fondo (bordes "invisibles") siguen al fondo; si no, se atenúan.
    // ── Líneas (bordes, divs de 1-3 px, sombras) ──
    const isLight = (c) => isGray(c) && lum(c) * c[3] > CLARO;
    const dimLight = (v) => clamp(Math.round(v * 0.25), 40, 64);
    const quitarLineas = () => CFG.separadores === 'quitar';
    const tocarLineas = () => CFG.separadores !== 'dejar';

    // Línea atenuada (o null si ya es tenue y no hace falta tocarla)
    const dimLine = (v, a) => {
      if (v * a > CLARO) return gray(dimLight(v), a);
      if (v > 170) return null; // blanco muy translúcido: ya se ve tenue
      return gray(clamp(Math.round(v * 0.45), 22, 64), a);
    };
    // Bordes del mismo color que el fondo (invisibles): siguen al fondo. undefined = no es el caso.
    const followBg = (v, own) => {
      if (own != null && Math.abs(v - own) <= 3) return mapSurface(own);
      if (Math.abs(v - state.base) <= 3) return 0;
      return undefined;
    };

    // ¿Es una línea? (≤ 3 px de alto o de ancho y visible)
    const isThin = (el) => {
      const h = el.offsetHeight;
      const w = el.offsetWidth;
      return h > 0 && w > 0 && Math.min(h, w) <= 3;
    };
    const isThinPseudo = (ps) => {
      const h = parseFloat(ps.height);
      const w = parseFloat(ps.width);
      return (h > 0 && h <= 3) || (w > 0 && w <= 3);
    };

    // Fondo gris de un elemento o pseudo-elemento → valor nuevo (o null para no tocarlo)
    function mapBackground(c, thin) {
      const v = lum(c);
      const lighter = v - state.base > CFG.tolerancia;
      if (c[3] < 0.5) {
        // Velos translúcidos claros (resaltados, fondos de chips…): fuera si no se quieren grises
        return !CFG.elevacion && lighter && v * c[3] > 4 ? T : null;
      }
      if (lighter && tocarLineas() && thin()) return quitarLineas() ? T : dimLine(v, c[3]);
      const n = mapSurface(v);
      return n == null ? null : gray(n, c[3]);
    }

    // Bordes de los 4 lados → [token, color]. En 1-2 lados son separadores; en 3-4, un recuadro.
    function mapBorders(cs, own, sides, esLinea = false) {
      const out = [];
      const lines = [];
      for (const [k, S] of sides) {
        const st = cs[`border${S}Style`];
        if (st === 'none' || st === 'hidden' || !parseFloat(cs[`border${S}Width`])) continue;
        const c = parseColor(cs[`border${S}Color`]);
        if (!c || c[3] === 0 || !isGray(c)) continue;
        const v = lum(c);
        const f = followBg(v, own);
        if (f !== undefined) { if (f !== null) out.push([k, gray(f, c[3])]); continue; }
        lines.push([k, v, c[3]]);
      }
      if (lines.length && tocarLineas()) {
        const quitar = quitarLineas() && (esLinea || lines.length <= 2);
        for (const [k, v, a] of lines) {
          const n = quitar ? T : dimLine(v, a);
          if (n) out.push([k, n]);
        }
      }
      return out;
    }

    // Sombras capa a capa. Una capa sin desenfoque desplazada en un solo eje es una raya.
    const splitLayers = (v) => {
      const out = [];
      let depth = 0;
      let cur = '';
      for (const ch of v) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += ch;
      }
      if (cur.trim()) out.push(cur.trim());
      return out;
    };
    function remapShadow(value, own) {
      let changed = false;
      const layers = splitLayers(value).map((layer) => {
        const m = COLOR_ONE.exec(layer);
        if (!m) return layer;
        const c = parseColor(m[0]);
        if (!c || c[3] === 0 || !isGray(c)) return layer;
        const v = lum(c);
        if (v <= state.base + CFG.tolerancia) return layer; // sombras oscuras: no molestan
        const f = followBg(v, own);
        let nc;
        if (f !== undefined) nc = f === null ? null : gray(f, c[3]);
        else {
          const [x = 0, y = 0, blur = 0, spread = 0] = (layer.replace(m[0], '').match(/-?[\d.]+px/g) || []).map(parseFloat);
          const raya = !blur && spread <= 0 && !x !== !y && Math.max(Math.abs(x), Math.abs(y)) <= 3;
          if (raya && !tocarLineas()) return layer;
          nc = raya && quitarLineas() ? T : dimLine(v, c[3]);
        }
        if (!nc) return layer;
        changed = true;
        return layer.replace(m[0], nc);
      });
      return changed ? layers.join(', ') : null;
    }

    // Reescribe los colores de un valor compuesto (degradado, sombra). Si alguno no es gris, no toca nada.
    // fn devuelve: número = nuevo gris · undefined = dejar ese color igual · null = abortar.
    function remap(value, fn) {
      let ok = true;
      let changed = false;
      const out = value.replace(COLOR_FN, (m) => {
        if (!ok) return m;
        const c = parseColor(m);
        if (!c) { ok = false; return m; }
        if (c[3] === 0) return m;
        if (!isGray(c)) { ok = false; return m; }
        const v = fn(lum(c));
        if (v === undefined) return m;
        if (v === null) { ok = false; return m; }
        changed = true;
        return gray(v, c[3]);
      });
      return ok && changed ? out : null;
    }

    /* ───────────── Análisis por elemento ───────────── */
    const SIDES = [['bt', 'Top'], ['br', 'Right'], ['bb', 'Bottom'], ['bl', 'Left']];
    const PSEUDOS = [['xb', '::before'], ['xa', '::after']];
    const TR_PROPS = /all|background|border|shadow/;
    let transitionHit = false;

    const eligible = (el) => el.namespaceURI === XHTML && !SKIP.has(el.tagName);

    function analyze(el) {
      const cs = getComputedStyle(el);
      const tk = [];
      const vars = [];
      const put = (k, v) => { tk.push(k); vars.push([`--oled-${k}`, v]); };
      let own = null;

      const bg = parseColor(cs.backgroundColor);
      if (bg && isGray(bg)) {
        if (bg[3] >= 0.5) own = lum(bg);
        const n = mapBackground(bg, () => isThin(el));
        if (n) put('bg', n);
      }

      const bi = cs.backgroundImage;
      if (bi && bi !== 'none' && bi.includes('gradient') && !bi.includes('url(')) {
        const g = remap(bi, mapSurface);
        if (g) put('bi', g);
        else if (quitarLineas() && isThin(el) && (bi.match(COLOR_FN) || []).every((c) => { const x = parseColor(c); return !x || isGray(x); })) {
          put('bi', 'none'); // raya dibujada con un degradado
        }
      }

      const bs = cs.boxShadow;
      if (bs && bs !== 'none') {
        const sh = remapShadow(bs, own);
        if (sh) put('sh', sh);
      }

      if (cs.borderStyle !== 'none') {
        const esLinea = el.tagName === 'HR' || isThin(el);
        for (const [k, n] of mapBorders(cs, own, SIDES, esLinea)) put(k, n);
      }

      if (CFG.pseudoElementos) {
        for (const [k, p] of PSEUDOS) {
          const ps = getComputedStyle(el, p);
          if (!ps.content || ps.content === 'none' || ps.content === 'normal') continue;
          const c = parseColor(ps.backgroundColor);
          let pOwn = null;
          if (c && isGray(c)) {
            if (c[3] >= 0.5) pOwn = lum(c);
            const n = mapBackground(c, () => isThinPseudo(ps));
            if (n) put(k, n);
          }
          // Bordes del pseudo-elemento: una sola regla para los 4 lados
          if (ps.borderStyle !== 'none') {
            const bs = mapBorders(ps, pOwn, SIDES);
            if (bs.length) put(`${k}d`, bs[0][1]);
          }
        }
      }

      if (!tk.length) return null;
      if (!transitionHit && /[1-9]/.test(cs.transitionDuration) && TR_PROPS.test(cs.transitionProperty)) transitionHit = true;
      return { tk: tk.join(' '), vars };
    }

    let done = new WeakSet();

    function apply(el, d) {
      done.add(el);
      if (!d) { if (el.hasAttribute(MK)) el.removeAttribute(MK); return; }
      const st = el.style;
      for (const [k, v] of d.vars) if (st.getPropertyValue(k) !== v) st.setProperty(k, v);
      if (el.getAttribute(MK) !== d.tk) el.setAttribute(MK, d.tk);
    }

    // Primero todas las lecturas y luego todas las escrituras: un solo recálculo de estilos.
    function processAll(els) {
      const ds = els.map((el) => analyze(el));
      for (let i = 0; i < els.length; i++) apply(els[i], ds[i]);
    }

    // Evita que los elementos con `transition` hagan un fundido gris→negro al aplicar/quitar
    // los overrides. Solo cancela transiciones de las propiedades que toca el script.
    const OWN_PROPS = new Set(['background-color', 'background-image', 'box-shadow',
      'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color']);
    const canAnim = typeof CSSTransition === 'function' && typeof document.getAnimations === 'function';
    function cancelTransitions(targets, withColor) {
      if (!canAnim) return;
      for (const a of document.getAnimations()) {
        if (!(a instanceof CSSTransition)) continue;
        const p = a.transitionProperty;
        if (!OWN_PROPS.has(p) && !(withColor && p === 'color')) continue;
        if (targets && !targets.has(a.effect && a.effect.target)) continue;
        a.cancel();
      }
    }

    /* ───────────── Detección del modo oscuro ───────────── */
    function detectBase() {
      const opaque = (el) => {
        if (!el) return null;
        const c = parseColor(getComputedStyle(el).backgroundColor);
        return c && c[3] >= 0.85 ? c : null;
      };
      const page = opaque(document.body) || opaque(root);
      const scheme = getComputedStyle(root).colorScheme || '';
      const canvasDark = /dark/.test(scheme) &&
        (!/light/.test(scheme) || matchMedia('(prefers-color-scheme: dark)').matches);

      // Muestrea la pantalla para saber qué gris domina (será el que pase a negro puro)
      const votes = new Map();
      let total = 0;
      let darkN = 0;
      const W = innerWidth;
      const H = innerHeight;
      if (W && H) {
        for (const fx of [0.2, 0.5, 0.8]) {
          for (const fy of [0.25, 0.5, 0.75]) {
            let c = null;
            for (const el of document.elementsFromPoint(W * fx, H * fy)) if ((c = opaque(el))) break;
            total++;
            let v;
            if (c) {
              if (!isGray(c)) continue;
              v = lum(c);
            } else {
              v = canvasDark ? 18 : 255;
            }
            if (v <= CFG.umbralOscuro) {
              darkN++;
              votes.set(v, (votes.get(v) || 0) + 1);
            }
          }
        }
      }

      // Si el fondo de la página es claro, solo se considera modo oscuro si casi toda la pantalla lo es
      const pageDark = page ? isGray(page) && lum(page) <= CFG.umbralOscuro : canvasDark;
      const ratio = total ? darkN / total : 0;
      if (!pageDark && ratio <= (page ? 0.75 : 0.5)) return null;

      let best = null;
      let n = 0;
      for (const [v, k] of votes) if (k > n || (k === n && v < best)) { best = v; n = k; }
      return best ?? (page ? lum(page) : 18);
    }

    /* ───────────── Barra del navegador ───────────── */
    function themeColor(on) {
      if (!CFG.barraNavegador || !document.head) return;
      const metas = document.head.querySelectorAll('meta[name="theme-color"]');
      if (on) {
        if (!metas.length) {
          const m = document.createElement('meta');
          m.name = 'theme-color';
          m.content = '#000000';
          m.setAttribute('data-oled-own', '');
          document.head.appendChild(m);
          return;
        }
        for (const m of metas) {
          if (!m.hasAttribute('data-oled-own') && !m.hasAttribute('data-oled-orig')) m.setAttribute('data-oled-orig', m.content);
          m.content = '#000000';
        }
      } else {
        for (const m of metas) {
          if (m.hasAttribute('data-oled-own')) m.remove();
          else if (m.hasAttribute('data-oled-orig')) {
            m.content = m.getAttribute('data-oled-orig');
            m.removeAttribute('data-oled-orig');
          }
        }
      }
    }

    /* ───────────── Pasada completa ───────────── */
    let refreshTimer = 0;
    let sig = '';
    let sheets = 0;
    const signature = () => {
      const b = document.body;
      if (!b) return '';
      const bs = getComputedStyle(b);
      const rs = getComputedStyle(root);
      return `${bs.color}|${bs.backgroundColor}|${rs.color}|${rs.backgroundColor}`;
    };

    // full=false: si el fondo base no ha cambiado, solo procesa lo que aún no se ha visto
    // (lo procesado durante la carga ya es correcto). Se usa en el arranque.
    function refresh(full = true) {
      clearTimeout(refreshTimer);
      refreshTimer = 0;
      pending.clear();
      if (!document.body) return;
      ensureStyle();

      // Se desactiva todo para leer los colores originales (en el mismo tick: no se llega a pintar)
      root.removeAttribute(ON);
      root.removeAttribute(DARK);
      cancelTransitions(null, true);

      const base = detectBase();
      const incremental = !full && state.dark && base != null && Math.abs(base - state.base) <= 2;
      state.dark = base != null;
      if (state.dark) state.base = base;
      save();
      if (!incremental) done = new WeakSet();

      if (state.dark) {
        root.setAttribute(DARK, '');
        const els = Array.prototype.filter.call(document.getElementsByTagName('*'),
          incremental ? (el) => eligible(el) && !done.has(el) : eligible);
        processAll(els);
        root.setAttribute(ON, '');
      } else {
        for (const el of document.querySelectorAll(`[${MK}]`)) el.removeAttribute(MK);
      }
      themeColor(state.dark);
      cancelTransitions(null, false);
      sig = signature();
      sheets = document.styleSheets.length;
    }

    function scheduleRefresh(delay = 150) {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refresh, delay);
    }

    /* ───────────── Contenido dinámico ───────────── */
    const pending = new Map(); // elemento → incluir descendientes siempre
    let raf = 0;

    function queue(el, deep) {
      if (deep || !pending.has(el)) pending.set(el, deep);
      if (!raf) raf = requestAnimationFrame(flush);
    }

    function flush() {
      raf = 0;
      if (!state.dark || refreshTimer) { pending.clear(); return; }
      const set = new Set();
      for (const [n, deep] of pending) {
        if (!n.isConnected) continue;
        if (eligible(n)) set.add(n);
        if (!n.firstElementChild) continue;
        const all = n.getElementsByTagName('*');
        if (deep || all.length <= 1500) for (const el of all) if (eligible(el)) set.add(el);
      }
      pending.clear();
      if (!set.size) return;

      // Elementos ya procesados cuyo estado cambió: se les quita la marca para leer el color nuevo
      let reeval = false;
      for (const el of set) if (el.hasAttribute(MK)) { el.removeAttribute(MK); reeval = true; }
      if (reeval) cancelTransitions(set, false);

      transitionHit = false;
      processAll([...set]);
      if (transitionHit || reeval) cancelTransitions(set, false);
    }

    let ready = false;
    const mo = new MutationObserver((recs) => {
      for (const r of recs) {
        if (r.type === 'attributes') {
          const t = r.target;
          if (state.dark && t !== root && t !== document.body) queue(t, false);
          continue;
        }
        for (const n of r.addedNodes) {
          if (n.nodeType === 1 && n.hasAttribute(UI_ATTR)) continue;
          if (n.nodeType === 1 && state.dark) queue(n, true);
          if (CFG.quitarAnuncios) scanAdded(n); // antes de que se pinte
          lnAdded(n);
          extrasAdded(n);
        }
        if (r.addedNodes.length) { scheduleAdScan(); scheduleLnScan(); scheduleExtras(); }
      }
      revalidateCollapsed();
      extrasTick();
      ensureStyle();
    });
    mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

    // Una hoja de estilos que llega tarde puede volver a poner grises: se rehace en el acto
    document.addEventListener('load', (e) => {
      const t = e.target;
      if (t && t.tagName === 'LINK' && /\bstylesheet\b/i.test(t.rel) && document.body) refresh(true);
    }, true);

    // Cambio de tema en <html>/<body>: solo se rehace todo si los colores base han cambiado de verdad
    // (las clases que se ponen al hacer scroll o abrir un modal no disparan una pasada completa).
    const ROOT_ATTRS = ['class', 'style', 'data-theme', 'data-bs-theme', 'data-mode', 'data-color-scheme', 'theme'];
    let sigTimer = 0;
    const rootMo = new MutationObserver(() => {
      clearTimeout(sigTimer);
      sigTimer = setTimeout(() => { if (signature() !== sig) scheduleRefresh(0); }, 80);
    });
    rootMo.observe(root, { attributes: true, attributeFilter: ROOT_ATTRS });

    /* ───────────── Anuncios: limpieza automática ───────────── */
    const AD_ATTR = 'data-fc-ad';      // "" = anuncio · "c" = contenedor que solo tenía anuncios
    const SKIP_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
    const MEDIA = 'img, picture, video, iframe, svg, canvas, object, embed, input, textarea, select, button';
    const SPONSOR_LINKS = [
      'a[rel~="sponsored"]', 'a[href*="doubleclick.net"]', 'a[href*="googleadservices.com"]', 'a[href*="/aclk?"]',
      'a[href*="adclick"]', 'a[href*="smartadserver.com"]', 'a[href*="adnxs.com"]', 'a[href*="utm_source=forocoches"]',
      'a[href*="utm_medium=banner"]', 'a[href*="utm_medium=display"]', 'a[href*="utm_medium=cpm"]',
    ].join(', ');
    const LABEL_TAGS = 'span, div, p, small, strong, b, em, i, label, h2, h3, h4, h5, h6';
    const LABEL_RE = /^(publicidad|anuncio|patrocinado|contenido patrocinado|sponsored|advertisement)$/i;
    const CONTENT_LINKS = 'a[href*="showthread"], a[href*="forumdisplay"], a[href*="member.php"]';
    const isAdEl = (el) => !!AD_JOINED && el.matches(AD_JOINED);

    function textOf(el) {
      let out = '';
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.parentElement && SKIP_TEXT.has(n.parentElement.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      while (w.nextNode()) out += w.currentNode.data;
      return out.replace(/\s+/g, ' ').trim();
    }

    // ¿Este nodo muestra algo que no sea un anuncio oculto?
    function contentful(n) {
      if (n.nodeType === 3) return !!n.data.trim();
      if (n.nodeType !== 1 || SKIP_TEXT.has(n.tagName) || n.hasAttribute(AD_ATTR) || n.hasAttribute(LN_ATTR) || n.hasAttribute(HID_ATTR) || isAdEl(n)) return false;
      if (n.matches(MEDIA)) return true;
      for (const c of n.childNodes) if (contentful(c)) return true;
      return false;
    }
    const hasContent = (el) => { for (const c of el.childNodes) if (contentful(c)) return true; return false; };

    // Al quitar un anuncio, quita también los envoltorios que se quedan vacíos (y su hueco).
    // Se revisan en cada cambio: si mientras carga la página les llega contenido, vuelven a mostrarse.
    const collapsed = new Map(); // elemento → atributo con el que se recogió
    function collapseUp(el, attr = AD_ATTR) {
      let p = el.parentElement;
      for (let i = 0; i < 3 && p && p !== document.body && p !== root; i++, p = p.parentElement) {
        if (p.hasAttribute(AD_ATTR) || p.hasAttribute(LN_ATTR) || p.hasAttribute(HID_ATTR)) continue;
        if (hasContent(p)) break;
        p.setAttribute(attr, 'c');
        collapsed.set(p, attr);
      }
    }
    function revalidateCollapsed() {
      for (const [el, attr] of collapsed) {
        if (!el.isConnected || el.getAttribute(attr) !== 'c') { collapsed.delete(el); continue; }
        if (hasContent(el)) { el.removeAttribute(attr); collapsed.delete(el); }
      }
    }

    // Mientras se descarga la página, un elemento puede estar a medias: solo se considera
    // cerrado cuando el navegador ya ha leído algo detrás de él.
    const parsing = () => document.readyState === 'loading';
    const isClosed = (el) => {
      for (let n = el; n && n !== root; n = n.parentNode) if (n.nextSibling) return true;
      return false;
    };

    function hideAd(box) {
      if (!box || box === document.body || box === root || box.hasAttribute(AD_ATTR)) return;
      if (box.querySelectorAll(CONTENT_LINKS).length > 1) return; // contiene hilos o usuarios: no es un anuncio
      if (box.getBoundingClientRect().height > 900) return;
      box.setAttribute(AD_ATTR, '');
      collapseUp(box);
    }

    // Desde un enlace patrocinado, sube hasta el bloque del anuncio sin tragarse contenido ajeno
    function adBoxFromLink(a) {
      let box = a;
      for (let i = 0; i < 5; i++) {
        const p = box.parentElement;
        if (!p || p === document.body || p === root) break;
        if (parsing() && !isClosed(p)) break; // a medias: lo recogerá collapseUp
        if ([...p.querySelectorAll('a[href]')].some((x) => !box.contains(x))) break;
        if (textOf(p).length - textOf(box).length > 40) break;
        box = p;
      }
      return box;
    }

    // Desde una etiqueta "Publicidad", busca el bloque que la contiene junto al anuncio
    function adBoxFromLabel(lbl) {
      let box = lbl.parentElement;
      for (let i = 0; i < 3 && box && box !== document.body && box !== root; i++, box = box.parentElement) {
        const tieneAnuncio = box.querySelector('iframe, ins, img, a[href]') || (AD_JOINED && box.querySelector(AD_JOINED));
        if (tieneAnuncio && textOf(box).length < 200) return box;
      }
      return null;
    }

    // Promociones propias de ForoCoches: se reconocen por su texto completo exacto.
    // Se añaden aquí si aparecen otras (el bloque entero debe coincidir, no basta con contener el texto).
    const AD_TEXTS = [
      /^amazon\s*¡?nuevas ofertas cada d[ií]a!?$/i,
    ];
    const AD_TRIGGER = /ofertas cada d[ií]a/i;

    // Desde el texto, el primer bloque cuyo texto completo sea el de la promoción.
    // Los envoltorios decorativos (el fondo de puntos) los recoge collapseUp.
    function adBoxFromText(node) {
      let el = node.parentElement;
      for (let i = 0; i < 8 && el && el !== document.body && el !== root; i++, el = el.parentElement) {
        const t = textOf(el);
        if (t.length > 80) return null;
        if (AD_TEXTS.some((re) => re.test(t))) return el;
      }
      return null;
    }

    // Revisión inmediata de cada nodo nuevo (se ejecuta antes de que el navegador lo pinte)
    function scanAdded(n) {
      if (n.nodeType === 3) {
        if (AD_TRIGGER.test(n.data) && !n.parentElement?.closest(`[${AD_ATTR}]`)) hideAd(adBoxFromText(n));
        return;
      }
      if (n.nodeType !== 1 || n.closest(`[${AD_ATTR}]`)) return;
      if (n.matches(SPONSOR_LINKS)) hideAd(adBoxFromLink(n));
      if (isAdEl(n)) collapseUp(n);
      if (!n.firstElementChild) return;
      for (const a of n.querySelectorAll(SPONSOR_LINKS)) hideAd(adBoxFromLink(a));
      if (AD_JOINED) for (const el of n.querySelectorAll(AD_JOINED)) collapseUp(el);
      if (AD_TRIGGER.test(n.textContent)) {
        const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
        const hits = [];
        while (w.nextNode()) if (AD_TRIGGER.test(w.currentNode.data)) hits.push(w.currentNode);
        for (const t of hits) if (!t.parentElement?.closest(`[${AD_ATTR}]`)) hideAd(adBoxFromText(t));
      }
    }

    // Aprende un selector CSS del bloque de cada anuncio detectado, para ocultarlo desde el
    // primer instante en las siguientes visitas. Solo si en esta página ese selector no toca
    // nada más que anuncios. Y se olvida solo si alguna vez tapa contenido.
    let learnReady = false; // se aprende 3 s después de cargar, cuando ya ha llegado el contenido tardío
    function learnAds() {
      if (!CFG.quitarAnuncios || parsing()) return;
      let changed = false;
      const isAdOrInside = (m) => m.closest(`[${AD_ATTR}]`) || isAdEl(m);
      aprendidos = aprendidos.filter((sel) => {
        let ok = true;
        try {
          for (const el of document.querySelectorAll(sel)) {
            if (el.querySelector(CONTENT_LINKS) || textOf(el).length > 300) { ok = false; break; }
          }
        } catch (_) { ok = false; }
        if (!ok) changed = true;
        return ok;
      });
      for (const el of learnReady ? document.querySelectorAll(`[${AD_ATTR}]`) : []) {
        if (el.parentElement?.closest(`[${AD_ATTR}]`)) continue; // solo el bloque más exterior
        const { solo, todos } = selectorsFor(el);
        const sel = [todos && todos.sel, solo].find((x) => {
          if (!x || /:nth-of-type/.test(x) || aprendidos.includes(x) || ocultos.includes(x)) return false;
          try { return [...document.querySelectorAll(x)].every(isAdOrInside); } catch (_) { return false; }
        });
        if (sel) { aprendidos.push(sel); changed = true; }
      }
      if (aprendidos.length > 60) { aprendidos = aprendidos.slice(-60); changed = true; }
      if (changed) { store.set('aprendidos', aprendidos); buildUserStyle(); }
    }

    let adTimer = 0;
    function scheduleAdScan(delay = 400) {
      if (!CFG.quitarAnuncios || !ready) return;
      clearTimeout(adTimer);
      adTimer = setTimeout(scanAds, delay);
    }

    function scanAds() {
      clearTimeout(adTimer);
      adTimer = 0;
      if (!CFG.quitarAnuncios || !document.body) return;
      // Contenedores recogidos que ahora tienen contenido real (carga diferida): se vuelven a mostrar
      for (const el of document.querySelectorAll(`[${AD_ATTR}="c"]`)) collapsed.set(el, AD_ATTR);
      revalidateCollapsed();
      if (AD_JOINED) for (const el of document.querySelectorAll(AD_JOINED)) collapseUp(el);
      for (const a of document.querySelectorAll(SPONSOR_LINKS)) hideAd(adBoxFromLink(a));
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const hits = [];
      while (w.nextNode()) if (AD_TRIGGER.test(w.currentNode.data)) hits.push(w.currentNode);
      for (const n of hits) if (!n.parentElement?.closest(`[${AD_ATTR}]`)) hideAd(adBoxFromText(n));
      for (const el of document.body.querySelectorAll(LABEL_TAGS)) {
        if (el.childElementCount || el.hasAttribute(AD_ATTR)) continue;
        const t = el.textContent.trim();
        if (!t || t.length > 24 || !LABEL_RE.test(t) || el.closest('a')) continue;
        hideAd(adBoxFromLabel(el) || el);
      }
      learnAds();
    }

    /* ───────────── Anuncios: selector manual ───────────── */
    const stableId = (id) => /^[A-Za-z][\w-]*$/.test(id) && !/\d{4,}/.test(id) && id.length < 40;
    const stableClass = (c) => /^[A-Za-z_-][\w-]*$/.test(c) && !/\d{3,}/.test(c) && c.length < 40 &&
      !/^(css|sc|jsx|svelte|emotion)-/.test(c);

    function part(el) {
      if (el.id && stableId(el.id)) return `#${CSS.escape(el.id)}`;
      const tag = el.tagName.toLowerCase();
      const cls = [...el.classList].filter(stableClass).slice(0, 3).map((c) => `.${CSS.escape(c)}`).join('');
      if (cls) return tag + cls;
      let i = 1;
      for (let x = el.previousElementSibling; x; x = x.previousElementSibling) if (x.tagName === el.tagName) i++;
      return `${tag}:nth-of-type(${i})`;
    }
    const count = (sel) => { try { return document.querySelectorAll(sel).length; } catch (_) { return Infinity; } };

    // Devuelve { solo: selector único para ese elemento, todos: selector de los iguales (si los hay) }
    function selectorsFor(el) {
      const parts = [];
      let solo = null;
      let shortest = null;
      for (let cur = el, lvl = 0; cur && cur !== document.body && cur !== root && lvl < 6; cur = cur.parentElement, lvl++) {
        parts.unshift(part(cur));
        const sel = parts.join(' > ');
        const n = count(sel);
        if (!shortest) shortest = { sel, n };
        if (n === 1) { solo = sel; break; }
        if (parts[0].startsWith('#')) break;
      }
      if (!solo) solo = parts.join(' > ');
      const todos = shortest && shortest.n > 1 && shortest.n <= 30 && !/:nth-of-type/.test(shortest.sel) ? shortest : null;
      return { solo, todos };
    }

    const PICKER_CSS = `
      :host { all: initial; }
      .hl { position: fixed; pointer-events: none; box-sizing: border-box; border: 2px solid #e3b552;
            background: rgba(227, 181, 82, .14); border-radius: 3px; }
      .hl.otro { border-style: dashed; background: rgba(227, 181, 82, .07); }
      .bar { position: fixed; left: 8px; right: 8px; bottom: calc(8px + env(safe-area-inset-bottom, 0px));
             pointer-events: auto; background: linear-gradient(180deg, #14110a, #0a0a0a 60%); color: #f2f2f2;
             border: 1px solid rgba(212, 166, 64, .35); border-radius: 16px; padding: 14px;
             font: 15px/1.35 system-ui, -apple-system, Roboto, sans-serif;
             box-shadow: 0 10px 30px rgba(0, 0, 0, .7), inset 0 1px 0 rgba(241, 207, 114, .12); }
      .info { margin: 0 0 10px; }
      .info code { display: block; margin-top: 4px; color: #8e8e8e; font: 12px/1.3 ui-monospace, monospace; word-break: break-all; }
      .btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      button { font: inherit; min-height: 44px; border-radius: 10px; border: 1px solid rgba(212, 166, 64, .28); background: #151309;
               color: #eadcb8; padding: 0 10px; -webkit-tap-highlight-color: transparent; }
      button:active { background: #221d0e; }
      button.wide { grid-column: 1 / -1; }
      button.pri { background: linear-gradient(135deg, #f6e27a, #d4a640 55%, #b5832a); border-color: transparent;
                   color: #1f1500; font-weight: 700; }
      button:disabled { opacity: .35; }
      [hidden] { display: none !important; }
    `;

    // Copia el HTML de un elemento (sin las marcas del script) para poder ajustar el script a la web real
    function cleanHTML(el) {
      const c = el.cloneNode(true);
      for (const x of [c, ...c.querySelectorAll('*')]) {
        for (const a of [...x.attributes]) if (/^data-(oled|fc-)/.test(a.name)) x.removeAttribute(a.name);
        if (x.style) {
          for (const prop of [...x.style]) if (prop.startsWith('--oled-')) x.style.removeProperty(prop);
          if (!x.getAttribute('style')) x.removeAttribute('style');
        }
      }
      const h = c.outerHTML.replace(/\s{2,}/g, ' ');
      return h.length > 6000 ? `${h.slice(0, 6000)}…` : h;
    }

    let pickerHost = null;
    function openPicker(modo = 'quitar') {
      const copiar = modo === 'copiar';
      if (pickerHost || !document.body) return;
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
      host.setAttribute(UI_ATTR, 'picker');
      const ui = host.attachShadow({ mode: 'closed' });
      ui.innerHTML = `<style>${PICKER_CSS}</style><div class="marks"></div>
        <div class="bar" role="dialog" aria-label="Quitar elemento">
          <p class="info">${copiar ? 'Toca el elemento cuyo código quieras copiar.' : 'Toca el anuncio o lo que quieras quitar.'}</p>
          <div class="btns">
            <button data-a="mas" disabled>Más grande</button>
            <button data-a="menos" disabled>Más pequeño</button>
            <button data-a="modo" class="wide" hidden></button>
            <button data-a="salir">Cancelar</button>
            <button data-a="quitar" class="pri" disabled>${copiar ? 'Copiar código' : 'Quitar'}</button>
          </div>
        </div>`;
      const $ = (q) => ui.querySelector(q);
      const marks = $('.marks');
      let cur = null;
      let hist = [];
      let sels = null;
      let todos = false;
      const selActual = () => (todos && sels.todos ? sels.todos.sel : sels.solo);

      const draw = () => {
        marks.textContent = '';
        if (!cur) return;
        const els = todos && sels.todos ? [...document.querySelectorAll(sels.todos.sel)] : [cur];
        for (const el of els.slice(0, 30)) {
          const r = el.getBoundingClientRect();
          if (!r.width && !r.height) continue;
          const d = document.createElement('div');
          d.className = el === cur ? 'hl' : 'hl otro';
          Object.assign(d.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
          marks.append(d);
        }
      };
      const render = () => {
        sels = selectorsFor(cur);
        const n = todos && sels.todos ? sels.todos.n : 1;
        const info = $('.info');
        info.textContent = copiar ? 'Se copiará lo marcado en rojo. Para una fila o un mensaje entero, pulsa Más grande hasta cubrirlo.'
          : n > 1 ? `Se quitarán ${n} elementos iguales.` : 'Se quitará lo marcado en rojo. Si no cubre todo el anuncio, pulsa Más grande.';
        const code = document.createElement('code');
        code.textContent = selActual();
        info.append(code);
        $('[data-a="mas"]').disabled = !cur.parentElement || cur.parentElement === document.body;
        $('[data-a="menos"]').disabled = !hist.length;
        $('[data-a="quitar"]').disabled = false;
        const modo = $('[data-a="modo"]');
        modo.hidden = copiar || !sels.todos;
        if (sels.todos) modo.textContent = todos ? 'Quitar solo este' : `Quitar todos los iguales (${sels.todos.n})`;
        draw();
      };
      const pick = (el) => {
        if (!el || el === root || el === document.body || el === host) return;
        cur = el;
        hist = [];
        todos = false;
        render();
      };

      const inUI = (e) => e.composedPath().includes(host);
      const onClick = (e) => {
        if (inUI(e)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        pick(e.target instanceof Element ? e.target : e.target.parentElement);
      };
      const swallow = (e) => { if (!inUI(e)) e.stopImmediatePropagation(); };
      const onKey = (e) => { if (e.key === 'Escape') close(); };
      let rafId = 0;
      const onMove = () => { if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; draw(); }); };
      const SWALLOW = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend'];

      function close() {
        removeEventListener('click', onClick, true);
        for (const t of SWALLOW) removeEventListener(t, swallow, true);
        removeEventListener('keydown', onKey, true);
        removeEventListener('scroll', onMove, true);
        removeEventListener('resize', onMove);
        host.remove();
        pickerHost = null;
      }

      $('.btns').addEventListener('click', (e) => {
        const a = e.target.closest('button')?.dataset.a;
        if (a === 'salir') close();
        else if (a === 'mas' && cur.parentElement && cur.parentElement !== document.body) { hist.push(cur); cur = cur.parentElement; todos = false; render(); }
        else if (a === 'menos' && hist.length) { cur = hist.pop(); todos = false; render(); }
        else if (a === 'modo') { todos = !todos; render(); }
        else if (a === 'quitar' && cur && copiar) {
          const html = cleanHTML(cur);
          marks.textContent = '';
          $('.btns').hidden = true;
          const done = (ok) => {
            const info = $('.info');
            info.textContent = ok ? 'Copiado. Pégalo en el chat.' : 'No se pudo copiar solo: mantén pulsado el texto, selecciónalo todo y cópialo.';
            if (!ok) {
              const ta = document.createElement('textarea');
              ta.value = html;
              ta.readOnly = true;
              ta.style.cssText = 'width:100%;height:30vh;margin-top:8px;background:#141414;color:#ddd;border:1px solid #333;border-radius:8px;font:12px monospace;';
              info.append(ta);
              const cerrar = document.createElement('button');
              cerrar.textContent = 'Cerrar';
              cerrar.className = 'wide';
              cerrar.style.cssText = 'width:100%;margin-top:8px;';
              cerrar.addEventListener('click', close);
              info.append(cerrar);
            } else setTimeout(close, 1800);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(html).then(() => done(true), () => done(false));
          else done(false);
        }
        else if (a === 'quitar' && cur) {
          const sel = selActual();
          if (!ocultos.includes(sel)) ocultos.push(sel);
          store.set('ocultos', ocultos);
          buildUserStyle();
          marks.textContent = '';
          $('.info').textContent = 'Quitado. Para deshacerlo: menú de Tampermonkey → Deshacer lo último quitado.';
          $('.btns').hidden = true;
          setTimeout(close, 2600);
        }
      });

      addEventListener('click', onClick, true);
      for (const t of SWALLOW) addEventListener(t, swallow, true);
      addEventListener('keydown', onKey, true);
      addEventListener('scroll', onMove, { capture: true, passive: true });
      addEventListener('resize', onMove);
      root.append(host);
      pickerHost = host;
    }

    function deshacerUltimo() {
      if (!ocultos.length) { alert('No hay nada quitado a mano.'); return; }
      ocultos.pop();
      store.set('ocultos', ocultos);
      buildUserStyle();
    }
    function restaurarTodo() {
      if (!ocultos.length && !aprendidos.length) { alert('No hay nada quitado.'); return; }
      if (!confirm('¿Volver a mostrar todo lo quitado a mano y olvidar los anuncios aprendidos?')) return;
      ocultos = [];
      aprendidos = [];
      store.set('ocultos', ocultos);
      store.set('aprendidos', aprendidos);
      buildUserStyle();
    }
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('🎯 Quitar un elemento…', openPicker);
      GM_registerMenuCommand('↩️ Deshacer lo último quitado', deshacerUltimo);
      GM_registerMenuCommand('♻️ Restaurar todo lo quitado', restaurarTodo);
      GM_registerMenuCommand('📋 Copiar código de un elemento', () => openPicker('copiar'));
    }

    /* ───────────── Lista negra ─────────────
     * Se guía por lo que ForoCoches muestra en pantalla: el aviso de mensaje ignorado,
     * "Cita de X", la fecha de cada mensaje ("Hoy 22:10") y el "@usuario" de cada tema. */
    const norm = (x) => x.replace(/\s+/g, ' ').trim().toLowerCase();
    let listaNegra = store.get('listaNegra', []);
    if (!Array.isArray(listaNegra)) listaNegra = [];
    let lnSet = new Set(listaNegra.map(norm));
    const IGNORED_RE = /oculto porque\s+(.+?)\s+est[aá] en tu lista de ignorados/i;
    const IGNORED_HINT = /lista de ignorados/i;
    const DATE_RE = /^(hoy|ayer|\d{1,2}[-/ ][a-záéíóú]{3,5}\.?[-/ ]\d{2,4})[\s,]*\d{1,2}:\d{2}$/i;
    const THREAD_ID = /[?&]t=(\d+)/;
    const isWordChar = (ch) => !!ch && /[\p{L}\p{N}_]/u.test(ch);

    // ¿El texto empieza por prefijo + un nombre de la lista? Devuelve ese nombre.
    function nameAfter(text, prefix, exact) {
      const t = norm(text);
      for (const n of lnSet) {
        const pre = prefix + n;
        if (t === pre) return n;
        if (!exact && t.startsWith(pre) && !isWordChar(t[pre.length])) return n;
      }
      return null;
    }
    const mentionsName = (data) => {
      if (!lnSet.size) return false;
      const t = norm(data);
      for (const n of lnSet) if (t.includes(n)) return true;
      return false;
    };

    // Fechas de mensaje ("Hoy 22:10", "Ayer 9:05", "06-oct-2025 21:21") dentro de scope
    function datesIn(scope) {
      const out = new Set();
      const w = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        const n = w.currentNode;
        if (!/\d:\d\d/.test(n.data)) continue;
        for (let el = n.parentElement, i = 0; i < 3 && el; i++, el = el.parentElement) {
          const t = textOf(el);
          if (t.length > 30) break;
          if (DATE_RE.test(t)) { out.add(el); break; }
          if (el === scope) break;
        }
      }
      return out;
    }
    function hasCitar(scope) {
      const w = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) if (/^citar$/i.test(w.currentNode.data.trim())) return true;
      return false;
    }

    // Caja completa de un mensaje: el menor bloque que contiene una sola fecha de cabecera,
    // ampliado si la barra de acciones (Citar…) va en un contenedor aparte.
    function postUnit(from) {
      let unit = null;
      for (let el = from, i = 0; el && el !== document.body && el !== root && i < 14; el = el.parentElement, i++) {
        const n = datesIn(el).size;
        if (n > 1) return null;
        if (n === 1) { unit = el; break; }
      }
      if (!unit) return null;
      for (let p = unit.parentElement, i = 0; p && p !== document.body && p !== root && i < 3; p = p.parentElement, i++) {
        if (parsing() && !isClosed(p)) break;
        if (datesIn(p).size !== 1) break;
        if (textOf(p).replace(textOf(unit), '').replace(/citar/gi, '').trim().length > 3) break;
        unit = p;
      }
      return unit;
    }

    // Fila de un tema en los listados: el menor bloque con un único enlace a un hilo
    // (contando el propio bloque, que a menudo es el enlace que envuelve toda la fila)
    const THREAD_LINK = 'a[href*="showthread"]';
    function threadIds(el) {
      const ids = new Set();
      const links = [...el.querySelectorAll(THREAD_LINK)];
      if (el.matches(THREAD_LINK)) links.push(el);
      for (const a of links) {
        const m = THREAD_ID.exec(a.getAttribute('href') || '');
        if (m) ids.add(m[1]);
      }
      return ids;
    }
    function rowUnit(from) {
      for (let el = from.parentElement, i = 0; el && el !== document.body && el !== root && i < 8; el = el.parentElement, i++) {
        if (textOf(el).length > 400) return null;
        const n = threadIds(el).size;
        if (n === 1) return el;
        if (n > 1) return null;
      }
      return null;
    }

    // Textos de la cabecera de un mensaje (nombre del autor, etc.), sin la fecha
    function headerNames(dateEl) {
      const dt = textOf(dateEl);
      for (let h = dateEl.parentElement, i = 0; h && h !== document.body && i < 4; h = h.parentElement, i++) {
        const t = textOf(h);
        if (t.length <= dt.length + 1) continue;
        if (t.length > 120) return [];
        const names = [t.replace(dt, '').trim()];
        const w = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
        while (w.nextNode()) {
          if (dateEl.contains(w.currentNode)) continue;
          const x = w.currentNode.data.trim();
          if (x) names.push(x);
        }
        return names;
      }
      return [];
    }

    function hideLN(unit, name) {
      if (!unit || unit === document.body || unit === root || unit.hasAttribute(LN_ATTR) || unit.closest(`[${UI_ATTR}]`)) return;
      unit.setAttribute(LN_ATTR, name);
      collapseUp(unit, LN_ATTR);
    }

    // Texto con un espacio entre nodos distintos ("Cita de <b>X</b><div>…" → "Cita de X …")
    function textSep(el) {
      const parts = [];
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.parentElement && SKIP_TEXT.has(n.parentElement.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      while (w.nextNode()) parts.push(w.currentNode.data);
      return parts.join(' ');
    }

    const ignoredBoxes = new Set(); // avisos de ignorado que recibirán el botón
    function checkText(n) {
      const p = n.parentElement;
      if (!p || p.closest(`[${LN_ATTR}], [${UI_ATTR}]`)) return;
      if (IGNORED_HINT.test(n.data)) {
        for (let el = p, i = 0; i < 4 && el && el !== document.body; i++, el = el.parentElement) {
          const t = textOf(el);
          if (t.length > 400) break;
          const m = IGNORED_RE.exec(t);
          if (!m) continue;
          if (lnSet.has(norm(m[1]))) hideLN(postUnit(el), norm(m[1]));
          else ignoredBoxes.add(el);
          return;
        }
      }
      if (!mentionsName(n.data)) return;
      for (let el = p, i = 0; i < 3 && el && el !== document.body; i++, el = el.parentElement) {
        const t = textSep(el);
        let nm = nameAfter(t, 'cita de ');
        if (nm) { hideLN(postUnit(el), nm); return; }      // alguien lo cita: fuera el mensaje entero
        nm = nameAfter(t, '@', true) || nameAfter(t, '@ ', true) || (i === 0 && nameAfter(t, '', true));
        if (nm) { const row = rowUnit(el); if (row) { hideLN(row, nm); return; } } // tema suyo en un listado
        if (t.length > 80) break;
      }
    }

    // Revisión inmediata de lo que va llegando (antes de que se pinte)
    function lnAdded(n) {
      if (n.nodeType === 3) {
        if (IGNORED_HINT.test(n.data) || mentionsName(n.data)) checkText(n);
        return;
      }
      if (n.nodeType !== 1 || !n.firstChild) return;
      const all = n.textContent;
      if (!IGNORED_HINT.test(all) && !mentionsName(all)) return;
      const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
      const hits = [];
      while (w.nextNode()) if (IGNORED_HINT.test(w.currentNode.data) || mentionsName(w.currentNode.data)) hits.push(w.currentNode);
      for (const h of hits) checkText(h);
    }

    // Botón "Añadir a la lista negra" en los avisos de mensaje ignorado
    const BTN_ATTR = 'data-fc-ln-btn';
    function addButtons() {
      for (const box of [...ignoredBoxes]) {
        ignoredBoxes.delete(box);
        if (!box.isConnected || box.closest(`[${LN_ATTR}]`)) continue;
        const m = IGNORED_RE.exec(textOf(box));
        if (!m) continue;
        const name = m[1].trim();
        const unit = postUnit(box) || box;
        if (unit.querySelector(`[${BTN_ATTR}]`)) continue;
        let after = null;
        const w = document.createTreeWalker(unit, NodeFilter.SHOW_TEXT);
        while (w.nextNode()) if (/^ver mensaje$/i.test(w.currentNode.data.trim())) { after = w.currentNode.parentElement; break; }
        const wrap = document.createElement('div');
        wrap.setAttribute(BTN_ATTR, '');
        wrap.style.marginTop = '.7em';
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = 'Añadir a la lista negra';
        a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); addToBlacklist(name, true); });
        wrap.append(a);
        if (after) after.after(wrap); else box.append(wrap);
      }
    }

    let lnTimer = 0;
    function scheduleLnScan(delay = 400) {
      if (!ready) return;
      clearTimeout(lnTimer);
      lnTimer = setTimeout(scanBlacklist, delay);
    }
    function scanBlacklist() {
      clearTimeout(lnTimer);
      lnTimer = 0;
      if (!document.body) return;
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const hits = [];
      while (w.nextNode()) if (IGNORED_HINT.test(w.currentNode.data) || mentionsName(w.currentNode.data)) hits.push(w.currentNode);
      for (const n of hits) checkText(n);
      // Mensajes normales (sin ignorar) de usuarios de la lista: por el nombre de la cabecera
      if (lnSet.size && !parsing()) {
        for (const d of datesIn(document.body)) {
          if (d.closest(`[${LN_ATTR}]`)) continue;
          const nm = headerNames(d).map(norm).find((x) => lnSet.has(x));
          if (!nm) continue;
          for (let el = d.parentElement, i = 0; el && el !== document.body && i < 10; el = el.parentElement, i++) {
            if (datesIn(el).size > 1) break;
            if (hasCitar(el)) { hideLN(postUnit(el), nm); break; }
          }
        }
      }
      addButtons();
    }

    function saveLN() {
      store.set('listaNegra', listaNegra);
      lnSet = new Set(listaNegra.map(norm));
      for (const el of document.querySelectorAll(`[${LN_ATTR}]`)) el.removeAttribute(LN_ATTR);
      revalidateCollapsed();
      scanBlacklist();
    }
    function addToBlacklist(name, preguntar) {
      const n = name.replace(/\s+/g, ' ').trim();
      if (!n) return;
      if (preguntar && !confirm(`¿Añadir a ${n} a la lista negra?\n\nDejarás de ver sus temas, sus mensajes y los mensajes que lo citen. Se deshace en el menú de Tampermonkey → Lista negra.`)) return;
      if (lnSet.has(norm(n))) return;
      listaNegra.push(n);
      saveLN();
    }

    // Panel para ver y editar la lista
    const LN_CSS = `
      .back { position: fixed; inset: 0; background: rgba(0, 0, 0, .65); }
      .title { margin: 0 0 4px; font-weight: 700; font-size: 17px; color: #f1cf72; letter-spacing: .02em; }
      .hint { margin: 0 0 12px; color: #9a9a9a; font-size: 13px; }
      ul { list-style: none; margin: 0 0 12px; padding: 0; max-height: 42vh; overflow: auto; }
      li { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0; border-bottom: 1px solid rgba(212, 166, 64, .12); }
      li span { word-break: break-all; }
      li button { min-height: 38px; }
      .empty { color: #8e8e8e; border: 0; }
      .add { display: flex; gap: 8px; margin-bottom: 8px; }
      input { flex: 1; min-width: 0; font: inherit; color: inherit; background: #100e08; border: 1px solid rgba(212, 166, 64, .3);
              border-radius: 10px; padding: 0 12px; min-height: 44px; }
    `;
    function openListPanel() {
      if (document.querySelector(`[${UI_ATTR}="ln"]`) || !document.body) return;
      const host = document.createElement('div');
      host.setAttribute(UI_ATTR, 'ln');
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
      const ui = host.attachShadow({ mode: 'closed' });
      ui.innerHTML = `<style>${PICKER_CSS}${LN_CSS}</style><div class="back"></div>
        <div class="bar" role="dialog" aria-label="Lista negra">
          <p class="title">Lista negra</p>
          <p class="hint">No verás sus temas, sus mensajes ni los mensajes que los citen.</p>
          <ul></ul>
          <div class="add"><input type="text" placeholder="Nombre de usuario" autocomplete="off" autocapitalize="off" spellcheck="false"><button data-a="add">Añadir</button></div>
          <div class="btns"><button data-a="close" class="wide">Cerrar</button></div>
        </div>`;
      const list = ui.querySelector('ul');
      const input = ui.querySelector('input');
      const render = () => {
        list.textContent = '';
        if (!listaNegra.length) {
          const li = document.createElement('li');
          li.className = 'empty';
          li.textContent = 'Vacía. Añade usuarios desde sus mensajes ignorados o escribiendo su nombre.';
          list.append(li);
        }
        listaNegra.forEach((name, i) => {
          const li = document.createElement('li');
          const sp = document.createElement('span');
          sp.textContent = name;
          const b = document.createElement('button');
          b.textContent = 'Quitar';
          b.dataset.i = String(i);
          li.append(sp, b);
          list.append(li);
        });
      };
      const close = () => host.remove();
      const add = () => { addToBlacklist(input.value, false); input.value = ''; render(); };
      ui.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (e.target.classList.contains('back')) close();
        if (!b) return;
        if (b.dataset.a === 'close') close();
        else if (b.dataset.a === 'add') add();
        else if (b.dataset.i) { listaNegra.splice(Number(b.dataset.i), 1); saveLN(); render(); }
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      render();
      root.append(host);
    }
    if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('🚫 Lista negra', openListPanel);

    /* ───────────── Hilos: ocultar y favoritos ───────────── */
    const isThreadPage = /showthread\.php/i.test(location.pathname);
    const isListPage = /forumdisplay\.php/i.test(location.pathname); // listado de temas de un subforo: el único sitio con favoritos arriba
    const listOf = (k) => { const v = store.get(k, []); return Array.isArray(v) ? v.filter((x) => x && x.id) : []; };
    let favoritos = listOf('favoritos');       // [{ id, titulo }]
    let hilosOcultos = listOf('hilosOcultos'); // [{ id, titulo }]
    let favSet = new Set(favoritos.map((f) => String(f.id)));
    let hidSet = new Set(hilosOcultos.map((f) => String(f.id)));
    const linkId = (a) => (THREAD_ID.exec(a.getAttribute('href') || '') || [])[1];

    // Fila completa de un tema en un listado: el mayor bloque con un único hilo enlazado
    function rowOfLink(a) {
      let row = a;
      for (let p = a.parentElement, i = 0; p && p !== document.body && p !== root && i < 8; p = p.parentElement, i++) {
        if (parsing() && !isClosed(p)) break;
        if (threadIds(p).size !== 1 || textOf(p).length > 400) break;
        row = p;
      }
      return row;
    }

    // Una fila de verdad está en un listado: tiene al menos 4 hermanas que enlazan cada una a un único hilo.
    // Así no se cuelan bloques sueltos con un enlace a un hilo (p. ej. el menú de usuario).
    function isListRow(row) {
      const par = row.parentElement;
      if (!par || par === document.body) return false;
      let n = 0;
      for (const c of par.children) if (threadIds(c).size === 1 && ++n >= 4) return true;
      return false;
    }

    // En los listados: los ocultos desaparecen y los favoritos se quitan de su sitio (van arriba)
    const pendingRows = new Set();
    function checkThreadLink(a) {
      if (isThreadPage || a.closest(`[${UI_ATTR}]`)) return;
      const id = linkId(a);
      const fav = isListPage && favSet.has(id);
      if (!id || (!hidSet.has(id) && !fav)) return;
      const row = rowOfLink(a);
      if (!parsing() && !isListRow(row)) {
        // Marcado mientras cargaba la página, pero no es una fila del listado: se deja visible
        for (let e = a; e && e !== row.parentElement; e = e.parentElement) e.removeAttribute(HID_ATTR);
        return;
      }
      if (!row.hasAttribute(HID_ATTR)) row.setAttribute(HID_ATTR, hidSet.has(id) ? 'oculto' : 'fav');
      if (parsing()) pendingRows.add(a);
    }

    const STAR = 'M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z';
    const EYE_OFF = 'M2.1 3.5l1.4-1.4 18.4 18.4-1.4 1.4-3.2-3.2A11 11 0 0 1 12 20C6.5 20 2.6 16.2 1 12c.8-2 2.1-3.8 3.8-5.2zM12 4c5.5 0 9.4 3.8 11 8a12.6 12.6 0 0 1-3.4 4.8l-3.1-3.1A4.5 4.5 0 0 0 10.3 7.5L8 5.2A11.6 11.6 0 0 1 12 4zm-3.5 6.9a3.5 3.5 0 0 0 4.6 4.6z';
    const CROWN = 'M3 18.5h18l-1.6-9.7-4.6 3.8L12 5l-2.8 7.6-4.6-3.8z';
    function svgIcon(d) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      svg.append(path);
      return svg;
    }

    // Bloque "★ Favoritos" anclado al principio del listado
    const PINS_CSS = `
      :host { display: block; }
      .box { padding: 2px 0 6px; border-bottom: 1px solid rgba(212, 166, 64, .16); }
      .hd { display: flex; align-items: center; gap: 5px; padding: 6px 16px 4px; color: #e0b450;
            font: 700 10px/1 system-ui, -apple-system, Roboto, sans-serif; letter-spacing: .09em; text-transform: uppercase; }
      .hd svg { width: 11px; height: 11px; fill: currentColor; }
      a { display: flex; align-items: baseline; gap: 10px; padding: 5px 16px; color: inherit; text-decoration: none;
          font-size: 14px; line-height: 1.3; -webkit-tap-highlight-color: transparent; }
      a:active { opacity: .7; }
      .t { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 600; color: #fff; }
      .m { flex: none; color: #8c8c8c; font-size: 12px; white-space: nowrap; }
    `;
    let pinsHost = null;
    let pinsUI = null;
    function renderPinned() {
      if (!isListPage || parsing()) return;
      if (!favoritos.length) { if (pinsHost) pinsHost.remove(); pinsHost = null; return; }
      const rows = [];
      const seen = new Set();
      for (const a of document.querySelectorAll(THREAD_LINK)) {
        if (a.closest(`[${UI_ATTR}]`)) continue;
        const r = rowOfLink(a);
        if (!seen.has(r)) { seen.add(r); rows.push(r); }
      }
      if (rows.length < 3) return; // esta página no es un listado de temas
      const byParent = new Map();
      for (const r of rows) byParent.set(r.parentElement, (byParent.get(r.parentElement) || 0) + 1);
      let list = null;
      let best = 0;
      for (const [par, k] of byParent) if (k > best) { list = par; best = k; }
      const listRows = rows.filter((r) => r.parentElement === list);
      const first = listRows[0];
      if (!pinsHost || !pinsHost.isConnected) {
        pinsHost = document.createElement(/^(UL|OL)$/.test(list.tagName) ? 'li' : 'div');
        pinsHost.setAttribute(UI_ATTR, 'favoritos');
        pinsHost.style.cssText = 'display:block;list-style:none;margin:0;padding:0;';
        pinsUI = pinsHost.attachShadow({ mode: 'closed' });
      }
      if (pinsHost.parentElement !== list || pinsHost.nextSibling !== first) list.insertBefore(pinsHost, first);
      // Fondo opaco igual al de las filas: si no, se transparenta el fondo decorativo del listado
      let fondo = root.hasAttribute(ON) ? '#000' : '';
      for (let e = first; e; e = e.parentElement) {
        const c = parseColor(getComputedStyle(e).backgroundColor);
        if (c && c[3] >= 0.5) { fondo = `rgb(${c[0]}, ${c[1]}, ${c[2]})`; break; }
      }
      pinsHost.style.setProperty('background', fondo || 'transparent', 'important');
      const box = document.createElement('div');
      box.className = 'box';
      const hd = document.createElement('div');
      hd.className = 'hd';
      hd.append(svgIcon(STAR), 'Favoritos');
      box.append(hd);
      for (const f of favoritos) {
        const id = String(f.id);
        const row = listRows.find((r) => threadIds(r).has(id));
        const a = document.createElement('a');
        const t = document.createElement('div');
        t.className = 't';
        const m = document.createElement('div');
        m.className = 'm';
        let titulo = f.titulo || `Hilo ${id}`;
        if (row) {
          // Datos actuales de la fila: el texto más largo es el título; el resto (respuestas, autor, hora) va debajo
          const textos = [];
          const w = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
          while (w.nextNode()) { const x = w.currentNode.data.replace(/\s+/g, ' ').trim(); if (x) textos.push(x); }
          const largo = textos.reduce((acc, x) => (x.length > acc.length ? x : acc), '');
          if (largo.length >= 4) titulo = largo;
          // Solo respuestas y hora: lo justo para una línea
          const resp = textos.find((x) => x !== largo && /^\d[\d.,]*$/.test(x));
          const hora = [...textos].reverse().find((x) => /^\d{1,2}:\d{2}$/.test(x));
          m.textContent = [resp, hora].filter(Boolean).join(' · ');
          const link = row.matches(THREAD_LINK) ? row : row.querySelector(THREAD_LINK);
          a.href = link ? link.href : `/foro/showthread.php?t=${id}`;
        } else {
          a.href = `/foro/showthread.php?t=${id}`;
        }
        t.textContent = titulo;
        a.append(t, m);
        box.append(a);
      }
      pinsUI.innerHTML = `<style>${PINS_CSS}</style>`;
      pinsUI.append(box);
    }

    // Botones dentro de un hilo
    const pageTitle = () => (document.title || '').replace(/\s*[-–|]\s*ForoCoches.*$/i, '').replace(/\s*[-–|]\s*P[aá]gina\s*\d+.*$/i, '').trim();
    function pageThreadId() {
      const q = new URLSearchParams(location.search).get('t');
      if (q && /^\d+$/.test(q)) return q;
      const can = document.querySelector('link[rel="canonical"]');
      const c = can && THREAD_ID.exec(can.getAttribute('href') || '');
      if (c) return c[1];
      const og = document.querySelector('meta[property="og:url"]');
      const o = og && THREAD_ID.exec(og.getAttribute('content') || '');
      if (o) return o[1];
      const form = document.querySelector('form[action*="threadid="]');
      const f = form && /threadid=(\d+)/.exec(form.getAttribute('action'));
      if (f) return f[1];
      const count = new Map();
      for (const a of document.querySelectorAll(THREAD_LINK)) {
        if (a.closest('nav, header, .menu-item, [class*="menu" i]')) continue;
        const id = linkId(a);
        if (id) count.set(id, (count.get(id) || 0) + 1);
      }
      let best = null;
      let n = 0;
      for (const [id, k] of count) if (k > n) { best = id; n = k; }
      return best;
    }
    function findTitleEl() {
      const want = norm(pageTitle());
      if (want) {
        for (const el of document.querySelectorAll('h1, h2, h3, [class*="title" i], [class*="titulo" i]')) {
          if (!el.closest(`[${UI_ATTR}]`) && norm(textOf(el)) === want) return el;
        }
      }
      // Si no: el texto más grande antes del primer mensaje
      const first = [...datesIn(document.body)][0];
      if (!first) return null;
      let best = null;
      let size = 17;
      let checked = 0;
      for (const el of document.body.querySelectorAll('h1, h2, h3, div, p, span, strong, b')) {
        if (first.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) break;
        if (el.childElementCount > 2 || el.closest(`[${UI_ATTR}]`) || inPanel(el)) continue;
        const t = textOf(el);
        if (t.length < 8 || t.length > 200) continue;
        if (++checked > 400) break;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs > size) { best = el; size = fs; }
      }
      return best;
    }
    const BAR_CSS = `
      :host { display: block; }
      .bar { display: flex; justify-content: center; flex-wrap: wrap; gap: 10px; margin: 12px 16px 16px; }
      button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 8px; min-height: 40px;
               padding: 0 16px; border-radius: 999px; border: 1px solid rgba(212, 166, 64, .4); color: #eadcb8; cursor: pointer;
               font: 600 14px/1 system-ui, -apple-system, Roboto, sans-serif; -webkit-tap-highlight-color: transparent;
               transition: transform .12s, border-color .2s, color .2s; }
      button:active { transform: scale(.96); }
      button svg { width: 17px; height: 17px; fill: currentColor; }
      button.fav.on { background: linear-gradient(135deg, #f6e27a, #d4a640 55%, #b5832a); border-color: transparent; color: #1f1500;
                      box-shadow: 0 2px 14px rgba(212, 166, 64, .35); }
      button.hid.on { border-color: rgba(255, 90, 74, .7); color: #ff8a7a; }
    `;
    let barHost = null;
    function tryInsertBar() {
      if (!isThreadPage || (barHost && barHost.isConnected) || !document.body) return;
      const id = pageThreadId();
      let titleEl = id && findTitleEl();
      if (!titleEl) return;
      const titulo = textOf(titleEl) || pageTitle();
      // si el título va envuelto, los botones van debajo del envoltorio
      while (titleEl.parentElement && titleEl.parentElement !== document.body && norm(textOf(titleEl.parentElement)) === norm(titulo)) {
        titleEl = titleEl.parentElement;
      }
      barHost = document.createElement('div');
      barHost.setAttribute(UI_ATTR, 'hilo');
      const ui = barHost.attachShadow({ mode: 'closed' });
      ui.innerHTML = `<style>${BAR_CSS}</style><div class="bar"><button class="fav"></button><button class="hid"></button></div>`;
      const bFav = ui.querySelector('.fav');
      const bHid = ui.querySelector('.hid');
      const paint = () => {
        const fav = favSet.has(id);
        const hid = hidSet.has(id);
        bFav.className = `fav${fav ? ' on' : ''}`;
        bFav.replaceChildren(svgIcon(STAR), fav ? 'En favoritos' : 'Añadir a favoritos');
        bHid.className = `hid${hid ? ' on' : ''}`;
        bHid.replaceChildren(svgIcon(EYE_OFF), hid ? 'Oculto · deshacer' : 'Ocultar hilo');
      };
      bFav.addEventListener('click', () => toggleThread('fav', id, titulo));
      bHid.addEventListener('click', () => toggleThread('hid', id, titulo));
      barHost.repaint = paint;
      paint();
      titleEl.after(barHost);
    }

    function saveThreads() {
      store.set('favoritos', favoritos);
      store.set('hilosOcultos', hilosOcultos);
      favSet = new Set(favoritos.map((f) => String(f.id)));
      hidSet = new Set(hilosOcultos.map((f) => String(f.id)));
      for (const el of document.querySelectorAll(`[${HID_ATTR}]`)) el.removeAttribute(HID_ATTR);
      revalidateCollapsed();
      scanExtras();
      if (barHost && barHost.repaint) barHost.repaint();
    }
    // Un hilo está en favoritos o en ocultos, no en los dos
    function toggleThread(kind, id, titulo) {
      id = String(id);
      const isFav = kind === 'fav';
      const mine = isFav ? favoritos : hilosOcultos;
      const i = mine.findIndex((f) => String(f.id) === id);
      if (i >= 0) mine.splice(i, 1);
      else {
        mine.push({ id, titulo });
        if (isFav) hilosOcultos = hilosOcultos.filter((f) => String(f.id) !== id);
        else favoritos = favoritos.filter((f) => String(f.id) !== id);
      }
      saveThreads();
    }

    function openThreadsPanel() {
      if (document.querySelector(`[${UI_ATTR}="hilos"]`) || !document.body) return;
      const host = document.createElement('div');
      host.setAttribute(UI_ATTR, 'hilos');
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
      const ui = host.attachShadow({ mode: 'closed' });
      ui.innerHTML = `<style>${PICKER_CSS}${LN_CSS}
          .sec { margin: 4px 0 6px; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
          li a { color: inherit; text-decoration: none; }</style>
        <div class="back"></div>
        <div class="bar" role="dialog" aria-label="Hilos">
          <p class="title">Hilos</p>
          <p class="sec" style="color:#e0b450">Favoritos</p><ul class="fav"></ul>
          <p class="sec" style="color:#ff8a7a">Ocultos</p><ul class="hid"></ul>
          <div class="btns"><button data-a="close" class="wide">Cerrar</button></div>
        </div>`;
      const fill = (ul, items, kind, label) => {
        ul.textContent = '';
        if (!items.length) {
          const li = document.createElement('li');
          li.className = 'empty';
          li.textContent = kind === 'fav' ? 'Ninguno. Añádelos con el botón de dentro de cada hilo.' : 'Ninguno.';
          ul.append(li);
        }
        for (const f of items) {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = `/foro/showthread.php?t=${f.id}`;
          a.textContent = f.titulo || `Hilo ${f.id}`;
          const b = document.createElement('button');
          b.textContent = label;
          b.dataset.kind = kind;
          b.dataset.id = String(f.id);
          li.append(a, b);
          ul.append(li);
        }
      };
      const render = () => {
        fill(ui.querySelector('ul.fav'), favoritos, 'fav', 'Quitar');
        fill(ui.querySelector('ul.hid'), hilosOcultos, 'hid', 'Mostrar');
      };
      ui.addEventListener('click', (e) => {
        if (e.target.classList.contains('back')) { host.remove(); return; }
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.a === 'close') host.remove();
        else if (b.dataset.kind) { toggleThread(b.dataset.kind, b.dataset.id, ''); render(); }
      });
      render();
      root.append(host);
    }

    /* ───────────── Nick Premium en el panel lateral (solo lo ves tú) ─────────────
     * El panel se reconoce por su contenido: las estadísticas ("135 Posts", "0 Hilos") y el menú
     * ("Mi perfil", "Cerrar sesión"...). El nick es el texto que hay justo encima de las estadísticas. */
    const STAT_RE = /^([\d.,]+\s*)?posts?$/i;
    const MENU_RE = /^(mi perfil|cerrar sesi[oó]n|mensajes privados|menciones|suscripciones|ajustes)$/i;
    function inPanel(el) {
      for (let x = el; x && x !== document.body && x !== root; x = x.parentElement) {
        if (/^(ASIDE|NAV|DIALOG)$/.test(x.tagName) || /^(dialog|navigation|menu)$/.test(x.getAttribute('role') || '')) return true;
        const pos = getComputedStyle(x).position;
        if (pos === 'fixed' || pos === 'sticky') return true;
      }
      return false;
    }
    function hasTextMatching(el, re) {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) if (re.test(w.currentNode.data.trim())) return true;
      return false;
    }
    function findDrawerNick() {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const stats = [];
      while (w.nextNode()) if (STAT_RE.test(w.currentNode.data.trim())) stats.push(w.currentNode);
      for (const st of stats) {
        let panel = null;
        for (let el = st.parentElement, i = 0; el && el !== document.body && el !== root && i < 10; el = el.parentElement, i++) {
          if (hasTextMatching(el, MENU_RE)) { panel = el; break; }
        }
        if (!panel) continue;
        // el último texto antes de las estadísticas que no sea un número
        const tw = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
        let prev = null;
        while (tw.nextNode()) {
          const n = tw.currentNode;
          if (n === st) break;
          const t = n.data.trim();
          if (!t || SKIP_TEXT.has(n.parentElement && n.parentElement.tagName) || /^[\d.,]+$/.test(t)) continue;
          prev = n;
        }
        if (prev && prev.data.trim().length <= 40 && !prev.parentElement.closest(`[${UI_ATTR}]`)) return prev;
      }
      return null;
    }
    function premiumBadge() {
      const b = document.createElement('span');
      b.setAttribute(BADGE_ATTR, '');
      b.append(svgIcon(CROWN), 'Premium');
      return b;
    }
    function applyPremium() {
      if (!CFG.premium || !document.body || document.querySelector(`[${GOLD_ATTR}]`)) return;
      const n = findDrawerNick();
      if (!n) return;
      const span = document.createElement('span');
      span.setAttribute(GOLD_ATTR, '');
      n.replaceWith(span);
      span.append(n);
      span.after(premiumBadge());
    }

    /* ── Enganches comunes ── */
    function extrasAdded(n) {
      if (n.nodeType === 3) {
        const t = n.data.trim();
        if (CFG.premium && (STAT_RE.test(t) || MENU_RE.test(t))) applyPremium(); // el panel acaba de aparecer
        return;
      }
      if (n.nodeType !== 1) return;
      if (!isThreadPage && (hidSet.size || favSet.size)) {
        if (n.matches(THREAD_LINK)) checkThreadLink(n);
        if (n.firstElementChild) for (const a of n.querySelectorAll(THREAD_LINK)) checkThreadLink(a);
      }
      if (CFG.premium && n.firstChild && /cerrar sesi[oó]n|mi perfil/i.test(n.textContent)) applyPremium();
    }
    function extrasTick() {
      for (const a of pendingRows) {
        if (!a.isConnected) { pendingRows.delete(a); continue; }
        checkThreadLink(a);
        if (!parsing()) pendingRows.delete(a);
      }
      if (isThreadPage && !(barHost && barHost.isConnected)) tryInsertBar();
    }
    let extrasTimer = 0;
    function scheduleExtras(delay = 400) {
      if (!ready) return;
      clearTimeout(extrasTimer);
      extrasTimer = setTimeout(scanExtras, delay);
    }
    function scanExtras() {
      clearTimeout(extrasTimer);
      extrasTimer = 0;
      if (!document.body) return;
      if (!isThreadPage) for (const a of document.querySelectorAll(THREAD_LINK)) checkThreadLink(a);
      renderPinned();
      tryInsertBar();
      applyPremium();
    }

    if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('★ Favoritos e hilos ocultos', openThreadsPanel);

    /* ───────────── Arranque ───────────── */
    // Si el navegador ya leyó parte de la página antes de arrancar el script, se procesa ya
    if (document.body || root.firstElementChild) {
      if (state.dark) queue(root, true);
      if (CFG.quitarAnuncios) scanAdded(root);
      lnAdded(root);
      extrasAdded(root);
    }

    function init() {
      ready = true;
      if (document.body) rootMo.observe(document.body, { attributes: true, attributeFilter: ROOT_ATTRS });
      refresh(false);
      scanAds();
      scanBlacklist();
      scanExtras();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
    // Al terminar de cargar solo se rehace si llegó CSS nuevo o cambiaron los colores base
    const armLearning = () => setTimeout(() => { learnReady = true; scanAds(); }, 3000);
    if (document.readyState === 'complete') armLearning();
    else addEventListener('load', armLearning, { once: true });
    if (document.readyState !== 'complete') {
      addEventListener('load', () => {
        if (document.styleSheets.length !== sheets || signature() !== sig) scheduleRefresh(50);
        scheduleAdScan(0);
        scheduleLnScan(0);
        scheduleExtras(0);
      }, { once: true });
    }
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => scheduleRefresh(50)); } catch (_) { /* nada */ }
    addEventListener('pageshow', (e) => { if (e.persisted) scheduleRefresh(50); });
  }
})();
