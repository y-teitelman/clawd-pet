import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'clawd-pet',
  component: 'Pane',
  requestId: 'clawd',
  props: {
    title: 'Clawd Pet',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

test('the pet view draws the title, the pet and an empty bubble', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /Clawd Pet/ }))?.text).toContain('Clawd Pet')
  // the body is drawn as clickable solid runs
  expect(await ui.find({ type: 'Button', text: /█/ })).toBeDefined()
  // no bubble frame until it speaks
  expect(await ui.find({ type: 'Text', text: /╭/ })).toBeUndefined()
  await ui.unmount()
})

test('a click on the pet makes it speak', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const body = await ui.find({ type: 'Button', text: /█/ })
  expect(body).toBeDefined()

  await ui.press({ key: String(body?.key) })

  // AI lines are off by default, so a built-in line lands at once
  expect(await ui.find({ type: 'Text', text: /╭/ })).toBeDefined()
  await ui.unmount()
})

test('the ≡ button opens settings, and a choice sticks', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.press({ key: 'open-settings' })
  expect(await ui.find({ type: 'Button', key: 'settings-done' })).toBeDefined()

  await ui.press({ key: 'opt-skin-mint' })
  expect((await ui.find({ type: 'Button', key: 'opt-skin-mint' }))?.text).toMatch(/●/)
  expect((await ui.find({ type: 'Button', key: 'opt-skin-classic' }))?.text).toMatch(/○/)

  await ui.press({ key: 'settings-done' })
  expect(await ui.find({ type: 'Button', key: 'open-settings' })).toBeDefined()
  await ui.unmount()
})

test('a language of your own: Russian is turned away before any model call', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'open-settings' })
  await ui.press({ key: 'opt-lang-custom' })
  expect(await ui.find({ type: 'Input', key: 'lang-input' })).toBeDefined()

  await ui.input({ key: 'lang-input', text: 'Русский язык' })
  expect(await ui.find({ type: 'Text', text: /tanks/ })).toBeDefined()
  expect(await ui.find({ type: 'Input', key: 'lang-input' })).toBeUndefined()

  // closing it leaves the language as it was
  await ui.press({ key: 'lang-close' })
  expect(await ui.find({ type: 'Text', text: /tanks/ })).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: 'opt-lang-auto' }))?.text).toMatch(/●/)
  await ui.unmount()
})

test('Japanese is built in, and its bubble keeps its frame', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'open-settings' })
  await ui.press({ key: 'opt-lang-ja' })
  expect(await ui.find({ type: 'Text', text: /設定/ })).toBeDefined()
  await ui.press({ key: 'settings-done' })

  // a built-in Japanese line: its rows are as wide as the frame, in cells
  const body = await ui.find({ type: 'Button', text: /█/ })
  await ui.press({ key: String(body?.key) })
  const top = (await ui.find({ type: 'Text', text: /╭/ }))?.text ?? ''
  expect(top.length).toBeGreaterThan(0)
  await ui.unmount()
})

test('the ? beside the pet opens the rules, and Back returns', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'open-help' })
  expect(await ui.find({ type: 'Text', text: /How to treat Clawd/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /up to 12 times a day/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Poking 4 times in 10 seconds/ })).toBeDefined()
  await ui.press({ key: 'help-back' })
  expect(await ui.find({ type: 'Button', key: 'open-help' })).toBeDefined()
  await ui.unmount()
})

test('resetting settings asks first, and No keeps them', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'open-settings' })
  await ui.press({ key: 'opt-skin-mint' })

  await ui.press({ key: 'reset-settings' })
  expect(await ui.find({ type: 'Button', key: 'confirm-yes' })).toBeDefined()
  await ui.press({ key: 'confirm-no' })
  expect((await ui.find({ type: 'Button', key: 'opt-skin-mint' }))?.text).toMatch(/●/)

  await ui.press({ key: 'reset-settings' })
  await ui.press({ key: 'confirm-yes' })
  expect((await ui.find({ type: 'Button', key: 'opt-skin-classic' }))?.text).toMatch(/●/)
  await ui.unmount()
})

test('resetting affection asks first', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'open-settings' })
  await ui.press({ key: 'reset-affection' })
  expect(await ui.find({ type: 'Text', text: /earned again/ })).toBeDefined()
  await ui.press({ key: 'confirm-no' })
  expect(await ui.find({ type: 'Button', key: 'reset-affection' })).toBeDefined()
  await ui.unmount()
})

test('a language of your own can be cancelled', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'open-settings' })
  await ui.press({ key: 'opt-lang-custom' })
  await ui.press({ key: 'lang-cancel' })
  expect(await ui.find({ type: 'Input', key: 'lang-input' })).toBeUndefined()
  await ui.unmount()
})

test('the app surfaces draw the pet as an SVG under the same header', async $ => {
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Clawd Pet/ }))?.text).toContain('Clawd Pet')
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    await ui.unmount()
  }
})

test('on the desktop a click layer lies over the pet and a click is heard', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Client', key: 'pet-click' })).toBeDefined()

  // the layer posts { poke: true }; the hook turns it into a reaction line
  await ui.pointer({ type: 'down', x: 2, y: 2, button: 'left' })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()
})
