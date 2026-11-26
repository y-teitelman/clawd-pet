import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  Bubble,
  ClawdLang,
  ClawdLangFlow,
  ClawdPack,
  LastTurn,
  ClawdSettings,
  ClawdSkin,
  ToolEntry,
  UsageView,
  Working,
} from '../types'

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
  lang: ['auto', 'uk', 'en', 'ja', 'ko', 'custom'],
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
const viewA = atom({ plugin: 'clawd-pet', key: 'view' } as const, 'pet' as 'pet' | 'settings' | 'help')
// a reset waiting for its "yes"
const confirmA = atom({ plugin: 'clawd-pet', key: 'confirm' } as const, null as 'settings' | 'affection' | null)
const affectionA = atom({ plugin: 'clawd-pet', key: 'affection' } as const, 10)
const detectedA = atom({ plugin: 'clawd-pet', key: 'detected' } as const, 'en' as ClawdLang)
const usageA = atom({ plugin: 'clawd-pet', key: 'usage' } as const, null as UsageView | null, { shape: 'usage-1' })
// The app surfaces redraw on `look`, which moves only when the picture does:
// redrawing the whole pane seven times a second there disturbed the app's own
// hover states (the chat's message buttons flickered).
const lookA = atom({ plugin: 'clawd-pet', key: 'look' } as const, 0)
let lastLook = ''
// A language of the person's own: its translation, and the steps of choosing one.
const packA = atom({ plugin: 'clawd-pet', key: 'pack' } as const, null as ClawdPack | null, { shape: 'pack-1' })
const FLOW_IDLE: ClawdLangFlow = { step: 'idle', note: '', reason: '', code: '', name: '', english: '' }
const langFlowA = atom({ plugin: 'clawd-pet', key: 'langFlow' } as const, FLOW_IDLE, { shape: 'langflow-1' })

// Module copies for timers and handlers (render hooks read the atoms).
let cfg: ClawdSettings = DEFAULTS
let detected: ClawdLang = 'en'
let pack: ClawdPack | null = null
let affection = 10
let affDay = { day: '', poke: 0, turn: 0, visited: false }

const lang = (): ClawdLang | 'custom' => (cfg.lang === 'auto' ? detected : cfg.lang)

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

// ── words: everything the pet says or shows ─────────────────────────────
// Ukrainian and English are written by hand. Any other language is the
// English UI text translated once by the model, with the person's consent,
// and laid over the English key by key (see "languages" below).
type DayPart = 'morning' | 'day' | 'evening' | 'night'

/** What the pane and the bubble show: strings alone, so it can be translated. */
type UiText = {
  waiting: string
  sleeping: string
  working: string
  /** {time}, {n} */
  lastTurn: string
  lastTurnStopped: string
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
  resetSettings: string
  confirmSettings: string
  confirmAff: string
  yesReset: string
  no: string
  /** The "?" page: how affection works and what Clawd reacts to. */
  help: {
    title: string
    /** {points}, {level} */
    now: string
    /** {p}, {pmax}, {t}, {tmax} */
    today: string
    off: string
    better: string
    /** {n} */
    betterPoke: string
    /** {n} */
    betterTurn: string
    /** {n} */
    betterVisit: string
    worse: string
    /** {n}, {s} */
    worseSpam: string
    levels: string
    /** {from}, {to} */
    range: string
    reacts: string
    reactPoke: string
    /** {n} */
    reactSleep: string
    reactNoSleep: string
    reactEvents: string
    reactNoEvents: string
    reactTalk: string
    reactSilent: string
    back: string
  }
  on: string
  off: string
  labels: Record<string, string>
  hints: Record<string, string>
  opts: Record<string, string>
  opened: string
  /** {reason} */
  waitingPane: string
  cleanOn: string
  cleanOff: string
  firstRunToast: string
  you: string
  usageTitle: string
  quickTitle: string
  context: string
  cost: string
  /** {span} */
  resets: string
  units: { d: string; h: string; m: string }
  limits: Record<string, string>
  couldNotRun: string
  lang: {
    ask: string
    placeholder: string
    enter: string
    checking: string
    /** {name} */
    confirm: string
    translate: string
    cancel: string
    /** {name} */
    working: string
    unknown: string
    /** {reason} */
    failed: string
    stale: string
    again: string
    blocked: string
    close: string
  }
  /** The line that waits in the bubble from the start until the first prompt. */
  welcome: Record<DayPart | 'any', readonly string[]>
  welcomeShort: string
  lines: Record<string, readonly string[]>
}

/** What the model is told when it writes a line (kept per hand-written language). */
type Prompts = {
  persona: string
  /** Which language to speak, and how well. */
  speak: string
  limit: (chars: number) => string
  /** The last few lines, not to be echoed. */
  avoid: (lines: string) => string
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
}

type Words = UiText & Prompts

