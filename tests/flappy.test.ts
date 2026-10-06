import { expect, mock, test } from 'claude-code/testing'

import {
  HUNK_WIDTH,
  JUMPER_HEIGHT,
  JUMPER_X,
  difficultyOf,
  flap,
  gapOf,
  isSettled,
  newGame,
  playHeight,
  spacingOf,
  step,
} from '../hooks/physics'
import type { Game, Size } from '../hooks/physics'

const SIZE = { columns: 60, height: 36 }
const TICK = 35
const FALL_TICKS = 160
const MINUTE = 60_000
const PICTURE_FRAME = 105
const PANE = {
  component: 'Pane',
  requestId: 'flappy',
  props: {
    title: 'Flappy Code',
    isFocused: true,
    bodyColumns: 60,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 3, bodyColumns: 100 },
} as const
const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

type Shown = { findAll: (query: { type: string; in: string }) => Promise<{ text: string }[]> }

const started = (size: Size = SIZE, seed = 1): Game => flap(newGame(size, seed), size)

const after = (game: Game, ticks: number, size: Size = SIZE): Game =>
  ticks === 0 ? game : after(step(game, size), ticks - 1, size)

const hovering = (game: Game, at: number): Game => ({ ...game, phase: 'playing', jumperY: at, velocity: 0 })

const afterHovering = (game: Game, ticks: number, at: number, size: Size = SIZE): Game =>
  ticks === 0 ? game : afterHovering(step(hovering(game, at), size), ticks - 1, at, size)

const facing = (hunkDistance: number, gapTop: number): Game => ({
  ...started(),
  hunks: [{ x: JUMPER_X + hunkDistance, gapTop, isPassed: false }],
})

const textOf = async (ui: Shown): Promise<string> =>
  (await ui.findAll({ type: 'Text', in: 'game' })).map(one => one.text.replaceAll('\u00a0', ' ')).join('|')

const expectOver = async (ui: Shown): Promise<void> => {
  expect(await textOf(ui)).toContain(' jump to try again ')
}

const expectPlaying = async (ui: Shown): Promise<void> => {
  expect(await textOf(ui)).not.toContain(' jump to try again ')
  expect(await textOf(ui)).not.toContain(' FLAPPY CODE ')
}

test('the jumper waits, rises on a jump and falls to its death', () => {
  const ready = step(newGame(SIZE, 1), SIZE)
  expect(ready.phase).toBe('ready')
  expect(ready.hunks).toEqual([])

  const jumped = step(flap(ready, SIZE), SIZE)
  expect(jumped.phase).toBe('playing')
  expect(jumped.jumperY).toBeLessThan(ready.jumperY)

  const fallen = after(jumped, 2 * FALL_TICKS)
  expect(fallen.phase).toBe('dead')
  expect(fallen.cause).toBe('crash')
  expect(fallen.score).toBe(0)
  expect(isSettled(fallen, SIZE)).toBe(true)
  expect(fallen.jumperY).toBe(playHeight(SIZE) - JUMPER_HEIGHT)
})

test('a hunk scores once passed through its gap and ends the game on contact', () => {
  const through = afterHovering(facing(7, 6), 2 * (7 + HUNK_WIDTH), 10)
  expect(through.phase).toBe('playing')
  expect(through.score).toBe(1)
  expect(afterHovering(through, 2, 10).score).toBe(1)

  const crashed = after(hovering(facing(7, 6), 1), 8)
  expect(crashed.phase).toBe('dead')
  expect(crashed.cause).toBe('conflict')
})

test('hunks keep coming with gaps that fit the screen', () => {
  const levelled = (game: Game): Game => ({ ...game, hunks: game.hunks.map(hunk => ({ ...hunk, gapTop: 6 })) })
  let game = started(SIZE, 42)
  const gapTops = new Set<number>()
  for (let tick = 0; tick < 800; tick += 1) {
    game.hunks.forEach(hunk => gapTops.add(hunk.gapTop))
    game = step(hovering(levelled(game), 10), SIZE)
  }

  expect(game.score).toBeGreaterThan(10)
  expect(game.hunks.length).toBeGreaterThan(1)
  expect(gapTops.size).toBeGreaterThan(3)
  for (const gapTop of gapTops) {
    expect(gapTop % 2).toBe(0)
    expect(gapTop).toBeGreaterThan(3)
    expect(gapTop + gapOf(SIZE)).toBeLessThan(playHeight(SIZE) - 3)
  }
})

