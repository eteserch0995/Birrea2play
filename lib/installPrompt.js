// Captura beforeinstallprompt al nivel de módulo — antes de que React monte.
// Chrome lo dispara muy temprano; si esperamos al useEffect ya se perdió.
let _prompt = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _prompt = e;
  });
  window.addEventListener('appinstalled', () => { _prompt = null; });
}

export function getInstallPrompt()   { return _prompt; }
export function clearInstallPrompt() { _prompt = null; }