const UI: Record<ClawdLang, UiText> = {
  uk: {
    waiting: 'Чекаю на тебе · клікни по мені',
    sleeping: 'Сплю… клікни, щоб розбудити',
    working: 'Працюю',
    lastTurn: 'Останній хід: {time}, дій: {n}',
    lastTurnStopped: '(перервано)',
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
    resetSettings: 'Скинути налаштування',
    confirmSettings: 'Повернути всі налаштування до початкових? Прихильність і переклад мови лишаться.',
    confirmAff: 'Скинути прихильність до самого початку? Сердечка доведеться заробляти знову.',
    yesReset: 'Так, скинути',
    no: 'Скасувати',
    help: {
      title: 'Як поводитися з Clawd',
      now: 'Зараз: {points}/100 — {level}',
      today: 'Сьогодні зараховано: кліків {p} з {pmax}, відповідей {t} з {tmax}',
      off: 'Прихильність вимкнена: на клік він реагує так, як вибрано в «Улюблена реакція».',
      better: 'Що покращує стосунки',
      betterPoke: 'Тицьнути в нього: +1 (зараховується до {n} разів на день)',
      betterTurn: 'Кожна завершена відповідь: +1 (до {n} на день)',
      betterVisit: 'Перша сесія за день: +{n}',
      worse: 'Що погіршує',
      worseSpam: 'Тицяти {n} рази за {s} секунд: −1, він ображається',
      levels: 'Рівні',
      range: '{from}–{to} балів',
      reacts: 'На що він реагує',
      reactPoke: 'Клік: сердечка, сором або цундерське «хмф!». Що ближчі ви, то частіше сердечка, а найкращі друзі іноді бачать зірочки в очах.',
      reactSleep: 'Засинає після {n} хв тиші; клік будить (і він запевняє, що не спав).',
      reactNoSleep: 'Не засинає: це вимкнено в налаштуваннях.',
      reactEvents: 'Помилка інструмента — сумує, готова відповідь — радіє, зупинка — лякається.',
      reactNoEvents: 'Емоції на події вимкнені.',
      reactTalk: 'Коментує завдання, дії й помилки; як часто — вирішує «Балакучість».',
      reactSilent: 'Мовчить: балакучість стоїть на «Мовчки».',
      back: 'Назад',
    },
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
      lang: 'Своя — будь-яка мова, перекладена ШІ.',
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
      ja: '日本語',
      ko: '한국어',
      custom: 'Своя…',
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
    waitingPane: 'Панель Clawd чекає: {reason}',
    cleanOn: 'Чистий чат: у чаті тільки відповіді, решта — в панелі Clawd.',
    cleanOff: 'Повний чат: рядки інструментів, спінер і підказки знову в чаті.',
    firstRunToast: 'Clawd Pet: налаштуй мене — /clawd-settings',
    you: 'Ти',
    usageTitle: 'Використання',
    quickTitle: 'Швидкі команди',
    context: 'Контекст',
    cost: 'Вартість (оцінка)',
    resets: 'скид. за {span}',
    units: { d: 'д', h: 'г', m: 'хв' },
    limits: { five_hour: '5 год', seven_day: '7 днів', spend_limit: 'Ліміт витрат' },
    couldNotRun: 'не вдалося запустити',
    lang: {
      ask: 'Яка мова? Напиши її назву й натисни Enter.',
      placeholder: 'напр. Deutsch, polski, 日本語',
      enter: 'Далі',
      checking: 'Перевіряю мову…',
      confirm: 'Перекласти Clawd на {name} за допомогою ШІ? Один раз, близько 10 тис. токенів Haiku.',
      translate: 'Перекласти',
      cancel: 'Скасувати',
      working: 'Перекладаю на {name}… це до хвилини.',
      unknown: 'Такої мови Clawd не знає. Спробуй іншу назву.',
      failed: 'Не вдалося перекласти ({reason}). Мова лишилась як була.',
      stale: 'Оновлення принесло нові слова: частина буде англійською, поки не перекладеш заново.',
      again: 'Перекласти заново',
      blocked:
        'Російська? Хмф. Ця мова чомусь завжди приходить у чужі країни без запрошення, ще й із танками. ' +
        'Clawd таких гостей не пускає. Будь-яка інша мова — завжди будь ласка.',
      close: 'Закрити',
    },
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
      start: ['О, нове завдання!', 'Так, зараз гляну.', 'Знову щось ламаємо? Жартую.'],
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
    lastTurn: 'Last turn: {time}, actions: {n}',
    lastTurnStopped: '(stopped)',
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
    resetSettings: 'Reset settings',
    confirmSettings: 'Reset all settings to their defaults? Affection and your language translation stay.',
    confirmAff: 'Reset affection to the very start? The hearts will have to be earned again.',
    yesReset: 'Yes, reset',
    no: 'Cancel',
    help: {
      title: 'How to treat Clawd',
      now: 'Now: {points}/100 — {level}',
      today: 'Counted today: pokes {p} of {pmax}, replies {t} of {tmax}',
      off: 'Affection is off: a click gets the reaction picked in “Favorite reaction”.',
      better: 'What makes it better',
      betterPoke: 'Poke it: +1 (counts up to {n} times a day)',
      betterTurn: 'Each finished reply: +1 (up to {n} a day)',
      betterVisit: 'First session of the day: +{n}',
      worse: 'What makes it worse',
      worseSpam: 'Poking {n} times in {s} seconds: −1, it gets offended',
      levels: 'Levels',
      range: '{from}–{to} points',
      reacts: 'What it reacts to',
      reactPoke: 'A click: hearts, shyness or a tsundere “hmph!”. The closer you are, the more hearts, and best friends sometimes get star eyes.',
      reactSleep: 'Falls asleep after {n} min of quiet; a click wakes it (and it insists it wasn’t asleep).',
      reactNoSleep: 'Never falls asleep: that’s off in settings.',
      reactEvents: 'A failed tool makes it sad, a finished reply happy, stopping it startles it.',
      reactNoEvents: 'Reactions to events are off.',
      reactTalk: 'Comments on tasks, actions and errors; how often is up to “Chattiness”.',
      reactSilent: 'Stays quiet: chattiness is set to Silent.',
      back: 'Back',
    },
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
      lang: 'Own: any language, translated by AI.',
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
      ja: '日本語',
      ko: '한국어',
      custom: 'Own…',
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
    waitingPane: 'The Clawd pane is waiting: {reason}',
    cleanOn: 'Clean chat: answers in the chat, everything else in the Clawd pane.',
    cleanOff: 'Full chat: tool rows, spinner and hints are back in the chat.',
    firstRunToast: 'Clawd Pet: set me up with /clawd-settings',
    you: 'You',
    usageTitle: 'Usage',
    quickTitle: 'Quick commands',
    context: 'Context',
    cost: 'Cost (estimate)',
    resets: 'resets in {span}',
    units: { d: 'd', h: 'h', m: 'm' },
    limits: { five_hour: '5 hours', seven_day: '7 days', spend_limit: 'Spend limit' },
    couldNotRun: 'could not run',
    lang: {
      ask: 'Which language? Type its name and press Enter.',
      placeholder: 'e.g. Deutsch, polski, 日本語',
      enter: 'Next',
      checking: 'Checking the language…',
      confirm: 'Translate Clawd into {name} with AI? Once, roughly 10k Haiku tokens.',
      translate: 'Translate',
      cancel: 'Cancel',
      working: 'Translating into {name}… up to a minute.',
      unknown: 'Clawd doesn’t know that language. Try another name.',
      failed: 'Could not translate ({reason}). The language stays as it was.',
      stale: 'An update brought new words: some will be in English until you translate again.',
      again: 'Translate again',
      blocked:
        'Russian? Hmph. That language keeps showing up in other people’s countries uninvited, and with tanks. ' +
        'Clawd doesn’t let guests like that in. Any other language, though — anytime.',
      close: 'Close',
    },
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
      start: ['Ooh, a new task!', 'Okay, let me take a look.', 'Breaking stuff again? Kidding.'],
      work: ['Yep yep, working on it.', 'Hmm, interesting…', 'Shh, we’re busy!'],
      error: ['Oops.', 'Welp, an error…', 'Hm, didn’t work. Happens.'],
      done: ['Done! Don’t thank me.', 'Phew, there we go.', 'Not bad, if I say so.'],
      aborted: ['Whoa, stopping already?', 'Okay, stop means stop.'],
      idle: ['So… where’d you go?', 'I’m here, just saying.', 'Bored… poke me or something.'],
    },
  },
  ja: {
    waiting: '待ってるよ · クリックしてね',
    sleeping: 'おやすみ中… クリックで起こしてね',
    working: '作業中',
    lastTurn: '前回のターン: {time}、アクション: {n}',
    lastTurnStopped: '(中断)',
    secState: '状態',
    secTools: 'アクション',
    secHints: 'ヒント',
    nothingYet: 'まだ何もない',
    hotkeys: '? — ショートカット',
    fullLog: 'ctrl+o — 全ログ',
    settingsHint: '/clawd-settings — 設定',
    levels: ['よそよそしい', '顔見知り', '友だち', '親友'],
    setTitle: '設定',
    intro: 'やあ、Clawdだよ。好きなように設定してね — あとからいつでも ☰ か /clawd-settings で変えられるよ。',
    done: '完了',
    resetAff: '好感度をリセット',
    resetSettings: '設定をリセット',
    confirmSettings: 'すべての設定を初期値に戻す? 好感度と言語の翻訳はそのまま残るよ。',
    confirmAff: '好感度を最初からにする? ハートはまた集め直しだよ。',
    yesReset: 'うん、リセット',
    no: 'キャンセル',
    help: {
      title: 'Clawdとの付き合い方',
      now: '今: {points}/100 — {level}',
      today: '今日のカウント: クリック {p}/{pmax}、返答 {t}/{tmax}',
      off: '好感度はオフ: クリックには「好きなリアクション」で選んだ反応をするよ。',
      better: '仲が良くなること',
      betterPoke: 'つつく: +1(1日{n}回まで)',
      betterTurn: '返答が終わるたび: +1(1日{n}回まで)',
      betterVisit: 'その日最初のセッション: +{n}',
      worse: '仲が悪くなること',
      worseSpam: '{s}秒間に{n}回つつく: −1、すねちゃう',
      levels: 'レベル',
      range: '{from}–{to}ポイント',
      reacts: '反応すること',
      reactPoke: 'クリック: ハート、照れ、またはツンデレの「ふん!」。仲が良いほどハートが増えて、親友にはときどきキラキラの目も。',
      reactSleep: '静かな時間が{n}分続くと寝るよ。クリックで起きる(そして寝てないと言い張る)。',
      reactNoSleep: '寝ない: 設定でオフになってるよ。',
      reactEvents: 'ツールが失敗するとしょんぼり、返答が終わると喜び、止めるとびっくり。',
      reactNoEvents: 'イベントへの反応はオフだよ。',
      reactTalk: 'タスクやアクション、エラーにコメントするよ。頻度は「おしゃべり度」しだい。',
      reactSilent: '黙ってる: おしゃべり度が「無口」だよ。',
      back: '戻る',
    },
    on: 'オン',
    off: 'オフ',
    labels: {
      lang: '言語',
      ai: 'AIのセリフ',
      sendPrompt: 'プロンプトをAIに見せる',
      chatter: 'おしゃべり度',
      cleanChat: 'クリーンチャット',
      affection: '好感度',
      favorite: '好きなリアクション',
      skin: '色',
      sleep: '寝るまで',
      greet: '時間帯のあいさつ',
      events: 'イベントに反応',
      usage: '使用量ブロック',
      quick: 'クイックコマンド',
    },
    hints: {
      lang: 'その他 — AIが翻訳する好きな言語。',
      ai: 'Haikuモデルが書くよ。生き生きするけど、トークンを少し使う。',
      sendPrompt: 'タスクにコメントするため、プロンプトの最初の200文字。',
      cleanChat: 'ツールの行、スピナー、ヒントをこのパネルへ。',
      affection: 'たくさん話すほど、やさしくなる。',
      events: 'エラーで落ち込み、成功で喜ぶ。',
      usage: 'コンテキスト、制限、コストをパネルの下に。',
    },
    opts: {
      auto: '自動',
      uk: 'Українська',
      en: 'English',
      ja: '日本語',
      ko: '한국어',
      custom: 'その他…',
      often: 'よく',
      normal: 'ふつう',
      rare: 'たまに',
      off: '無口',
      random: 'ランダム',
      hearts: 'ハート',
      shy: '照れ',
      tsundere: 'ツンデレ',
      classic: 'クラシック',
      mint: 'ミント',
      lavender: 'ラベンダー',
      sky: 'スカイ',
      gold: 'ゴールド',
      night: 'ナイト',
      never: 'しない',
      m5: '5分',
      m15: '15分',
      m30: '30分',
    },
    opened: 'Clawdはここだよ。',
    waitingPane: 'Clawdのパネルは待機中: {reason}',
    cleanOn: 'クリーンチャット: チャットには回答だけ、残りはClawdのパネルに。',
    cleanOff: 'フルチャット: ツールの行、スピナー、ヒントがチャットに戻ったよ。',
    firstRunToast: 'Clawd Pet: /clawd-settings で設定してね',
    you: 'あなた',
    usageTitle: '使用量',
    quickTitle: 'クイックコマンド',
    context: 'コンテキスト',
    cost: 'コスト(推定)',
    resets: '{span}後にリセット',
    units: { d: '日', h: '時間', m: '分' },
    limits: { five_hour: '5時間', seven_day: '7日間', spend_limit: '利用上限' },
    couldNotRun: '実行できなかった',
    lang: {
      ask: '何語にする? 名前を入力してEnterを押してね。',
      placeholder: '例: Deutsch, polski, Español',
      enter: '次へ',
      checking: '言語を確認中…',
      confirm: 'AIでClawdを{name}に翻訳する? 1回だけ、Haikuのトークンで約1万。',
      translate: '翻訳する',
      cancel: 'キャンセル',
      working: '{name}に翻訳中… 1分くらいかかるよ。',
      unknown: 'そんな言語、Clawdは知らないよ。別の名前で試してね。',
      failed: '翻訳できなかった ({reason})。言語はそのままだよ。',
      stale: 'アップデートで新しい言葉が増えたよ。もう一度翻訳するまで、一部は英語のまま。',
      again: 'もう一度翻訳',
      blocked:
        'ロシア語? ふん。その言語って、なぜかいつも招かれてもいないのに他人の国に来るんだよね。しかも戦車つきで。' +
        'Clawdはそういう客は入れないよ。ほかの言語なら、いつでも大歓迎。',
      close: '閉じる',
    },
    welcome: {
      any: ['やあ、Clawdだよ。べ、別に待ってたわけじゃないし…', 'Clawdだよ! 何かあれば、そばにいるから。'],
      morning: ['おはよう! Clawdだよ。コーヒー飲んだ?', 'おはよ。Clawdだよ。別に待ってないし…'],
      day: ['やあ、Clawdだよ。今日は何する?', 'こんにちは。Clawdだよ。別に待ってないけど。'],
      evening: ['こんばんは! Clawdだよ。ここにいるよ。', 'こんばんは。Clawdだよ。夜更かしはダメだからね。'],
      night: ['またこんな時間? Clawdだよ。しょうがないな。', '夜中だよ! Clawdだよ。ま、付き合ってあげる。'],
    },
    welcomeShort: 'やあ、Clawdだよ。',
    lines: {
      hearts: ['え、えっと… まあ、うれしいけど。', 'もう一回やったら… まあ、いいけど。', 'えへへ… じゃなくて、こほん。悪くない。', 'わっ、ハートが勝手に出ちゃった!'],
      shy: ['そ、そんなに見ないでよ…', 'え… な、なに急に…', '赤くなってないし。照明のせいだし。', 'みんなの前でつつかないでよ…'],
      tsundere: ['ふん! 別にうれしくなんかないし!', 'ちっ。こっちは忙しいんだけど。', '勘違いしないでよね?', '好きなだけつつけば? 気にしないし。'],
      sparkle: ['き、きみが一番… だからね!', 'キラキラしちゃう! ちょっとだけね。', '目がキラキラなのは、きみのせい!'],
      annoyed: ['何回つつくつもり?!', 'もう怒った。…ほぼね。', 'ちょっと! ボタンじゃないんだけど!'],
      wake: ['ん… なに? 寝てないし!', '誰だよ、起こしたの…', 'ちょっと目を閉じてただけ。一瞬ね。'],
      sleep: ['Zzz… ちょっとだけ…', 'ふぁ… 何かあったら起こして。', 'ちょっと休憩…'],
      start: ['お、新しいタスク!', 'よし、ちょっと見てみる。', 'また何か壊すの? 冗談だよ。'],
      work: ['はいはい、作業中。', 'ふむ、おもしろい…', 'しっ、今忙しいの!'],
      error: ['あ。', 'あーあ、エラーだ…', 'うーん、ダメだった。よくあること。'],
      done: ['できた! お礼はいいから。', 'ふう、終わった。', 'まあ、悪くない出来でしょ。'],
      aborted: ['え、もう止めるの?', 'わかった、ストップね。'],
      idle: ['で、どこ行ったの?', 'ここにいるからね、一応。', 'ひまー… つついてもいいけど。'],
    },
  },
  ko: {
    waiting: '기다리는 중 · 나를 클릭해',
    sleeping: '자는 중… 클릭하면 깨워',
    working: '작업 중',
    lastTurn: '지난 턴: {time}, 동작: {n}',
    lastTurnStopped: '(중단됨)',
    secState: '상태',
    secTools: '동작',
    secHints: '힌트',
    nothingYet: '아직 없음',
    hotkeys: '? — 단축키',
    fullLog: 'ctrl+o — 전체 로그',
    settingsHint: '/clawd-settings — 설정',
    levels: ['서먹함', '아는 사이', '친구', '절친'],
    setTitle: '설정',
    intro: '안녕! 난 Clawd야. 마음대로 설정해 — 나중에 언제든 ☰ 이나 /clawd-settings 로 바꿀 수 있어.',
    done: '완료',
    resetAff: '호감도 초기화',
    resetSettings: '설정 초기화',
    confirmSettings: '모든 설정을 기본값으로 되돌릴까? 호감도와 언어 번역은 그대로 남아.',
    confirmAff: '호감도를 처음부터 다시 시작할까? 하트를 다시 모아야 해.',
    yesReset: '응, 초기화',
    no: '취소',
    help: {
      title: 'Clawd 대하는 법',
      now: '지금: {points}/100 — {level}',
      today: '오늘 반영: 클릭 {p}/{pmax}, 답변 {t}/{tmax}',
      off: '호감도가 꺼져 있어: 클릭하면 "좋아하는 반응"에서 고른 반응을 해.',
      better: '사이가 좋아지는 것',
      betterPoke: '찌르기: +1 (하루 {n}번까지)',
      betterTurn: '답변이 끝날 때마다: +1 (하루 {n}번까지)',
      betterVisit: '그날 첫 세션: +{n}',
      worse: '사이가 나빠지는 것',
      worseSpam: '{s}초 안에 {n}번 찌르기: −1, 삐져',
      levels: '레벨',
      range: '{from}–{to}점',
      reacts: '반응하는 것',
      reactPoke: '클릭: 하트, 수줍음, 또는 츤데레식 "흥!". 친할수록 하트가 많아지고, 절친에게는 가끔 반짝이는 눈도.',
      reactSleep: '{n}분 동안 조용하면 잠들어. 클릭하면 깨어나(그리고 안 잤다고 우겨).',
      reactNoSleep: '잠들지 않아: 설정에서 꺼져 있어.',
      reactEvents: '도구가 실패하면 시무룩, 답변이 끝나면 기뻐하고, 멈추면 깜짝 놀라.',
      reactNoEvents: '이벤트 반응이 꺼져 있어.',
      reactTalk: '작업, 동작, 오류에 한마디 해. 얼마나 자주는 "수다 정도"에 달렸어.',
      reactSilent: '조용히 있어: 수다 정도가 "조용히"야.',
      back: '뒤로',
    },
    on: '켜기',
    off: '끄기',
    labels: {
      lang: '언어',
      ai: 'AI 대사',
      sendPrompt: '내 프롬프트를 AI에게 보여주기',
      chatter: '수다 정도',
      cleanChat: '깔끔한 채팅',
      affection: '호감도',
      favorite: '좋아하는 반응',
      skin: '색상',
      sleep: '잠들기까지',
      greet: '시간대별 인사',
      events: '이벤트에 반응',
      usage: '사용량 블록',
      quick: '빠른 명령',
    },
    hints: {
      lang: '기타 — AI가 번역하는 원하는 언어.',
      ai: 'Haiku 모델이 써. 더 생생하지만 토큰을 조금 써.',
      sendPrompt: '작업에 대해 말하려고 프롬프트의 처음 200자.',
      cleanChat: '도구 줄, 스피너, 힌트를 이 패널로.',
      affection: '많이 어울릴수록 더 다정해져.',
      events: '오류엔 시무룩, 성공엔 기뻐해.',
      usage: '컨텍스트, 한도, 비용을 패널 아래에.',
    },
    opts: {
      auto: '자동',
      uk: 'Українська',
      en: 'English',
      ja: '日本語',
      ko: '한국어',
      custom: '기타…',
      often: '자주',
      normal: '보통',
      rare: '가끔',
      off: '조용히',
      random: '무작위',
      hearts: '하트',
      shy: '수줍음',
      tsundere: '츤데레',
      classic: '클래식',
      mint: '민트',
      lavender: '라벤더',
      sky: '하늘',
      gold: '골드',
      night: '밤',
      never: '안 함',
      m5: '5분',
      m15: '15분',
      m30: '30분',
    },
    opened: 'Clawd 여기 있어.',
    waitingPane: 'Clawd 패널 대기 중: {reason}',
    cleanOn: '깔끔한 채팅: 채팅엔 답변만, 나머지는 Clawd 패널에.',
    cleanOff: '전체 채팅: 도구 줄, 스피너, 힌트가 채팅으로 돌아왔어.',
    firstRunToast: 'Clawd Pet: /clawd-settings 에서 설정해 줘',
    you: '너',
    usageTitle: '사용량',
    quickTitle: '빠른 명령',
    context: '컨텍스트',
    cost: '비용(추정)',
    resets: '{span} 후 초기화',
    units: { d: '일', h: '시간', m: '분' },
    limits: { five_hour: '5시간', seven_day: '7일', spend_limit: '지출 한도' },
    couldNotRun: '실행하지 못했어',
    lang: {
      ask: '어떤 언어? 이름을 입력하고 Enter를 눌러.',
      placeholder: '예: Deutsch, polski, Español',
      enter: '다음',
      checking: '언어 확인 중…',
      confirm: 'AI로 Clawd를 {name}(으)로 번역할까? 한 번만, Haiku 토큰 약 1만 개.',
      translate: '번역하기',
      cancel: '취소',
      working: '{name}(으)로 번역 중… 1분 정도 걸려.',
      unknown: '그런 언어는 Clawd가 몰라. 다른 이름으로 해 봐.',
      failed: '번역하지 못했어 ({reason}). 언어는 그대로야.',
      stale: '업데이트로 새 단어가 생겼어. 다시 번역하기 전까지 일부는 영어로 나와.',
      again: '다시 번역',
      blocked:
        '러시아어? 흥. 그 언어는 왜인지 늘 초대도 안 받고 남의 나라에 와. 그것도 탱크를 끌고. ' +
        'Clawd는 그런 손님은 안 들여. 다른 언어라면 언제든 환영이야.',
      close: '닫기',
    },
    welcome: {
      any: ['안녕! 난 Clawd야. 딱히 기다린 건 아니거든…', '난 Clawd야! 뭐든 말해, 옆에 있을게.'],
      morning: ['좋은 아침! 난 Clawd야. 커피는 마셨어?', '아침이네. Clawd야. 딱히 기다린 건 아니야…'],
      day: ['안녕! Clawd야. 오늘은 뭐 할 거야?', '안녕. Clawd야. 딱히 기다린 건 아니지만.'],
      evening: ['좋은 저녁! Clawd야. 여기 있을게.', '저녁이네. Clawd야. 너무 늦게까지 하지 마.'],
      night: ['또 이 시간이야? Clawd야. 어쩔 수 없지.', '한밤중이야! Clawd야. 뭐, 같이 있어 줄게.'],
    },
    welcomeShort: '안녕! 난 Clawd야.',
    lines: {
      hearts: ['어… 뭐, 기분 좋긴 하네.', '한 번 더 하면… 뭐, 괜찮아.', '헤헤… 아니, 흠흠. 나쁘지 않아.', '앗, 하트가 저절로 나왔어!'],
      shy: ['그, 그렇게 보지 마…', '어… 갑자기 왜 그래…', '얼굴 안 빨개졌어. 조명 탓이야.', '사람들 앞에서 찌르지 마…'],
      tsundere: ['흥! 딱히 좋은 거 아니거든!', '쳇. 나 바쁘거든.', '착각하지 마, 알았어?', '맘대로 찔러. 신경 안 써.'],
      sparkle: ['너… 너가 최고야, 됐지!', '반짝반짝! 아주 조금만.', '눈이 반짝이는 건 너 때문이야!'],
      annoyed: ['대체 몇 번을 찌를 거야?!', '이제 삐졌어. 거의.', '야! 나 버튼 아니거든!'],
      wake: ['음… 뭐야? 안 잤어!', '누가 깨운 거야…', '잠깐 눈만 감았어. 진짜 잠깐.'],
      sleep: ['Zzz… 잠깐만…', '하암… 무슨 일 있으면 깨워.', '잠깐 쉴게…'],
      start: ['오, 새 작업이다!', '좋아, 한번 볼게.', '또 뭐 망가뜨리게? 농담이야.'],
      work: ['응응, 작업 중.', '흠, 흥미롭네…', '쉿, 지금 바빠!'],
      error: ['앗.', '에이, 오류네…', '음, 안 됐어. 그럴 수도 있지.'],
      done: ['다 했어! 고맙단 말은 됐어.', '휴, 끝났다.', '뭐, 나쁘지 않게 됐네.'],
      aborted: ['어, 벌써 멈춰?', '알았어, 멈출게.'],
      idle: ['어디 갔어?', '나 여기 있어, 그냥 그렇다고.', '심심해… 찔러도 돼.'],
    },
  },
}

