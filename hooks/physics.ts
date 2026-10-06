export type Phase = 'ready' | 'playing' | 'dead'

export type Cause = 'none' | 'conflict' | 'crash'

export type Hunk = { x: number; gapTop: number; isPassed: boolean }

export type Game = {
  phase: Phase
  cause: Cause
  tick: number
  jumperY: number
  velocity: number
  hunks: Hunk[]
  score: number
  seed: number
  diedAt: number
}

export type Size = { columns: number; height: number }

export const TICK_MS = 35
export const JUMPER_X = 12
export const JUMPER_WIDTH = 6
export const JUMPER_HEIGHT = 5
export const HUNK_WIDTH = 6
export const GROUND = 2

const GRAVITY = 0.0625
const FLAP_VELOCITY = -0.8
const FULL_GAP = 16
const SMALL_GAP = 10
const ROOMY_HEIGHT = 30
const ROOMY_MARGIN = 4
const TIGHT_MARGIN = 2
const GAP_SLACK = 4
const MAX_FALL = 1.1
const SCROLL_TICKS = 2
const FIRST_HUNK_DISTANCE = 44
const EASY_SPACING = 28
const HARD_SPACING = 21
const HARDEST_SCORE = 250
const SWING_REACH = 6
const RESTART_TICKS = 16
const BOB_PERIOD = 6

export const playHeight = (size: Size): number => size.height - GROUND

const marginOf = (size: Size): number => (playHeight(size) >= ROOMY_HEIGHT ? ROOMY_MARGIN : TIGHT_MARGIN)

export const gapOf = (size: Size): number => {
  const room = 2 * Math.floor((playHeight(size) - 2 * marginOf(size) - GAP_SLACK) / 2)

  return Math.max(SMALL_GAP, Math.min(FULL_GAP, room))
}

const liftOf = (size: Size): number => FLAP_VELOCITY * Math.sqrt(gapOf(size) / FULL_GAP)

const restingY = (size: Size): number => Math.max(1, Math.floor(playHeight(size) / 2) - JUMPER_HEIGHT)

const nextSeed = (seed: number): number => (Math.imul(seed, 1664525) + 1013904223) >>> 0

export const newGame = (size: Size, seed: number): Game => ({
  phase: 'ready',
  cause: 'none',
  tick: 0,
  jumperY: restingY(size),
  velocity: 0,
  hunks: [],
  score: 0,
  seed,
  diedAt: 0,
})

export const jumperTop = (game: Game): number => Math.round(game.jumperY)

const isBeside = (hunk: Hunk): boolean => JUMPER_X + JUMPER_WIDTH > hunk.x && JUMPER_X < hunk.x + HUNK_WIDTH

const fitsGap = (top: number, hunk: Hunk, gap: number): boolean =>
  top >= hunk.gapTop && top + JUMPER_HEIGHT <= hunk.gapTop + gap

const hitsHunk = (game: Game, hunk: Hunk, gap: number): boolean =>
  isBeside(hunk) && !fitsGap(jumperTop(game), hunk, gap)

const isOnFloor = (game: Game, size: Size): boolean => jumperTop(game) + JUMPER_HEIGHT >= playHeight(size)

const isTooSoonToRestart = (game: Game): boolean => game.tick - game.diedAt < RESTART_TICKS

export const difficultyOf = (score: number): number => Math.min(1, score / HARDEST_SCORE)

export const spacingOf = (score: number): number =>
  Math.round(EASY_SPACING - (EASY_SPACING - HARD_SPACING) * difficultyOf(score))

const farPlaceChance = (difficulty: number): number => (1 + difficulty) / 2

const isFarPlaceDrawn = (seed: number, difficulty: number): boolean =>
  (seed >>> 24) / 0x100 < farPlaceChance(difficulty)

