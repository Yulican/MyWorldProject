export const colors = {
  background: '#ffffff',
  surface: '#f4f5f7',
  text: '#111827',
  textMuted: '#6b7280',
  primary: '#2563eb',
  danger: '#dc2626',
  // Dark game UI around the map
  panel: '#14171f',
  panelText: '#f1ede4',
  panelMuted: '#9a9fab',
  accent: '#e8b54a',
  barTrack: '#2a2f3a',
  barCapacity: '#4a4436',
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const theme = { colors, spacing } as const;
export type Theme = typeof theme;
