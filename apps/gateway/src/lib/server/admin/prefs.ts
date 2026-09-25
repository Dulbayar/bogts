/** Per-browser dashboard preferences (a cookie, so the theme applies before paint with no inline script). */
export const THEME_COOKIE = 'bogts_theme';
export type ThemePref = 'system' | 'light' | 'dark';

export function themeFrom(value: string | undefined): ThemePref {
	return value === 'light' || value === 'dark' ? value : 'system';
}
