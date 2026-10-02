import { atom, read } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderElement } from 'claude-code'

import type { FlappyBoard } from '../types'
import { diagnosis, noteFrame, notePaneDraw } from './diagnostics'
import { gameRowsFor, paneSizeOf, pictureSizeFor } from './layout'
import { finalScore, flap, isSettled, newGame, stepped } from './physics'
import type { Game, Size } from './physics'
import { pictureOf } from './picture'
import { sceneOf } from './scene'

type PicturePlay = {
  game: Game
  size: Size
  seenAt: number
  frames: number
  unwatchedTicks: number
  isAdvancing: boolean
}

const PANE = 'flappy'
const TITLE = 'Flappy Code'
const BEST = 'best'
const RESET = 'reset'
const DEBUG = 'debug'
const MIN_ROWS = 8
const MAX_ROWS = 20
const WANTED_ROWS = 21
const WANTED_COLUMNS = 240
const SUGGEST_AFTER_MS = 60_000
const ASK = 'ask'
const OPEN = 'open'
const OFF = 'off'
const PICTURE_FRAME_MS = 105
const TICKS_PER_PICTURE = 3
const PICTURE_IDLE_MS = 10_000
const NEVER = Number.NEGATIVE_INFINITY
const UNWATCHED_TICKS = 100
const FIELD = 'keys'
const TERMINAL_WORDS = { hint: 'space to jump · esc to quit', submit: 'jump' }
const PICTURE_WORDS = { hint: 'click here, then press space', submit: 'click to jump' }
const FIELD_READY_HINT = ' click the box below, then space '
const BUTTON_READY_HINT = ' tap Jump to play '
const FIELD_EXPLAINER =
  'How to play here: click the box below once, then press space to jump. The picture itself cannot be clicked.'
const ENDINGS = { conflict: 'merge conflict', crash: 'core dumped', none: 'game over' }
const BOARD = { plugin: 'flappy', key: 'board' } as const
const FRAME = { plugin: 'flappy', key: 'frame' } as const

const board = atom(BOARD, { best: 0, draws: 0, isSuggested: false })
const frame = atom(FRAME, 0)
const scoreboard: FlappyBoard = { best: 0, draws: 0, isSuggested: false }
const picture: PicturePlay = {
  game: newGame(pictureSizeFor(0), 1),
  size: pictureSizeFor(0),
  seenAt: NEVER,
  frames: 0,
  unwatchedTicks: 0,
  isAdvancing: false,
}

let jumps = 0
let thinkingMode = ASK
let pendingSuggestion: { cancel: () => void } | undefined
let picturePulse: { cancel: () => void } | undefined

const hasScore = (posted: unknown): posted is { score: unknown } =>
  typeof posted === 'object' && posted !== null && 'score' in posted

const scoreOf = (posted: unknown): number => {
  const score = hasScore(posted) ? Number(posted.score) : 0

  return Number.isFinite(score) ? score : 0
}

const pictureAlt = (game: Game): string => {
  if (game.phase === 'ready') {
    return 'Flappy Code: ready, jump to start'
  }

  return game.phase === 'dead'
    ? `Flappy Code: ${ENDINGS[game.cause]}, ${game.score} hunks cleared`
    : `Flappy Code: playing, ${game.score} hunks cleared`
}

const redrawBoard = async ($: EngineInterface): Promise<void> => {
  scoreboard.draws += 1
  await $.state.set(BOARD, { ...scoreboard })
}

const keepBest = async ($: EngineInterface, score: number): Promise<void> => {
  scoreboard.best = score
  await redrawBoard($)
  await $.store.set(BEST, score)
}

const loadBest = async ($: EngineInterface): Promise<void> => {
  const stored = Number((await $.store.get(BEST)) ?? 0)
  scoreboard.best = Number.isFinite(stored) ? stored : 0
  await redrawBoard($)
}

const redrawPicture = async ($: EngineInterface): Promise<void> => {
  picture.frames += 1
  await $.state.set(FRAME, picture.frames)
  $.ui.invalidate('ui.render')
}

