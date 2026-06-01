// ─── Theme token engine ───────────────────────────────────────────────────────
// Turns a (partial) BlockTheme into a complete, scheme-aware token set so the
// renderers never hardcode colours. Shared conceptually with the SDK (sdk.js
// reimplements the same defaults in vanilla JS for parity).

import type { BlockTheme, ColorScheme } from "./types"

export const FONTS: Record<string, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
  serif:  '"Tiempos", "Charter", Georgia, "Times New Roman", serif',
  mono:   '"JetBrains Mono", ui-monospace, "Cascadia Code", monospace',
}

export const BTN_RADIUS: Record<string, string> = {
  rounded: "12px",
  pill:    "999px",
  square:  "4px",
}

export type ThemeTokens = {
  scheme:      ColorScheme
  accent:      string
  onAccent:    string        // readable text colour on top of the accent
  pageBg:      string        // page background behind the paywall
  pageGradient:string | null // optional gradient for the page background
  surface:     string        // modal / fullscreen panel base
  card:        string        // cards sitting on the surface
  cardBorder:  string
  text:        string
  textMuted:   string
  textFaint:   string
  border:      string
  hairline:    string        // very subtle fill (hover, zebra, open states)
  track:       string        // toggle / switch "off" track
  videoTint:   string        // empty media placeholder background
  closeBg:     string
  closeIcon:   string
  font:        string
  btnRadius:   string
  cardRadius:  string
  overlay:     string        // dim layer behind a modal
}

