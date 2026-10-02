import { HUNK_WIDTH, JUMPER_X, gapOf, jumperTop, playHeight } from './physics'
import type { Game, Hunk, Size } from './physics'

export type Run = { color: string; background: string; text: string }

type Cell = { top: string; bottom: string; glyph: string }

type Label = { row: number; column: number; text: string }

type Paint = { ink: string; paper: string; sign: string }

type Haze = { x: number; y: number; width: number }

export const HALF_BLOCK = '▀'
export const TERMINAL_HINT = ' space or click to jump '
export const BLANK = ' '

const NIGHT = '#151520'
const HAZE = '#24283b'
const CLAUDE = '#d97757'
const CLAUDE_DOWN = '#8c8c8c'
const EYE = '#151520'
const FLOOR = '#d97757'
const SOIL = '#3b2a24'
const INK = '#ffffff'
const BADGE = '#414868'
const REMOVED: Paint = { ink: '#ffa198', paper: '#67060c', sign: '-' }
const ADDED: Paint = { ink: '#7ee787', paper: '#0f5323', sign: '+' }
const HEADER: Paint = { ink: '#79c0ff', paper: '#0c2d6b', sign: '@' }
const HEADER_HEIGHT = 2
const CODE_LINES = ['━━━━', '━━ ━', '━━━ ', '━ ━━', '━━  ', '━━━━']
const HEADER_LINE = '@ -+ '
const SPRITE_INSET = 1
const FALLING = ['.OOOOOO.', '.OkOOkO.', 'OOOOOOOO', '.OOOOOO.', '.O.OO.O.']
const RISING = ['.OOOOOO.', 'OOkOOkOO', '.OOOOOO.', '.OOOOOO.', '..O..O..']
const HAZE_PERIOD = 64
const HAZE_SLOWNESS = 8
const HAZE_HEIGHT = 2
const HAZES: Haze[] = [
  { x: 5, y: 4, width: 7 },
  { x: 27, y: 10, width: 9 },
  { x: 48, y: 6, width: 6 },
]
const ENDINGS = { conflict: ' MERGE CONFLICT ', crash: ' CORE DUMPED ', none: ' GAME OVER ' }

const isRising = (game: Game): boolean => game.phase !== 'dead' && game.velocity < 0

const jumperPixel = (game: Game, x: number, y: number): string | undefined => {
  const frame = isRising(game) ? RISING : FALLING
  const mark = frame[y - jumperTop(game)]?.[x - JUMPER_X + SPRITE_INSET]
  if (mark === undefined || mark === '.') {
    return undefined
  }
  if (mark === 'k') {
    return EYE
  }

  return game.phase === 'dead' ? CLAUDE_DOWN : CLAUDE
}

const hunkAt = (game: Game, x: number): Hunk | undefined =>
  game.hunks.find(hunk => x >= hunk.x && x < hunk.x + HUNK_WIDTH)

const isInGap = (hunk: Hunk, y: number, gap: number): boolean => y >= hunk.gapTop && y < hunk.gapTop + gap

const isInHeader = (hunk: Hunk, y: number, gap: number): boolean =>
  y >= hunk.gapTop - HEADER_HEIGHT && y < hunk.gapTop + gap + HEADER_HEIGHT

const paintOf = (hunk: Hunk, y: number, gap: number): Paint | undefined => {
  if (isInGap(hunk, y, gap)) {
    return undefined
  }
  if (isInHeader(hunk, y, gap)) {
    return HEADER
  }

  return y < hunk.gapTop ? REMOVED : ADDED
}

const covers = (haze: Haze, x: number, y: number): boolean =>
  x >= haze.x && x < haze.x + haze.width && y >= haze.y && y < haze.y + HAZE_HEIGHT

const isHaze = (game: Game, x: number, y: number): boolean => {
  const drifted = (x + Math.floor(game.tick / HAZE_SLOWNESS)) % HAZE_PERIOD

  return HAZES.some(haze => covers(haze, drifted, y))
}