const isPictureWatched = (now: number): boolean => now - picture.seenAt <= PICTURE_IDLE_MS

const stopPicturePulse = (): void => {
  picturePulse?.cancel()
  picturePulse = undefined
  picture.isAdvancing = false
  picture.unwatchedTicks = 0
}

const isPictureAbandoned = async ($: EngineInterface): Promise<boolean> => {
  const isWatched = picture.seenAt !== NEVER && isPictureWatched(await $.clock.now())
  picture.unwatchedTicks = isWatched ? 0 : picture.unwatchedTicks + 1
  if (picture.unwatchedTicks > UNWATCHED_TICKS) {
    stopPicturePulse()
  }

  return !isWatched
}

const advancePicture = async ($: EngineInterface): Promise<void> => {
  if (picture.isAdvancing || (await isPictureAbandoned($))) {
    return
  }
  picture.isAdvancing = true
  const before = picture.game
  picture.game = stepped(before, picture.size, TICKS_PER_PICTURE)
  const isResting = isSettled(before, picture.size) && picture.game.phase === 'dead'
  if (finalScore(picture.game) > scoreboard.best) {
    await keepBest($, picture.game.score)
  }
  if (!isResting) {
    await redrawPicture($)
  }
  picture.isAdvancing = false
}

const focusField = async ($: EngineInterface): Promise<void> => {
  await $.ui.focus({ requestId: PANE, key: FIELD }).catch(() => undefined)
}

const startPicturePulse = ($: EngineInterface): void => {
  picturePulse ??= $.clock.every(PICTURE_FRAME_MS, () => void advancePicture($).catch(stopPicturePulse))
}

const jump = async ($: EngineInterface): Promise<void> => {
  jumps += 1
  if (picture.seenAt === NEVER) {
    return
  }
  startPicturePulse($)
  picture.game = flap(picture.game, picture.size)
  picture.seenAt = await $.clock.now()
  await redrawPicture($)
  await focusField($)
}

const pictureReport = (): string =>
  `picture mode: ${picture.frames} pictures published, timer ${picturePulse ? 'running' : 'stopped'}`

const showsSuggestion = (shown: FlappyBoard, band: { hasSurvey: boolean; isWorking: boolean }): boolean =>
  shown.isSuggested && band.isWorking && !band.hasSurvey

const isGameOpen = async ($: EngineInterface): Promise<boolean> =>
  (await $.ui.panes()).some(pane => pane.id === PANE)

const withdrawSuggestion = async ($: EngineInterface): Promise<void> => {
  pendingSuggestion?.cancel()
  pendingSuggestion = undefined
  if (scoreboard.isSuggested) {
    scoreboard.isSuggested = false
    await redrawBoard($)
  }
}

const openGame = async ($: EngineInterface): Promise<boolean> => {
  await withdrawSuggestion($)
  await loadBest($)
  startPicturePulse($)
  const opened = await $.ui.open({
    id: PANE,
    title: TITLE,
    focus: true,
    closeOnEscape: true,
    rows: WANTED_ROWS,
    columns: WANTED_COLUMNS,
  })
  void focusField($)

  return opened.isPlaced
}

const offerGame = async ($: EngineInterface): Promise<void> => {
  scoreboard.isSuggested = true
  await redrawBoard($)
}

const nudgeToPlay = async ($: EngineInterface): Promise<void> => {
  if (thinkingMode === OFF || (await isGameOpen($))) {
    return
  }
  if (thinkingMode === OPEN && (await openGame($))) {
    return
  }
  await offerGame($)
}

const jumpField = (
  Input: Elements['terminal']['Input'],
  draws: number,
  words: { hint: string; submit: string },
  onJump: () => void,
): RenderElement => (
  <Input
    key={FIELD}
    autoFocus
    placeholder={words.hint}
    value={draws % 2 === 0 ? '' : ' '}
    submitLabel={words.submit}
    onInput={onJump}
    onSubmit={onJump}
  />
)

