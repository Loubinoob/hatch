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

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

/** Parse #rgb / #rrggbb / rgb()/rgba() / hsl()/hsla() into [r,g,b] (0-255), or null. */
function toRgb(c: string): [number, number, number] | null {
  const s = c.trim().toLowerCase()
  let m = s.match(/^#([0-9a-f]{3})$/)
  if (m) { const h = m[1]; return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)] }
  m = s.match(/^#([0-9a-f]{6})$/)
  if (m) { const h = m[1]; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] }
  m = s.match(/^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/)
  if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])]
  m = s.match(/^hsla?\(\s*([0-9.]+)(?:deg)?[\s,]+([0-9.]+)%[\s,]+([0-9.]+)%/)
  if (m) return hslToRgb(+m[1], +m[2], +m[3])
  return null
}

/** Resolve a CSS value to a hex colour. Handles hex/rgb/hsl AND the shadcn/Tailwind
 *  convention of storing colours as bare HSL channels (e.g. `--primary: 73 98% 53%`). */
function resolveCssColor(val: string): string | null {
  const v = val.trim().replace(/!important$/i, "").trim()
  const direct = toRgb(v)
  if (direct) return toHex(direct)
  // shadcn triple: "H S% L%"  (also tolerates "H, S%, L%")
  const m = v.match(/^([0-9.]+)(?:deg)?[\s,]+([0-9.]+)%[\s,]+([0-9.]+)%$/)
  if (m) return toHex(hslToRgb(+m[1], +m[2], +m[3]))
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

/** Stylesheet URLs referenced by the page (so callers can fetch + mine the
 *  real CSS bundles — essential for client-rendered SPAs whose HTML is a shell). */
export function collectStylesheetUrls(html: string, baseUrl: string): string[] {
  const urls = new Set<string>()
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0]
    if (!/rel=["'][^"']*stylesheet/i.test(tag)) continue
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1]
    const abs = href ? resolveUrl(href, baseUrl) : null
    if (abs) urls.add(abs)
  }
  return [...urls].slice(0, 4)
}