const nextPlace = (seed: number, places: number, lastPlace: number, difficulty: number): number => {
  const lowest = Math.max(0, lastPlace - SWING_REACH)
  const reachable = Math.min(places - 1, lastPlace + SWING_REACH) - lowest + 1
  const first = lowest + ((seed >>> 8) % reachable)
  const second = lowest + ((seed >>> 16) % reachable)
  const [near, far] = Math.abs(first - lastPlace) <= Math.abs(second - lastPlace) ? [first, second] : [second, first]

  return isFarPlaceDrawn(seed, difficulty) ? far : near
}

const placeOfGap = (gapTop: number, margin: number): number => (gapTop - margin) / 2

const nextHunkX = (hunks: Hunk[], spacing: number): number => {
  const last = hunks.at(-1)

  return last ? last.x + spacing : JUMPER_X + FIRST_HUNK_DISTANCE
}

const spawned = (game: Game, size: Size): Game => {
  const margin = marginOf(size)
  const places = Math.max(1, Math.floor((playHeight(size) - gapOf(size) - 2 * margin) / 2) + 1)
  const difficulty = difficultyOf(game.score)
  const spacing = spacingOf(game.score)
  const hunks = [...game.hunks]
  let seed = game.seed
  let x = nextHunkX(hunks, spacing)
  while (x <= size.columns) {
    seed = nextSeed(seed)
    const lastPlace = placeOfGap(hunks.at(-1)?.gapTop ?? margin, margin)
    hunks.push({ x, gapTop: margin + 2 * nextPlace(seed, places, lastPlace, difficulty), isPassed: false })
    x += spacing
  }

  return hunks.length === game.hunks.length ? game : { ...game, seed, hunks }
}

const scrolled = (game: Game): Game => {
  if (game.tick % SCROLL_TICKS !== 0) {
    return game
  }
  const shifted = game.hunks.map(hunk => ({ ...hunk, x: hunk.x - 1 })).filter(hunk => hunk.x + HUNK_WIDTH >= 0)
  const hunks = shifted.map(hunk => ({ ...hunk, isPassed: hunk.x + HUNK_WIDTH <= JUMPER_X }))
  const gained = hunks.filter((hunk, index) => hunk.isPassed && shifted[index]?.isPassed !== true).length

  return { ...game, hunks, score: game.score + gained }
}

const fallen = (game: Game, size: Size): Game => {
  const velocity = Math.min(MAX_FALL, game.velocity + GRAVITY)
  const floor = playHeight(size) - JUMPER_HEIGHT
  const jumperY = Math.min(floor, Math.max(0, game.jumperY + velocity))

  return { ...game, velocity: jumperY === 0 ? 0 : velocity, jumperY }
}

const died = (game: Game, cause: Cause): Game => ({ ...game, phase: 'dead', cause, diedAt: game.tick })

const played = (game: Game, size: Size): Game => {
  const next = fallen(scrolled(spawned(game, size)), size)
  const gap = gapOf(size)
  if (next.hunks.some(hunk => hitsHunk(next, hunk, gap))) {
    return died(next, 'conflict')
  }

  return isOnFloor(next, size) ? died(next, 'crash') : next
}

export const step = (game: Game, size: Size): Game => {
  const ticked = { ...game, tick: game.tick + 1 }
  if (ticked.phase === 'playing') {
    return played(ticked, size)
  }
  if (ticked.phase === 'dead') {
    return fallen(ticked, size)
  }

  return { ...ticked, jumperY: restingY(size) + Math.sin(ticked.tick / BOB_PERIOD) }
}

export const stepped = (game: Game, size: Size, ticks: number): Game =>
  ticks <= 0 ? game : stepped(step(game, size), size, ticks - 1)

export const isSettled = (game: Game, size: Size): boolean => game.phase === 'dead' && isOnFloor(game, size)

export const finalScore = (game: Game): number => (game.phase === 'dead' ? game.score : 0)

export const flap = (game: Game, size: Size): Game => {
  if (game.phase !== 'dead') {
    return { ...game, phase: 'playing', velocity: liftOf(size) }
  }
  if (isTooSoonToRestart(game)) {
    return game
  }

  return { ...newGame(size, game.seed), phase: 'playing', velocity: liftOf(size) }
}
