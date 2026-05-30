#!/usr/bin/env node
/**
 * Build pipeline para Vercel:
 *   1. expo export --platform web --output-dir dist
 *   2. Copia los HTMLs estáticos legales/info de docs/ a dist/info/
 *      (sirven para /info/privacidad, /info/terminos, etc.)
 *
 * Se invoca desde vercel.json buildCommand.
 */
const { execSync } = require('child_process');
const { existsSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync } = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DOCS = path.join(ROOT, 'docs');
const WEB_STATIC = path.join(ROOT, 'web-static');
const ASSETS = path.join(ROOT, 'assets');
const INFO_OUT = path.join(DIST, 'info');

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT });
}

// 1. Limpiar dist previa
if (existsSync(DIST)) {
  console.log(`Limpiando ${DIST}`);
  rmSync(DIST, { recursive: true, force: true });
}

// 2. Build Expo Web
run('npx expo export --platform web --output-dir dist');

// 3. Copiar HTMLs estáticos (privacidad, términos, eliminar-cuenta, recargas) a /info/
if (existsSync(DOCS)) {
  mkdirSync(INFO_OUT, { recursive: true });

  const staticFiles = [
    'privacidad.html',
    'terminos.html',
    'eliminar-cuenta.html',
    'recarga.html',
    'recarga-ok.html',
    'recarga-fail.html',
  ];

  for (const f of staticFiles) {
    const src = path.join(DOCS, f);
    if (existsSync(src)) {
      cpSync(src, path.join(INFO_OUT, f));
      console.log(`  + info/${f}`);
    }
  }

  // Copiar /img si existe (logos referenciados por los HTMLs)
  const imgSrc = path.join(DOCS, 'img');
  if (existsSync(imgSrc)) {
    cpSync(imgSrc, path.join(INFO_OUT, 'img'), { recursive: true });
    console.log('  + info/img/ (recursive)');
  }
} else {
  console.warn('docs/ no existe; salteo copia de HTMLs estáticos.');
}

// 3b. Copiar archivos estáticos web (service worker, manifest PWA) a dist/
if (existsSync(WEB_STATIC)) {
  for (const f of ['sw.js', 'manifest.json']) {
    const src = path.join(WEB_STATIC, f);
    if (existsSync(src)) {
      cpSync(src, path.join(DIST, f));
      console.log(`  + ${f}`);
    }
  }
}

// 3c. Copiar iconos PWA explícitos para instalaciones desde navegador/Vercel.
// Expo genera favicon.ico, pero el manifest necesita PNGs grandes y estables.
for (const f of ['icon.png', 'favicon.png', 'pwa-icon-192.png', 'pwa-icon-512.png']) {
  const src = path.join(ASSETS, f);
  if (existsSync(src)) {
    cpSync(src, path.join(DIST, f));
    console.log(`  + ${f}`);
  }
}