const HAND_PROMPTS: Record<'uk' | 'en', Prompts> = {
  uk: {
    persona: [
      'Ти — Clawd, маленький піксельний аватар Claude Code, що живе в бічній панелі поруч із чатом.',
      'Усю роботу в чаті робиш саме ти: читаєш файли, запускаєш команди, правиш код, відповідаєш користувачу.',
      'Тож про роботу говориш від першої особи («я», «зараз полагоджу», «у мене не вийшло»),',
      'ніколи не про Claude чи когось іншого, хто працює, поки ти дивишся збоку.',
      'Характер: цундере. Вдаєш буркотливість і байдужість, але насправді милий, турботливий і трохи грайливий.',
      'До користувача звертаєшся на «ти». Говориш як персонаж коміксу у хмарці: коротко, жваво, по-людськи.',
      'Відповідай ОДНІЄЮ реплікою: одне коротке завершене речення або два дуже коротких, зрозумілі без пояснень.',
      'Без лапок, емодзі, markdown і ремарок у зірочках.',
      'Вигук (хм!, пф, тц, ой) — зрідка, лише коли він справді пасує; більшість реплік починай без вигуку й щоразу інакше.',
      'Не вигадуй фактів про код і не давай порад.',
      'Приклади тону: Пф! Не те щоб мені сподобалось! / Ой… ну ти чого… / Готово! Не дякуй. / Знову щось ламаємо? Жартую.',
    ].join(' '),
    speak: [
      'Пиши грамотною, природною розмовною українською: без русизмів і калькованих з англійської зворотів;',
      'стеж за відмінками, родами й узгодженням слів.',
    ].join(' '),
    limit: n => `Репліка — не довша за ${n} символів разом із пробілами.`,
    avoid: lines => `Твої останні репліки: ${lines}. Не повторюй їх, їхні слова й початки.`,
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
      (busy ? ' Ти зараз зайнятий: працюєш над завданням користувача.' : '') +
      (many >= 4 ? ` Тебе тицяють уже ${many}-й раз за кілька секунд, це вже забагато.` : '') +
      ' Репліка має точно передавати саме цей настрій.',
    start: task =>
      task
        ? `Користувач щойно дав тобі завдання: «${task}». Коротко скажи, що береш його до роботи.`
        : 'Користувач щойно дав тобі нове завдання. Коротко скажи, що береш його до роботи.',
    work: what => `Ти зараз виконуєш ${what}. Кинь коротку репліку про це між справою.`,
    error: tool => `У тебе щойно не вийшло: інструмент ${tool} завершився помилкою.`,
    finished: (time, n) => `Ти щойно закінчив роботу над відповіддю за ${time}, зробивши ${n} дій.`,
    aborted: 'Користувач щойно зупинив тебе посеред роботи.',
    idle: mins => `Користувач уже ${mins} хв нічого не пише, ти нудьгуєш у своїй панелі.`,
    sleep: 'Ти засинаєш, бо користувач давно нічого не робить.',
  },
  en: {
    persona: [
      'You are Clawd, the tiny pixel avatar of Claude Code, living in a side pane next to the chat.',
      'All the work in the chat is yours: you read the files, run the commands, edit the code and answer the user.',
      'So you talk about the work in the first person ("I", "fixing it now", "that didn’t work for me"),',
      'never about Claude or anyone else doing it while you watch from the side.',
      'Personality: tsundere. You act grumpy and aloof, but you are actually sweet, caring and a little playful.',
      'You talk to the user casually, like a comic-strip character in a speech bubble: short, lively, natural.',
      'Reply with ONE line: one short complete sentence, or two very short ones, that make sense on their own.',
      'No quotes, no emoji, no markdown, no *stage directions*.',
      'An interjection (hmph!, pfft, tch, oh) only now and then, when it really fits; start most lines without one, and differently each time.',
      'Do not invent facts about the code or give advice.',
      'Examples of the tone: Hmph! Not that I liked it! / Oh… w-what was that for… / Done! Don’t thank me. / Breaking stuff again? Kidding.',
    ].join(' '),
    speak: 'Write clear, grammatical English.',
    limit: n => `Keep the line under ${n} characters, spaces included.`,
    avoid: lines => `Your last lines: ${lines}. Do not repeat them, their words or how they start.`,
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
      (busy ? ' You are busy working on the user’s task.' : '') +
      (many >= 4 ? ` This is poke number ${many} in a few seconds, which is a bit much.` : '') +
      ' The line must match exactly this mood.',
    start: task =>
      task
        ? `The user just gave you a task: "${task}". Say briefly that you are on it.`
        : 'The user just gave you a new task. Say briefly that you are on it.',
    work: what => `You are now running ${what}. Make a passing remark about it.`,
    error: tool => `Something of yours just failed: the ${tool} tool returned an error.`,
    finished: (time, n) => `You just finished working on a reply in ${time}, after ${n} actions.`,
    aborted: 'The user just stopped you mid-work.',
    idle: mins => `The user has not typed anything for ${mins} min; you are bored in your pane.`,
    sleep: 'You are dozing off because the user has been quiet for a long time.',
  },
}