const WIDE = { columns: 4000, height: 36 }

const spawnedAt = (score: number, seed: number): Game => step({ ...started(WIDE, seed), score }, WIDE)

const swingsOf = (game: Game): number[] =>
  game.hunks.slice(1).map((hunk, index) => Math.abs(hunk.gapTop - (game.hunks[index]?.gapTop ?? hunk.gapTop)))

const meanSwing = (score: number): number => {
  const swings = [1, 2, 3, 4, 5].flatMap(seed => swingsOf(spawnedAt(score, seed)))

  return swings.reduce((sum, swing) => sum + swing, 0) / swings.length
}

test('hunks come closer together and swing further apart as the score climbs, up to a cap', () => {
  expect(spacingOf(0)).toBe(28)
  expect(spacingOf(125)).toBeLessThan(spacingOf(0))
  expect(spacingOf(250)).toBeLessThan(spacingOf(125))
  expect(spacingOf(1000)).toBe(spacingOf(250))
  expect(difficultyOf(1000)).toBe(difficultyOf(250))

  expect(meanSwing(250)).toBeGreaterThan(meanSwing(0))
  expect(meanSwing(1000)).toBe(meanSwing(250))
})

test('even at the hardest, a tall pane never asks for a swing too far to fly', () => {
  const tall = { columns: 4000, height: 80 }
  const hardest = step({ ...started(tall, 3), score: 250 }, tall)

  expect(Math.max(...swingsOf(hardest))).toBeLessThanOrEqual(12)
})

test('a short pane still leaves a gap the jumper fits through and can hop within', () => {
  for (const rows of [8, 9, 11, 13, 15, 16, 18, 20]) {
    const size = { columns: 60, height: 2 * rows }
    const gap = gapOf(size)
    expect(gap % 2).toBe(0)
    expect(gap).toBeGreaterThan(JUMPER_HEIGHT + 4)

    for (const hunk of started(size, rows).hunks) {
      expect(hunk.gapTop).toBeGreaterThan(1)
      expect(hunk.gapTop + gap).toBeLessThan(playHeight(size) - 1)
    }

    let hop: Game = { ...flap(hovering(started(size), 10), size), hunks: [] }
    for (let tick = 0; tick < 24; tick += 1) {
      hop = { ...step(hop, size), hunks: [] }
      expect(10 - hop.jumperY).toBeLessThan(gap - JUMPER_HEIGHT)
    }
  }
})

test('a finished game restarts on a jump only after a pause', () => {
  const dead = after({ ...started(), jumperY: playHeight(SIZE) - 6, velocity: 1 }, 4)
  expect(dead.phase).toBe('dead')
  expect(flap(dead, SIZE).phase).toBe('dead')

  const again = flap(after(dead, 20), SIZE)
  expect(again.phase).toBe('playing')
  expect(again.score).toBe(0)
})

test('the pane runs the game through ticks, keys, clicks and the jump field', async ($, on) => {
  mock.clock(on)
  mock.store(on, { best: 7 })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))

  const answer = await $.command.run({ command: 'flappy', args: '', ...TYPED })
  expect(answer.text).toContain('Flappy Code is open')

  const ui = await $.ui.mount({ plugin: 'flappy', surface: 'terminal', ...PANE })
  await ui.resize({ columns: 60, rows: 18 })
  expect(await ui.find({ type: 'Client', key: 'game' })).toBeDefined()
  expect(await textOf(ui)).toContain(' FLAPPY CODE ')
  expect(await textOf(ui)).toContain(' BEST 7 ')

  await ui.key({ key: ' ' })
  await ui.advance(TICK * 3)
  await expectPlaying(ui)

  await ui.advance(TICK * FALL_TICKS)
  await expectOver(ui)
  expect(await textOf(ui)).toMatch(/ CORE DUMPED | MERGE CONFLICT /)
  expect(await textOf(ui)).toContain(' hunks cleared · best 7 ')

  await ui.input({ key: 'keys', text: ' ', kind: 'change' })
  await ui.advance(TICK * 2)
  await expectPlaying(ui)

  await ui.advance(TICK * FALL_TICKS)
  await expectOver(ui)
  await ui.pointer({ type: 'down', x: 5, y: 5, button: 'left' })
  await ui.advance(TICK)
  await expectPlaying(ui)

  await ui.advance(TICK * FALL_TICKS)
  await expectOver(ui)
  await ui.input({ key: 'keys', text: '' })
  await ui.advance(TICK * 2)
  await expectPlaying(ui)
  await ui.unmount()
})

