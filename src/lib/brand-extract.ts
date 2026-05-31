// ─── Brand signal extraction ──────────────────────────────────────────────────
// Deterministic (no AI) extraction of design/branding signals from a host page's
// raw HTML, so the AI generator can produce a paywall that feels native to the
// app it's embedded in. Pure functions — unit-testable without an API key.

export type BrandSignals = {
  url:          string
  title:        string
  description:  string
  themeColor:   string | null
  logoUrl:      string | null
  ogImage:      string | null
  /** Frequency-ranked colours found across inline styles, <style>, CSS vars. */
  palette:      { color: string; count: number }[]
  /** Best guess at the brand accent (most frequent saturated colour). */
  accentGuess:  string | null
  /** Named CSS custom properties that look brand-relevant (--primary, --accent…). */
  cssVars:      Record<string, string>
  /** Font families declared on the page, most common first. */
  fonts:        string[]
  fontFamily:   "system" | "serif" | "mono"
  buttonShape:  "rounded" | "pill" | "square"
  colorScheme:  "light" | "dark"
  bodyText:     string
}

// ── helpers ────────────────────────────────────────────────────────────────────

function resolveUrl(href: string, base: string): string | null {
  if (!href) return null
  try { return new URL(href, base).toString() } catch { return null }
}

/** Parse #rgb / #rrggbb / rgb()/rgba() into [r,g,b] (0-255), or null. */
function toRgb(c: string): [number, number, number] | null {
  const s = c.trim().toLowerCase()
  let m = s.match(/^#([0-9a-f]{3})$/)
  if (m) { const h = m[1]; return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)] }
  m = s.match(/^#([0-9a-f]{6})$/)
  if (m) { const h = m[1]; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] }
  m = s.match(/^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/)
  if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])]
  return null
}

function toHex(rgb: [number, number, number]): string {
  return "#" + rgb.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")
}

function relLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4) }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function saturation([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max === 0) return 0
  return (max - min) / max
}

function firstMatch(html: string, re: RegExp): string {
  return html.match(re)?.[1]?.trim() ?? ""
}

// ── main ─────────────────────────────────────────────────────────────────────