export function extractBrandSignals(html: string, baseUrl: string, extraCss = ""): BrandSignals {
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

  // Collect <style> blocks + style="" attributes + any fetched external CSS for
  // colour / font / radius mining. extraCss is the linked stylesheet bundles.
  const styleBlocks = (html.match(/<style[\s\S]*?<\/style>/gi) ?? []).join("\n")
  const inlineStyles = (html.match(/style=["'][^"']*["']/gi) ?? []).join("\n")
  const cssText = styleBlocks + "\n" + extraCss          // real CSS (head + bundles)
  const styleSoup = cssText + "\n" + inlineStyles

  // ── CSS custom properties — resolve shadcn/Tailwind HSL-channel vars too ──
  // (e.g. `--primary: 73 98% 53%`, the dominant convention for SPA design systems.)
  // Capture per-selector so we can prefer the .dark theme block when relevant.
  const rootVars: Record<string, string> = {}
  const darkVars: Record<string, string> = {}
  for (const block of cssText.matchAll(/(:root|\.dark|\[data-theme=["']?dark["']?\])([^{]*)\{([^}]*)\}/gi)) {
    const target = /dark/i.test(block[1]) ? darkVars : rootVars
    for (const v of block[3].matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) {
      const name = v[1].toLowerCase().trim()
      if (!(name in target)) target[name] = v[2].trim().slice(0, 60)
    }
  }
  // Does the page default to dark? (class/data-theme on <html>/<body>, or meta)
  const htmlDark = /<html[^>]*\b(?:class|data-theme)=["'][^"']*\bdark\b/i.test(html) ||
    /<body[^>]*\bclass=["'][^"']*\bdark\b/i.test(html) ||
    /<meta[^>]+name=["']color-scheme["'][^>]+content=["'][^"']*dark/i.test(html)
  const vars = { ...rootVars, ...(htmlDark ? darkVars : {}) }

  const cssVars: Record<string, string> = {}
  for (const [name, val] of Object.entries(vars)) {
    if (!/(primary|accent|brand|theme|bg|background|foreground|surface|ring|card|muted|secondary|border|text|color)/.test(name)) continue
    const hex = resolveCssColor(val)
    if (hex && Object.keys(cssVars).length < 20) cssVars[name] = hex
  }

  // ── Frequency-rank colours: literals (hex/rgb/hsl) + resolved vars (weighted) ──
  const counts = new Map<string, number>()
  const bump = (hex: string, n = 1) => counts.set(hex, (counts.get(hex) ?? 0) + n)
  for (const m of styleSoup.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]+\)|hsla?\([^)]+\)/g)) {
    const rgb = toRgb(m[0]); if (rgb) bump(toHex(rgb))
  }
  for (const hex of Object.values(cssVars)) bump(hex, 2) // declared tokens carry brand weight
  const palette = [...counts.entries()].map(([color, count]) => ({ color, count })).sort((a, b) => b.count - a.count).slice(0, 16)

  // ── Accent: the brand's DECLARED primary wins over any frequency heuristic ──
  const brandVar = ["--primary", "--accent", "--brand", "--color-primary", "--primary-color", "--ring", "--theme-primary"]
    .map(n => cssVars[n]).find(Boolean)
  const accentGuess = brandVar
    ?? palette.map(p => ({ p, rgb: toRgb(p.color)! }))
        .filter(({ rgb }) => saturation(rgb) > 0.3 && relLuminance(rgb) > 0.04 && relLuminance(rgb) < 0.92)
        .sort((a, b) => b.p.count - a.p.count)[0]?.p.color
    ?? (themeColor && toRgb(themeColor) ? toHex(toRgb(themeColor)!) : null)

  // Fonts.
  const fontCounts = new Map<string, number>()
  for (const m of styleSoup.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) {
    const first = m[1].split(",")[0].replace(/["']/g, "").trim().toLowerCase()
    if (first && !first.startsWith("var(") && first.length < 40) fontCounts.set(first, (fontCounts.get(first) ?? 0) + 1)
  }
  const fonts = [...fontCounts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]).slice(0, 6)
  // Bucket from the MOST COMMON body font (not any occurrence) — avoids picking
  // "mono" just because the bundle declares a monospace stack for code/numbers.
  const topFont = fonts[0] || ""
  const fontFamily: BrandSignals["fontFamily"] =
    /(mono|courier|consolas|menlo|jetbrains|fira code|source code)/.test(topFont) ? "mono"
    : /(serif|georgia|times|playfair|merriweather|lora|tiempos|charter|garamond)/.test(topFont) ? "serif"
    : "system"

  // Border radius → button shape.
  const radii = [...styleSoup.matchAll(/border-radius\s*:\s*([0-9.]+)(px|rem|em|%)/gi)]
    .map(m => ({ v: parseFloat(m[1]), unit: m[2] }))
  const pillish = radii.some(r => (r.unit === "%" && r.v >= 40) || (r.unit !== "%" && r.v >= 40))
  const squarish = radii.length > 0 && radii.every(r => r.v <= 3)
  const buttonShape: BrandSignals["buttonShape"] = pillish ? "pill" : squarish ? "square" : "rounded"

  // Light / dark: resolved --background var (already .dark-aware) → body bg →
  // theme-color → palette dark-dominance fallback. Note: the runtime SDK chameleon
  // is the authoritative match on the live page; this is the best build-time guess.
  const bgHex =
    cssVars["--background"] || cssVars["--card"] || cssVars["--bg"] ||
    resolveCssColor(firstMatch(html, /<body[^>]+style=["'][^"']*background(?:-color)?\s*:\s*([^;"']+)/i)) ||
    (themeColor && toRgb(themeColor) ? toHex(toRgb(themeColor)!) : "")
  const bgRgb = bgHex ? toRgb(bgHex) : null
  let colorScheme: BrandSignals["colorScheme"] = bgRgb ? (relLuminance(bgRgb) < 0.42 ? "dark" : "light") : "light"
  // Fallback: if no bg signal but very-dark colours dominate the palette, lean dark.
  if (!bgRgb && htmlDark) colorScheme = "dark"
  else if (!bgRgb) {
    const dark = palette.filter(p => { const r = toRgb(p.color); return r && relLuminance(r) < 0.15 }).reduce((s, p) => s + p.count, 0)
    const light = palette.filter(p => { const r = toRgb(p.color); return r && relLuminance(r) > 0.85 }).reduce((s, p) => s + p.count, 0)
    if (dark > light * 1.5) colorScheme = "dark"
  }

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