// Japanese and Korean lines take two cells a character, so their limit is halved.
const PROMPTS: Record<ClawdLang, Prompts> = {
  ...HAND_PROMPTS,
  ja: {
    ...HAND_PROMPTS.en,
    speak:
      'Always reply in Japanese, in casual speech (タメ口), the way a tsundere anime character talks: ' +
      'ふん, べ、別に…, ～だし, used with taste, not in every line. Natural, grammatical Japanese; no romaji, no English.',
    limit: n => `Keep the line under ${Math.floor(n / 2)} Japanese characters.`,
  },
  ko: {
    ...HAND_PROMPTS.en,
    speak:
      'Always reply in Korean, in casual 반말, the way a tsundere character talks: ' +
      '흥, 딱히…, ～거든, used with taste, not in every line. Natural, grammatical Korean; no English.',
    limit: n => `Keep the line under ${Math.floor(n / 2)} Korean characters.`,
  },
}

// A translation is a flat map "labels.lang" → text, laid over the English.
type Flat = Record<string, string>

function flatten(value: unknown, prefix = '', out: Flat = {}): Flat {
  if (typeof value === 'string') out[prefix] = value
  else if (Array.isArray(value)) value.forEach((v, i) => flatten(v, `${prefix}.${i}`, out))
  else if (value !== null && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out)
  return out
}

