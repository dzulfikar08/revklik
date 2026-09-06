/**
 * revklik analytics theme — ported from apps/web/src/index.css.
 * Deep blue-charcoal surfaces, orange traffic accent, gold money.
 * Applied to light and dark alike so the palette is theme-independent,
 * exactly like the web app's `:root, .dark` block.
 *
 * React Native cannot parse oklch() strings, so each entry carries the
 * sRGB hex equivalent of its source token (comment = original oklch).
 */

// --chart oklch(0.78 0.13 55) — orange accent
// --compare oklch(0.6 0.012 255)
// --money oklch(0.8 0.13 88) — gold
// --up oklch(0.75 0.14 155) — green
// --down oklch(0.66 0.19 25) — red
// --violet oklch(0.72 0.14 300)
const viz = {
  chart: "#F7A062",
  compare: "#7B8187",
  down: "#F05653",
  money: "#E1B850",
  up: "#59C886",
  violet: "#B28FEF",
} as const;

// background oklch(0.165 0.014 260)
// foreground oklch(0.955 0.006 250)
// card oklch(0.207 0.016 260)
// popover oklch(0.222 0.017 260)
// primary-foreground oklch(0.2 0.016 260)
// secondary/muted/accent/input oklch(0.262 0.018 260)
// muted-foreground oklch(0.685 0.015 255)
// border oklch(0.28 0.017 260)
// ring oklch(0.62 0.02 255)
const palette = {
  accent: "#1F252D",
  accentForeground: "#EDF0F4",
  background: "#0B0E14",
  border: "#242931",
  card: "#13181F",
  cardForeground: "#EDF0F4",
  foreground: "#EDF0F4",
  input: "#1F252D",
  muted: "#1F252D",
  mutedForeground: "#949AA3",
  popover: "#161B23",
  popoverForeground: "#EDF0F4",
  primary: "#EDF0F4",
  primaryForeground: "#12161D",
  ring: "#7E8792",
  secondary: "#1F252D",
  secondaryForeground: "#EDF0F4",
} as const;

const makeTheme = () =>
  ({
    borderRadius: {
      lg: 12,
      md: 8,
      sm: 6,
      xl: 16,
    },
    colors: {
      ...palette,
      ...viz,
      destructive: viz.down,
      destructiveForeground: "#FFFFFF",
      typography: palette.foreground,
    },
    fontSize: {
      "2xl": 24,
      "3xl": 30,
      "4xl": 36,
      base: 16,
      lg: 18,
      sm: 14,
      xl: 20,
      xs: 12,
    },
    spacing: {
      lg: 24,
      md: 16,
      sm: 8,
      xl: 32,
      xs: 4,
      xxl: 48,
    },
  }) as const;

export type AppTheme = ReturnType<typeof makeTheme>;

export const lightTheme = makeTheme();
export const darkTheme = makeTheme();
