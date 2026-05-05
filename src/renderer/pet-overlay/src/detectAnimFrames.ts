// Detects how many frames each animation row actually contains by drawing
// the spritesheet onto an offscreen canvas and checking pixel alpha.
// Unused frame cells are fully transparent (per the Codex pet spec).

const ROWS = 9
const COLS = 8
const CELL_W = 96   // display-scale width per frame
const CELL_H = 104  // display-scale height per frame

// Fixed row order per the Codex spritesheet format
export const ANIM_ROW_ORDER = [
  'idle',
  'running-right',
  'running-left',
  'waving',
  'jumping',
  'failed',
  'waiting',
  'running',
  'review',
] as const

export type AnimRowState = (typeof ANIM_ROW_ORDER)[number]

export function detectAnimFrames(
  spritesheetSrc: string
): Promise<Partial<Record<string, number>>> {
  return new Promise((resolve) => {
    const img = new Image()

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = COLS * CELL_W    // 768
        canvas.height = ROWS * CELL_H   // 936
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) { resolve({}); return }

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const stride = canvas.width

        // Sample every 8px within a frame cell, 4px inset from each edge.
        // Returns true if any sampled pixel has alpha > 10.
        const hasContent = (col: number, row: number): boolean => {
          const x0 = col * CELL_W + 4
          const y0 = row * CELL_H + 4
          const x1 = (col + 1) * CELL_W - 4
          const y1 = (row + 1) * CELL_H - 4
          for (let y = y0; y < y1; y += 8) {
            for (let x = x0; x < x1; x += 8) {
              if (data[(y * stride + x) * 4 + 3] > 10) return true
            }
          }
          return false
        }

        const result: Partial<Record<string, number>> = {}
        ANIM_ROW_ORDER.forEach((state, row) => {
          let count = 0
          for (let col = 0; col < COLS; col++) {
            if (hasContent(col, row)) count = col + 1
          }
          result[state] = Math.max(1, count)
        })

        resolve(result)
      } catch {
        resolve({})
      }
    }

    img.onerror = () => resolve({})
    img.src = spritesheetSrc
  })
}