test('the game takes the height the pane really has, or says the terminal is too short', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const heightOf = async (placement: 'dock' | 'inline', bodyRows: number, rows: number): Promise<unknown> => {
    const ui = await $.ui.mount({
      plugin: 'flappy',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'flappy',
      props: { ...PANE.props, placement, scroll: { offset: 0, bodyRows } },
      viewport: { columns: 100, rows },
    })
    const game = await ui.find({ type: 'Client', key: 'game' })
    const notice = await ui.find({ type: 'Text', text: /taller terminal/ })
    await ui.unmount()

    return game ? game.props.height : notice?.text
  }

  expect(await heightOf('inline', 9, 44)).toBe(11)
  expect(await heightOf('inline', 9, 60)).toBe(17)
  expect(await heightOf('inline', 9, 90)).toBe(20)
  expect(await heightOf('inline', 9, 30)).toContain('taller terminal')
  expect(await heightOf('dock', 45, 50)).toBe(20)
  expect(await heightOf('dock', 14, 16)).toBe(13)
})

test('where the drawing module cannot load, a jump starts the game as a picture redrawn from the hooks side', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const ui = await $.ui.mount({ plugin: 'flappy', surface: 'desktop', ...PANE })
  const pictured = async (): Promise<{ alt: string; source: string }> => {
    const svg = await ui.find({ type: 'Svg' })

    return { alt: String(svg?.props.alt), source: String(svg?.props.source) }
  }

  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /click the box below once, then press space/ })).toBeDefined()
  expect((await pictured()).alt).toContain('ready')
  expect((await pictured()).source).toMatch(/^<svg xmlns=/)
  expect((await pictured()).source.length).toBeLessThan(131_072)

  await ui.input({ key: 'keys', text: ' ', kind: 'change' })
  expect((await pictured()).alt).toContain('playing')
  const justJumped = (await pictured()).source
  await clock.advance(PICTURE_FRAME * 4)
  expect((await pictured()).source).not.toBe(justJumped)
  expect((await $.command.run({ command: 'flappy', args: 'debug', ...TYPED })).text).toContain('timer running')

  await clock.advance(PICTURE_FRAME * 80)
  expect((await pictured()).alt).toMatch(/core dumped|merge conflict/)

  await ui.input({ key: 'keys', text: '' })
  expect((await pictured()).alt).toContain('playing')
  await ui.unmount()
})

test('each surface gets controls it can draw: a field where there is one, a button where there is none', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const controlsOn = async (surface: 'terminal' | 'desktop' | 'vscode' | 'mobile'): Promise<string[]> => {
    const ui = await $.ui.mount({ plugin: 'flappy', surface, ...PANE })
    const drawn = await Promise.all(
      ['Client', 'Svg', 'Input', 'Button'].map(async type => ((await ui.find({ type })) ? type : '')),
    )
    await ui.unmount()

    return drawn.filter(Boolean)
  }

  expect(await controlsOn('terminal')).toEqual(['Client', 'Input'])
  expect(await controlsOn('desktop')).toEqual(['Svg', 'Input'])
  expect(await controlsOn('vscode')).toEqual(['Svg', 'Input'])
  expect(await controlsOn('mobile')).toEqual(['Svg', 'Button'])
})

