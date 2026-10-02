import type { ClientModule, ClientSurface, RenderElement } from 'claude-code'

import { TICK_MS, finalScore, flap, isSettled, newGame, step } from './physics'
import type { Game, Size } from './physics'
import { sceneOf } from './scene'
import type { Run } from './scene'

type Props = { jumps: number; best: number }

type Controller = { seenJumps: number; current: () => Game; jump: () => Game }

const MAX_COLUMNS = 240
const MIN_COLUMNS = 30
const DEFAULT_COLUMNS = 60
const DEFAULT_ROWS = 18
const JUMP_KEYS = [' ', 'space', 'up', 'return', 'w', 'k', 'j', 'f']

let controller: Controller | undefined

const sizeOf = (surface: ClientSurface<Game>): Size => ({
  columns: Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, surface.columns || DEFAULT_COLUMNS)),
  height: 2 * (surface.rows || DEFAULT_ROWS),
})

const controllerFor = (props: Props, surface: ClientSurface<Game>): Controller => {
  let game = newGame(sizeOf(surface), Date.now() >>> 0)
  const show = (next: Game): Game => {
    game = next
    surface.setState(next)

    return next
  }
  const jump = (): Game => show(flap(game, sizeOf(surface)))
  const advance = (): void => {
    const size = sizeOf(surface)
    const next = step(game, size)
    surface.post({ beat: next.tick, score: finalScore(next), columns: surface.columns, rows: surface.rows })
    if (isSettled(game, size) && next.phase === 'dead') {
      game = next
      return
    }
    show(next)
  }
  surface.every(TICK_MS, advance)
  surface.onKey(event => {
    if (JUMP_KEYS.includes(event.key)) {
      jump()
    }
  })
  surface.onPointer(event => {
    if (event.type === 'down') {
      jump()
    }
  })
  surface.setState(game)

  return { seenJumps: props.jumps, current: () => game, jump }
}

const gameAfter = (driver: Controller, props: Props): Game => {
  const isJumpAsked = props.jumps !== driver.seenJumps
  driver.seenJumps = props.jumps

  return isJumpAsked ? driver.jump() : driver.current()
}

const drawnRow = (surface: ClientSurface<Game>, runs: readonly Run[]): RenderElement => {
  const { Box, Text } = surface.elements

  return (
    <Box>
      {runs.map(run => (
        <Text color={run.color} backgroundColor={run.background}>
          {run.text}
        </Text>
      ))}
    </Box>
  )
}

const FlappyCode: ClientModule<Props, Game> = (props, surface): RenderElement => {
  const { Box } = surface.elements
  if (surface.state === undefined || controller === undefined) {
    controller = controllerFor(props, surface)
  }
  const game = gameAfter(controller, props)
  const best = Math.max(props.best, finalScore(game))

  return <Box flexDirection="column">{sceneOf(game, best, sizeOf(surface)).map(runs => drawnRow(surface, runs))}</Box>
}

export default FlappyCode