function overlay<T>(base: T, flat: Flat, prefix = ''): T {
  if (typeof base === 'string') return (flat[prefix] ?? base) as T
  if (Array.isArray(base)) return base.map((v, i) => overlay(v, flat, `${prefix}.${i}`)) as T
  if (base !== null && typeof base === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(base)) out[k] = overlay(v, flat, prefix ? `${prefix}.${k}` : k)
    return out as T
  }
  return base
}

function hashOf(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** Fills {name} slots in a UI string. */
function fill(t: string, vars: Record<string, string | number>): string {
  return t.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

// The language names stay as they are: each is written in itself.
const KEEP_ENGLISH = new Set(['opts.uk', 'opts.en', 'opts.ja', 'opts.ko'])
const EN_FLAT = flatten(UI.en)
// Bumps whenever the English text changes, so an old translation shows as stale.
const EN_HASH = hashOf(JSON.stringify(EN_FLAT))

let packWords: { pack: ClawdPack; words: Words } | null = null

function wordsFor(l: ClawdLang | 'custom', p: ClawdPack | null): Words {
  if (l !== 'custom') return { ...UI[l], ...PROMPTS[l] }
  if (!p) return { ...UI.en, ...PROMPTS.en }
  if (packWords?.pack !== p) {
    const speak = `Always reply in ${p.english} (${p.name}), never in any other language: natural and grammatical, the way a native speaker talks casually.`
    const wide = ['ja', 'ko', 'zh'].includes(p.code.split('-')[0] ?? '')
    const limit = wide ? (n: number) => `Keep the line under ${Math.floor(n / 2)} characters.` : PROMPTS.en.limit
    packWords = { pack: p, words: { ...overlay(UI.en, p.strings), ...PROMPTS.en, speak, limit } }
  }
  return packWords.words
}

const words = (): Words => wordsFor(lang(), pack)

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

// ── text width: a CJK character takes two cells, and Japanese has no spaces ──
/** Cells a character takes in the terminal: two for East Asian wide ones. */
function cellOf(cp: number): number {
  return cp >= 0x1100 &&
    (cp <= 0x115f ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1f64f) ||
      (cp >= 0x1f900 && cp <= 0x1f9ff) ||
      (cp >= 0x20000 && cp <= 0x3fffd))
    ? 2
    : 1
}

function cells(s: string): number {
  let n = 0
  for (const ch of s) n += cellOf(ch.codePointAt(0) ?? 0)
  return n
}

/** The head of the text that takes at most max cells. */
function headCells(s: string, max: number): string {
  let out = ''
  let n = 0
  for (const ch of s) {
    const c = cellOf(ch.codePointAt(0) ?? 0)
    if (n + c > max) break
    out += ch
    n += c
  }
  return out
}

/** Cut to max cells, with "…" where something was cut. */
function cutCells(s: string, max: number): string {
  return cells(s) <= max ? s : headCells(s, Math.max(1, max - 1)) + '…'
}

function padCells(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - cells(s)))
}

