export type FlappyBoard = { best: number; draws: number; isSuggested: boolean }

declare module 'claude-code' {
  interface PluginState {
    flappy: { board: FlappyBoard; frame: number }
  }
}
