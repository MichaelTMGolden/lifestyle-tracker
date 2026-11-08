// Habit colours: a small palette tuned to the Rite look (mid tones that hold up
// on near-black, with white text on fills). A habit without a chosen colour gets
// a stable one from its id. Colours are mixed here, not with CSS color-mix().
import type { CSSProperties } from 'react'

export const PALETTE = [
  { hex: '#b23a5b', name: 'Crimson' },
  { hex: '#b8612e', name: 'Ember' },
  { hex: '#a8862f', name: 'Gold' },
  { hex: '#6d8a3e', name: 'Moss' },
  { hex: '#2f8a7e', name: 'Verdigris' },
  { hex: '#4a6fa5', name: 'Slate' },
  { hex: '#7d55a8', name: 'Amethyst' },
  { hex: '#a8507e', name: 'Rose' },
] as const

const BASE = '#1f1c20' // --rite-heat-0, the empty cell

export function habitColor(h: { id: number; colorHex?: string | null }): string {
  return h.colorHex && /^#[0-9a-f]{6}$/i.test(h.colorHex) ? h.colorHex.toLowerCase() : PALETTE[(Math.abs(h.id) - 1 + PALETTE.length) % PALETTE.length].hex
}

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const mix = (a: string, b: string, t: number) => {
  const [x, y] = [rgb(a), rgb(b)]
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`
}
const alpha = (hex: string, a: number) => `rgba(${rgb(hex).join(', ')}, ${a})`

/** CSS variables for one habit: its colour, a light tone for text, a tint, and heatmap levels. */
export function habitStyle(h: { id: number; colorHex?: string | null }): CSSProperties {
  const c = habitColor(h)
  return {
    '--habit': c,
    '--habit-light': mix(c, '#ffffff', 0.35),
    '--habit-tint': alpha(c, 0.14),
    '--habit-border': alpha(c, 0.5),
    '--rite-heat-1': mix(BASE, c, 0.3),
    '--rite-heat-2': mix(BASE, c, 0.6),
    '--rite-heat-3': c,
    '--rite-heat-4': mix(c, '#ffffff', 0.35),
  } as CSSProperties
}
