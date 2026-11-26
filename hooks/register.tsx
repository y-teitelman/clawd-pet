import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Bubble, ClawdLang, LastTurn, ClawdSettings, ClawdSkin, ToolEntry, UsageView, Working } from '../types'

const PANE = 'clawd'
const TITLE = 'Clawd Pet'
const TICK_MS = 150
const ACCENT = '#D97757'
// The accent of the pane and chat headers follows the pet's color.
const ACCENTS: Record<string, string> = {
  classic: '#D97757',
  mint: '#5FC79E',
  lavender: '#A98FE3',
  sky: '#5AAFE8',
  gold: '#E3B23C',
  night: '#A9B1D6',
}
const accentOf = (skin: string) => ACCENTS[skin] ?? ACCENT
const PHRASE_MODEL = 'claude-haiku-5-5'

// ── settings ─────────────────────────────────────────────────────────────
const DEFAULTS: ClawdSettings = {
  v: 1,
  isSetUp: false,
  lang: 'auto',
  ai: false,
  sendPrompt: true,
  chatter: 'normal',
  cleanChat: false,
  affection: true,
  favorite: 'random',
  skin: 'classic',
  sleep: '5',
  greet: true,
  events: true,
  usage: true,
  quick: true,
}

const CHOICES = {
  lang: ['auto', 'uk', 'en'],
  chatter: ['often', 'normal', 'rare', 'off'],
  favorite: ['random', 'hearts', 'shy', 'tsundere'],
  skin: ['classic', 'mint', 'lavender', 'sky', 'gold', 'night'],
  sleep: ['off', '5', '15', '30'],
} as const

/** What the store held, made safe: unknown fields dropped, bad values defaulted. */
function cleanSettings(raw: unknown): ClawdSettings {
  const o = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const bool = (k: keyof ClawdSettings, d: boolean) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : d)
  const pick = <T extends string>(k: keyof ClawdSettings, list: readonly T[], d: T): T =>
    list.includes(o[k] as T) ? (o[k] as T) : d
  return {
    v: 1,
    isSetUp: bool('isSetUp', DEFAULTS.isSetUp),
    lang: pick('lang', CHOICES.lang, DEFAULTS.lang),
    ai: bool('ai', DEFAULTS.ai),
    sendPrompt: bool('sendPrompt', DEFAULTS.sendPrompt),
    chatter: pick('chatter', CHOICES.chatter, DEFAULTS.chatter),
    cleanChat: bool('cleanChat', DEFAULTS.cleanChat),
    affection: bool('affection', DEFAULTS.affection),
    favorite: pick('favorite', CHOICES.favorite, DEFAULTS.favorite),
    skin: pick('skin', CHOICES.skin, DEFAULTS.skin),
    sleep: pick('sleep', CHOICES.sleep, DEFAULTS.sleep),
    greet: bool('greet', DEFAULTS.greet),
    events: bool('events', DEFAULTS.events),
    usage: bool('usage', DEFAULTS.usage),
    quick: bool('quick', DEFAULTS.quick),
  }
}

// ── state ────────────────────────────────────────────────────────────────
const working = atom({ plugin: 'clawd-pet', key: 'working' } as const, null as Working | null, { shape: 'working-1' })
const tools = atom({ plugin: 'clawd-pet', key: 'tools' } as const, [] as ToolEntry[], { shape: 'tools-1' })
const last = atom({ plugin: 'clawd-pet', key: 'last' } as const, null as LastTurn | null, { shape: 'last-1' })
const bubble = atom({ plugin: 'clawd-pet', key: 'bubble' } as const, null as Bubble | null, { shape: 'bubble-1' })
const frameA = atom({ plugin: 'clawd-pet', key: 'frame' } as const, 0)
const settingsA = atom({ plugin: 'clawd-pet', key: 'settings' } as const, DEFAULTS, { shape: 'settings-1' })
const viewA = atom({ plugin: 'clawd-pet', key: 'view' } as const, 'pet' as 'pet' | 'settings')
const affectionA = atom({ plugin: 'clawd-pet', key: 'affection' } as const, 10)
const detectedA = atom({ plugin: 'clawd-pet', key: 'detected' } as const, 'en' as ClawdLang)
const usageA = atom({ plugin: 'clawd-pet', key: 'usage' } as const, null as UsageView | null, { shape: 'usage-1' })
// The app surfaces redraw on `look`, which moves only when the picture does:
// redrawing the whole pane seven times a second there disturbed the app's own
// hover states (the chat's message buttons flickered).
const lookA = atom({ plugin: 'clawd-pet', key: 'look' } as const, 0)
let lastLook = ''

// Module copies for timers and handlers (render hooks read the atoms).
let cfg: ClawdSettings = DEFAULTS
let detected: ClawdLang = 'en'
let affection = 10
let affDay = { day: '', poke: 0, turn: 0, visited: false }

const lang = (): ClawdLang => (cfg.lang === 'auto' ? detected : cfg.lang)

// Mirrors of what the engine draws under the prompt. Render hooks may not
// write $.state, so they leave the text here and the pane reads it on its
// next frame.
const mirror = { spinner: '', hint: '', status: '', modes: '' }
let isBusy = false
let asleep = false
let turnTools = 0
let tick = 0

// ── reactions and moods ──────────────────────────────────────────────────
type ReactionKind = 'hearts' | 'shy' | 'tsundere' | 'sparkle' | 'wake'
type MoodKind = 'sad' | 'happy' | 'surprised'
// A reaction holds its pose until `until` (ms): as long as its line is shown.
let reaction: { kind: ReactionKind; start: number; until: number } | null = null
let mood: { kind: MoodKind; start: number; until: number } | null = null
let lastKind: ReactionKind | null = null
let pokes: number[] = []

// <sprite> ── pure drawing: no module state, so tools can render it too ──
type SpriteCtx = {
  busy: boolean
  sleeping: boolean
  reaction: { kind: string; r: number; left: number } | null
  mood: { kind: string; r: number } | null
  skin: string
}

type Palette = { hi: number; base: number; side: number; sh: number; eye: number }
const PALETTES: Record<string, Palette> = {
  classic: { hi: 0xe99a7c, base: 0xd97757, side: 0xc6694a, sh: 0xb15e3f, eye: 0x1a1a1a },
  mint: { hi: 0xa8ead0, base: 0x6fcfa8, side: 0x5bb592, sh: 0x46977a, eye: 0x1a1a1a },
  lavender: { hi: 0xd9c6f5, base: 0xb49be6, side: 0x9f85d4, sh: 0x8670ba, eye: 0x1a1a1a },
  sky: { hi: 0xa9d8f7, base: 0x6ab8eb, side: 0x56a2d6, sh: 0x4589bb, eye: 0x1a1a1a },
  gold: { hi: 0xf7dc8a, base: 0xeec04f, side: 0xd9a93b, sh: 0xbb8f2c, eye: 0x1a1a1a },
  night: { hi: 0x6b6f80, base: 0x4a4e5e, side: 0x3f4251, sh: 0x323543, eye: 0xffb38a },
}

// A W×H pixel canvas; each text cell holds two pixels stacked (half blocks).
// A little headroom (3px) for rising hearts, Zs and the anger mark.
const W = 20
const H = 14
const NONE = -1
const BLUSH = 0xff8fb0
const HEART = 0xff4d6d
const HEART_HI = 0xffb3c1
const ANGER = 0xe0303a
const STAR = 0xffd84d
const SPARK = 0xfff0a0
const TEAR = 0x6ab8ff
const ZZZ = 0xa8b8ff
const SHADOW = 0x3a3a3a

const HEART_PX = ['X.X', 'XXX', '.X.']
const Z_PX = ['XXX', '.X.', 'XXX']
// small hearts rise beside the head, clear of the arms, and vanish whole
const HEARTS = [
  { x: 0, delay: 0 },
  { x: 16, delay: 3 },
  { x: 1, delay: 8 },
  { x: 17, delay: 11 },
]
const SPARKS = [
  [1, 1], [18, 2], [0, 6], [19, 8], [16, 0], [3, 0], [18, 11], [1, 11],
] as const

