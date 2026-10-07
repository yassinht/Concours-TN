/** Theme preference (system / light / dark), stored per device and applied as data-theme on <html>. */
export type ThemePref = 'system' | 'light' | 'dark';
export const THEME_KEY = 'ctn_theme';

export function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

export function saveTheme(pref: ThemePref): void {
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
  applyTheme(pref);
}

export function applyStoredTheme(): void {
  applyTheme(readTheme());
}

/** Inline, render-blocking snippet for the app layout so the stored theme applies before first paint (no flash). */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;