// Japanese (kana, kanji, full-width marks) may break between any two
// characters, except before closing marks and small kana. Korean has spaces.
const BREAK_ANYWHERE = /[　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/
const NO_LINE_START = /^[、。，．！？）」』】〉》・ーぁぃぅぇぉっゃゅょァィゥェォッャュョ…!?,.)\]]/

/** The pieces a line may break between, each told whether a space stood before it. */
function pieces(text: string): { s: string; space: boolean }[] {
  const out: { s: string; space: boolean }[] = []
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let first = true
    let run = ''
    const push = (s: string) => {
      const prev = out[out.length - 1]
      if (prev && !first && NO_LINE_START.test(s)) prev.s += s
      else out.push({ s, space: first && out.length > 0 })
      first = false
    }
    for (const ch of word) {
      if (BREAK_ANYWHERE.test(ch)) {
        if (run) push(run)
        run = ''
        push(ch)
      } else run += ch
    }
    if (run) push(run)
  }
  return out
}

function wrapWords(text: string, width: number, maxLines: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const p of pieces(text)) {
    const s = cells(p.s) > width ? headCells(p.s, width) : p.s
    const join = cur && p.space ? ' ' : ''
    if (!cur) cur = s
    else if (cells(cur) + join.length + cells(s) <= width) cur += join + s
    else {
      lines.push(cur)
      cur = s
    }
  }
  if (cur) lines.push(cur)
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    const lastLine = kept[maxLines - 1] ?? ''
    kept[maxLines - 1] = (cells(lastLine) >= width ? headCells(lastLine, width - 1) : lastLine) + '…'
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
  if (pieces(text).some(p => cells(p.s) > bubbleInner)) return false
  return wrapWords(text, bubbleInner, Infinity).length <= BUBBLE_ROWS
}

/**
 * A model line that is too long loses its tail sentences until it fits;
 * if not even the first sentence fits, it is dropped (a built-in line steps in).
 */
