import type { Size } from './physics'

const CONTROL_ROWS = 1
const UNMEASURED_ROWS = 18
const INLINE_SHARE = 3
const INLINE_FRAME_ROWS = 2
const PICTURE_ROWS = 20
const PICTURE_MIN_COLUMNS = 40
const PICTURE_MAX_COLUMNS = 90
const PICTURE_DEFAULT_COLUMNS = 80

export const gameRowsFor = (placement: 'dock' | 'inline', bodyRows: number, terminalRows: number | undefined): number => {
  if (placement === 'inline' && terminalRows !== undefined) {
    return Math.floor(terminalRows / INLINE_SHARE) - INLINE_FRAME_ROWS - CONTROL_ROWS
  }

  return bodyRows > 0 ? bodyRows - CONTROL_ROWS : UNMEASURED_ROWS
}

export const paneSizeOf = (
  pane: { placement: string; bodyColumns: number; scroll: { bodyRows: number } },
  viewport: { columns: number; rows: number } | undefined,
): string => {
  const measured = viewport ? `${viewport.columns}x${viewport.rows}` : 'unmeasured'

  return `${pane.placement}, body ${pane.bodyColumns}x${pane.scroll.bodyRows} cells, viewport ${measured}`
}

export const pictureSizeFor = (bodyColumns: number): Size => ({
  columns: Math.max(PICTURE_MIN_COLUMNS, Math.min(PICTURE_MAX_COLUMNS, bodyColumns || PICTURE_DEFAULT_COLUMNS)),
  height: 2 * PICTURE_ROWS,
})