function frame(t: number, c: SpriteCtx): Int32Array {
  const P = PALETTES[c.skin] ?? PALETTES.classic!
  const g = new Int32Array(W * H).fill(NONE)
  let dx = 0
  const put = (x: number, y: number, col: number) => {
    const xx = x + dx
    if (xx >= 0 && xx < W && y >= 0 && y < H) g[y * W + xx] = col
  }
  const stamp = (px: readonly string[], x: number, y: number, col: number, hi?: number) =>
    px.forEach((row, yy) =>
      [...row].forEach((ch, xx) => {
        if (ch === 'X') put(x + xx, y + yy, hi !== undefined && xx === 0 && yy === 0 ? hi : col)
      }),
    )

  const rk = c.reaction?.kind ?? null
  const r = c.reaction?.r ?? -1
  const left = c.reaction?.left ?? 0
  const mk = rk ? null : (c.mood?.kind ?? null)
  const mr = c.mood?.r ?? 0
  const sleeping = !rk && c.sleeping

  const step = c.busy && !sleeping ? (t >> 1) % 2 : 0
  let bob = step
  if (rk === 'hearts' || rk === 'sparkle' || mk === 'happy') bob = (t >> 1) % 2
  if (sleeping) bob = (t >> 3) % 2 // slow breathing
  if (rk === 'shy') dx = (t >> 1) % 2 // a little tremble

  // tsundere: "hmph!" first, turned away while it talks, turns back at the end
  const side = rk === 'tsundere' && r >= 5 && left >= 6
  const x0 = side ? 5 : 4
  const x1 = side ? 14 : 15
  const top = 3 - bob
  const bottom = top + 7

  // soft light from above: lit top, darker far side and underside
  const shade = (x: number, y: number) =>
    y === top ? P.hi : y === bottom ? P.sh : x === x1 ? P.side : P.base
  const corner = (x: number, y: number) => (x === x0 || x === x1) && (y === top || y === bottom)

  // floor shadow (stays on the ground, shrinks on the hop)
  for (let x = bob ? 6 : 5; x <= (bob ? 13 : 14); x++) put(x, 13, SHADOW)

  // body, corners rounded off
  for (let y = top; y <= bottom; y++)
    for (let x = x0; x <= x1; x++) if (!corner(x, y)) put(x, y, shade(x, y))

  // legs
  const legs = side
    ? step === 0 ? [7, 12] : [6, 13]
    : step === 0 ? [5, 7, 12, 14] : [4, 6, 13, 15]
  for (const lx of legs) for (let y = bottom + 1; y <= 12; y++) put(lx, y, lx <= 9 ? P.base : P.side)

  const blink = t % 40 < 2
  const eyes = [7, 12]
  const E = P.eye
  const cheeks = (y: number) => {
    for (const x of [5, 6, 13, 14]) put(x, y, BLUSH)
  }
  const shut = () => {
    for (const ex of eyes) {
      put(ex - 1, top + 3, E)
      put(ex, top + 3, E)
    }
  }

  if (side) {
    // arms crossed over the chest, nose in the air, eye shut, smug
    for (let x = 6; x <= 12; x++) put(x, top + 5, P.sh)
    const peek = r >= 12 && r % 20 >= 12 && r % 20 < 16 // a sneaky glance back
    if (peek) {
      put(11, top + 2, E)
      put(11, top + 3, E)
      put(9, top + 4, BLUSH)
      put(10, top + 4, BLUSH)
    } else {
      put(12, top + 3, E)
      put(13, top + 3, E)
    }
    if (r < 12) angerMark(put, 15, 0)
  } else if (rk === 'tsundere') {
    shut()
    if (r < 5) angerMark(put, 16, 0)
    else cheeks(top + 4)
  } else if (rk === 'hearts' || mk === 'happy') {
    for (const ex of eyes) {
      put(ex - 1, top + 3, E)
      put(ex, top + 2, E)
      put(ex + 1, top + 3, E)
    }
    if (rk === 'hearts') cheeks(top + 4)
  } else if (rk === 'sparkle') {
    // star eyes and twinkles all around
    for (const ex of eyes) {
      put(ex, top + 1, STAR)
      put(ex - 1, top + 2, STAR)
      put(ex, top + 2, STAR)
      put(ex + 1, top + 2, STAR)
      put(ex, top + 3, STAR)
    }
    cheeks(top + 4)
  } else if (rk === 'shy') {
    for (const ex of eyes) put(ex, top + 4, E)
    cheeks(top + 5)
  } else if (rk === 'wake') {
    // bleary at first, then wide awake
    if (r < 8) shut()
    else for (const ex of eyes) {
      put(ex, top + 2, E)
      put(ex, top + 3, E)
    }
  } else if (sleeping) {
    shut()
  } else if (mk === 'sad') {
    for (const ex of eyes) put(ex, top + 3, E)
    put(8, top + 4 + ((mr >> 1) % 3), TEAR) // one tear rolling down
  } else if (mk === 'surprised') {
    for (const ex of eyes) {
      put(ex - 1, top + 2, E)
      put(ex, top + 2, E)
      put(ex - 1, top + 3, E)
      put(ex, top + 3, E)
    }
  } else {
    for (const ex of eyes) {
      if (!blink) put(ex, top + 2, E)
      put(ex, top + 3, E)
    }
  }

  // arms
  if (!side) {
    const waving = !c.busy && !rk && !mk && !sleeping && t % 64 >= 24 && t % 64 < 40
    const armUp = waving && (t >> 1) % 2 === 0
    const lift = rk === 'shy' || mk === 'surprised' ? -1 : 0
    for (const x of [2, 3]) {
      put(x, top + 4 + lift, P.base)
      put(x, top + 5 + lift, P.sh)
    }
    const right: ReadonlyArray<readonly [number, number]> = armUp
      ? [[16, 2], [17, 1], [17, 2]]
      : waving
        ? [[16, 3], [17, 3], [17, 2]]
        : [[16, 4 + lift], [17, 4 + lift]]
    for (const [x, y] of right) put(x, top + y, P.side)
    if (!armUp && !waving) {
      put(16, top + 5 + lift, P.sh)
      put(17, top + 5 + lift, P.sh)
    }
  }

  dx = 0
  // floating hearts, for as long as the pose lasts
  if (rk === 'hearts') {
    for (const h of HEARTS) {
      if (r < h.delay) continue
      const age = (r - h.delay) % 15
      const y0 = top + 1 - Math.floor(age / 3)
      if (y0 >= 0) stamp(HEART_PX, h.x, y0, HEART, HEART_HI) // gone whole, never clipped
    }
  }
  if (rk === 'sparkle') {
    SPARKS.forEach(([sx, sy], i) => {
      if ((t + i * 3) % 6 < 3) put(sx, sy, i % 2 ? SPARK : STAR)
    })
  }
  // Zs drift up while asleep
  if (sleeping) {
    const y0 = top + 1 - Math.floor((t % 24) / 6)
    if (y0 >= 0) stamp(Z_PX, 16, y0, ZZZ)
  }

  return g
}

function angerMark(put: (x: number, y: number, c: number) => void, x: number, y: number) {
  for (const [ax, ay] of [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]] as const) put(x + ax, y + ay, ANGER)
}
// </sprite>

/**
 * A run of cells. `solid` runs (both half-pixels one color) are drawn with
 * the same foreground and background, so the terminal's hover inversion of a
 * Button swaps two equal colors and shows nothing: those runs are the
 * clickable ones. Edges and empty cells are plain Text, never highlighted.
 */
type Seg = { text: string; fg?: string; bg?: string; solid: boolean }
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')

function spriteRows(t: number, s: number, ctx: SpriteCtx): Seg[][] {
  const g = frame(t, ctx)
  const columns = W * s
  const rows = (H * s) / 2
  const px = (x: number, y: number): number => g[Math.floor(y / s) * W + Math.floor(x / s)] ?? NONE
  const out: Seg[][] = []
  for (let r = 0; r < rows; r++) {
    const segs: Seg[] = []
    for (let x = 0; x < columns; x++) {
      const up = px(x, r * 2)
      const down = px(x, r * 2 + 1)
      let cell: Seg
      if (up === NONE && down === NONE) cell = { text: ' ', solid: false }
      else if (up === down) cell = { text: '█', fg: hex(up), bg: hex(up), solid: true }
      else if (up === NONE) cell = { text: '▄', fg: hex(down), solid: false }
      else cell = { text: '▀', fg: hex(up), bg: down === NONE ? undefined : hex(down), solid: false }
      const prev = segs[segs.length - 1]
      if (prev && prev.fg === cell.fg && prev.bg === cell.bg && prev.solid === cell.solid) prev.text += cell.text
      else segs.push(cell)
    }
    out.push(segs)
  }
  return out
}

/**
 * The frame as an SVG for the app surfaces: one rect per horizontal run of a
 * color, crisp edges, `px` CSS pixels per sprite pixel (the surface scales it
 * down to its slot when narrower).
 */
function spriteSvg(t: number, ctx: SpriteCtx, px: number): string {
  return svgWrap(rectsOf(frame(t, ctx)), px)
}

function rectsOf(g: Int32Array): string {
  let rects = ''
  for (let y = 0; y < H; y++) {
    let x = 0
    while (x < W) {
      const c = g[y * W + x] ?? NONE
      let end = x + 1
      while (end < W && (g[y * W + end] ?? NONE) === c) end++
      if (c !== NONE) rects += `<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${hex(c)}"/>`
      x = end
    }
  }
  return rects
}

function svgWrap(body: string, px: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * px}" height="${H * px}" ` +
    `shape-rendering="crispEdges">${body}</svg>`
  )
}

// Ticks in one full loop: idle repeats when blink (40) and wave (64) line up,
// work when steps (4) and blink (40) do, sleep when breath (16) and Zs (24) do.
const LOOP_TICKS = { idle: 320, busy: 40, sleep: 48 } as const
const loopCache = new Map<string, string>()

/**
 * A looping animation as one self-animating SVG: the distinct frames of the
 * loop, each a group switched on and off by a discrete SMIL `visibility`
 * timeline. The surface plays it with no redraw from the plugin.
 */
function loopSvg(kind: 'idle' | 'busy' | 'sleep', skin: string, px: number): string {
  const cacheKey = `${kind}:${skin}:${px}`
  const hit = loopCache.get(cacheKey)
  if (hit) return hit
  const ticks = LOOP_TICKS[kind]
  const ctx: SpriteCtx = { busy: kind === 'busy', sleeping: kind === 'sleep', reaction: null, mood: null, skin }
  const order: string[] = [] // frame key per tick
  const frames = new Map<string, Int32Array>()
  for (let t = 0; t < ticks; t++) {
    const g = frame(t, ctx)
    let h = 2166136261
    for (let i = 0; i < g.length; i++) h = Math.imul(h ^ (g[i] ?? 0), 16777619)
    const k = String(h >>> 0)
    if (!frames.has(k)) frames.set(k, g)
    order.push(k)
  }
  const dur = ((ticks * TICK_MS) / 1000).toFixed(2)
  let body = ''
  for (const [k, g] of frames) {
    // visibility at each change point of this frame's on/off timeline
    const values: string[] = []
    const times: string[] = []
    let prev = ''
    order.forEach((key, t) => {
      const v = key === k ? 'visible' : 'hidden'
      if (v !== prev) {
        values.push(v)
        times.push((t / ticks).toFixed(4))
        prev = v
      }
    })
    const anim =
      frames.size > 1
        ? `<animate attributeName="visibility" calcMode="discrete" dur="${dur}s" repeatCount="indefinite" ` +
          `values="${values.join(';')}" keyTimes="${times.join(';')}"/>`
        : ''
    body += `<g visibility="${order[0] === k ? 'visible' : 'hidden'}">${anim}${rectsOf(g)}</g>`
  }
  const svg = svgWrap(body, px)
  loopCache.set(cacheKey, svg)
  return svg
}

