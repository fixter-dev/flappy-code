import { HALF_BLOCK } from './scene'
import type { Run } from './scene'

const CELL_WIDTH = 10
const CELL_HEIGHT = 20
const BAR = '━'
const BAR_HEIGHT = 4
const BASELINE = 15
const CORNER = 12
const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace"
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

const escaped = (glyph: string): string => ESCAPES[glyph] ?? glyph

const rect = (x: number, y: number, width: number, height: number, fill: string): string =>
  `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}"/>`

const isHalfBlocks = (run: Run): boolean => [...run.text].every(glyph => glyph === HALF_BLOCK)

const glyphMark = (glyph: string, x: number, y: number, color: string): string => {
  if (glyph === BAR) {
    return rect(x, y + (CELL_HEIGHT - BAR_HEIGHT) / 2, CELL_WIDTH, BAR_HEIGHT, color)
  }
  if (glyph.trim() === '') {
    return ''
  }

  return `<text x="${x + CELL_WIDTH / 2}" y="${y + BASELINE}" text-anchor="middle" fill="${color}">${escaped(glyph)}</text>`
}

const runMarks = (run: Run, x: number, y: number): string => {
  const glyphs = [...run.text]
  const paper = rect(x, y, glyphs.length * CELL_WIDTH, CELL_HEIGHT, run.background)
  if (isHalfBlocks(run)) {
    return paper + rect(x, y, glyphs.length * CELL_WIDTH, CELL_HEIGHT / 2, run.color)
  }

  return paper + glyphs.map((glyph, index) => glyphMark(glyph, x + index * CELL_WIDTH, y, run.color)).join('')
}

const rowMarks = (runs: readonly Run[], y: number): string => {
  let column = 0

  return runs
    .map(run => {
      const marks = runMarks(run, column * CELL_WIDTH, y)
      column += [...run.text].length

      return marks
    })
    .join('')
}

export const pictureOf = (rows: readonly Run[][]): string => {
  const columns = (rows[0] ?? []).reduce((count, run) => count + [...run.text].length, 0)
  const width = columns * CELL_WIDTH
  const height = rows.length * CELL_HEIGHT
  const marks = rows.map((runs, row) => rowMarks(runs, row * CELL_HEIGHT)).join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
    `font-family="${FONT}" font-size="15" font-weight="700" shape-rendering="crispEdges">` +
    `<clipPath id="frame"><rect width="${width}" height="${height}" rx="${CORNER}"/></clipPath>` +
    `<g clip-path="url(#frame)">${marks}</g></svg>`
  )
}