/** Relative luminance (sRGB, 0..1). Accepts #rgb / #rrggbb. */
function luminance(hex: string): number {
  const h = hex.replace("#", "")
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h
  const n = parseInt(full.slice(0, 6), 16)
  if (Number.isNaN(n)) return 0
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Pick black or white text for best contrast on a solid colour. */
export function onColor(hex: string): string {
  return luminance(hex) > 0.55 ? "#0B0B0F" : "#FFFFFF"
}

export function resolveTheme(theme: Partial<BlockTheme>): ThemeTokens {
  const scheme: ColorScheme = theme.colorScheme ?? "dark"
  const accent = theme.accentColor ?? "#6366F1"
  const dark = scheme === "dark"

  const base = dark
    ? {
        pageBg:     "#0A0A0F",
        surface:    "#0F0F12",
        card:       "rgba(255,255,255,0.045)",
        cardBorder: "rgba(255,255,255,0.09)",
        text:       "#FFFFFF",
        textMuted:  "rgba(255,255,255,0.66)",
        textFaint:  "rgba(255,255,255,0.40)",
        border:     "rgba(255,255,255,0.09)",
        hairline:   "rgba(255,255,255,0.03)",
        track:      "rgba(255,255,255,0.16)",
        videoTint:  "radial-gradient(120% 120% at 50% 0%, rgba(255,255,255,0.07), rgba(255,255,255,0.015))",
        closeBg:    "rgba(255,255,255,0.08)",
        closeIcon:  "rgba(255,255,255,0.6)",
      }
    : {
        pageBg:     "#EEF0F4",
        surface:    "#FFFFFF",
        card:       "rgba(12,14,20,0.028)",
        cardBorder: "rgba(12,14,20,0.10)",
        text:       "#0B0B0F",
        textMuted:  "rgba(11,11,15,0.62)",
        textFaint:  "rgba(11,11,15,0.42)",
        border:     "rgba(12,14,20,0.10)",
        hairline:   "rgba(12,14,20,0.025)",
        track:      "rgba(12,14,20,0.14)",
        videoTint:  "radial-gradient(120% 120% at 50% 0%, rgba(12,14,20,0.05), rgba(12,14,20,0.01))",
        closeBg:    "rgba(12,14,20,0.06)",
        closeIcon:  "rgba(11,11,15,0.55)",
      }

  return {
    scheme,
    accent,
    onAccent:     onColor(accent),
    pageBg:       theme.background ?? base.pageBg,
    pageGradient: theme.backgroundGradient ?? null,
    surface:      theme.surface ?? base.surface,
    card:         base.card,
    cardBorder:   base.cardBorder,
    text:         theme.textColor ?? base.text,
    textMuted:    base.textMuted,
    textFaint:    base.textFaint,
    border:       base.border,
    hairline:     base.hairline,
    track:        base.track,
    videoTint:    base.videoTint,
    closeBg:      base.closeBg,
    closeIcon:    base.closeIcon,
    font:         FONTS[theme.fontFamily ?? "system"] ?? FONTS.system,
    btnRadius:    BTN_RADIUS[theme.buttonShape ?? "rounded"] ?? BTN_RADIUS.rounded,
    cardRadius:   "16px",
    overlay:      `rgba(0,0,0,${(theme.overlayOpacity ?? 65) / 100})`,
  }
}

// ─── One-click "looks" ─────────────────────────────────────────────────────────
// Curated presets that set scheme + accent + background + type in a single tap.

export type ThemePreset = {
  id:      string
  name:    string
  swatch:  string            // dot colour shown in the picker
  scheme:  ColorScheme
  theme:   Partial<BlockTheme>
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "midnight", name: "Midnight", swatch: "#6366F1", scheme: "dark",
    theme: { colorScheme: "dark", accentColor: "#6366F1", fontFamily: "system", buttonShape: "rounded" },
  },
  {
    id: "aurora", name: "Aurora", swatch: "#8B5CF6", scheme: "dark",
    theme: {
      colorScheme: "dark", accentColor: "#8B5CF6", fontFamily: "system", buttonShape: "pill",
      background: "#0B0712", backgroundGradient: "radial-gradient(120% 90% at 50% -10%, rgba(139,92,246,0.30), rgba(11,7,18,0) 60%), #0B0712",
    },
  },
  {
    id: "clean", name: "Clean", swatch: "#6366F1", scheme: "light",
    theme: { colorScheme: "light", accentColor: "#6366F1", fontFamily: "system", buttonShape: "rounded", background: "#EEF0F4" },
  },
  {
    id: "mellow", name: "Mellow", swatch: "#10B981", scheme: "light",
    theme: {
      colorScheme: "light", accentColor: "#10B981", fontFamily: "system", buttonShape: "pill",
      background: "#F2F7F4",
    },
  },
  {
    id: "warm", name: "Warm", swatch: "#F59E0B", scheme: "light",
    theme: { colorScheme: "light", accentColor: "#EA8C2B", fontFamily: "serif", buttonShape: "rounded", background: "#FBF6EE" },
  },
  {
    id: "mono", name: "Mono", swatch: "#111827", scheme: "light",
    theme: { colorScheme: "light", accentColor: "#111827", fontFamily: "mono", buttonShape: "square", background: "#F4F4F5" },
  },
  {
    id: "ocean", name: "Ocean", swatch: "#22D3EE", scheme: "dark",
    theme: {
      colorScheme: "dark", accentColor: "#22D3EE", fontFamily: "system", buttonShape: "rounded",
      background: "#04141A", backgroundGradient: "linear-gradient(180deg, #06212B, #04141A)",
    },
  },
  {
    id: "rose", name: "Rosé", swatch: "#F43F5E", scheme: "light",
    theme: { colorScheme: "light", accentColor: "#F43F5E", fontFamily: "system", buttonShape: "pill", background: "#FCF3F4" },
  },
]

/** Curated page-background presets shown in the builder. */
export const BACKGROUND_PRESETS: { id: string; label: string; value: { background?: string; backgroundGradient?: string } }[] = [
  { id: "scheme", label: "Auto", value: { background: undefined, backgroundGradient: undefined } },
  { id: "violet", label: "Violet glow", value: { background: "#0B0712", backgroundGradient: "radial-gradient(120% 90% at 50% -10%, rgba(139,92,246,0.30), rgba(11,7,18,0) 60%), #0B0712" } },
  { id: "indigo", label: "Indigo", value: { background: "#0A0A18", backgroundGradient: "linear-gradient(180deg, #141433, #0A0A18)" } },
  { id: "sunset", label: "Sunset", value: { background: "#1A0E12", backgroundGradient: "radial-gradient(120% 90% at 50% -10%, rgba(244,63,94,0.28), rgba(26,14,18,0) 60%), #1A0E12" } },
  { id: "mint", label: "Mint", value: { background: "#F2F7F4", backgroundGradient: "radial-gradient(120% 90% at 50% -10%, rgba(16,185,129,0.18), rgba(242,247,244,0) 60%), #F2F7F4" } },
  { id: "paper", label: "Paper", value: { background: "#F4F4F5", backgroundGradient: undefined } },
]
