// Stroke icons for the Rite kit: 24x24 paths drawn with currentColor.
export const iconPaths = {
  today: 'M3 11 12 3l9 8M5 10v11h5v-7h4v7h5V10',
  habits: 'M12 2c2 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 2 3 3 3 0-3-1-5 0-7Z',
  plan: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM7 3v4M17 3v4M3 10h18',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  schedule: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2',
  health: 'M2 12h5l3-8 4 16 3-8h5',
  nutrition: 'M12 21c-6 0-9-4-9-10 6 0 9 3 9 10ZM12 21c0-9 2-15 9-18 1 8-2 16-9 18Z',
  artist: 'M9 18V5l12-2v13M9 9l12-2M9 18c0 2-2 3-4 3s-3-1-3-2 2-3 4-3c1 0 3 0 3 2ZM21 16c0 2-2 3-4 3s-3-1-3-2 2-3 4-3c1 0 3 0 3 2Z',
  review: 'M7 3h10l4 4v14H3V3h4ZM15 3v6h6M7 13h10M7 17h7',
  bingo: 'M3 3h18v18H3ZM9 3v18M15 3v18M3 9h18M3 15h18',
  connect: 'm9 15 6-6M8 17l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2-1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
  settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6',
  close: 'M6 6l12 12M18 6 6 18',
  play: 'M7 4v16l13-8Z',
  pause: 'M9 5v14M15 5v14',
  check: 'm5 12 5 5 9-10',
  plus: 'M12 5v14M5 12h14',
  chevron: 'm9 6 6 6-6 6',
  flame: 'M12 2c2 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 2 3 3 3 0-3-1-5 0-7Z',
} as const

export type IconName = keyof typeof iconPaths
