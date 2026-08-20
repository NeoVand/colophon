/**
 * The theme, and the two attributes it sets.
 *
 * `.dark` on `<html>` carries scheme-level behaviour — Tailwind's `dark:`
 * variants and anything keyed on the scheme rather than the tint.
 * `data-theme` carries the tint itself. Both are set together, because a theme
 * here is a temperature and not merely a light/dark switch: see
 * `src/routes/layout.css`, where each named theme retunes the whole legend.
 *
 * The one non-obvious part is `system`. It is a real choice, not the absence of
 * one — "follow the machine" has to keep following it, so the media query stays
 * subscribed for as long as that choice stands.
 */

export interface Theme {
	id: string;
	label: string;
	scheme: 'light' | 'dark';
	/** One sentence, shown in the picker. */
	note: string;
}

export const THEMES: Theme[] = [
	{ id: 'paper', label: 'Paper', scheme: 'light', note: 'Warm and low-contrast, for reading.' },
	{ id: 'chalk', label: 'Chalk', scheme: 'light', note: 'Neutral daylight.' },
	{ id: 'midnight', label: 'Midnight', scheme: 'dark', note: 'Near-black, off the glare.' },
	{ id: 'slate', label: 'Slate', scheme: 'dark', note: 'Cool and dim, for working late.' }
];

const KEY = 'colophon:theme';

/**
 * `chalk` and `midnight` are the bare schemes — they set no `data-theme`,
 * because the base `:root` and `.dark` blocks *are* those themes. Naming them
 * in the picker while leaving the attribute off keeps one source of truth for
 * the default palette instead of duplicating it into a block.
 */
const BARE = new Set(['chalk', 'midnight']);

class ThemeState {
	/** The chosen theme id, or 'system' to follow the machine. */
	choice = $state<string>('system');
	/** What is actually on screen — never 'system'. */
	active = $state<string>('midnight');

	#media: MediaQueryList | undefined;

	start(): void {
		const saved = localStorage.getItem(KEY);
		this.choice = saved ?? 'system';

		this.#media = window.matchMedia('(prefers-color-scheme: dark)');
		this.#media.addEventListener('change', () => {
			// Only meaningful while following the system; harmless otherwise.
			if (this.choice === 'system') this.#paint();
		});

		this.#paint();
	}

	set(id: string): void {
		this.choice = id;
		localStorage.setItem(KEY, id);
		this.#paint();
	}

	#paint(): void {
		const prefersDark = this.#media?.matches ?? true;
		const id = this.choice === 'system' ? (prefersDark ? 'midnight' : 'paper') : this.choice;
		this.active = id;

		const theme = THEMES.find((t) => t.id === id) ?? THEMES[2];
		const root = document.documentElement;

		root.classList.toggle('dark', theme.scheme === 'dark');
		if (BARE.has(id)) root.removeAttribute('data-theme');
		else root.setAttribute('data-theme', id);

		// So the browser paints form controls and scrollbars to match rather than
		// rendering a light dropdown on a dark page.
		root.style.colorScheme = theme.scheme;
	}
}

export const theme = new ThemeState();
