import type { ITheme } from '@xterm/xterm'

/** One appearance of a theme: the app's surfaces and text, and the terminal palette drawn on `content`. */
interface Variant {
  /** Left out by Default, whose surfaces are the tokens in styles.css and whose accent is the Mac's. */
  chrome?: {
    base: string
    sidebar: string
    content: string
    raised: string
    label: string
    accent: string
    /** Text on an accent fill; dark on the pastel accents white can't be read on. */
    onAccent: string
    orange: string
    red: string
    green: string
  }
  foreground: string
  cursor: string
  selection: string
  /** black, red, green, yellow, blue, magenta, cyan, white, then the bright eight. */
  ansi: string[]
}

export interface Theme {
  id: string
  name: string
  dark: Variant
  light: Variant
}

const ANSI_NAMES = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
] as const

// The well-known ones keep their published terminal colors; where a palette has no light side (Nord)
// or a light side meant for a code editor, it was drawn from the same colors, darkened to read on it.
export const THEMES: Theme[] = [
  {
    id: 'default',
    name: 'Default',
    // The macOS system colors. The light set uses darker shades, since the dark set's yellows and
    // cyans wash out on white.
    dark: {
      foreground: '#e5e5e7', cursor: '#e5e5e7', selection: '#3f638b',
      ansi: [
        '#3a3a3c', '#ff453a', '#30d158', '#ffd60a', '#0a84ff', '#bf5af2', '#64d2ff', '#e5e5e7',
        '#8e8e93', '#ff6961', '#4fe07a', '#ffe36a', '#409cff', '#da8fff', '#8ce0ff', '#ffffff',
      ],
    },
    light: {
      foreground: '#1d1d1f', cursor: '#1d1d1f', selection: '#b3d7ff',
      ansi: [
        '#1d1d1f', '#d70015', '#248a3d', '#a05a00', '#0040dd', '#ad44ab', '#0071a4', '#6e6e73',
        '#8e8e93', '#ff3b30', '#28a745', '#c27c0e', '#007aff', '#af52de', '#0a84c6', '#3a3a3c',
      ],
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    dark: {
      chrome: {
        base: '#242933', sidebar: '#3b4252', content: '#2e3440', raised: '#3b4252', label: '#eceff4',
        accent: '#88c0d0', onAccent: '#2e3440', orange: '#d08770', red: '#bf616a', green: '#a3be8c',
      },
      foreground: '#d8dee9', cursor: '#d8dee9', selection: '#434c5e',
      ansi: [
        '#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0',
        '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4',
      ],
    },
    light: {
      chrome: {
        base: '#d8dee9', sidebar: '#e5e9f0', content: '#eceff4', raised: '#f2f4f8', label: '#2e3440',
        accent: '#5e81ac', onAccent: '#ffffff', orange: '#b5603f', red: '#b0434f', green: '#5f7f45',
      },
      foreground: '#2e3440', cursor: '#2e3440', selection: '#c9d3e3',
      ansi: [
        '#3b4252', '#b0434f', '#5f7f45', '#9a7426', '#5e81ac', '#8f6a8b', '#3e7f8d', '#4c566a',
        '#7b8496', '#bf616a', '#6e8f50', '#b08a35', '#81a1c1', '#a17d9d', '#5a98a6', '#2e3440',
      ],
    },
  },
  {
    id: 'solarized',
    name: 'Solarized',
    dark: {
      chrome: {
        base: '#00212b', sidebar: '#073642', content: '#002b36', raised: '#073642', label: '#93a1a1',
        accent: '#268bd2', onAccent: '#ffffff', orange: '#e8753a', red: '#dc322f', green: '#859900',
      },
      foreground: '#93a1a1', cursor: '#93a1a1', selection: '#0d4655',
      ansi: [
        '#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
        '#586e75', '#cb4b16', '#9cb31a', '#d0a316', '#4aa3e0', '#6c71c4', '#3fbdb2', '#fdf6e3',
      ],
    },
    light: {
      chrome: {
        base: '#eee8d5', sidebar: '#f7f1de', content: '#fdf6e3', raised: '#fdf6e3', label: '#586e75',
        accent: '#268bd2', onAccent: '#ffffff', orange: '#cb4b16', red: '#dc322f', green: '#738a00',
      },
      foreground: '#586e75', cursor: '#586e75', selection: '#e4ddc8',
      ansi: [
        '#073642', '#dc322f', '#738a00', '#a07800', '#268bd2', '#d33682', '#2aa198', '#93a1a1',
        '#839496', '#cb4b16', '#859900', '#b58900', '#2076b5', '#6c71c4', '#22867e', '#002b36',
      ],
    },
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    // Mocha and Latte.
    dark: {
      chrome: {
        base: '#11111b', sidebar: '#181825', content: '#1e1e2e', raised: '#313244', label: '#cdd6f4',
        accent: '#cba6f7', onAccent: '#11111b', orange: '#fab387', red: '#f38ba8', green: '#a6e3a1',
      },
      foreground: '#cdd6f4', cursor: '#f5e0dc', selection: '#45475a',
      ansi: [
        '#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de',
        '#585b70', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8',
      ],
    },
    light: {
      chrome: {
        base: '#dce0e8', sidebar: '#e6e9ef', content: '#eff1f5', raised: '#eff1f5', label: '#4c4f69',
        accent: '#8839ef', onAccent: '#ffffff', orange: '#c4510a', red: '#d20f39', green: '#40a02b',
      },
      foreground: '#4c4f69', cursor: '#dc8a78', selection: '#ccd0da',
      ansi: [
        '#5c5f77', '#d20f39', '#40a02b', '#df8e1d', '#1e66f5', '#ea76cb', '#179299', '#acb0be',
        '#6c6f85', '#d20f39', '#40a02b', '#df8e1d', '#1e66f5', '#ea76cb', '#179299', '#bcc0cc',
      ],
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    // Dracula and Alucard, its official light side.
    dark: {
      chrome: {
        base: '#191a21', sidebar: '#21222c', content: '#282a36', raised: '#343746', label: '#f8f8f2',
        accent: '#bd93f9', onAccent: '#191a21', orange: '#ffb86c', red: '#ff5555', green: '#50fa7b',
      },
      foreground: '#f8f8f2', cursor: '#f8f8f2', selection: '#44475a',
      ansi: [
        '#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
        '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff',
      ],
    },
    light: {
      chrome: {
        base: '#ece8d6', sidebar: '#f6f2e1', content: '#fffbeb', raised: '#fffbeb', label: '#1f1f1f',
        accent: '#644ac9', onAccent: '#ffffff', orange: '#a34d14', red: '#cb3a2a', green: '#14710a',
      },
      foreground: '#1f1f1f', cursor: '#1f1f1f', selection: '#cfcfde',
      ansi: [
        '#1f1f1f', '#cb3a2a', '#14710a', '#846e15', '#644ac9', '#a3144d', '#036a96', '#6c664b',
        '#635d97', '#d74c3d', '#198d0c', '#9e841a', '#7862d0', '#bf185a', '#047fb4', '#2c2b31',
      ],
    },
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    dark: {
      chrome: {
        base: '#1d2021', sidebar: '#32302f', content: '#282828', raised: '#3c3836', label: '#ebdbb2',
        accent: '#83a598', onAccent: '#1d2021', orange: '#fe8019', red: '#fb4934', green: '#b8bb26',
      },
      foreground: '#ebdbb2', cursor: '#ebdbb2', selection: '#504945',
      ansi: [
        '#3c3836', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984',
        '#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2',
      ],
    },
    light: {
      chrome: {
        base: '#ebdbb2', sidebar: '#f2e5bc', content: '#fbf1c7', raised: '#f9f5d7', label: '#3c3836',
        accent: '#076678', onAccent: '#ffffff', orange: '#af3a03', red: '#9d0006', green: '#79740e',
      },
      foreground: '#3c3836', cursor: '#3c3836', selection: '#d5c4a1',
      ansi: [
        '#3c3836', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#7c6f64',
        '#928374', '#9d0006', '#79740e', '#b57614', '#076678', '#8f3f71', '#427b58', '#282828',
      ],
    },
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    // Night and Day.
    dark: {
      chrome: {
        base: '#16161e', sidebar: '#1f2335', content: '#1a1b26', raised: '#292e42', label: '#c0caf5',
        accent: '#7aa2f7', onAccent: '#16161e', orange: '#ff9e64', red: '#f7768e', green: '#9ece6a',
      },
      foreground: '#c0caf5', cursor: '#c0caf5', selection: '#283457',
      ansi: [
        '#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6',
        '#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5',
      ],
    },
    light: {
      chrome: {
        base: '#d0d5e3', sidebar: '#e9e9ed', content: '#e1e2e7', raised: '#e9e9ed', label: '#343b58',
        accent: '#2e7de9', onAccent: '#ffffff', orange: '#b15c00', red: '#f52a65', green: '#587539',
      },
      foreground: '#3760bf', cursor: '#3760bf', selection: '#b7c1e3',
      ansi: [
        '#8990b3', '#f52a65', '#587539', '#8c6c3e', '#2e7de9', '#9854f1', '#007197', '#6172b0',
        '#a1a6c5', '#f52a65', '#587539', '#8c6c3e', '#2e7de9', '#9854f1', '#007197', '#3760bf',
      ],
    },
  },
  {
    id: 'night-owl',
    name: 'Night Owl',
    // Night Owl and Light Owl.
    dark: {
      chrome: {
        base: '#010e1a', sidebar: '#0b2942', content: '#011627', raised: '#0b253a', label: '#d6deeb',
        accent: '#82aaff', onAccent: '#011627', orange: '#f78c6c', red: '#ef5350', green: '#22da6e',
      },
      foreground: '#d6deeb', cursor: '#80a4c2', selection: '#1d3b53',
      ansi: [
        '#1d3b53', '#ef5350', '#22da6e', '#addb67', '#82aaff', '#c792ea', '#21c7a8', '#ffffff',
        '#575656', '#ef5350', '#22da6e', '#ffeb95', '#82aaff', '#c792ea', '#7fdbca', '#ffffff',
      ],
    },
    light: {
      chrome: {
        base: '#ececec', sidebar: '#f6f6f6', content: '#fbfbfb', raised: '#ffffff', label: '#403f53',
        accent: '#288ed7', onAccent: '#ffffff', orange: '#c7600e', red: '#de3d3b', green: '#08916a',
      },
      foreground: '#403f53', cursor: '#90a7b2', selection: '#e0e0e0',
      ansi: [
        '#403f53', '#de3d3b', '#08916a', '#c79400', '#288ed7', '#d6438a', '#2aa298', '#93a1a1',
        '#989fb1', '#de3d3b', '#08916a', '#daaa01', '#288ed7', '#d6438a', '#2aa298', '#403f53',
      ],
    },
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    // Main and Dawn. Dawn's black is its muted grey, since the published one is nearly its background.
    dark: {
      chrome: {
        base: '#12101b', sidebar: '#1f1d2e', content: '#191724', raised: '#26233a', label: '#e0def4',
        accent: '#c4a7e7', onAccent: '#191724', orange: '#f6c177', red: '#eb6f92', green: '#9ccfd8',
      },
      foreground: '#e0def4', cursor: '#524f67', selection: '#403d52',
      ansi: [
        '#26233a', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4',
        '#6e6a86', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4',
      ],
    },
    light: {
      chrome: {
        base: '#f2e9e1', sidebar: '#fffaf3', content: '#faf4ed', raised: '#fffaf3', label: '#575279',
        accent: '#907aa9', onAccent: '#ffffff', orange: '#c27a1e', red: '#b4637a', green: '#286983',
      },
      foreground: '#575279', cursor: '#cecacd', selection: '#dfdad9',
      ansi: [
        '#9893a5', '#b4637a', '#286983', '#ea9d34', '#56949f', '#907aa9', '#d7827e', '#575279',
        '#9893a5', '#b4637a', '#286983', '#ea9d34', '#56949f', '#907aa9', '#d7827e', '#575279',
      ],
    },
  },
  {
    id: 'everforest',
    name: 'Everforest',
    // Medium contrast, dark and light.
    dark: {
      chrome: {
        base: '#232a2e', sidebar: '#343f44', content: '#2d353b', raised: '#3d484d', label: '#d3c6aa',
        accent: '#a7c080', onAccent: '#2d353b', orange: '#e69875', red: '#e67e80', green: '#83c092',
      },
      foreground: '#d3c6aa', cursor: '#d3c6aa', selection: '#543a48',
      ansi: [
        '#475258', '#e67e80', '#a7c080', '#dbbc7f', '#7fbbb3', '#d699b6', '#83c092', '#d3c6aa',
        '#859289', '#e67e80', '#a7c080', '#dbbc7f', '#7fbbb3', '#d699b6', '#83c092', '#e1d6bc',
      ],
    },
    light: {
      chrome: {
        base: '#efebd4', sidebar: '#f4f0d9', content: '#fdf6e3', raised: '#fffbef', label: '#5c6a72',
        accent: '#8da101', onAccent: '#2d353b', orange: '#f57d26', red: '#f85552', green: '#35a77c',
      },
      foreground: '#5c6a72', cursor: '#5c6a72', selection: '#eaedc8',
      ansi: [
        '#5c6a72', '#f85552', '#8da101', '#dfa000', '#3a94c5', '#df69ba', '#35a77c', '#939f91',
        '#a6b0a0', '#f85552', '#8da101', '#dfa000', '#3a94c5', '#df69ba', '#35a77c', '#5c6a72',
      ],
    },
  },
  {
    id: 'flexoki',
    name: 'Flexoki',
    dark: {
      chrome: {
        base: '#100f0f', sidebar: '#282726', content: '#1c1b1a', raised: '#343331', label: '#cecdc3',
        accent: '#3aa99f', onAccent: '#100f0f', orange: '#da702c', red: '#d14d41', green: '#879a39',
      },
      foreground: '#cecdc3', cursor: '#cecdc3', selection: '#403e3c',
      ansi: [
        '#403e3c', '#d14d41', '#879a39', '#d0a215', '#4385be', '#ce5d97', '#3aa99f', '#cecdc3',
        '#575653', '#d14d41', '#879a39', '#d0a215', '#4385be', '#ce5d97', '#3aa99f', '#e6e4d9',
      ],
    },
    light: {
      chrome: {
        base: '#e6e4d9', sidebar: '#f2f0e5', content: '#fffcf0', raised: '#fffcf0', label: '#100f0f',
        accent: '#24837b', onAccent: '#fffcf0', orange: '#bc5215', red: '#af3029', green: '#66800b',
      },
      foreground: '#100f0f', cursor: '#100f0f', selection: '#dad8ce',
      ansi: [
        '#100f0f', '#af3029', '#66800b', '#ad8301', '#205ea6', '#a02f6f', '#24837b', '#6f6e69',
        '#878580', '#d14d41', '#879a39', '#d0a215', '#4385be', '#ce5d97', '#3aa99f', '#282726',
      ],
    },
  },
  {
    id: 'indigo',
    name: 'Indigo',
    // Our own: near-black and white with one indigo accent, after the look of modern work apps.
    dark: {
      chrome: {
        base: '#08090a', sidebar: '#0e0f11', content: '#131416', raised: '#1c1d21', label: '#f7f8f8',
        accent: '#5e6ad2', onAccent: '#ffffff', orange: '#f2994a', red: '#eb5757', green: '#4cb782',
      },
      foreground: '#e2e4e7', cursor: '#7c85e8', selection: '#2a2e52',
      ansi: [
        '#2a2c31', '#eb5757', '#4cb782', '#f2c94c', '#6e79e0', '#b88cf2', '#4ab8c7', '#d0d3d8',
        '#62666d', '#ff7a7a', '#68d39c', '#f7d774', '#8f98f0', '#cfa8ff', '#6fd0dc', '#f7f8f8',
      ],
    },
    light: {
      chrome: {
        base: '#eeeff2', sidebar: '#f5f5f7', content: '#ffffff', raised: '#ffffff', label: '#282a30',
        accent: '#5e6ad2', onAccent: '#ffffff', orange: '#d9731f', red: '#d93f3f', green: '#2f9e67',
      },
      foreground: '#282a30', cursor: '#5e6ad2', selection: '#dfe1f7',
      ansi: [
        '#282a30', '#d23b3b', '#25845a', '#a8790c', '#4f5bc4', '#8a4fd1', '#16839a', '#6b6f76',
        '#8a8f98', '#e5534b', '#2f9e67', '#c28a10', '#5e6ad2', '#9b62e0', '#2096ae', '#3c3f46',
      ],
    },
  },
]

const DEFAULT_BASE = { dark: '#0b0e13', light: '#e9ebef' }

const dark = matchMedia('(prefers-color-scheme: dark)')
let current = THEMES.find(t => t.id === window.deck.theme()) ?? THEMES[0]
let systemAccent = window.deck.accent()
const listeners = new Set<() => void>()

const variant = () => (dark.matches ? current.dark : current.light)

export const currentTheme = () => current

/** The xterm theme for the current theme and appearance. */
export function terminalTheme(): ITheme {
  const v = variant()
  const background = v.chrome?.content ?? (dark.matches ? '#10131a' : '#ffffff')
  return {
    background,
    foreground: v.foreground,
    cursor: v.cursor,
    cursorAccent: background,
    selectionBackground: v.selection,
    ...Object.fromEntries(ANSI_NAMES.map((name, i) => [name, v.ansi[i]])),
  }
}

/** Called when the theme or the appearance changes. */
export function onThemeChange(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const TOKENS = [
  '--base', '--sidebar', '--content', '--raised', '--glass', '--label', '--secondary', '--tertiary',
  '--accent', '--on-accent', '--orange', '--red', '--green', '--tile', '--field',
]

function apply() {
  const root = document.documentElement.style
  const chrome = variant().chrome
  TOKENS.forEach(token => root.removeProperty(token))
  if (!chrome) {
    root.setProperty('--accent', systemAccent)
    return
  }
  // Some themes' raised color is their sidebar's, so cards step away from it: lighter in dark, toward
  // white in light, as Default's do.
  const card = dark.matches
    ? `color-mix(in srgb, ${chrome.label} 6%, ${chrome.raised})`
    : `color-mix(in srgb, #ffffff 55%, ${chrome.raised})`
  const tokens: Record<string, string> = {
    '--base': chrome.base,
    '--sidebar': chrome.sidebar,
    '--content': chrome.content,
    '--raised': chrome.raised,
    '--glass': `color-mix(in srgb, ${chrome.raised} 85%, transparent)`,
    '--label': chrome.label,
    '--secondary': `color-mix(in srgb, ${chrome.label} 62%, transparent)`,
    '--tertiary': `color-mix(in srgb, ${chrome.label} 36%, transparent)`,
    '--accent': chrome.accent,
    '--on-accent': chrome.onAccent,
    '--orange': chrome.orange,
    '--red': chrome.red,
    '--green': chrome.green,
    '--tile': card,
    // Dark fields are a see-through wash already; light ones are white, which cream themes need tinted.
    ...(dark.matches ? {} : { '--field': card }),
  }
  for (const [token, value] of Object.entries(tokens)) root.setProperty(token, value)
}

// The main process keeps the choice and builds View → Theme, and paints the window in the theme's
// base before the page loads, so it needs the names and both bases.
function tellMain() {
  window.deck.setTheme({
    id: current.id,
    names: THEMES.map(t => ({ id: t.id, name: t.name })),
    windowColors: {
      dark: current.dark.chrome?.base ?? DEFAULT_BASE.dark,
      light: current.light.chrome?.base ?? DEFAULT_BASE.light,
    },
  })
}

export function setTheme(id: string) {
  const next = THEMES.find(t => t.id === id)
  if (!next || next === current) return
  current = next
  apply()
  tellMain()
  listeners.forEach(l => l())
}

apply()
tellMain()
dark.addEventListener('change', () => {
  apply()
  listeners.forEach(l => l())
})
window.deck.onAccent(color => {
  systemAccent = color
  apply()
})

// Hot-swapping this module would leave the terminals and the appearance listener on the old copy, so
// an edit reloads the window instead; the shells keep running and main replays their output.
import.meta.hot?.accept(() => location.reload())