const pixel = (game: Game, size: Size, x: number, y: number): string => {
  const floor = playHeight(size)
  if (y >= floor) {
    return y === floor ? FLOOR : SOIL
  }
  const hunk = hunkAt(game, x)
  const paint = hunk && paintOf(hunk, y, gapOf(size))

  return jumperPixel(game, x, y) ?? paint?.paper ?? (isHaze(game, x, y) ? HAZE : NIGHT)
}

const codeGlyph = (hunk: Hunk, paint: Paint, x: number, row: number): string => {
  const offset = x - hunk.x
  if (offset === 0) {
    return paint.sign
  }
  const line = paint === HEADER ? HEADER_LINE : ` ${CODE_LINES[(row * 7 + hunk.gapTop) % CODE_LINES.length] ?? ''}`

  return line[offset - 1] ?? ' '
}

const isBarePaper = (paint: Paint, top: string, bottom: string): boolean =>
  top === paint.paper && bottom === paint.paper

const cellAt = (game: Game, size: Size, x: number, row: number): Cell => {
  const top = pixel(game, size, x, 2 * row)
  const bottom = pixel(game, size, x, 2 * row + 1)
  const hunk = hunkAt(game, x)
  const paint = hunk && 2 * row < playHeight(size) ? paintOf(hunk, 2 * row, gapOf(size)) : undefined
  if (!hunk || !paint || !isBarePaper(paint, top, bottom)) {
    return { top, bottom, glyph: '' }
  }

  return { top: paint.ink, bottom: paint.paper, glyph: codeGlyph(hunk, paint, x, row) }
}

const centered = (row: number, text: string, size: Size): Label => ({
  row,
  column: Math.max(0, Math.floor((size.columns - text.length) / 2)),
  text,
})

const labelsOf = (game: Game, best: number, size: Size, readyHint: string): Label[] => {
  const middle = Math.max(4, Math.floor(size.height / 4))
  const record = ` BEST ${best} `
  const hud = [
    { row: 0, column: 1, text: ` ${game.score} ` },
    { row: 0, column: Math.max(0, size.columns - record.length - 1), text: record },
  ]
  if (game.phase === 'ready') {
    return [...hud, centered(middle - 3, ' FLAPPY CODE ', size), centered(middle + 2, readyHint, size)]
  }
  if (game.phase === 'dead') {
    return [
      ...hud,
      centered(middle - 2, ENDINGS[game.cause], size),
      centered(middle, ` ${game.score} hunks cleared · best ${best} `, size),
      centered(middle + 2, ' jump to try again ', size),
    ]
  }

  return hud
}

const stamped = (cells: Cell[], label: Label): Cell[] => {
  const glyphs = [...label.text]

  return cells.map((cell, x) => {
    const glyph = glyphs[x - label.column]

    return glyph === undefined ? cell : { top: INK, bottom: BADGE, glyph }
  })
}

const cellsOf = (game: Game, size: Size, row: number, labels: readonly Label[]): Cell[] =>
  labels
    .filter(label => label.row === row)
    .reduce(
      stamped,
      Array.from({ length: size.columns }, (_, x) => cellAt(game, size, x, row)),
    )

const glyphOf = (cell: Cell): string => {
  if (cell.glyph === '' && cell.top !== cell.bottom) {
    return HALF_BLOCK
  }

  return cell.glyph === '' || cell.glyph === ' ' ? BLANK : cell.glyph
}

const runsOf = (cells: readonly Cell[]): Run[] => {
  const runs: Run[] = []
  for (const cell of cells) {
    const last = runs.at(-1)
    if (last && last.color === cell.top && last.background === cell.bottom) {
      last.text += glyphOf(cell)
    } else {
      runs.push({ color: cell.top, background: cell.bottom, text: glyphOf(cell) })
    }
  }

  return runs
}

export const sceneOf = (game: Game, best: number, size: Size, readyHint: string = TERMINAL_HINT): Run[][] => {
  const labels = labelsOf(game, best, size, readyHint)

  return Array.from({ length: size.height / 2 }, (_, row) => runsOf(cellsOf(game, size, row, labels)))
}