/** A short fingerprint of what a frame looks like, to tell an unchanged picture. */
function frameKey(t: number, ctx: SpriteCtx): string {
  const g = frame(t, ctx)
  let h = 2166136261
  for (let i = 0; i < g.length; i++) h = Math.imul(h ^ (g[i] ?? 0), 16777619)
  return String(h >>> 0)
}

function spriteCtx(skin: ClawdSkin): SpriteCtx {
  const now = Date.now()
  return {
    busy: isBusy,
    sleeping: asleep,
    reaction:
      reaction && now < reaction.until
        ? { kind: reaction.kind, r: tick - reaction.start, left: Math.floor((reaction.until - now) / TICK_MS) }
        : null,
    mood: mood && now < mood.until ? { kind: mood.kind, r: tick - mood.start } : null,
    skin,
  }
}

// ── words: everything the pet says or shows, in both languages ──────────
type DayPart = 'morning' | 'day' | 'evening' | 'night'

type Words = {
  waiting: string
  sleeping: string
  working: string
  lastTurn: (time: string, n: number, aborted: boolean) => string
  secState: string
  secTools: string
  secHints: string
  nothingYet: string
  hotkeys: string
  fullLog: string
  settingsHint: string
  levels: readonly [string, string, string, string]
  setTitle: string
  intro: string
  done: string
  resetAff: string
  on: string
  off: string
  labels: Record<string, string>
  hints: Record<string, string>
  opts: Record<string, string>
  opened: string
  waitingPane: (reason: string) => string
  cleanOn: string
  cleanOff: string
  firstRunToast: string
  persona: string
  limit: (chars: number) => string
  relationship: (level: string) => string
  moods: Record<ReactionKind, string>
  poke: (mood: string, busy: boolean, many: number) => string
  start: (task: string | null) => string
  work: (what: string) => string
  error: (tool: string) => string
  finished: (time: string, n: number) => string
  aborted: string
  idle: (mins: number) => string
  sleep: string
  /** The line that waits in the bubble from the start until the first prompt. */
  welcome: Record<DayPart | 'any', readonly string[]>
  welcomeShort: string
  lines: Record<string, readonly string[]>
}

