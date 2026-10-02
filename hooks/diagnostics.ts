type SurfaceTrace = { draws: number; pane: string; frames: number; region: string }

const traces = new Map<string, SurfaceTrace>()

const traceOf = (surface: string): SurfaceTrace => {
  const known = traces.get(surface) ?? { draws: 0, pane: '', frames: 0, region: '' }
  traces.set(surface, known)

  return known
}

const hasRegion = (posted: unknown): posted is { columns: unknown; rows: unknown } =>
  typeof posted === 'object' && posted !== null && 'columns' in posted && 'rows' in posted

const verdictOf = (trace: SurfaceTrace): string => {
  if (trace.frames === 0) {
    return 'the game has drawn no frames: it is not running on this surface'
  }
  const frames = `${trace.frames} ${trace.frames === 1 ? 'frame' : 'frames'}`
  if (trace.region.startsWith('0x') || trace.region.endsWith('x0')) {
    return `the game runs (${frames}) but its region is ${trace.region} cells: it has no room to draw`
  }

  return `the game runs (${frames}) in a region of ${trace.region} cells`
}

export const notePaneDraw = (surface: string, pane: string): void => {
  const trace = traceOf(surface)
  trace.draws += 1
  trace.pane = pane
}

export const noteFrame = (surface: string, posted: unknown): void => {
  const trace = traceOf(surface)
  trace.frames += 1
  trace.region = hasRegion(posted) ? `${String(posted.columns)}x${String(posted.rows)}` : 'unknown'
}

export const diagnosis = (): string =>
  traces.size === 0
    ? 'Nothing drawn yet: open /flappy first, on each surface you want checked.'
    : [...traces]
        .map(([surface, trace]) => `${surface}: pane drawn ${trace.draws}x (${trace.pane}); ${verdictOf(trace)}`)
        .join('\n')
