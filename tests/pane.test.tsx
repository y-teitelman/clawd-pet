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

test('other surfaces get a short note, not a broken drawing', async $ => {
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Clawd/ })).toBeDefined()
    await ui.unmount()
  }
})