export function extractBrandSignals(html: string, baseUrl: string): BrandSignals {
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
  const description =
    firstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    firstMatch(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
  const themeColorRaw = firstMatch(html, /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i)
  const themeColor = themeColorRaw && toRgb(themeColorRaw) ? toHex(toRgb(themeColorRaw)!) : (themeColorRaw || null)

  const ogImage = resolveUrl(firstMatch(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i), baseUrl)

  // Logo: prefer apple-touch-icon (usually crisp), then icon link, then og:image.
  const appleIcon = firstMatch(html, /<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i)
    || firstMatch(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*apple-touch-icon[^"']*["']/i)
  const iconLink = firstMatch(html, /<link[^>]+rel=["'][^"']*\bicon\b[^"']*["'][^>]+href=["']([^"']+)["']/i)
  const logoUrl = resolveUrl(appleIcon, baseUrl) || ogImage || resolveUrl(iconLink, baseUrl)

  // Collect <style> blocks + style="" attributes for colour / font / radius mining.
  const styleBlocks = (html.match(/<style[\s\S]*?<\/style>/gi) ?? []).join("\n")
  const inlineStyles = (html.match(/style=["'][^"']*["']/gi) ?? []).join("\n")
  const styleSoup = styleBlocks + "\n" + inlineStyles

  // CSS custom properties that look brand-relevant.
  const cssVars: Record<string, string> = {}
  for (const m of styleSoup.matchAll(/(--[\w-]*(?:primary|accent|brand|theme|bg|background|foreground|surface|text|color)[\w-]*)\s*:\s*([^;}{]+)/gi)) {
    const name = m[1].toLowerCase().trim()
    const val = m[2].trim().slice(0, 40)
    if (!cssVars[name]) cssVars[name] = val
  }

  // Frequency-rank every colour token.
  const counts = new Map<string, number>()
  for (const m of styleSoup.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]+\)/g)) {
    const rgb = toRgb(m[0])
    if (!rgb) continue
    const hex = toHex(rgb)
    counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }
  const palette = [...counts.entries()]
    .map(([color, count]) => ({ color, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 16)

  // Accent guess = most frequent reasonably-saturated, mid-luminance colour.
  const accentGuess = palette
    .map(p => ({ p, rgb: toRgb(p.color)! }))
    .filter(({ rgb }) => saturation(rgb) > 0.25 && relLuminance(rgb) > 0.05 && relLuminance(rgb) < 0.85)
    .sort((a, b) => b.p.count - a.p.count)[0]?.p.color
    ?? (themeColor && toRgb(themeColor) ? themeColor : null)

  // Fonts.
  const fontCounts = new Map<string, number>()
  for (const m of styleSoup.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) {
    const first = m[1].split(",")[0].replace(/["']/g, "").trim().toLowerCase()
    if (first && !first.startsWith("var(") && first.length < 40) fontCounts.set(first, (fontCounts.get(first) ?? 0) + 1)
  }
  const fonts = [...fontCounts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]).slice(0, 6)
  const fontBlob = fonts.join(" ")
  const fontFamily: BrandSignals["fontFamily"] =
    /(mono|courier|consolas|menlo|jetbrains|fira code|source code)/.test(fontBlob) ? "mono"
    : /(serif|georgia|times|playfair|merriweather|lora|tiempos|charter|garamond)/.test(fontBlob) ? "serif"
    : "system"

  // Border radius → button shape.
  const radii = [...styleSoup.matchAll(/border-radius\s*:\s*([0-9.]+)(px|rem|em|%)/gi)]
    .map(m => ({ v: parseFloat(m[1]), unit: m[2] }))
  const pillish = radii.some(r => (r.unit === "%" && r.v >= 40) || (r.unit !== "%" && r.v >= 40))
  const squarish = radii.length > 0 && radii.every(r => r.v <= 3)
  const buttonShape: BrandSignals["buttonShape"] = pillish ? "pill" : squarish ? "square" : "rounded"

  // Light / dark from body/html background, else theme-color, else default light.
  const bgRaw =
    firstMatch(styleBlocks, /(?:^|[\s,{])(?:body|html)\b[^{]*\{[^}]*background(?:-color)?\s*:\s*([^;}{]+)/i) ||
    firstMatch(html, /<body[^>]+style=["'][^"']*background(?:-color)?\s*:\s*([^;"']+)/i)
  const bgRgb = toRgb(bgRaw) ?? (themeColor ? toRgb(themeColor) : null)
  const colorScheme: BrandSignals["colorScheme"] = bgRgb ? (relLuminance(bgRgb) < 0.4 ? "dark" : "light") : "light"

  // Visible text for tone/category/copy inference.
  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 5000)

  return {
    url: baseUrl, title, description, themeColor, logoUrl, ogImage,
    palette, accentGuess, cssVars, fonts, fontFamily, buttonShape, colorScheme, bodyText,
  }
}

/** Compact, token-efficient rendering of the signals for the Claude prompt. */
export function summariseSignals(s: BrandSignals): string {
  const vars = Object.entries(s.cssVars).slice(0, 12).map(([k, v]) => `${k}: ${v}`).join("; ")
  return [
    `URL: ${s.url}`,
    `TITLE: ${s.title}`,
    `META DESCRIPTION: ${s.description}`,
    `DETECTED COLOR SCHEME: ${s.colorScheme}`,
    `THEME-COLOR: ${s.themeColor ?? "(none)"}`,
    `LOGO URL: ${s.logoUrl ?? "(none)"}`,
    `ACCENT GUESS: ${s.accentGuess ?? "(none)"}`,
    `TOP COLORS: ${s.palette.slice(0, 10).map(p => `${p.color}×${p.count}`).join(", ") || "(none)"}`,
    `BRAND CSS VARS: ${vars || "(none)"}`,
    `FONTS: ${s.fonts.join(", ") || "(none)"} → bucket ${s.fontFamily}`,
    `BUTTON SHAPE: ${s.buttonShape}`,
    `VISIBLE TEXT (truncated): ${s.bodyText.slice(0, 3500)}`,
  ].join("\n")
}
