/* Tema 2 — motor de tilt holográfico (browser JS puro, sin React).
   Inyectado por scripts/build-web.js como <script id="b2p-tema2-fx"> (patrón wc-splash).
   GOTCHA (hallado en review): este script inline corre al parsear el HTML, ANTES
   de que React monte y App.js ponga data-tema2 en <html>. Por eso el gate se
   chequea PEREZOSAMENTE dentro de cada handler (getAttribute es barato), nunca
   como early-return al cargar. Desktop: pointer sobre [data-t2-tilt]. Celular:
   giroscopio (deviceorientation) mueve todas las cartas visibles, suavizado con
   rAF. Respeta prefers-reduced-motion. */
(function () {
  try {
    var html = document.documentElement;
    if (!html) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    function gateOn() { return html.getAttribute('data-tema2') === 'on'; }

    var MAX_RX = 7, MAX_RY = 10; // grados — sutil, no mareo
    var raf = null;

    function setVars(el, rx, ry, hx) {
      el.style.setProperty('--t2rx', rx.toFixed(2) + 'deg');
      el.style.setProperty('--t2ry', ry.toFixed(2) + 'deg');
      el.style.setProperty('--t2hx', hx.toFixed(0) + '%');
    }
    function resetVars(el) {
      el.style.removeProperty('--t2rx');
      el.style.removeProperty('--t2ry');
      el.style.removeProperty('--t2hx');
    }

    // ── Desktop / mouse: tilt individual por carta (delegación, sin listeners por card)
    document.addEventListener('pointermove', function (e) {
      if (!gateOn()) return;
      if (e.pointerType && e.pointerType !== 'mouse') return;
      var el = e.target && e.target.closest ? e.target.closest('[data-t2-tilt]') : null;
      if (!el) return;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () {
        var r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var x = (e.clientX - r.left) / r.width;
        var y = (e.clientY - r.top) / r.height;
        setVars(el, (0.5 - y) * MAX_RX * 2, (x - 0.5) * MAX_RY * 2, x * 100);
      });
    }, { passive: true });

    document.addEventListener('pointerout', function (e) {
      if (!gateOn()) return;
      var el = e.target && e.target.closest ? e.target.closest('[data-t2-tilt]') : null;
      if (el && (!e.relatedTarget || !el.contains(e.relatedTarget))) resetVars(el);
    }, { passive: true });

    // ── Celular: giroscopio global suavizado. Cache de nodos refrescado cada ~60
    // frames (querySelectorAll por frame era otro hallazgo del review).
    var gyroOn = false, gRx = 0, gRy = 0, tRx = 0, tRy = 0, baseBeta = null, baseGamma = null;
    var cards = null, cacheTick = 60;
    function gyroLoop() {
      if (!gateOn()) { gyroOn = false; cards = null; cacheTick = 60; return; }
      gRx += (tRx - gRx) * 0.12;
      gRy += (tRy - gRy) * 0.12;
      if (++cacheTick >= 60) { cards = document.querySelectorAll('[data-t2-tilt]'); cacheTick = 0; }
      for (var i = 0; i < cards.length; i++) {
        setVars(cards[i], gRx, gRy, 50 + (gRy / MAX_RY) * 40);
      }
      requestAnimationFrame(gyroLoop);
    }
    function onOrient(e) {
      if (!gateOn()) return;
      if (e.beta == null || e.gamma == null) return;
      if (baseBeta == null) { baseBeta = e.beta; baseGamma = e.gamma; }
      tRx = Math.max(-MAX_RX, Math.min(MAX_RX, (e.beta - baseBeta) * 0.35));
      tRy = Math.max(-MAX_RY, Math.min(MAX_RY, (e.gamma - baseGamma) * 0.45));
      if (!gyroOn) { gyroOn = true; requestAnimationFrame(gyroLoop); }
    }
    // iOS 13+ exige permiso vía gesto; Android dispara directo.
    if (typeof DeviceOrientationEvent !== 'undefined') {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        document.addEventListener('touchend', function req() {
          if (!gateOn()) return; // no gastar el permiso si el preview no está activo
          DeviceOrientationEvent.requestPermission().then(function (s) {
            if (s === 'granted') window.addEventListener('deviceorientation', onOrient, { passive: true });
          }).catch(function () {});
          document.removeEventListener('touchend', req);
        }, { passive: true });
      } else {
        window.addEventListener('deviceorientation', onOrient, { passive: true });
      }
    }
  } catch (e) {}
})();
