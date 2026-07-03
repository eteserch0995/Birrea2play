// ============================================================
// WorldCupSplash.js — Splash temporal "Mundial 26" · birrea2play
// Se muestra 1 vez por sesión (por pestaña), solo entre el 10 y el
// 25 de junio de 2026. Fuera de la ventana retorna null.
// ELIMINAR este componente (y su CSS) al terminar la campaña.
//
// Adaptado a Expo React Native Web (web-only):
//  - Sin "use client" ni import de CSS (el CSS se inyecta global
//    via scripts/build-web.js como <style id="wc-splash">).
//  - El logo del Mundial usa el asset EXISTENTE del repo via
//    require()+resolveAssetSource (intocable; solo se anima el
//    contenedor, segun el CSS).
//  - Se monta solo en web (guard Platform.OS === 'web' en App.js).
// ============================================================

import { useEffect, useState, useCallback } from "react";
import { Image } from "react-native";

// ---------- CONFIGURACIÓN (editar aquí) ----------------------
const SPLASH_START = new Date("2026-06-10T00:00:00-05:00");
const SPLASH_END   = new Date("2026-06-25T23:59:59-05:00"); // inclusive
const SESSION_KEY  = "wc_splash_played_session";
const DURACION_MS  = 3800; // animación visible
const FADE_MS      = 500;  // fade-out final

// Logo oficial del Mundial 26 YA presente en el repo. Asset intocable:
// se referencia por require (mismo asset que usa el resto de la app),
// sin recolorear ni filtrar; la animación vive en el contenedor (CSS).
let LOGO_SRC = "";
try {
  LOGO_SRC = Image.resolveAssetSource(require("../assets/mundial/mundial-logo.png")).uri;
} catch (e) {
  LOGO_SRC = "";
}

// Países del confeti (códigos ISO 3166-1 alpha-2).
// La bandera se resuelve vía flagcdn (PNG ~1 KB, dominio público),
// con fallback a emoji si la imagen no carga.
const PAISES = ["mx","us","ca","pa","ar","br","jp","fr","de","es","co","cr"];
// --------------------------------------------------------------

const emojiBandera = (iso) =>
  iso.toUpperCase().replace(/./g, c =>
    String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65));

export default function WorldCupSplash() {
  // fases: "oculto" (sin DOM) | "activo" | "saliendo" (fade-out)
  const [fase, setFase] = useState("oculto");

  const cerrar = useCallback(() => {
    setFase(f => {
      if (f !== "activo") return f;       // evita doble cierre
      setTimeout(() => setFase("oculto"), FADE_MS); // desmontaje real
      return "saliendo";
    });
  }, []);

  useEffect(() => {
    // Red de seguridad: este componente es solo-web (usa DOM/localStorage).
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const ahora = new Date();

    // 1) Ventana de fechas: fuera de rango, no montar nada
    if (ahora < SPLASH_START || ahora > SPLASH_END) return;

    // 2) Usuario con movimiento reducido: registrar y no mostrar
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      try { sessionStorage.setItem(SESSION_KEY, "1"); } catch (e) {}
      return;
    }

    // 3) Una vez por sesión (por pestaña). sessionStorage se limpia al cerrar
    //    la pestaña: una visita nueva lo vuelve a mostrar, pero un refresh
    //    dentro de la misma sesión no lo repite. try/catch: storage puede
    //    estar bloqueado y la app jamás debe romperse por esto.
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;
      // Se marca AL INICIO: un refresh a mitad de splash no lo repite
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch (e) { return; }

    setFase("activo");
    const t = setTimeout(cerrar, DURACION_MS);
    const esc = (e) => { if (e.key === "Escape") cerrar(); };
    window.addEventListener("keydown", esc);
    return () => { clearTimeout(t); window.removeEventListener("keydown", esc); };
  }, [cerrar]);

  if (fase === "oculto") return null;

  return (
    <div
      className={`wc-splash ${fase === "saliendo" ? "wc-splash--out" : ""}`}
      onClick={cerrar}
      role="presentation"
      aria-hidden="true"
    >
      {/* Confeti: 18 banderas con posición, delay y tamaño variados */}
      <div className="wc-splash__confeti">
        {Array.from({ length: 18 }).map((_, i) => {
          const iso = PAISES[i % PAISES.length];
          return (
            <span
              key={i}
              className="wc-splash__bandera"
              style={{
                left: `${(i * 53) % 100}%`,
                animationDelay: `${(i % 6) * 0.35}s`,
              }}
            >
              <img
                src={`https://flagcdn.com/w40/${iso}.png`}
                width={28 + (i % 3) * 8}
                alt=""
                loading="eager"
                draggable="false"
                // Fallback: si flagcdn no responde, emoji en su lugar
                onError={(e) => {
                  const s = document.createElement("span");
                  s.textContent = emojiBandera(iso);
                  s.style.fontSize = `${28 + (i % 3) * 8}px`;
                  e.currentTarget.replaceWith(s);
                }}
              />
            </span>
          );
        })}
      </div>

      {/* Fuegos artificiales: el repo no tiene asset propio, se deja
          el fallback CSS (4 explosiones radiales). */}
      <span className="wc-fw wc-fw--1" />
      <span className="wc-fw wc-fw--2" />
      <span className="wc-fw wc-fw--3" />
      <span className="wc-fw wc-fw--4" />

      {/* Logo oficial — asset intocable, animación en el contenedor. */}
      {LOGO_SRC ? (
        <div className="wc-splash__logo">
          <img src={LOGO_SRC} alt="" draggable="false" />
        </div>
      ) : null}

      <p className="wc-splash__texto">¡Que arranque la fiesta!</p>
      <span className="wc-splash__skip">Toca para saltar · Esc</span>
    </div>
  );
}