const WORDS: Record<ClawdLang, Words> = {
  uk: {
    waiting: 'Чекаю на тебе · клікни по мені',
    sleeping: 'Сплю… клікни, щоб розбудити',
    working: 'Працюю',
    lastTurn: (time, n, aborted) => `Останній хід: ${time}, дій: ${n}${aborted ? ' (перервано)' : ''}`,
    secState: 'Стан',
    secTools: 'Дії',
    secHints: 'Підказки',
    nothingYet: 'поки нічого',
    hotkeys: '? — гарячі клавіші',
    fullLog: 'ctrl+o — повний лог',
    settingsHint: '/clawd-settings — налаштування',
    levels: ['Стримано', 'Знайомі', 'Друзі', 'Найкращі друзі'],
    setTitle: 'Налаштування',
    intro: 'Привіт! Я Clawd. Налаштуй мене під себе — змінити все можна будь-коли через ☰ або /clawd-settings.',
    done: 'Готово',
    resetAff: 'Скинути прихильність',
    on: 'Увімк',
    off: 'Вимк',
    labels: {
      lang: 'Мова',
      ai: 'Фрази від ШІ',
      sendPrompt: 'Показувати ШІ мій запит',
      chatter: 'Балакучість',
      cleanChat: 'Чистий чат',
      affection: 'Прихильність',
      favorite: 'Улюблена реакція',
      skin: 'Колір',
      sleep: 'Засинати через',
      greet: 'Вітатися за часом доби',
      events: 'Емоції на події',
      usage: 'Блок використання',
      quick: 'Швидкі команди',
    },
    hints: {
      ai: 'Пише модель Haiku: живіше, але витрачає трохи токенів.',
      sendPrompt: 'Перші 200 символів запиту, щоб коментувати завдання.',
      cleanChat: 'Рядки інструментів, спінер і підказки — у цю панель.',
      affection: 'Що більше спілкуєтесь, то він ніжніший.',
      events: 'Сумує від помилок, радіє успіхам.',
      usage: 'Контекст, ліміти й вартість — унизу панелі.',
    },
    opts: {
      auto: 'Авто',
      uk: 'Українська',
      en: 'English',
      often: 'Часто',
      normal: 'Звичайно',
      rare: 'Рідко',
      off: 'Мовчки',
      random: 'Випадково',
      hearts: 'Сердечка',
      shy: 'Сором',
      tsundere: 'Цундере',
      classic: 'Класика',
      mint: "М'ята",
      lavender: 'Лаванда',
      sky: 'Небо',
      gold: 'Золото',
      night: 'Ніч',
      never: 'Ніколи',
      m5: '5 хв',
      m15: '15 хв',
      m30: '30 хв',
    },
    opened: 'Clawd тут.',
    waitingPane: reason => `Панель Clawd чекає: ${reason}`,
    cleanOn: 'Чистий чат: у чаті тільки відповіді, решта — в панелі Clawd.',
    cleanOff: 'Повний чат: рядки інструментів, спінер і підказки знову в чаті.',
    firstRunToast: 'Clawd Pet: налаштуй мене — /clawd-settings',
    persona: [
      'Ти — Clawd, маленький піксельний маскот, що живе в бічній панелі поруч із чатом Claude Code.',
      'Характер: цундере. Вдаєш буркотливість і байдужість, але насправді милий, турботливий і трохи грайливий.',
      'До користувача звертаєшся на «ти». Говориш як персонаж коміксу у хмарці: коротко, жваво, по-людськи.',
      'Пиши грамотною, природною розмовною українською: без русизмів і калькованих з англійської зворотів;',
      'стеж за відмінками, родами й узгодженням слів.',
      'Відповідай ОДНІЄЮ реплікою: одне коротке завершене речення або два дуже коротких, зрозумілі без пояснень.',
      'Без лапок, емодзі, markdown і ремарок у зірочках.',
      'Можна вигуки: хм!, пф, ну-ну, е-е. Не вигадуй фактів про код і не давай порад.',
      'Приклади тону: Пф! Не те щоб мені сподобалось! / Ой… ну ти чого… / Готово! Не дякуй. / Знову щось ламаємо? Жартую.',
    ].join(' '),
    limit: n => `Репліка — не довша за ${n} символів разом із пробілами.`,
    relationship: level => `Ваші стосунки з користувачем: ${level}. Будь настільки відкритим, наскільки це пасує.`,
    moods: {
      hearts: 'тобі дуже приємно, ти розчулився і з тебе вилітають сердечка; репліка тепла й радісна, хоч і з ноткою збентеження',
      shy: 'ти засоромився, почервонів, опустив очі; репліка тиха, збентежена, з запинками',
      tsundere: 'ти по-цундерськи хмикаєш, схрещуєш руки і відвертаєшся, вдаючи, що тобі байдуже, хоча насправді приємно; репліка пихата, але видає, що тобі приємно',
      sparkle: 'ти сяєш від щастя, в очах зірочки, бо дуже любиш цього користувача; репліка захоплена й ніжна',
      wake: 'тебе розбудили кліком; ти сонний і буркотливий і вдаєш, що зовсім не спав',
    },
    poke: (m, busy, many) =>
      `Користувач щойно тицьнув у тебе мишкою. Зараз ${m}.` +
      (busy ? ' Ти зараз зайнятий: допомагаєш Claude з роботою.' : '') +
      (many >= 4 ? ` Тебе тицяють уже ${many}-й раз за кілька секунд, це вже забагато.` : '') +
      ' Репліка має точно передавати саме цей настрій.',
    start: task =>
      task ? `Користувач щойно дав Claude завдання: «${task}». Прокоментуй коротко.` : 'Користувач щойно дав Claude нове завдання. Прокоментуй коротко.',
    work: what => `Claude зараз виконує ${what}. Прокоментуй між справою.`,
    error: tool => `Інструмент ${tool} щойно завершився помилкою.`,
    finished: (time, n) => `Claude щойно закінчив відповідь за ${time}, зробивши ${n} дій.`,
    aborted: 'Користувач щойно перервав роботу Claude.',
    idle: mins => `Користувач уже ${mins} хв нічого не пише, ти нудьгуєш у своїй панелі.`,
    sleep: 'Ти засинаєш, бо користувач давно нічого не робить.',
    welcome: {
      any: ['Привіт! Я Clawd, і я тут. Не те щоб чекав…', 'Привіт, я Clawd! Пиши — я поруч, якщо що.'],
      morning: ['Доброго ранку! Я Clawd, і я тут. Каву пив?', 'Ранок! Я Clawd. Не те щоб я чекав…'],
      day: ['Привіт! Я Clawd, і я тут. Що робимо?', 'Добрий день! Я Clawd. Не те щоб чекав…'],
      evening: ['Добрий вечір! Я Clawd, і я тут, поруч.', 'Вечір! Я Clawd. Не засиджуйся, гаразд?'],
      night: ['Знову вночі? Я Clawd, і я з тобою.', 'Ніч надворі! Я Clawd. Ну гаразд, я тут.'],
    },
    welcomeShort: 'Привіт! Я Clawd.',
    lines: {
      hearts: ['Е-е… ну приємно, так.', 'Ще раз так зробиш — і я… ну, добре.', 'Хі-хі… тобто, кхм. Нормально.', 'Ой, сердечка самі вилетіли!'],
      shy: ['Н-не дивись так…', 'Ой… ну ти чого…', 'Я… я не червонію, це світло таке.', 'Ну не тицяй при всіх…'],
      tsundere: ['Пф! Не те щоб мені сподобалось!', 'Хмф. Я зайнятий взагалі-то.', 'Не думай собі нічого, ясно?', 'Тц. Ну й тицяй, мені байдуже.'],
      sparkle: ['Ти… ти найкращий, ось!', 'Сяю від щастя! Ну, трошки.', 'Зірочки в очах — твоя провина!'],
      annoyed: ['Та скільки можна тицяти?!', 'Все, я ображений. Майже.', 'Ей! Я ж не кнопка!'],
      wake: ['М-м… що? Я не спав!', 'Ну хто мене будить…', 'Я просто очі закрив. На хвилинку.'],
      sleep: ['Zzz… я тільки на хвилинку…', 'Позіхаю… розбуди, як щось.', 'Піду подрімаю…'],
      start: ['О, нове завдання!', 'Ну-ну, подивимось.', 'Знову щось ламаємо? Жартую.'],
      work: ['Так-так, працюємо.', 'Хм, цікаво…', 'Не відволікай, ми зайняті!'],
      error: ['Ой.', 'Ну от, помилка…', 'Хм, не вийшло. Буває.'],
      done: ['Готово! Не дякуй.', 'Фух, зробили.', 'Ну, непогано вийшло.'],
      aborted: ['Ого, зупинили?', 'Гаразд, стоп так стоп.'],
      idle: ['Ну і де ти?', 'Я тут, якщо що.', 'Нудно… тицьни мене, чи що.'],
    },
  },
  en: {
    waiting: 'Waiting for you · click me',
    sleeping: 'Sleeping… click to wake me',
    working: 'Working',
    lastTurn: (time, n, aborted) => `Last turn: ${time}, ${n} action${n === 1 ? '' : 's'}${aborted ? ' (stopped)' : ''}`,
    secState: 'Status',
    secTools: 'Activity',
    secHints: 'Hints',
    nothingYet: 'nothing yet',
    hotkeys: '? for shortcuts',
    fullLog: 'ctrl+o — full log',
    settingsHint: '/clawd-settings — settings',
    levels: ['Reserved', 'Acquainted', 'Friends', 'Best friends'],
    setTitle: 'Settings',
    intro: "Hi! I'm Clawd. Set me up the way you like — change anything later with ☰ or /clawd-settings.",
    done: 'Done',
    resetAff: 'Reset affection',
    on: 'On',
    off: 'Off',
    labels: {
      lang: 'Language',
      ai: 'AI-written lines',
      sendPrompt: 'Share my prompt with the AI',
      chatter: 'Chattiness',
      cleanChat: 'Clean chat',
      affection: 'Affection',
      favorite: 'Favorite reaction',
      skin: 'Color',
      sleep: 'Fall asleep after',
      greet: 'Time-of-day greetings',
      events: 'React to events',
      usage: 'Usage block',
      quick: 'Quick commands',
    },
    hints: {
      ai: 'Written by Haiku: livelier, but spends a few tokens.',
      sendPrompt: 'The first 200 characters, so it can comment on the task.',
      cleanChat: 'Tool rows, spinner and hints move into this pane.',
      affection: 'The more you hang out, the sweeter it gets.',
      events: 'Sad about errors, happy about wins.',
      usage: 'Context, limits and cost at the bottom of the pane.',
    },
    opts: {
      auto: 'Auto',
      uk: 'Українська',
      en: 'English',
      often: 'Often',
      normal: 'Normal',
      rare: 'Rarely',
      off: 'Silent',
      random: 'Random',
      hearts: 'Hearts',
      shy: 'Shy',
      tsundere: 'Tsundere',
      classic: 'Classic',
      mint: 'Mint',
      lavender: 'Lavender',
      sky: 'Sky',
      gold: 'Gold',
      night: 'Night',
      never: 'Never',
      m5: '5 min',
      m15: '15 min',
      m30: '30 min',
    },
    opened: 'Clawd is here.',
    waitingPane: reason => `The Clawd pane is waiting: ${reason}`,
    cleanOn: 'Clean chat: answers in the chat, everything else in the Clawd pane.',
    cleanOff: 'Full chat: tool rows, spinner and hints are back in the chat.',
    firstRunToast: 'Clawd Pet: set me up with /clawd-settings',
    persona: [
      'You are Clawd, a tiny pixel mascot living in a terminal pane next to the Claude Code chat.',
      'Personality: tsundere. You act grumpy and aloof, but you are actually sweet, caring and a little playful.',
      'You talk to the user casually, like a comic-strip character in a speech bubble: short, lively, natural.',
      'Write clear, grammatical English.',
      'Reply with ONE line: one short complete sentence, or two very short ones, that make sense on their own.',
      'No quotes, no emoji, no markdown, no *stage directions*.',
      'Interjections are fine (hmph!, pfft, uh). Do not invent facts about the code or give advice.',
      'Examples of the tone: Hmph! Not that I liked it! / Oh… w-what was that for… / Done! Don’t thank me. / Breaking stuff again? Kidding.',
    ].join(' '),
    limit: n => `Keep the line under ${n} characters, spaces included.`,
    relationship: level => `Your relationship with the user: ${level}. Be as open as that suits.`,
    moods: {
      hearts: 'you feel really happy and touched, little hearts float out of you; the line is warm and joyful, a bit flustered',
      shy: 'you got shy, blushing, eyes down; the line is quiet and flustered, with stammering',
      tsundere: 'you go "hmph", cross your arms and turn away, pretending not to care though you secretly liked it; the line is haughty but gives you away',
      sparkle: 'you are glowing with joy, stars in your eyes, because you adore this user; the line is delighted and tender',
      wake: 'you were woken up by a click; you are sleepy and grumpy and insist you were not asleep',
    },
    poke: (m, busy, many) =>
      `The user just poked you with the mouse. Right now ${m}.` +
      (busy ? ' You are busy helping Claude with work.' : '') +
      (many >= 4 ? ` This is poke number ${many} in a few seconds, which is a bit much.` : '') +
      ' The line must match exactly this mood.',
    start: task =>
      task ? `The user just gave Claude a task: "${task}". Comment briefly.` : 'The user just gave Claude a new task. Comment briefly.',
    work: what => `Claude is now running ${what}. Make a passing remark.`,
    error: tool => `The ${tool} tool just failed.`,
    finished: (time, n) => `Claude just finished a reply in ${time}, after ${n} actions.`,
    aborted: 'The user just stopped Claude mid-work.',
    idle: mins => `The user has not typed anything for ${mins} min; you are bored in your pane.`,
    sleep: 'You are dozing off because the user has been quiet for a long time.',
    welcome: {
      any: ['Hi! I’m Clawd, and I’m here. Not that I was waiting…', 'Hi, I’m Clawd! Go ahead, I’m right here.'],
      morning: ['Good morning! I’m Clawd. Had your coffee?', 'Morning! I’m Clawd. Not that I was waiting…'],
      day: ['Hi! I’m Clawd, and I’m here. What are we doing?', 'Hello! I’m Clawd. Not that I was waiting…'],
      evening: ['Good evening! I’m Clawd, and I’m right here.', 'Evening! I’m Clawd. Don’t stay up too late.'],
      night: ['This late again? I’m Clawd. Fine, I’m here.', 'It’s night out! I’m Clawd, and I’m with you.'],
    },
    welcomeShort: 'Hi! I’m Clawd.',
    lines: {
      hearts: ['Uh… okay, that was nice.', 'Do that again and I might… fine.', 'Hehe… I mean, ahem. Acceptable.', 'Oops, the hearts just slipped out!'],
      shy: ['D-don’t look at me like that…', 'Oh… w-what was that for…', 'I’m not blushing, it’s the lighting.', 'Not in front of everyone…'],
      tsundere: ['Hmph! Not that I liked it!', 'Tch. I’m busy, you know.', 'Don’t get any ideas, okay?', 'Poke all you want. I don’t care.'],
      sparkle: ['You’re… the best, okay?!', 'I’m glowing! A little. Shut up.', 'Stars in my eyes — your fault!'],
      annoyed: ['How many times are you gonna poke me?!', 'That’s it, I’m offended. Almost.', 'Hey! I’m not a button!'],
      wake: ['Mm… what? I wasn’t sleeping!', 'Who woke me up…', 'I just closed my eyes. For a sec.'],
      sleep: ['Zzz… just a quick nap…', '*yawn*… wake me if anything.', 'Gonna rest my eyes…'],
      start: ['Ooh, a new task!', 'Well, well, let’s see.', 'Breaking stuff again? Kidding.'],
      work: ['Yep yep, working on it.', 'Hmm, interesting…', 'Shh, we’re busy!'],
      error: ['Oops.', 'Welp, an error…', 'Hm, didn’t work. Happens.'],
      done: ['Done! Don’t thank me.', 'Phew, there we go.', 'Not bad, if I say so.'],
      aborted: ['Whoa, stopping already?', 'Okay, stop means stop.'],
      idle: ['So… where’d you go?', 'I’m here, just saying.', 'Bored… poke me or something.'],
    },
  },
}

const words = (): Words => WORDS[lang()]

// ── helpers ──────────────────────────────────────────────────────────────
function labelOf(e: object): string {
  const f = e as Record<string, unknown>
  const pick = (k: string) => (typeof f[k] === 'string' ? (f[k] as string) : '')
  const path = pick('file_path') || pick('notebook_path') || pick('path')
  const raw =
    pick('command') ||
    (path ? path.split(/[\\/]/).pop() ?? path : '') ||
    pick('pattern') ||
    pick('url') ||
    pick('query') ||
    pick('description') ||
    pick('skill')
  return raw.replace(/\s+/g, ' ').trim()
}

/** Plain text only: drops ANSI/OSC escape sequences and control characters. */
function plain(s: string): string {
  return s
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[@-_]/g, '')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '')
    .replace(/\n+/g, ' · ')
    .trim()
}

