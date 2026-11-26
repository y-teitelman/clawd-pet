export type ToolEntry = {
  id: string
  tool: string
  label: string
  state: 'run' | 'ok' | 'err'
}

export type Working = { startedAt: number }

export type LastTurn = { ms: number; tools: number; isAborted: boolean }

export type Bubble = { text: string; until: number }

export type ClawdLang = 'uk' | 'en'

export type ClawdSkin = 'classic' | 'mint' | 'lavender' | 'sky' | 'gold' | 'night'

export type ClawdSettings = {
  v: 1
  /** False until the person pressed Done on the first-run settings. */
  isSetUp: boolean
  lang: 'auto' | ClawdLang
  /** Lines written by a small model (costs tokens) instead of built-in ones. */
  ai: boolean
  /** Whether the model may see the first 200 characters of a prompt. */
  sendPrompt: boolean
  chatter: 'often' | 'normal' | 'rare' | 'off'
  /** Tool rows, spinner and hints move from the chat into the pane. */
  cleanChat: boolean
  affection: boolean
  favorite: 'random' | 'hearts' | 'shy' | 'tsundere'
  skin: ClawdSkin
  /** Minutes of quiet before it dozes off. */
  sleep: 'off' | '5' | '15' | '30'
  greet: boolean
  /** Sad on a failed tool, glad when a turn ends, startled when it is stopped. */
  events: boolean
  /** Context, rate limits and cost at the bottom of the pane. */
  usage: boolean
  /** A row of buttons for common slash commands. */
  quick: boolean
}

/** What the pane shows of the session's usage, refreshed every few seconds. */
export type UsageView = {
  ctxPercent: number | null
  ctxTokens: number | null
  ctxWindow: number
  limits: { kind: string; percent: number; resetsAt: string | null }[]
  usd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'clawd-pet': {
      working: Shaped<Working | null>
      tools: Shaped<ToolEntry[]>
      last: Shaped<LastTurn | null>
      bubble: Shaped<Bubble | null>
      frame: number
      settings: Shaped<ClawdSettings>
      view: 'pet' | 'settings'
      affection: number
      detected: ClawdLang
      usage: Shaped<UsageView | null>
    }
  }
}