const watchedPicture = async (
  $: EngineInterface,
  bodyColumns: number,
  best: number,
  readyHint: string,
): Promise<string> => {
  picture.seenAt = await $.clock.now()
  picture.size = pictureSizeFor(bodyColumns)

  return pictureOf(sceneOf(picture.game, Math.max(best, finalScore(picture.game)), picture.size, readyHint))
}

export const register: Register = (on, options) => {
  thinkingMode = String(options.whenThinking ?? ASK)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'flappy',
      description: 'Play Flappy Code in a pane, even while Claude works',
      argumentHint: '[reset|debug]',
      immediate: true,
    })
    await loadBest($)
    if (await isGameOpen($)) {
      startPicturePulse($)
    }

    return next(e)
  })

  on('command.run', { command: 'flappy' }, async ($, e) => {
    if (e.args.trim() === RESET) {
      await keepBest($, 0)

      return { text: 'Flappy Code best score reset.' }
    }
    if (e.args.trim() === DEBUG) {
      return { text: `${diagnosis()}\n${pictureReport()}` }
    }
    await openGame($)

    return { text: 'Flappy Code is open. Space, any key or a click jumps; Esc quits.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      stopPicturePulse()
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await withdrawSuggestion($)
    pendingSuggestion = $.clock.after(SUGGEST_AFTER_MS, () => void nudgeToPlay($).catch(() => undefined))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await withdrawSuggestion($)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, board)
    if (!showsSuggestion(shown, e.props)) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box gap={2}>
        <Text dimColor>Still thinking. Fancy a round of Flappy Code?</Text>
        <Button key="play" hotkey="1" plain label="Play" onPress={() => void openGame($)} />
        <Button key="later" hotkey="2" plain dimColor label="Not now" onPress={() => void withdrawSuggestion($)} />
      </Box>
    )
  })

  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE) {
      return next(e)
    }
    noteFrame(e.surface, e.data)
    const score = scoreOf(e.data)
    if (score > scoreboard.best) {
      await keepBest($, score)
    }

    return { props: { jumps, best: scoreboard.best } }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const shown = await read($, board)
    const onJump = (): void => void jump($)
    notePaneDraw(e.surface, paneSizeOf(e.props, e.viewport))
    if (e.surface === 'terminal') {
      const { Box, Client, Input, Text } = $.ui.resolve(e)
      const rows = Math.min(MAX_ROWS, gameRowsFor(e.props.placement, e.props.scroll.bodyRows, e.viewport?.rows))
      if (rows < MIN_ROWS) {
        return <Text>Flappy Code needs a taller terminal, or one at least 110 columns wide.</Text>
      }

      return (
        <Box flexDirection="column">
          <Client key="game" module="./game.tsx" props={{ jumps, best: shown.best }} width={e.props.bodyColumns} height={rows} />
          {jumpField(Input, shown.draws, TERMINAL_WORDS, onJump)}
        </Box>
      )
    }
    await read($, frame)
    const readyHint = e.surface === 'mobile' ? BUTTON_READY_HINT : FIELD_READY_HINT
    const source = await watchedPicture($, e.props.bodyColumns, shown.best, readyHint)
    noteFrame(e.surface, { columns: picture.size.columns, rows: picture.size.height / 2 })
    if (e.surface === 'mobile') {
      const { Box, Button, Svg } = $.ui.resolve(e)

      return (
        <Box flexDirection="column">
          <Svg source={source} alt={pictureAlt(picture.game)} />
          <Button key="jump" variant="primary" label="Jump" onPress={onJump} />
        </Box>
      )
    }
    const { Box, Input, Svg, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Svg source={source} alt={pictureAlt(picture.game)} />
        <Text dimColor>{FIELD_EXPLAINER}</Text>
        {jumpField(Input, shown.draws, PICTURE_WORDS, onJump)}
      </Box>
    )
  })
}
