/**
 * Theme registry for the three appearance themes (design command §3).
 *
 * `swatches` mirrors the token values in styles/tokens.css and exists only so
 * the Settings screen can preview a theme the user is not currently wearing.
 * Components never read these hexes — they read the CSS custom properties.
 */
export type ThemeId = 'obsidian' | 'oxblood' | 'editorial';

export interface ThemeOption {
  id: ThemeId;
  name: string;
  tagline: string;
  mood: string[];
  surfaces: 'dark' | 'dark' | 'mixed';
  swatches: { canvas: string; surface: string; accent: string; metal: string; text: string };
  notes: string;
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'obsidian',
    name: 'Obsidian',
    tagline: 'Near-black, silver detail, restrained rose.',
    mood: ['dramatic', 'sleek', 'quiet'],
    surfaces: 'dark',
    swatches: { canvas: '#050507', surface: '#101015', accent: '#4c3d44', metal: '#c3c6cf', text: '#e6e4e8' },
    notes: 'The darkest and most minimal of the three. Highest contrast photography treatment.'
  },
  {
    id: 'oxblood',
    name: 'Oxblood',
    tagline: 'Black, burgundy, oxblood, plum, champagne.',
    mood: ['seductive', 'editorial', 'rich'],
    surfaces: 'dark',
    swatches: { canvas: '#0a0608', surface: '#171015', accent: '#6d1a2c', metal: '#ded9d4', text: '#eee4dc' },
    notes: 'The signature theme and the default on first install.'
  },
  {
    id: 'editorial',
    name: 'Editorial',
    tagline: 'Ivory pages, espresso ink, antique rose.',
    mood: ['publication', 'archive', 'legible'],
    surfaces: 'mixed',
    swatches: { canvas: '#f1eae0', surface: '#faf6ef', accent: '#5e1b2c', metal: '#9b7f52', text: '#2b201d' },
    notes: 'A mixed dark-and-light magazine experience. Reading, education and reports use the light surfaces.'
  }
];

export const DEFAULT_THEME: ThemeId = 'oxblood';

export function themeOption(id: string | undefined): ThemeOption {
  return THEME_OPTIONS.find((t) => t.id === id) ?? THEME_OPTIONS[1];
}
