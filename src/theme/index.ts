export const colors = {
  background: '#ffffff',
  surface: '#f4f5f7',
  text: '#111827',
  textMuted: '#6b7280',
  primary: '#2563eb',
  danger: '#dc2626',
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const theme = { colors, spacing } as const;
export type Theme = typeof theme;