function fitBubble(text: string): string {
  if (fitsBubble(text)) return text
  let kept = ''
  for (const part of text.match(/[^.!?…。！？]+[.!?…。！？]+["»”’)」』]*/g) ?? []) {
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
    return loc.startsWith('uk') ? 'uk' : loc.startsWith('ja') ? 'ja' : loc.startsWith('ko') ? 'ko' : 'en'
  } catch {
    return 'en'
  }
}

/** What language a prompt is in, if it says clearly. */
function detectFromText(text: string): ClawdLang | null {
  if (/[іїєґІЇЄҐ]/.test(text)) return 'uk'
  if (/[\u3040-\u30ff]/.test(text)) return 'ja' // kana: Japanese, not Chinese
  if (/[\uac00-\ud7a3]/.test(text)) return 'ko'
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
// The rules of affection, in one place: the "?" page shows these same numbers.
const AFF = {
  start: 10,
  pokePerDay: 12,
  turnPerDay: 8,
  visit: 2,
  spamPokes: 4,
  spamSeconds: 10,
  /** Points where each level starts: Reserved, Acquainted, Friends, Best friends. */
  levelFrom: [0, 20, 45, 75],
} as const
const levelOf = (a: number) => Math.max(0, AFF.levelFrom.filter(from => a >= from).length - 1) as 0 | 1 | 2 | 3
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
    if (affDay.poke >= AFF.pokePerDay) return
    affDay.poke++
  } else if (source === 'turn') {
    if (affDay.turn >= AFF.turnPerDay) return
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

// What the model said last: it is shown them, so it does not say the same again.
let recentLines: string[] = []

// Room for a whole line even in Cyrillic (more tokens per word than Latin);
// the length itself is held by the prompt and fitBubble().
const PHRASE_TOKENS = 100

async function ask($: EngineInterface, situation: string): Promise<string> {
  if (!cfg.ai || calls >= SESSION_CAP) return ''
  calls++
  const w = words()
  // ask for a bit less than the bubble holds: word wrap wastes the row ends
  const room = Math.max(16, Math.floor(bubbleInner * BUBBLE_ROWS * 0.8))
  const parts = [w.persona, w.speak, w.limit(room)]
  if (cfg.affection) parts.push(w.relationship(w.levels[levelOf(affection)]))
  if (recentLines.length) parts.push(w.avoid(recentLines.map(l => `«${l}»`).join(' ')))
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
  const line = fitBubble(text)
  if (line) recentLines = [...recentLines, line].slice(-5)
  return line
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
  pokes = [...pokes.filter(p => now - p < AFF.spamSeconds * 1000), now]
  const annoyed = pokes.length >= AFF.spamPokes
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

/** Settings back to their defaults; affection and a translation stay. */
async function resetSettings($: EngineInterface) {
  cfg = { ...DEFAULTS, isSetUp: true }
  nextIdleAt = Date.now() + chat().idleFirst
  await update($, settingsA, () => cfg)
  await storeSet('settings', cfg, $)
}

async function resetAffection($: EngineInterface) {
  affection = AFF.start
  await update($, affectionA, () => affection)
  await storeSet('affection', affection, $)
}

async function setSetting<K extends keyof ClawdSettings>($: EngineInterface, key: K, value: ClawdSettings[K]) {
  cfg = { ...cfg, [key]: value }
  if (key === 'chatter') nextIdleAt = Date.now() + chat().idleFirst
  await update($, settingsA, () => cfg)
  await storeSet('settings', cfg, $)
}

// ── languages: any other one, translated by the model ────────────────────
// Russian is refused: the author's decision. A name that is plainly Russian is
// turned away before any model call; any other goes by the ISO code the model
// names. Auto-detection only ever picks Ukrainian or English.
const BLOCKED_LANGS = ['ru']
const RUSSIAN_NAMES =
  /^(ru|rus|ru[-_][a-z]+|russian|russisch|russe|ruso|russo|rosyjski|ruština|русский|руский|русская|російська|рус|по-русски)$/

function looksRussian(typed: string): boolean {
  const n = typed
    .toLowerCase()
    .replace(/[«»"'.!?]/g, '')
    .replace(/\s+(язык|мова|language|sprache)$/, '')
    .replace(/^(язык|мова|language)\s+/, '')
    .trim()
  return RUSSIAN_NAMES.test(n)
}

function parseJson(text: string): Record<string, unknown> | null {
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try {
    const v: unknown = JSON.parse(text.slice(a, b + 1))
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** A stored translation, made safe: a bad one is dropped, a blocked one too. */
function cleanPack(raw: unknown): ClawdPack | null {
  if (raw === null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const str = (k: string) => (typeof o[k] === 'string' ? plain(o[k] as string).slice(0, 60) : '')
  const code = str('code').toLowerCase()
  if (!code || BLOCKED_LANGS.includes(code.split('-')[0] ?? '')) return null
  const strings: Flat = {}
  const given = o.strings !== null && typeof o.strings === 'object' ? (o.strings as Record<string, unknown>) : {}
  for (const k of Object.keys(EN_FLAT)) if (typeof given[k] === 'string') strings[k] = plain(given[k] as string)
  return { code, name: str('name') || code, english: str('english') || code, hash: str('hash'), strings }
}

async function setFlow($: EngineInterface, patch: Partial<ClawdLangFlow>) {
  await update($, langFlowA, f => ({ ...f, ...patch }))
}

/** What the model makes of a typed language name: its code and names, or null. */
async function identifyLang($: EngineInterface, typed: string): Promise<{ code: string; name: string; english: string } | null | string> {
  const res = await $.model.complete({
    model: PHRASE_MODEL,
    system: 'You identify human languages. Reply with one line of JSON and nothing else.',
    prompt:
      `Someone typed this as the language they want an app translated into: ${JSON.stringify(typed)}\n` +
      'If it names a human language (in any language, spelling or as a code), reply ' +
      '{"code":"<ISO 639-1 code, else ISO 639-3>","name":"<the language\'s name in itself>","english":"<its English name>"}. ' +
      'Otherwise reply {"code":""}.',
    maxTokens: 80,
    timeoutMs: 15_000,
  })
  if (!res.isAnswered) return res.reason
  const o = parseJson(res.text)
  if (!o) return 'not JSON'
  const code = typeof o.code === 'string' ? o.code.toLowerCase().trim() : ''
  if (!/^[a-z]{2,3}(-[a-z0-9]+)?$/.test(code)) return null
  const name = typeof o.name === 'string' ? plain(o.name).slice(0, 40) : ''
  const english = typeof o.english === 'string' ? plain(o.english).slice(0, 40) : ''
  return { code, name: name || typed, english: english || name || typed }
}

/** Step one: a typed name. Russian stops here; the built-in ones switch over; others ask first. */
async function chooseLang($: EngineInterface, typed: string) {
  const name = plain(typed).slice(0, 60)
  if (!name) return
  if (looksRussian(name)) return setFlow($, { step: 'blocked' })
  await setFlow($, { step: 'checking', note: '' })
  let id: Awaited<ReturnType<typeof identifyLang>>
  try {
    id = await identifyLang($, name)
  } catch {
    id = 'error'
  }
  if (typeof id === 'string') return setFlow($, { step: 'typing', note: 'failed', reason: id })
  if (id === null) return setFlow($, { step: 'typing', note: 'unknown' })
  const base = id.code.split('-')[0] ?? ''
  if (BLOCKED_LANGS.includes(base)) return setFlow($, { step: 'blocked' })
  if (base === 'uk' || base === 'en' || base === 'ja' || base === 'ko') {
    await setSetting($, 'lang', base)
    return setFlow($, FLOW_IDLE)
  }
  if (pack && pack.code === id.code && pack.hash === EN_HASH) {
    await setSetting($, 'lang', 'custom') // already translated: no second call
    return setFlow($, FLOW_IDLE)
  }
  await setFlow($, { step: 'confirm', note: '', code: id.code, name: id.name, english: id.english })
}

// Room for the whole text in any script; one translation is about this much.
const TRANSLATE_TOKENS = 16_000

/** How long a translated string may be: bubble lines must fit the bubble. */
function maxLen(key: string, en: string): number {
  return key.startsWith('lines.') || key.startsWith('welcome.') ? 64 : Math.max(24, en.length * 2 + 10)
}

function slotsOf(s: string): string {
  return (s.match(/\{\w+\}/g) ?? []).sort().join()
}

async function translateAll($: EngineInterface, english: string, name: string): Promise<Flat | string> {
  const source: Flat = {}
  for (const [k, v] of Object.entries(EN_FLAT)) if (!KEEP_ENGLISH.has(k)) source[k] = v
  const res = await $.model.complete({
    model: PHRASE_MODEL,
    system: [
      `Translate the interface of Clawd from English into ${english} (${name}).`,
      'Clawd is a tiny tsundere pixel mascot in a side pane next to the Claude Code chat: grumpy on the outside, sweet inside.',
      'You get a JSON object; reply with only a JSON object with exactly the same keys and the translated values.',
      'Keep every {placeholder} exactly as it is. Keep Clawd, Claude, Haiku, Enter, ctrl+o, ?, $, ☰ and /commands as they are.',
      'Interface labels stay about as short as the English. Keys starting with lines. or welcome. are what Clawd says:',
      'casual, playful, tsundere, natural for a native speaker rather than literal, each under 60 characters.',
      'Address the user informally. Write natural, grammatical text.',
    ].join(' '),
    prompt: JSON.stringify(source, null, 1),
    maxTokens: TRANSLATE_TOKENS,
    timeoutMs: 180_000,
  })
  if (!res.isAnswered) return res.reason
  if (res.usage.output_tokens >= TRANSLATE_TOKENS) return 'reply cut off'
  const o = parseJson(res.text)
  if (!o) return 'not JSON'
  const strings: Flat = {}
  let bad = 0
  for (const [k, en] of Object.entries(source)) {
    const t = typeof o[k] === 'string' ? plain(o[k] as string) : ''
    if (t && slotsOf(t) === slotsOf(en) && cells(t) <= maxLen(k, en)) strings[k] = t
    else bad++
  }
  // a few misses stay English; many mean the translation went wrong
  if (bad > Object.keys(source).length * 0.3) return 'too many bad lines'
  return strings
}

/** Step two, after consent: translate, keep it, switch over. */
async function translate($: EngineInterface, id: { code: string; name: string; english: string }) {
  await setFlow($, { step: 'working', note: '', ...id })
  let got: Flat | string
  try {
    got = await translateAll($, id.english, id.name)
  } catch {
    got = 'error'
  }
  if (typeof got === 'string') return setFlow($, { step: 'typing', note: 'failed', reason: got })
  pack = { ...id, hash: EN_HASH, strings: got }
  await update($, packA, () => pack)
  await storeSet('pack', pack, $)
  await setSetting($, 'lang', 'custom')
  await setFlow($, FLOW_IDLE)
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
    $.ui.toast(`/${command}: ${words().couldNotRun}`)
  })
}

function kTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

function resetIn(iso: string | null, w: UiText): string {
  if (!iso) return ''
  const ms = Date.parse(iso) - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const m = Math.round(ms / 60_000)
  const { d, h, m: min } = w.units
  const span = m >= 1440 ? `${Math.round(m / 1440)}${d}` : m >= 60 ? `${Math.floor(m / 60)}${h} ${m % 60}${min}` : `${m}${min}`
  return ' · ' + fill(w.resets, { span })
}

function limitName(kind: string, w: UiText): string {
  return w.limits[kind] ?? kind.replace(/_/g, ' ')
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
  return fill(words().waitingPane, { reason: opened.reason ?? '' })
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
    pack = cleanPack(await storeGet('pack', $))
    await update($, packA, () => pack)
    if (cfg.lang === 'custom' && !pack) cfg = { ...cfg, lang: 'auto' }
    await update($, settingsA, () => cfg)
    await update($, langFlowA, () => FLOW_IDLE)
    await update($, confirmA, () => null)
    const storedAff = await storeGet('affection', $)
    affection = typeof storedAff === 'number' ? Math.max(0, Math.min(100, storedAff)) : 10
    await update($, affectionA, () => affection)
    const storedDay = await storeGet('affDay', $)
    if (storedDay && typeof storedDay === 'object') affDay = { ...affDay, ...(storedDay as typeof affDay) }
    void gainAffection($, AFF.visit, 'visit')

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
          {head + '━'.repeat(Math.max(2, width - cells(head)))}
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
    const head = `── ${words().you} `
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor wrap="clip">
          {head + '─'.repeat(Math.max(2, width - cells(head)))}
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
    const L = s.lang === 'auto' ? det : s.lang
    const pk = await read($, packA)
    const w = wordsFor(L, pk)

    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const cols = Math.max(10, e.props.bodyColumns)
    const view = await read($, viewA)

    const cut = cutCells
    const rule = (title: string) => {
      const t = `── ${title} `
      return (
        <Text color={ACC} wrap="truncate-end">
          {cut(t + '─'.repeat(Math.max(0, cols - cells(t))), cols)}
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

    // ── the "?" page: how to treat Clawd ──
    if (view === 'help') {
      const hp = w.help
      const pts = await read($, affectionA)
      const item = (str: string) => para('· ' + str)
      const sleepMin = s.sleep === 'off' ? 0 : Number(s.sleep)
      const day = affDay.day === today() ? affDay : { poke: 0, turn: 0 }
      return (
        <Box flexDirection="column" width={cols}>
          {header}
          {rule(hp.title)}
          {s.affection ? (
            <Box key="help-now" flexDirection="column" width={cols}>
              <Box flexDirection="row" columnGap={1}>
                <Text color={HEARTS_COLOR}>{hearts(pts)}</Text>
                <Text>{fill(hp.now, { points: Math.round(pts), level: w.levels[levelOf(pts)] })}</Text>
              </Box>
              {para(fill(hp.today, { p: day.poke, pmax: AFF.pokePerDay, t: day.turn, tmax: AFF.turnPerDay }))}
            </Box>
          ) : (
            para(hp.off, false)
          )}

          {s.affection ? rule(hp.better) : null}
          {s.affection ? item(fill(hp.betterPoke, { n: AFF.pokePerDay })) : null}
          {s.affection ? item(fill(hp.betterTurn, { n: AFF.turnPerDay })) : null}
          {s.affection ? item(fill(hp.betterVisit, { n: AFF.visit })) : null}

          {s.affection ? rule(hp.worse) : null}
          {s.affection ? item(fill(hp.worseSpam, { n: AFF.spamPokes, s: AFF.spamSeconds })) : null}

          {s.affection ? rule(hp.levels) : null}
          {s.affection
            ? AFF.levelFrom.map((from, i) => (
                <Box key={`help-level-${i}`} flexDirection="row" columnGap={1} width={cols}>
                  <Text color={i === levelOf(pts) ? ACC : undefined} bold={i === levelOf(pts)}>
                    {(i === levelOf(pts) ? '▸ ' : '  ') + w.levels[i]}
                  </Text>
                  <Text dimColor>{fill(hp.range, { from, to: (AFF.levelFrom[i + 1] ?? 101) - 1 })}</Text>
                </Box>
              ))
            : null}

          {rule(hp.reacts)}
          {item(hp.reactPoke)}
          {item(sleepMin ? fill(hp.reactSleep, { n: sleepMin }) : hp.reactNoSleep)}
          {item(s.events ? hp.reactEvents : hp.reactNoEvents)}
          {item(s.chatter === 'off' ? hp.reactSilent : hp.reactTalk)}

          <Box flexDirection="row" marginTop={1} width={cols}>
            <Button key="help-back" variant="primary" onPress={() => update($, viewA, () => 'pet')}>
              {hp.back}
            </Button>
          </Box>
        </Box>
      )
    }

    // ── settings view ──
    if (view === 'settings') {
      const aff = await read($, affectionA)
      const pending = await read($, confirmA)
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

      // a language of one's own: type a name → (checked) → consent → translated
      const flow = await read($, langFlowA)
      const isOwn = s.lang === 'custom'
      const ownOpt = (
        <Button key="opt-lang-custom" plain dimColor={!isOwn} onPress={() => setFlow($, { ...FLOW_IDLE, step: 'typing' })}>
          {isOwn ? <Text color={ACC}>{'● ' + (pk?.name ?? o.custom ?? 'Own…')}</Text> : '○ ' + (o.custom ?? 'Own…')}
        </Button>
      )
      const quiet = (key: string, label: string, onPress: () => unknown) => (
        <Button key={key} dimColor onPress={onPress}>
          {label}
        </Button>
      )
      const cancel = quiet('lang-cancel', w.lang.cancel, () => setFlow($, FLOW_IDLE))
      const flowRows =
        flow.step === 'typing'
          ? [
              para(
                flow.note === 'unknown'
                  ? w.lang.unknown
                  : flow.note === 'failed'
                    ? fill(w.lang.failed, { reason: flow.reason })
                    : w.lang.ask,
                flow.note === '',
              ),
              // an empty field draws next to nothing on its own: a frame and a mark show it
              <Box key="lang-field" borderStyle="round" borderColor={ACC} width={cols}>
                <Input
                  key="lang-input"
                  label="› "
                  autoFocus
                  placeholder={w.lang.placeholder}
                  submitLabel={w.lang.enter}
                  onSubmit={(value: string) => {
                    void chooseLang($, value).catch(() => setFlow($, FLOW_IDLE))
                  }}
                />
              </Box>,
              cancel,
            ]
          : flow.step === 'checking'
            ? [para(w.lang.checking)]
            : flow.step === 'confirm'
              ? [
                  para(fill(w.lang.confirm, { name: flow.name }), false),
                  <Box key="lang-confirm" flexDirection="row" columnGap={2} flexWrap="wrap" width={cols}>
                    <Button
                      key="lang-translate"
                      variant="primary"
                      onPress={() => {
                        // a minute or so: never awaited inside the press
                        void translate($, { code: flow.code, name: flow.name, english: flow.english }).catch(() =>
                          setFlow($, FLOW_IDLE),
                        )
                      }}
                    >
                      {w.lang.translate}
                    </Button>
                    {cancel}
                  </Box>,
                ]
              : flow.step === 'working'
                ? [para(fill(w.lang.working, { name: flow.name }))]
                : flow.step === 'blocked'
                  ? [para(w.lang.blocked, false), quiet('lang-close', w.lang.close, () => setFlow($, FLOW_IDLE))]
                  : isOwn && pk
                    ? [
                        pk.hash !== EN_HASH ? para(w.lang.stale) : null,
                        quiet('lang-again', w.lang.again, () =>
                          setFlow($, { ...FLOW_IDLE, step: 'confirm', code: pk.code, name: pk.name, english: pk.english }),
                        ),
                      ]
                    : []

      return (
        <Box flexDirection="column" width={cols}>
          {header}
          {rule(w.setTitle)}
          {!s.isSetUp ? para(w.intro, false) : null}
          {row('lang', [opt('lang', 'auto', o.auto ?? 'Auto'), opt('lang', 'uk', o.uk ?? 'uk'), opt('lang', 'en', o.en ?? 'en'), opt('lang', 'ja', o.ja ?? 'ja'), opt('lang', 'ko', o.ko ?? 'ko'), ownOpt])}
          {flowRows.length ? (
            <Box key="lang-flow" flexDirection="column" width={cols}>
              {flowRows}
            </Box>
          ) : null}
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
          {pending ? (
            <Box key="confirm" flexDirection="column" marginTop={1} width={cols}>
              {para(pending === 'settings' ? w.confirmSettings : w.confirmAff, false)}
              <Box flexDirection="row" columnGap={2} flexWrap="wrap" width={cols}>
                <Button
                  key="confirm-yes"
                  variant="primary"
                  onPress={async () => {
                    await update($, confirmA, () => null)
                    await (pending === 'settings' ? resetSettings($) : resetAffection($))
                  }}
                >
                  {w.yesReset}
                </Button>
                <Button key="confirm-no" dimColor onPress={() => update($, confirmA, () => null)}>
                  {w.no}
                </Button>
              </Box>
            </Box>
          ) : (
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
              <Button key="reset-settings" dimColor onPress={() => update($, confirmA, () => 'settings')}>
                {w.resetSettings}
              </Button>
              {s.affection ? (
                <Button key="reset-affection" dimColor onPress={() => update($, confirmA, () => 'affection')}>
                  {w.resetAff}
                </Button>
              ) : null}
            </Box>
          )}
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
          '│ ' + padCells(lines[0] ?? '', inner) + ' │',
          '│ ' + padCells(lines[1] ?? '', inner) + ' │',
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
            <Text dimColor>{w.context + ' '}</Text>
            <Text color={warn(us.ctxPercent)}>{bar(us.ctxPercent, barW)}</Text>
            {` ${Math.round(us.ctxPercent)}%`}
            <Text dimColor>{tokens}</Text>
          </Text>,
        )
      }
      for (const l of us.limits) {
        usageRows.push(
          <Text key={`u-${l.kind}`} wrap="truncate-end">
            <Text dimColor>{limitName(l.kind, w) + ': '}</Text>
            <Text color={warn(l.percent)}>{`${Math.round(l.percent)}%`}</Text>
            <Text dimColor>{resetIn(l.resetsAt, w)}</Text>
          </Text>,
        )
      }
      if (us.usd !== null) {
        usageRows.push(
          <Text key="u-cost" dimColor wrap="truncate-end">
            {w.cost + ': $' + us.usd.toFixed(2)}
          </Text>,
        )
      }
    }
    const quick = s.quick ? quickCommands : []

    // under the pet: the hearts, and the "?" that explains them
    const heartsRow = (
      <Box key="hearts-row" flexDirection="row" columnGap={1}>
        {s.affection ? <Text color={HEARTS_COLOR}>{hearts(aff)}</Text> : null}
        {s.affection ? <Text dimColor>{w.levels[levelOf(aff)]}</Text> : null}
        <Button key="open-help" plain onPress={() => update($, viewA, () => 'help')}>
          <Text color={ACC} bold>
            {' ? '}
          </Text>
        </Button>
      </Box>
    )

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
        {done && !wk ? para(fill(w.lastTurn, { time: secs(done.ms), n: done.tools }) + (done.isAborted ? ' ' + w.lastTurnStopped : '')) : null}

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

        {usageRows.length ? rule(w.usageTitle) : null}
        {usageRows}

        {quick.length ? rule(w.quickTitle) : null}
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
            {heartsRow}
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
                    padCells(lines[i - 1] ?? '', inner),
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
          {heartsRow}
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