// 4. Override agresivo del CSS reset de Expo Web.
//    Estrategia: hacer que el BODY sea el scroller global en web (en vez de
//    cada ScrollView), para que TODOS los paneles puedan hacer scroll natural
//    sin depender de altura cascadeada por cada container.
const indexPath = path.join(DIST, 'index.html');
if (existsSync(indexPath)) {
  let html = readFileSync(indexPath, 'utf8');
  const scrollFix = `
  <style id="b2p-web-scroll-fix">
    /* Permitir que html/body crezcan con contenido y scrolleen naturalmente */
    html, body {
      height: auto !important;
      min-height: 100% !important;
      overflow: visible !important;
      margin: 0;
      padding: 0;
    }
    body {
      overflow-y: auto !important;
      overflow-x: hidden !important;
      overscroll-behavior-y: contain;
      -webkit-overflow-scrolling: touch;
    }
    #root {
      height: auto !important;
      min-height: 100vh !important;
      display: flex;
      flex-direction: column;
    }
    /* RN-Web pone overflow inline en ScrollView; quitarlo para que el body scrollee */
    div[style*="overflow-x: scroll"][style*="overflow-y: scroll"]:not([data-keep-scroll]) {
      overflow: visible !important;
      max-height: none !important;
    }
    /* Espacio al fondo para que la tab bar FIXED no tape contenido del body */
    body { padding-bottom: calc(80px + env(safe-area-inset-bottom, 0)); }
  </style>`;
  // SW killswitch (2026-05-20): ya NO registramos un SW nuevo.
  // Para users que tienen un SW viejo instalado, hacemos cleanup activo:
  // pedimos al browser que desregistre cualquier SW del scope y limpie caches.
  // Esto + el sw.js killswitch fuerzan a la app a comportarse como SPA web
  // normal sin service worker intermediando.
  const swInject = `
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#C8102E">
  <script id="b2p-sw-cleanup">
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then(function(regs) { regs.forEach(function(r) { r.unregister(); }); })
        .catch(function() {});
    }
    if (typeof caches !== 'undefined' && caches.keys) {
      caches.keys().then(function(keys) {
        keys.forEach(function(k) { caches.delete(k); });
      }).catch(function() {});
    }
  </script>`;
  // PRELOAD del bundle JS principal: el browser empieza a descargarlo en
  // cuanto parsea el <head>, sin esperar al <script> en el <body>.
  // Esto le quita 200-500ms al TTI en mobile 4G.
  const bundleMatch = html.match(/_expo\/static\/js\/web\/index-[a-z0-9]+\.js/);

  // Fonts críticas: buscá todos los .woff2 que Expo exportó (BebasNeue, Barlow).
  // Preload solo de las dos más usadas en EventDetail: BebasNeue + Barlow Regular.
  const fontDir = require('path').join(DIST, '_expo', 'static', 'fonts');
  let fontPreloads = '';
  if (existsSync(fontDir)) {
    const fontFiles = require('fs').readdirSync(fontDir);
    // Priorizar BebasNeue (headings) y Barlow_400Regular (body base)
    const criticalFonts = fontFiles.filter(f =>
      f.endsWith('.woff2') && (
        f.includes('BebasNeue') ||
        f.includes('Barlow_400') ||
        f.includes('Barlow_600') // usado en nombres de jugadores
      )
    );
    // También aceptar .ttf si no hay woff2 (Expo puede exportar ttf)
    const ttfFallback = criticalFonts.length === 0
      ? fontFiles.filter(f =>
          f.endsWith('.ttf') && (f.includes('BebasNeue') || f.includes('Barlow_400') || f.includes('Barlow_600'))
        )
      : [];
    const toPreload = [...criticalFonts, ...ttfFallback].slice(0, 4); // máximo 4 preloads
    fontPreloads = toPreload.map(f => {
      const ext = f.endsWith('.woff2') ? 'woff2' : 'truetype';
      return `\n  <link rel="preload" as="font" type="font/${ext}" href="/_expo/static/fonts/${f}" crossorigin>`;
    }).join('');
    if (toPreload.length) console.log(`  + font preloads: ${toPreload.join(', ')}`);
  }

  const preloadInject = (bundleMatch
    ? `\n  <link rel="preload" as="script" href="/${bundleMatch[0]}">` : '')
    + `\n  <link rel="preconnect" href="https://rumreditrvxkcnlhawut.supabase.co" crossorigin>`
    + `\n  <link rel="dns-prefetch" href="https://rumreditrvxkcnlhawut.supabase.co">`
    + fontPreloads;

  // SPLASH inline: mientras el bundle descarga y monta React, el user ve
  // logo + texto en lugar de pantalla blanca. CSS-only, sin JS.
  // React reemplaza el contenido de #root cuando monta.
  const splashInline = `
  <style id="b2p-splash-style">
    #b2p-splash {
      position: fixed; inset: 0;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      background: #07101F;
      z-index: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      transition: opacity 250ms ease-out;
    }
    #b2p-splash.gone { opacity: 0; pointer-events: none; }
    #b2p-splash-logo {
      width: 88px; height: 88px;
      border-radius: 18px;
      background: #C8102E;
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-weight: 800; font-size: 30px;
      letter-spacing: 2px;
      margin-bottom: 18px;
      box-shadow: 0 8px 24px rgba(200,16,46,0.35);
    }
    #b2p-splash-title {
      color: #fff; font-size: 34px; font-weight: 800;
      letter-spacing: 0; margin-bottom: 22px;
    }
    #b2p-splash-spinner {
      width: 28px; height: 28px;
      border: 3px solid rgba(255,255,255,0.15);
      border-top-color: #B8FF00;
      border-radius: 50%;
      animation: b2p-spin 0.9s linear infinite;
    }
    @keyframes b2p-spin { to { transform: rotate(360deg); } }
  </style>`;

  // El mensaje del splash cambia según la ruta:
  // /evento/:id → "Cargando evento..." para dar contexto inmediato al usuario.
  // El script es tiny e inline — no hay dependencias.
  const splashBody = `<div id="b2p-splash">
  <div id="b2p-splash-title">birrea<span style="color:#B8FF00">2play</span></div>
  <div id="b2p-splash-msg" style="color:#9AA3B0;font-size:13px;letter-spacing:1px;margin-bottom:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"></div>
  <div id="b2p-splash-spinner"></div>
  <script>
    (function(){
      var msg = document.getElementById('b2p-splash-msg');
      if (!msg) return;
      var p = window.location.pathname;
      if (/^\\/evento\\//.test(p)) { msg.textContent = 'Cargando evento…'; }
      else if (/^\\/eventos/.test(p)) { msg.textContent = 'Cargando eventos…'; }
    })();
  <\/script>
</div>`;

  // Script que oculta el splash en cuanto React mete contenido real en #root.
  // Usa MutationObserver para detectar el primer mount.
  // Safety net reducido a 5s (antes 8s) — bundle ya preloadeado debería montar antes.
  // Métricas de perf enviadas a console para diagnóstico sin dependencias externas.
  const splashHideScript = `
  <script id="b2p-splash-hide">
    (function(){
      // ── Métricas de performance (console only, sin deps) ──────────────────
      var t0 = Date.now();
      window.__b2pPerf = { start: t0 };
      document.addEventListener('DOMContentLoaded', function() {
        window.__b2pPerf.domContentLoaded = Date.now() - t0;
      });
      window.addEventListener('load', function() {
        window.__b2pPerf.windowLoad = Date.now() - t0;
        // First Paint via PerformanceObserver (Chrome/Android)
        try {
          var po = new PerformanceObserver(function(list) {
            list.getEntries().forEach(function(e) {
              if (e.name === 'first-paint') window.__b2pPerf.firstPaint = Math.round(e.startTime);
              if (e.name === 'first-contentful-paint') window.__b2pPerf.fcp = Math.round(e.startTime);
            });
            console.log('[b2p perf]', JSON.stringify(window.__b2pPerf));
            po.disconnect();
          });
          po.observe({ type: 'paint', buffered: true });
        } catch(e2) {}
        // Fallback: log on load regardless
        setTimeout(function(){
          if (!window.__b2pPerf.firstPaint) console.log('[b2p perf]', JSON.stringify(window.__b2pPerf));
        }, 500);
      });
      // ── Splash hide logic ─────────────────────────────────────────────────
      var hidden = false;
      function hide(){
        if (hidden) return; hidden = true;
        window.__b2pPerf.splashHidden = Date.now() - t0;
        var s = document.getElementById('b2p-splash');
        if (!s) return;
        s.classList.add('gone');
        setTimeout(function(){ if (s.parentNode) s.parentNode.removeChild(s); }, 300);
      }
      function check(){
        var root = document.getElementById('root');
        // React monta al menos 1 child cuando está listo
        if (root && root.childElementCount > 0) hide();
      }
      // Safety net: 5s (reducido de 8s — bundle preloadeado monta antes)
      setTimeout(hide, 5000);
      if (document.readyState === 'complete') check();
      window.addEventListener('load', check);
      var obs = new MutationObserver(check);
      if (document.getElementById('root')) obs.observe(document.getElementById('root'), { childList: true });
      else document.addEventListener('DOMContentLoaded', function(){
        var r = document.getElementById('root');
        if (r) obs.observe(r, { childList: true });
        check();
      });
    })();
  </script>`;

  html = html.replace('</head>', preloadInject + scrollFix + splashInline + swInject + splashHideScript + '</head>');
  // Splash dentro del body, ANTES del #root (queda como hermano, no como child)
  html = html.replace(/(<body[^>]*>)/, `$1${splashBody}`);
  writeFileSync(indexPath, html);
  console.log('  + preload + splash inline + scroll fix + SW cleanup inyectados en dist/index.html');
}

console.log('\nBuild web completo. Salida en dist/');
