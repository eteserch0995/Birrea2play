ESTADO (2026-06-11): las banderas del scoreboard del home se resolvieron por
CODIGO via flagcdn (URL remota), NO con archivos locales. Ver el mapa FLAG_CC
y el componente <Flag> en components/mundial/TodayMatches.js
(https://flagcdn.com/w40/<cc>.png). Esta carpeta quedo SIN USO.

Se deja documentado por si en el futuro se quieren banderas PROPIAS (estilo
distinto) empaquetadas en el bundle, en vez de flagcdn:

CONVENCION (si se usan archivos locales)
- Nombre de archivo = codigo de 3 letras en MINUSCULA + .png
  (el "code" de wc_teams). Ej: Mexico -> mex.png, Sudafrica -> zaf.png
- Formato PNG, relacion ~4:3 (ej. 80x60 o 120x90), mismo aspecto en todas.
- Metro NO permite require() con ruta dinamica: habria que generar un mapa
  estatico assets/mundial/flags/index.js (code -> require) y cablearlo en el
  componente, reemplazando flagUri()/flagcdn.

CHECKLIST (48)
A: cze.png  kor.png  mex.png  zaf.png
B: bih.png  can.png  qat.png  sui.png
C: bra.png  sco.png  hai.png  mar.png
D: aus.png  usa.png  par.png  tur.png
E: ger.png  civ.png  cuw.png  ecu.png
F: jpn.png  ned.png  swe.png  tun.png
G: bel.png  egy.png  irn.png  nzl.png
H: ksa.png  cpv.png  esp.png  uru.png
I: fra.png  irq.png  nor.png  sen.png
J: dza.png  arg.png  aut.png  jor.png
K: col.png  por.png  cod.png  uzb.png
L: cro.png  gha.png  eng.png  pan.png