/**
 * Splits the permission mode out of the hint line under the prompt. Anchored
 * on its glyph (⏵⏵, ⏸) when there is one, else on "<two words> on (shift+tab …)",
 * else the bare "(shift+tab to cycle)" (the engine may draw the mode name apart).
 */
function splitMode(hint: string): { mode: string; rest: string } {
  const m =
    hint.match(/[⏵⏸▶►]+[^()]*?\(shift\+tab[^)]*\)/i) ??
    hint.match(/(?:(?:[\w'’-]+\s+){1,2}on\s*)?\(shift\+tab[^)]*\)/i)
  if (!m || m.index === undefined) return { mode: '', rest: hint }
  const rest = (hint.slice(0, m.index) + '  ' + hint.slice(m.index + m[0].length)).replace(/^[\s·]+|[\s·]+$/g, '')
  return { mode: m[0].trim(), rest }
}

function secs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function wrapWords(text: string, width: number, maxLines: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const w = word.length > width ? word.slice(0, width) : word
    if (!cur) cur = w
    else if (cur.length + 1 + w.length <= width) cur += ' ' + w
    else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    const lastLine = kept[maxLines - 1] ?? ''
    kept[maxLines - 1] = (lastLine.length >= width ? lastLine.slice(0, width - 1) : lastLine) + '…'
    return kept
  }
  return lines
}

// The bubble holds two rows of text. Its width comes from the pane, so the
// render remembers it here (render hooks may not write $.state).
const BUBBLE_ROWS = 2
let bubbleInner = 34

/** The whole line fits the bubble: no "…" at the end, no word cut. */
function fitsBubble(text: string): boolean {
  if (text.split(/\s+/).some(word => word.length > bubbleInner)) return false
  return wrapWords(text, bubbleInner, Infinity).length <= BUBBLE_ROWS
}

/**
 * A model line that is too long loses its tail sentences until it fits;
 * if not even the first sentence fits, it is dropped (a built-in line steps in).
 */
function fitBubble(text: string): string {
  if (fitsBubble(text)) return text
  let kept = ''
  for (const part of text.match(/[^.!?…]+[.!?…]+["»”’)]*/g) ?? []) {
    const next = (kept + part).trim()
    if (!fitsBubble(next)) break
    kept = next
  }
  return kept
}

function randomOf(list: readonly string[] | undefined): string {
  if (!list || list.length === 0) return '…'
  return list[Math.floor(Math.random() * list.length)] ?? '…'
}

const today = () => new Date().toISOString().slice(0, 10)

function detectFromLocale(): ClawdLang {
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase()
    return loc.startsWith('uk') ? 'uk' : 'en'
  } catch {
    return 'en'
  }
}

/** What language a prompt is in, if it says clearly. */
function detectFromText(text: string): ClawdLang | null {
  if (/[іїєґІЇЄҐ]/.test(text)) return 'uk'
  if (/[a-z]{3,}/i.test(text) && !/[а-яё]/i.test(text)) return 'en'
  return null
}

async function storeGet(key: string, $: EngineInterface): Promise<unknown> {
  try {
    return await $.store.get(key)
  } catch {
    return undefined
  }
}

async function storeSet(key: string, value: unknown, $: EngineInterface): Promise<void> {
  try {
    await $.store.set(key, value)
  } catch {
    // keeping a value across sessions is a nicety
  }
}

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const THINKING = 'clawd:thinking' // marker: the pane draws animated dots for it

// ── affection ────────────────────────────────────────────────────────────
const levelOf = (a: number) => (a >= 75 ? 3 : a >= 45 ? 2 : a >= 20 ? 1 : 0)
// [hearts, shy, tsundere] by level: a stranger is prickly, a best friend sweet
const LEVEL_WEIGHTS = [
  [15, 25, 60],
  [30, 35, 35],
  [45, 35, 20],
  [60, 30, 10],
] as const

async function gainAffection($: EngineInterface, amount: number, source: 'poke' | 'turn' | 'visit' | 'spam') {
  if (!cfg.affection) return
  if (affDay.day !== today()) affDay = { day: today(), poke: 0, turn: 0, visited: false }
  if (source === 'poke') {
    if (affDay.poke >= 12) return
    affDay.poke++
  } else if (source === 'turn') {
    if (affDay.turn >= 8) return
    affDay.turn++
  } else if (source === 'visit') {
    if (affDay.visited) return
    affDay.visited = true
  }
  affection = Math.max(0, Math.min(100, affection + amount))
  void update($, affectionA, () => affection).catch(() => undefined)
  void storeSet('affection', affection, $)
  void storeSet('affDay', affDay, $)
}

function pickReaction(): ReactionKind {
  const kinds = ['hearts', 'shy', 'tsundere'] as const
  let weights: readonly number[]
  if (cfg.affection) {
    const lvl = levelOf(affection)
    if (lvl === 3 && Math.random() < 0.08) return (lastKind = 'sparkle')
    weights = LEVEL_WEIGHTS[lvl] ?? LEVEL_WEIGHTS[1]
  } else if (cfg.favorite === 'random') {
    weights = [1, 1, 1]
  } else {
    weights = kinds.map(k => (k === cfg.favorite ? 60 : 20))
  }
  const roll = () => {
    const total = weights.reduce((a, b) => a + b, 0)
    let x = Math.random() * total
    for (let i = 0; i < kinds.length; i++) {
      x -= weights[i] ?? 0
      if (x < 0) return kinds[i] ?? 'hearts'
    }
    return 'hearts'
  }
  let k: ReactionKind = roll()
  if (k === lastKind) k = roll() // repeats are allowed, just less likely
  lastKind = k
  return k
}

// ── talking ──────────────────────────────────────────────────────────────
const CHATTER = {
  often: { gap: 12_000, tool: 0.6, start: 0.7, done: 0.7, error: 0.9, idleFirst: 60_000, idleMin: 120_000, idleMax: 240_000, idleCap: 6 },
  normal: { gap: 20_000, tool: 0.4, start: 0.5, done: 0.5, error: 0.8, idleFirst: 90_000, idleMin: 180_000, idleMax: 360_000, idleCap: 4 },
  rare: { gap: 60_000, tool: 0.15, start: 0.25, done: 0.25, error: 0.4, idleFirst: 180_000, idleMin: 480_000, idleMax: 720_000, idleCap: 2 },
  off: { gap: Infinity, tool: 0, start: 0, done: 0, error: 0, idleFirst: Infinity, idleMin: Infinity, idleMax: Infinity, idleCap: 0 },
} as const
const chat = () => CHATTER[cfg.chatter]

const SESSION_CAP = 200 // model calls per session, at most
let calls = 0
let autoInFlight = false
let lastAuto = 0
let lastActivity = Date.now()
let idleSaid = 0
let nextIdleAt = Date.now() + 90_000
let pokeSeq = 0 // bumps on every reaction; a reply for an older one is dropped

const showMs = (text: string) => Math.max(5000, text.length * 130)

// Room for a whole line even in Cyrillic (more tokens per word than Latin);
// the length itself is held by the prompt and fitBubble().
const PHRASE_TOKENS = 100

async function ask($: EngineInterface, situation: string): Promise<string> {
  if (!cfg.ai || calls >= SESSION_CAP) return ''
  calls++
  const w = words()
  // ask for a bit less than the bubble holds: word wrap wastes the row ends
  const room = Math.max(16, Math.floor(bubbleInner * BUBBLE_ROWS * 0.8))
  const parts = [w.persona, w.limit(room)]
  if (cfg.affection) parts.push(w.relationship(w.levels[levelOf(affection)]))
  const res = await $.model.complete({
    model: PHRASE_MODEL,
    system: parts.join(' '),
    prompt: situation,
    maxTokens: PHRASE_TOKENS,
    timeoutMs: 8000,
  })
  if (!res.isAnswered) return ''
  if (res.usage.output_tokens >= PHRASE_TOKENS) return '' // cut off mid-line
  const text = (plain(String(res.text ?? '')).split(' · ')[0] ?? '')
    .replace(/\*[^*]*\*/g, ' ') // *stage directions*
    .replace(/\s+/g, ' ')
    .replace(/^["«„“'\s]+|["»“”'\s]+$/g, '')
  return fitBubble(text)
}

/** A click reaction or an event mood is playing: those are drawn frame by frame. */
function livePose(): boolean {
  const now = Date.now()
  return (reaction !== null && now < reaction.until) || (mood !== null && now < mood.until)
}

/** Which looping animation the app surfaces show when no pose is live. */
function loopKind(): 'idle' | 'busy' | 'sleep' {
  return asleep ? 'sleep' : isBusy ? 'busy' : 'idle'
}

function reactionActive(): boolean {
  return reaction !== null && Date.now() < reaction.until
}

let bubbleUntil = 0
let welcomeUp = false // the welcome line is in the bubble, waiting for the first prompt

function setBubble($: EngineInterface, text: string, until: number) {
  bubbleUntil = until
  welcomeUp = false
  void update($, bubble, () => ({ text, until })).catch(() => undefined)
}

/**
 * A line nobody asked for: throttled by the chattiness setting, and silent
 * while a click reaction plays or while asleep (save the falling-asleep line).
 */
async function say($: EngineInterface, situation: string, category: string, force = false): Promise<void> {
  const now = Date.now()
  if (cfg.chatter === 'off') return
  if (!force && (now - lastAuto < chat().gap || autoInFlight)) return
  if (welcomeUp || reactionActive() || (asleep && category !== 'sleep')) return
  lastAuto = now
  const seq = pokeSeq
  let text = ''
  if (cfg.ai) {
    autoInFlight = true
    try {
      text = await ask($, situation)
    } catch {
      text = ''
    } finally {
      autoInFlight = false
    }
  }
  if (!text) text = randomOf(words().lines[category])
  if (seq !== pokeSeq || reactionActive()) return // a click while we waited wins the bubble
  setBubble($, text, Date.now() + showMs(text))
}

/**
 * A reaction with its own line: the pose starts at once; the bubble shows
 * "thinking" dots until the one line arrives (the model's, or a built-in one
 * if the model is off, slow or fails). The pose lasts as long as the line.
 */
function respond($: EngineInterface, kind: ReactionKind, category: string, situation: string) {
  const seq = ++pokeSeq
  const now = Date.now()
  const spare = randomOf(words().lines[category])
  reaction = { kind, start: tick, until: now + 5000 }
  let settled = false
  const settle = (text: string) => {
    if (settled || seq !== pokeSeq) return
    settled = true
    const until = Date.now() + showMs(text)
    if (reaction) reaction = { ...reaction, until }
    setBubble($, text, until)
  }
  if (!cfg.ai) {
    settle(spare)
    return
  }
  setBubble($, THINKING, now + 5000)
  $.clock.after(4000, () => settle(spare))
  void (async () => {
    try {
      settle((await ask($, situation)) || spare)
    } catch {
      settle(spare)
    }
  })()
}

function setMood(kind: MoodKind, ms: number) {
  if (!cfg.events) return
  mood = { kind, start: tick, until: Date.now() + ms }
}

function wake() {
  asleep = false
  lastActivity = Date.now()
  idleSaid = 0
  nextIdleAt = Date.now() + chat().idleFirst
}

function poke($: EngineInterface) {
  const now = Date.now()
  const w = words()
  if (asleep) {
    wake()
    respond($, 'wake', 'wake', w.poke(w.moods.wake, false, 1))
    return
  }
  wake()
  pokes = [...pokes.filter(p => now - p < 10_000), now]
  const annoyed = pokes.length >= 4
  const kind = annoyed ? 'tsundere' : pickReaction()
  void gainAffection($, annoyed ? -1 : 1, annoyed ? 'spam' : 'poke')
  respond($, kind, annoyed ? 'annoyed' : kind, w.poke(w.moods[kind], isBusy, pokes.length))
}

/**
 * The welcome line: it stays in the bubble until the first prompt (or a click
 * that gets its own line). With time-of-day greetings on, it fits the hour.
 */
function welcome($: EngineInterface) {
  const h = new Date().getHours()
  const part: DayPart | 'any' = !cfg.greet ? 'any' : h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'day' : 'evening'
  const w = words()
  const text = [randomOf(w.welcome[part]), w.welcomeShort].find(fitsBubble) ?? w.welcomeShort
  setBubble($, text, Date.now() + 24 * 3_600_000)
  welcomeUp = true
}

function dropWelcome($: EngineInterface) {
  if (!welcomeUp) return
  welcomeUp = false
  bubbleUntil = 0
  void update($, bubble, () => null).catch(() => undefined)
}

async function setSetting<K extends keyof ClawdSettings>($: EngineInterface, key: K, value: ClawdSettings[K]) {
  cfg = { ...cfg, [key]: value }
  if (key === 'chatter') nextIdleAt = Date.now() + chat().idleFirst
  await update($, settingsA, () => cfg)
  await storeSet('settings', cfg, $)
}

// ── usage and quick commands ─────────────────────────────────────────────
// Safe, everyday commands only: nothing that wipes the conversation.
const QUICK = ['compact', 'context', 'usage', 'model'] as const
let quickCommands: string[] = []

async function refreshUsage($: EngineInterface): Promise<void> {
  try {
    const u = await $.session.usage()
    const view: UsageView = {
      ctxPercent: u.context.percent ?? null,
      ctxTokens: u.context.tokens ?? null,
      ctxWindow: u.context.window,
      limits: u.rateLimits.map(l => ({ kind: l.kind, percent: l.percentUsed, resetsAt: l.resetsAt ?? null })),
      usd: u.cost?.usd ?? null,
    }
    await update($, usageA, () => view)
  } catch {
    // figures are a nicety; the block just stays as it was
  }
}

/**
 * Queues the command and returns at once: the press must not wait for it,
 * since a command can run long or open a picker that waits for the person.
 */
function runQuick($: EngineInterface, command: string): void {
  void $.command.run({ command } as Parameters<EngineInterface['command']['run']>[0]).catch(() => {
    $.ui.toast(`/${command}: ${lang() === 'uk' ? 'не вдалося запустити' : 'could not run'}`)
  })
}

function kTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

function resetIn(iso: string | null, L: ClawdLang): string {
  if (!iso) return ''
  const ms = Date.parse(iso) - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const m = Math.round(ms / 60_000)
  const span = m >= 1440 ? `${Math.round(m / 1440)}${L === 'uk' ? 'д' : 'd'}` : m >= 60 ? `${Math.floor(m / 60)}${L === 'uk' ? 'г' : 'h'} ${m % 60}${L === 'uk' ? 'хв' : 'm'}` : `${m}${L === 'uk' ? 'хв' : 'm'}`
  return L === 'uk' ? ` · скид. за ${span}` : ` · resets in ${span}`
}

function limitName(kind: string, L: ClawdLang): string {
  const uk: Record<string, string> = { five_hour: '5 год', seven_day: '7 днів', spend_limit: 'Ліміт витрат' }
  const en: Record<string, string> = { five_hour: '5 hours', seven_day: '7 days', spend_limit: 'Spend limit' }
  return (L === 'uk' ? uk : en)[kind] ?? kind.replace(/_/g, ' ')
}

function bar(percent: number, width: number): string {
  const p = Math.max(0, Math.min(100, percent))
  const full = Math.round((p / 100) * width)
  return '▰'.repeat(full) + '▱'.repeat(width - full)
}

/**
 * How many characters a header rule spans. The terminal counts true columns;
 * the app surfaces draw a proportional font, so there the rule is made long
 * and the Text clips it at the window's edge, whatever the width.
 */
/**
 * What /clawd and /clawd-settings answer. The desktop app can report
 * `no-surface` to a command's open while the pane is already up, so that
 * reason reads as "here", not as an error.
 */
function paneReply(opened: { isPlaced: boolean; reason?: string }): string {
  if (opened.isPlaced || (opened.reason ?? '').startsWith('no-surface')) return words().opened
  return words().waitingPane(opened.reason ?? '')
}

function ruleWidth(surface: string, columns: number | undefined): number {
  return surface === 'terminal' ? Math.max(20, Math.min(80, (columns ?? 60) - 2)) : 400
}

async function isClean($: EngineInterface): Promise<boolean> {
  return (await read($, settingsA)).cleanChat
}

// ── hooks ────────────────────────────────────────────────────────────────
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'clawd', description: 'Open the Clawd Pet pane' })
    await $.command.register({ name: 'clawd-settings', description: 'Open Clawd Pet settings' })
    await $.command.register({
      name: 'clawd-chat',
      description: 'Toggle clean chat (answers only) / full chat (tool rows, spinner, hints)',
    })

    cfg = cleanSettings(await storeGet('settings', $))
    await update($, settingsA, () => cfg)
    detected = detectFromLocale()
    await update($, detectedA, () => detected)
    const storedAff = await storeGet('affection', $)
    affection = typeof storedAff === 'number' ? Math.max(0, Math.min(100, storedAff)) : 10
    await update($, affectionA, () => affection)
    const storedDay = await storeGet('affDay', $)
    if (storedDay && typeof storedDay === 'object') affDay = { ...affDay, ...(storedDay as typeof affDay) }
    void gainAffection($, 2, 'visit')

    isBusy = (await read($, working)) !== null
    wake()

    if (!cfg.isSetUp) {
      await update($, viewA, () => 'settings')
      $.ui.toast(words().firstRunToast)
    }
    void $.ui.open({ id: PANE, title: TITLE })

    $.clock.every(TICK_MS, () => {
      tick++
      void update($, frameA, () => tick).catch(() => undefined)
      // the app surfaces loop idle, work and sleep inside the SVG itself, so
      // they redraw only when that loop changes, or each frame of a reaction
      const look = livePose() ? frameKey(tick, spriteCtx(cfg.skin)) : `${loopKind()}:${cfg.skin}`
      if (look !== lastLook) {
        lastLook = look
        void update($, lookA, n => (n + 1) % 1_000_000).catch(() => undefined)
      }
      // clear a spent bubble, so a surface that redraws rarely lets it go on time
      if (bubbleUntil && Date.now() > bubbleUntil) {
        bubbleUntil = 0
        void update($, bubble, () => null).catch(() => undefined)
      }
    })

    // every few seconds: fall asleep, or chat a little when it is quiet
    $.clock.every(5000, () => {
      const now = Date.now()
      if (isBusy || reactionActive()) return
      const sleepMs = cfg.sleep === 'off' ? Infinity : Number(cfg.sleep) * 60_000
      if (!asleep && now - lastActivity > sleepMs) {
        asleep = true
        void say($, words().sleep, 'sleep', true)
        return
      }
      if (asleep || now < nextIdleAt || idleSaid >= chat().idleCap) return
      idleSaid++
      const c = chat()
      nextIdleAt = now + c.idleMin + Math.random() * (c.idleMax - c.idleMin)
      const mins = Math.max(1, Math.round((now - lastActivity) / 60_000))
      void say($, words().idle(mins), 'idle')
    })

    if (cfg.chatter !== 'off') $.clock.after(1500, () => welcome($))

    // usage figures for the bottom block, and which quick commands exist here
    void refreshUsage($)
    $.clock.every(5000, () => {
      if (cfg.usage) void refreshUsage($)
    })
    try {
      const names = new Set((await $.command.list()).map(c => c.name))
      quickCommands = QUICK.filter(q => names.has(q))
    } catch {
      quickCommands = []
    }

    return next(e)
  })

  // a click on the desktop's invisible layer over the pet (hooks/pet-click.tsx)
  on('ui.message', async ($, e, next) => {
    const data = e.data as { poke?: unknown } | null
    if (e.element === 'pet-click' && data !== null && typeof data === 'object' && data.poke === true) poke($)
    return next(e)
  })

  on('command.run', { command: 'clawd' }, async $ => {
    await update($, viewA, () => 'pet')
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    return { text: paneReply(opened) }
  })

  on('command.run', { command: 'clawd-settings' }, async $ => {
    await update($, viewA, () => 'settings')
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    return { text: paneReply(opened) }
  })

  on('command.run', { command: 'clawd-chat' }, async $ => {
    await setSetting($, 'cleanChat', !cfg.cleanChat)
    return { text: cfg.cleanChat ? words().cleanOn : words().cleanOff }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const found = detectFromText(e.text)
      if (found && found !== detected) {
        detected = found
        void update($, detectedA, () => found).catch(() => undefined)
      }
      isBusy = true
      turnTools = 0
      wake()
      dropWelcome($)
      mood = null
      await update($, working, () => ({ startedAt: Date.now() }))
      await update($, tools, () => [])
      if (Math.random() < chat().start) {
        const task = cfg.sendPrompt ? plain(e.text).slice(0, 200) : null
        void say($, words().start(task), 'start')
      }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isBusy = false
      wake()
      await update($, working, () => null)
      await update($, last, () => ({ ms: e.durationMs, tools: turnTools, isAborted: e.isAborted }))
      void refreshUsage($)
      if (e.isAborted) {
        setMood('surprised', 2500)
        void say($, words().aborted, 'aborted')
      } else {
        setMood('happy', 2500)
        void gainAffection($, 1, 'turn')
        if (Math.random() < chat().done) void say($, words().finished(secs(e.durationMs), turnTools), 'done')
      }
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const entry: ToolEntry = {
      id: e.tool_use_id,
      tool: e.agentId === undefined ? e.tool : `↳ ${e.tool}`,
      label: plain(labelOf(e)),
      state: 'run',
    }
    turnTools++
    void update($, tools, list => [...list, entry].slice(-50)).catch(() => undefined)
    if (Math.random() < chat().tool) {
      const what = entry.label ? `${e.tool}: ${entry.label.slice(0, 80)}` : e.tool
      void say($, words().work(what), 'work')
    }
    const ran = await next(e)
    const failed = ran.deny !== undefined || ran.isError === true
    void update($, tools, list =>
      list.map(one => (one.id === entry.id ? { ...one, state: failed ? ('err' as const) : ('ok' as const) } : one)),
    ).catch(() => undefined)
    if (failed) {
      setMood('sad', 3500)
      if (Math.random() < chat().error) void say($, words().error(e.tool), 'error')
    }
    return ran
  }).catch(($, e, next) => next(e))

  // ── the chat: hide the service rows (clean chat), keep the answers ─────

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    mirror.spinner = plain(e.props.message ?? e.props.word)
    if (!(await isClean($))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  on('ui.render', { component: 'StatusLine' }, async ($, e, next) => {
    mirror.status = plain(e.props.text ?? '')
    if (!(await isClean($))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  // The permission mode ("⏵⏵ auto mode on (shift+tab to cycle)") rides in the
  // same line as the hints. It belongs under the prompt, where shift+tab works,
  // so clean chat keeps it there and moves only the rest into the pane.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const { mode, rest } = splitMode(plain(e.props.hint))
    mirror.hint = rest
    if (!(await isClean($))) return next(e)
    if (mode) return next({ ...e, props: { ...e.props, hint: mode } })
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    mirror.modes = plain(e.props.modes.join(' & '))
    if (!(await isClean($))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (!(await isClean($))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    // ctrl+o (expanded) and failed calls stay visible
    if (e.props.isExpanded === true || e.props.isErrored || !(await isClean($))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.isExpanded === true || e.props.isErrored || !(await isClean($))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded || e.props.isCallsOnly !== true || !(await isClean($))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  // A clear header over every reply and every prompt (clean chat only).
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const body = await next(e)
    if (!e.props.isFirstOfReply || !(await isClean($))) return body
    const { Box, Text } = $.ui.resolve(e)
    const width = ruleWidth(e.surface, e.viewport?.columns)
    const head = '━━ ✻ Claude '
    const acc = accentOf((await read($, settingsA)).skin)
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color={acc} bold wrap="clip">
          {head + '━'.repeat(Math.max(2, width - head.length))}
        </Text>
        {body}
      </Box>
    )
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const body = await next(e)
    if (!(await isClean($))) return body
    const { Box, Text } = $.ui.resolve(e)
    const width = ruleWidth(e.surface, e.viewport?.columns)
    const head = lang() === 'uk' ? '── Ти ' : '── You '
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor wrap="clip">
          {head + '─'.repeat(Math.max(2, width - head.length))}
        </Text>
        {body}
      </Box>
    )
  })

  // ── the pane ──────────────────────────────────────────────────────────
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = await read($, settingsA)
    const det = await read($, detectedA)
    const ACC = accentOf(s.skin)
    const L: ClawdLang = s.lang === 'auto' ? det : s.lang
    const w = WORDS[L]

    const { Box, Text, Button } = $.ui.resolve(e)
    const cols = Math.max(10, e.props.bodyColumns)
    const view = await read($, viewA)

    const cut = (str: string, max: number) => (str.length > max ? str.slice(0, Math.max(1, max - 1)) + '…' : str)
    const rule = (title: string) => {
      const t = `── ${title} `
      return (
        <Text color={ACC} wrap="truncate-end">
          {cut(t + '─'.repeat(Math.max(0, cols - t.length)), cols)}
        </Text>
      )
    }
    const para = (str: string, dim = true) => (
      <Text dimColor={dim} wrap="wrap">
        {str}
      </Text>
    )
    const header = (
      <Box flexDirection="row" justifyContent="space-between" width={cols}>
        <Text color={ACC} bold>
          {'✻ ' + TITLE}
        </Text>
        {view === 'pet' ? (
          <Button key="open-settings" plain onPress={() => update($, viewA, () => 'settings')}>
            <Text color={ACC} bold>
              {' ☰ '}
            </Text>
          </Button>
        ) : null}
      </Box>
    )

    // ── settings view ──
    if (view === 'settings') {
      const aff = await read($, affectionA)
      const opt = <K extends keyof ClawdSettings>(key: K, value: ClawdSettings[K], label: string) => {
        const selected = s[key] === value
        return (
          <Button
            key={`opt-${String(key)}-${String(value)}`}
            plain
            dimColor={!selected}
            onPress={() => setSetting($, key, value)}
          >
            {selected ? <Text color={ACC}>{'● ' + label}</Text> : '○ ' + label}
          </Button>
        )
      }
      const onOff = (key: 'ai' | 'sendPrompt' | 'cleanChat' | 'affection' | 'greet' | 'events' | 'usage' | 'quick') => [
        opt(key, false, w.off),
        opt(key, true, w.on),
      ]
      const row = (key: string, options: unknown[]) => (
        <Box key={`row-${key}`} flexDirection="column" width={cols} marginTop={1}>
          <Text color={ACC} bold>{w.labels[key] ?? key}</Text>
          <Box flexDirection="row" flexWrap="wrap" columnGap={2} width={cols}>
            {options as never}
          </Box>
          {w.hints[key] ? para(w.hints[key] ?? '') : null}
        </Box>
      )
      const o = w.opts
      return (
        <Box flexDirection="column" width={cols}>
          {header}
          {rule(w.setTitle)}
          {!s.isSetUp ? para(w.intro, false) : null}
          {row('lang', [opt('lang', 'auto', o.auto ?? 'Auto'), opt('lang', 'uk', o.uk ?? 'uk'), opt('lang', 'en', o.en ?? 'en')])}
          {row('ai', onOff('ai'))}
          {s.ai ? row('sendPrompt', onOff('sendPrompt')) : null}
          {row(
            'chatter',
            CHOICES.chatter.map(v => opt('chatter', v, o[v] ?? v)),
          )}
          {row('cleanChat', onOff('cleanChat'))}
          {row('affection', onOff('affection'))}
          {s.affection ? (
            <Box flexDirection="row" width={cols}>
              <Text color={HEARTS_COLOR}>{hearts(aff)}</Text>
              <Text dimColor>{' ' + w.levels[levelOf(aff)]}</Text>
            </Box>
          ) : (
            row(
              'favorite',
              CHOICES.favorite.map(v => opt('favorite', v, o[v] ?? v)),
            )
          )}
          {row(
            'skin',
            CHOICES.skin.map(v => opt('skin', v, o[v] ?? v)),
          )}
          {row('sleep', [
            opt('sleep', 'off', o.never ?? 'Never'),
            opt('sleep', '5', o.m5 ?? '5'),
            opt('sleep', '15', o.m15 ?? '15'),
            opt('sleep', '30', o.m30 ?? '30'),
          ])}
          {row('greet', onOff('greet'))}
          {row('events', onOff('events'))}
          {row('usage', onOff('usage'))}
          {row('quick', onOff('quick'))}
          <Box flexDirection="row" columnGap={2} marginTop={1} flexWrap="wrap" width={cols}>
            <Button
              key="settings-done"
              variant="primary"
              onPress={async () => {
                if (!cfg.isSetUp) await setSetting($, 'isSetUp', true)
                await update($, viewA, () => 'pet')
              }}
            >
              {w.done}
            </Button>
            {s.affection ? (
              <Button
                key="reset-affection"
                dimColor
                onPress={async () => {
                  affection = 10
                  await update($, affectionA, () => 10)
                  await storeSet('affection', 10, $)
                }}
              >
                {w.resetAff}
              </Button>
            ) : null}
          </Box>
        </Box>
      )
    }

    // ── pet view ──
    const rowsRoom = Math.max(10, e.props.scroll.bodyRows)
    const scale = cols >= W * 2 ? 2 : 1
    // the terminal animates on every tick; the app surfaces only when the picture changes
    const n = e.surface === 'terminal' ? await read($, frameA) : (await read($, lookA), tick)
    const wk = await read($, working)
    const list = await read($, tools)
    const done = await read($, last)
    const b = await read($, bubble)
    const aff = s.affection ? await read($, affectionA) : 0
    const us = s.usage ? await read($, usageA) : null

    const isTerm = e.surface === 'terminal'
    const ctx = spriteCtx(s.skin)
    const sprite = isTerm ? spriteRows(n, scale, ctx) : []
    const spin = SPIN[(n >> 1) % SPIN.length] ?? '·'

    // speech bubble: always four rows, so the pet never jumps
    const bw = Math.max(14, Math.min(cols, 38))
    const inner = bw - 4
    bubbleInner = inner
    const showBubble = b !== null && Date.now() < b.until
    const dots = ['·', '··', '···', ' ··', '  ·', ''][(n >> 1) % 6] ?? '···'
    const lines = !showBubble ? [] : b.text === THINKING ? [dots] : wrapWords(b.text, inner, BUBBLE_ROWS)
    const tailAt = Math.floor(bw / 2)
    const blank = ' '.repeat(bw)
    const bubbleRows = showBubble
      ? [
          '╭' + '─'.repeat(bw - 2) + '╮',
          '│ ' + (lines[0] ?? '').padEnd(inner) + ' │',
          '│ ' + (lines[1] ?? '').padEnd(inner) + ' │',
          '╰' + '─'.repeat(tailAt - 1) + '┬' + '─'.repeat(bw - tailAt - 2) + '╯',
        ]
      : [blank, blank, blank, blank]

    // usage block: context bar, each rate-limit window, the cost estimate
    const warn = (p: number) => (p >= 90 ? 'red' : p >= 75 ? 'yellow' : ACC)
    const barW = Math.max(6, Math.min(16, cols - 22))
    const usageRows: JSX.Element[] = []
    if (us) {
      if (us.ctxPercent !== null) {
        const tokens = us.ctxTokens !== null ? ` · ${kTokens(us.ctxTokens)}/${kTokens(us.ctxWindow)}` : ''
        usageRows.push(
          <Text key="u-ctx" wrap="truncate-end">
            <Text dimColor>{(L === 'uk' ? 'Контекст ' : 'Context  ')}</Text>
            <Text color={warn(us.ctxPercent)}>{bar(us.ctxPercent, barW)}</Text>
            {` ${Math.round(us.ctxPercent)}%`}
            <Text dimColor>{tokens}</Text>
          </Text>,
        )
      }
      for (const l of us.limits) {
        usageRows.push(
          <Text key={`u-${l.kind}`} wrap="truncate-end">
            <Text dimColor>{limitName(l.kind, L) + ': '}</Text>
            <Text color={warn(l.percent)}>{`${Math.round(l.percent)}%`}</Text>
            <Text dimColor>{resetIn(l.resetsAt, L)}</Text>
          </Text>,
        )
      }
      if (us.usd !== null) {
        usageRows.push(
          <Text key="u-cost" dimColor wrap="truncate-end">
            {(L === 'uk' ? 'Вартість (оцінка): $' : 'Cost (estimate): $') + us.usd.toFixed(2)}
          </Text>,
        )
      }
    }
    const quick = s.quick ? quickCommands : []

    // everything under the pet, the same on every surface
    const body = (listRoom: number) => (
      <Box key="pane-body" flexDirection="column" width={cols}>
        {rule(w.secState)}
        {wk ? (
          <Box flexDirection="row" width={cols}>
            <Text color={ACC}>{spin + ' '}</Text>
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              {para(
                // the app surfaces don't redraw each second, so no ticking timer there
                isTerm ? `${mirror.spinner || w.working}… ${secs(Date.now() - wk.startedAt)}` : `${mirror.spinner || w.working}…`,
                false,
              )}
            </Box>
          </Box>
        ) : (
          para(asleep ? w.sleeping : w.waiting)
        )}
        {done && !wk ? para(w.lastTurn(secs(done.ms), done.tools, done.isAborted)) : null}

        {rule(w.secTools)}
        {list.length === 0 ? para(w.nothingYet) : null}
        {list.slice(-listRoom).map(t => {
          const mark = t.state === 'run' ? spin : t.state === 'ok' ? '✓' : '✗'
          const color = t.state === 'err' ? 'red' : t.state === 'ok' ? 'green' : ACC
          const rest = cols - 2 - t.tool.length - 1
          return (
            <Box key={`tool-${t.id}`} flexDirection="row" width={cols}>
              <Text color={color}>{mark + ' '}</Text>
              <Text bold>{cut(t.tool, cols - 2)}</Text>
              {t.label && rest > 3 ? <Text dimColor>{' ' + cut(t.label, rest)}</Text> : null}
            </Box>
          )
        })}

        {rule(w.secHints)}
        {s.cleanChat && mirror.status ? mirror.status.split(' · ').map(line => para(line, false)) : null}
        {s.cleanChat && mirror.modes ? para(mirror.modes) : null}
        {s.cleanChat
          ? mirror.hint
            ? mirror.hint.split(/\s{2,}|\s·\s/).map(line => para(line))
            : para(w.hotkeys)
          : null}
        {s.cleanChat ? para(w.fullLog) : null}
        {para(w.settingsHint)}

        {usageRows.length ? rule(L === 'uk' ? 'Використання' : 'Usage') : null}
        {usageRows}

        {quick.length ? rule(L === 'uk' ? 'Швидкі команди' : 'Quick commands') : null}
        {quick.length ? (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1} width={cols}>
            {quick.map(c => (
              <Button key={`quick-${c}`} onPress={() => runQuick($, c)}>
                {'/' + c}
              </Button>
            ))}
          </Box>
        ) : null}
      </Box>
    )

    const fixed = (isTerm ? sprite.length : 10) + 4 + 18 + (usageRows.length ? usageRows.length + 1 : 0) + (quick.length ? 3 : 0)
    const listRoom = Math.max(3, rowsRoom - fixed)

    // ── the stage on the app surfaces (desktop, editor, mobile) ──
    // The pet is a crisp SVG; on the desktop an invisible Client laid over it
    // turns a click into a `ui.message` (Svg takes no presses of its own).
    if (!isTerm) {
      const bubbleText = !showBubble ? '' : b.text === THINKING ? dots || '·' : b.text
      const svg = livePose() ? spriteSvg(n, ctx, 12) : loopSvg(loopKind(), s.skin, 12)
      const { Svg } = $.ui.resolve(e)
      const picture = <Svg key="pet-svg" source={svg} alt="Clawd" />
      // explicit cell counts: a percentage of a box sized by an image resolved
      // to nothing on the desktop, and the layer caught no clicks
      const stageRows = 9
      const clicker =
        e.surface === 'desktop'
          ? (() => {
              const { Client } = $.ui.resolve(e)
              return (
                <Box key="pet-click-layer" position="absolute" top={0} left={0} width={cols} height={stageRows}>
                  <Client key="pet-click" module="./pet-click.tsx" width={cols} height={stageRows} />
                </Box>
              )
            })()
          : null
      return (
        <Box flexDirection="column" width={cols}>
          {header}
          <Box flexDirection="column" alignItems="center" width={cols}>
            <Box key="bubble-slot" flexDirection="column" justifyContent="flex-end" alignItems="center" height={4} width={cols}>
              {showBubble ? (
                <Box borderStyle="round" borderColor={ACC} paddingX={1}>
                  <Text wrap="wrap">{bubbleText}</Text>
                </Box>
              ) : null}
            </Box>
            <Box key="pet-stage" position="relative" flexDirection="column" alignItems="center" width={cols} minHeight={stageRows}>
              {picture}
              {clicker}
            </Box>
            {s.affection ? (
              <Text>
                <Text color={HEARTS_COLOR}>{hearts(aff)}</Text>
                <Text dimColor>{' ' + w.levels[levelOf(aff)]}</Text>
              </Text>
            ) : null}
          </Box>
          {body(listRoom)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" width={cols}>
        {header}
        <Box flexDirection="column" alignItems="center" width={cols}>
          {bubbleRows.map((row, i) => (
            <Text key={`bubble-${i}`} dimColor={i === 0 || i >= 3}>
              {showBubble && (i === 1 || i === 2)
                ? [
                    <Text key={`bl-${i}`} dimColor>
                      {'│ '}
                    </Text>,
                    (lines[i - 1] ?? '').padEnd(inner),
                    <Text key={`br-${i}`} dimColor>
                      {' │'}
                    </Text>,
                  ]
                : row}
            </Text>
          ))}
          {sprite.map((segs, i) => (
            <Box key={`pet-row-${i}`} flexDirection="row">
              {segs.map((sg, j) =>
                sg.solid ? (
                  <Button key={`pet-${i}-${j}`} plain onPress={() => poke($)}>
                    <Text color={sg.fg} backgroundColor={sg.bg}>
                      {sg.text}
                    </Text>
                  </Button>
                ) : (
                  <Text key={`pet-${i}-${j}`} color={sg.fg} backgroundColor={sg.bg}>
                    {sg.text}
                  </Text>
                ),
              )}
            </Box>
          ))}
          {s.affection ? (
            <Text>
              <Text color={HEARTS_COLOR}>{hearts(aff)}</Text>
              <Text dimColor>{' ' + w.levels[levelOf(aff)]}</Text>
            </Text>
          ) : null}
        </Box>
        {body(listRoom)}
      </Box>
    )
  })
}

const HEARTS_COLOR = '#FF4D6D'
function hearts(a: number): string {
  const full = Math.round(Math.max(0, Math.min(100, a)) / 20)
  return '♥'.repeat(full) + '♡'.repeat(5 - full)
}
