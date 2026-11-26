// Renders the mod's own sprite code into assets/icon.png and assets/demo.gif.
// Usage (from the mod folder): node scripts/render-assets.mjs .
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync, crc32 } from 'node:zlib'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const mod = process.argv[2]
const src = readFileSync(join(mod, 'hooks', 'register.tsx'), 'utf8')
const after = src.split('// <sprite>')[1]
const chunk = after?.slice(after.indexOf('\n') + 1).split('// </sprite>')[0]
if (!chunk) throw new Error('sprite markers not found')
const tmp = join(tmpdir(), `clawd-sprite-${process.pid}.ts`)
writeFileSync(tmp, chunk + '\nexport { frame, W, H, NONE }\n')
const { frame, W, H, NONE } = await import(pathToFileURL(tmp).href)

const BG = 0x1e1e1e

// ── scenes (150 ms per tick) ──
const scenes = []
const add = (count, ctx) => {
  for (let i = 0; i < count; i++) scenes.push(ctx(i))
}
const base = { busy: false, sleeping: false, reaction: null, mood: null, skin: 'classic' }
let t = 0
add(44, () => ({ t: t++, c: { ...base } })) // idle: blink + wave
add(20, () => ({ t: t++, c: { ...base, busy: true } })) // working: walking
add(30, i => ({ t: t++, c: { ...base, reaction: { kind: 'hearts', r: i, left: 30 - i } } }))
add(22, i => ({ t: t++, c: { ...base, reaction: { kind: 'shy', r: i, left: 22 - i } } }))
add(36, i => ({ t: t++, c: { ...base, reaction: { kind: 'tsundere', r: i, left: 36 - i } } }))
add(22, i => ({ t: t++, c: { ...base, reaction: { kind: 'sparkle', r: i, left: 22 - i } } }))
add(14, i => ({ t: t++, c: { ...base, mood: { kind: 'sad', r: i } } }))
add(30, () => ({ t: t++, c: { ...base, sleeping: true } }))
add(12, i => ({ t: t++, c: { ...base, reaction: { kind: 'wake', r: i, left: 12 - i } } }))
for (const skin of ['mint', 'lavender', 'sky', 'gold', 'night']) add(8, () => ({ t: t++, c: { ...base, skin } }))

// ── rasterize ──
const S = 16 // screen px per sprite px
const PAD = 2 // sprite px of margin
const IW = (W + PAD * 2) * S
const IH = (H + PAD * 2) * S
function raster(g) {
  const img = new Uint32Array(IW * IH).fill(BG)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = g[y * W + x]
      if (c === NONE) continue
      for (let yy = 0; yy < S; yy++)
        for (let xx = 0; xx < S; xx++) img[((y + PAD) * S + yy) * IW + (x + PAD) * S + xx] = c
    }
  return img
}

// ── GIF (89a, global palette, LZW) ──
function lzw(indices, minCode) {
  const out = []
  let cur = 0, bits = 0
  const write = (code, size) => {
    cur |= code << bits
    bits += size
    while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8 }
  }
  const clear = 1 << minCode, eoi = clear + 1
  let size = minCode + 1, next = eoi + 1
  let dict = new Map()
  write(clear, size)
  let prefix = indices[0]
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]
    const key = prefix * 4096 + k
    const hit = dict.get(key)
    if (hit !== undefined) { prefix = hit; continue }
    write(prefix, size)
    if (next < 4096) {
      dict.set(key, next++)
      if (next > (1 << size) && size < 12) size++
    } else {
      write(clear, size)
      dict = new Map(); size = minCode + 1; next = eoi + 1
    }
    prefix = k
  }
  write(prefix, size)
  write(eoi, size)
  if (bits > 0) out.push(cur & 255)
  return out
}

const frames = scenes.map(({ t, c }) => raster(frame(t, c)))
const colors = new Map()
for (const f of frames) for (const c of f) if (!colors.has(c)) colors.set(c, colors.size)
if (colors.size > 256) throw new Error('too many colors: ' + colors.size)
const palBits = Math.max(1, Math.ceil(Math.log2(colors.size)))
const palSize = 1 << palBits
const bytes = []
const u16 = n => bytes.push(n & 255, (n >> 8) & 255)
bytes.push(...Buffer.from('GIF89a'))
u16(IW); u16(IH)
bytes.push(0x80 | ((palBits - 1) << 4) | (palBits - 1), 0, 0)
const pal = new Array(palSize).fill(0)
for (const [c, i] of colors) pal[i] = c
for (const c of pal) bytes.push((c >> 16) & 255, (c >> 8) & 255, c & 255)
bytes.push(0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0) // loop forever
const minCode = Math.max(2, palBits)
for (const f of frames) {
  bytes.push(0x21, 0xf9, 4, 0x04); u16(15); bytes.push(0, 0) // 150 ms
  bytes.push(0x2c); u16(0); u16(0); u16(IW); u16(IH); bytes.push(0)
  bytes.push(minCode)
  const data = lzw(Array.from(f, c => colors.get(c)), minCode)
  for (let i = 0; i < data.length; i += 255) {
    const block = data.slice(i, i + 255)
    bytes.push(block.length, ...block)
  }
  bytes.push(0)
}
bytes.push(0x3b)

// ── PNG icon: the idle pet, centered on a square ──
function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0
    for (let x = 0; x < width; x++) {
      const c = rgb[y * width + x], o = y * (width * 3 + 1) + 1 + x * 3
      raw[o] = (c >> 16) & 255; raw[o + 1] = (c >> 8) & 255; raw[o + 2] = c & 255
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
}
const SIZE = 512
const g = frame(5, { ...base, reaction: { kind: 'hearts', r: 6, left: 20 } })
const P = Math.floor(SIZE / (W + 4))
const ox = Math.floor((SIZE - W * P) / 2), oy = Math.floor((SIZE - H * P) / 2)
const icon = new Uint32Array(SIZE * SIZE).fill(BG)
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const c = g[y * W + x]
    if (c === NONE) continue
    for (let yy = 0; yy < P; yy++) for (let xx = 0; xx < P; xx++) icon[(oy + y * P + yy) * SIZE + ox + x * P + xx] = c
  }

mkdirSync(join(mod, 'assets'), { recursive: true })
writeFileSync(join(mod, 'assets', 'demo.gif'), Buffer.from(bytes))
writeFileSync(join(mod, 'assets', 'icon.png'), png(SIZE, SIZE, icon))
console.log(`demo.gif ${frames.length} frames ${IW}x${IH}, ${colors.size} colors, ${bytes.length} bytes; icon.png ${SIZE}x${SIZE}`)