test('a turn longer than a minute offers the game above the prompt until it is taken or the turn ends', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const opened: unknown[] = []
  on('ui.open', ($$, e) => {
    opened.push(e)

    return { value: { isPlaced: true as const } }
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.render', { component: 'AbovePrompt' }, ($$, e) => $$.ui.resolve(e).Box({}))
  on('turn.start', ($$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const offer = async (): Promise<unknown> => {
    const band = await $.ui.mount({ plugin: 'flappy', surface: 'terminal', ...BAND })
    const play = await band.find({ type: 'Button', key: 'play' })
    await band.unmount()

    return play?.props.label
  }

  await $.turn.start({ text: 'think hard', turnId: 'turn-1' })
  await clock.advance(MINUTE - 1)
  expect(await offer()).toBeUndefined()
  await clock.advance(1)
  expect(await offer()).toBe('Play')

  const band = await $.ui.mount({ plugin: 'flappy', surface: 'terminal', ...BAND })
  await band.press({ key: 'play' })
  await band.unmount()
  expect(opened).toHaveLength(1)
  expect(await offer()).toBeUndefined()

  await $.turn.start({ text: 'think again', turnId: 'turn-2' })
  await clock.advance(MINUTE)
  expect(await offer()).toBe('Play')
  await $.turn.complete({ reason: 'answer', text: 'done', turnId: 'turn-2', durationMs: MINUTE })
  expect(await offer()).toBeUndefined()
})

test('set to open, a long turn opens the game by itself instead of asking', { options: { whenThinking: 'open' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const opened: unknown[] = []
  on('ui.open', ($$, e) => {
    opened.push(e)

    return { value: { isPlaced: true as const } }
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.render', { component: 'AbovePrompt' }, ($$, e) => $$.ui.resolve(e).Box({}))
  on('turn.start', ($$, e) => ({ turnId: e.turnId }))

  await $.turn.start({ text: 'think hard', turnId: 'turn-1' })
  await clock.advance(MINUTE)
  expect(opened).toHaveLength(1)
  const band = await $.ui.mount({ plugin: 'flappy', surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Button', key: 'play' })).toBeUndefined()
  await band.unmount()
})

test('set to off, a long turn neither opens the game nor asks', { options: { whenThinking: 'off' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  on('ui.panes', () => ({ value: [] }))
  on('ui.render', { component: 'AbovePrompt' }, ($$, e) => $$.ui.resolve(e).Box({}))
  on('turn.start', ($$, e) => ({ turnId: e.turnId }))

  await $.turn.start({ text: 'think hard', turnId: 'turn-1' })
  await clock.advance(MINUTE)
  const band = await $.ui.mount({ plugin: 'flappy', surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Button', key: 'play' })).toBeUndefined()
  await band.unmount()
})

test('/flappy reset clears the kept best score', async ($, on) => {
  mock.clock(on)
  mock.store(on, { best: 18 })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))

  const answer = await $.command.run({ command: 'flappy', args: 'reset', ...TYPED })
  expect(answer.text).toContain('reset')
  await $.command.run({ command: 'flappy', args: '', ...TYPED })
  const ui = await $.ui.mount({ plugin: 'flappy', surface: 'terminal', ...PANE })
  await ui.resize({ columns: 60, rows: 18 })
  expect(await textOf(ui)).toContain(' BEST 0 ')
  await ui.unmount()
})

test('/flappy debug says, per surface, whether the game runs and in how much room', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  const reported = async (): Promise<string> =>
    (await $.command.run({ command: 'flappy', args: 'debug', ...TYPED })).text ?? ''

  expect(await reported()).toContain('Nothing drawn yet')
  expect(await reported()).toContain('picture mode: 0 pictures published, timer stopped')

  const terminal = await $.ui.mount({ plugin: 'flappy', surface: 'terminal', ...PANE })
  await terminal.resize({ columns: 60, rows: 18 })
  await terminal.advance(TICK * 3)
  const desktop = await $.ui.mount({
    plugin: 'flappy',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'flappy',
    props: { ...PANE.props, placement: 'dock', bodyColumns: 0, scroll: { offset: 0, bodyRows: 0 } },
  })

  expect(await reported()).toMatch(
    /terminal: pane drawn \d+x \(inline, body 60x20 cells, viewport unmeasured\); the game runs \(\d+ frames?\) in a region of 60x18 cells/,
  )
  expect(await reported()).toMatch(
    /desktop: pane drawn \d+x \(dock, body 0x0 cells, viewport unmeasured\); the game runs \(\d+ frames?\) in a region of 80x20 cells/,
  )
  await terminal.unmount()
  await desktop.unmount()
})
