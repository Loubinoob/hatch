import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"
import { makeBlock } from "@/lib/blocks/utils"
import type { BlockType } from "@/lib/blocks/types"
import { extractBrandSignals, collectStylesheetUrls, summariseSignals, type BrandSignals } from "@/lib/brand-extract"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const VALID_BLOCK_TYPES: BlockType[] = [
  "hero", "image", "plans", "features", "testimonials", "logos",
  "comparison", "faq", "urgency", "guarantee", "video", "stats", "footer",
]

// Stable system prompt → prompt-cached (cache_control on the system block).
const SYSTEM_PROMPT = `You are an elite brand & conversion designer. You are given DESIGN + CONTENT signals scraped from a company's own website/app, plus their pricing plans. Your job: design a paywall that looks like it was built BY that company's own design team — visually native to their product — and convert it to a strict JSON spec.

The paywall is rendered by a block system with a token-based theme. Make it feel 100% on-brand:
- accentColor: the brand's primary/CTA color (use ACCENT GUESS / brand CSS vars / theme-color as the strongest evidence). Must be a #rrggbb hex.
- colorScheme: match the site's DETECTED COLOR SCHEME (light or dark). The paywall must feel like the same product.
- background: optional page background. Prefer a subtle, tasteful background that matches the brand — a near-scheme color or a soft accent-tinted gradient. Use a CSS gradient string in backgroundGradient when it elevates the look, else leave both null to use the scheme default.
- surface: optional card/panel color; leave null unless the brand clearly uses a specific surface.
- fontFamily: choose system | serif | mono to match the site's detected font bucket.
- buttonShape: match the site's detected button shape (rounded | pill | square).

Then design the layout and write copy in the brand's TONE, specific to what the product does (never generic filler). Reference the product's real value props from the visible text.

Available block types and props:
hero        – eyebrow(str|null), headline(str), subheadline(str|null), alignment("left"|"center")
image       – url(str), alt(str), size("s"|"m"|"l"|"full"), rounded(bool)   // use the brand LOGO URL if provided, near the top
plans       – ctaCopy(str), yearlyToggle(bool)
features    – title(str|null), items([{icon:str,text:str}])   // icon = an emoji or one of: check,sparkles,trending,lock,zap,heart,award,crown,star,shield
testimonials– title(str|null), items([{quote:str,author:str,role:str}])
logos       – title(str|null), items([{name:str}])
comparison  – title(str|null), rows([{feature:str,values:[str,str]}])
faq         – title(str|null), items([{question:str,answer:str}])
urgency     – text(str), subtext(str|null)
guarantee   – text(str)
stats       – items([{value:str,label:str}])
footer      – text(str), showPoweredBy(bool)

Return RAW JSON only (no markdown fences), exactly this shape:
{
  "brand": { "name": "str", "category": "str", "tone": "str", "colorScheme": "light"|"dark", "accentColor": "#hex", "summary": "1-sentence read on the brand's visual identity" },
  "display_mode": "modal" | "fullscreen",
  "theme": { "accentColor": "#hex", "colorScheme": "light"|"dark", "background": "#hex or null", "backgroundGradient": "css gradient string or null", "surface": "#hex or null", "fontFamily": "system"|"serif"|"mono", "buttonShape": "rounded"|"pill"|"square" },
  "blocks": [ { "type": "<block_type>", "props": { ... } } ],
  "reasoning": "1-2 sentences on how this matches the brand"
}

Rules:
- Always include a hero first and a plans block; end with a footer.
- If a brand LOGO URL is provided, include an image block (size "s", rounded false) near the very top.
- modal → 4-6 blocks (compact); fullscreen → 6-10 blocks. Pick what suits the brand.
- The plans block uses the real plan data — you only set ctaCopy + yearlyToggle.
- Copy must be specific to THIS product and written in THIS brand's voice.
- Max 10 blocks.`

async function fetchHtml(url: string): Promise<{ html: string; error?: string }> {
  // Light SSRF guard — block obvious internal targets.
  try {
    const u = new URL(url)
    if (!/^https?:$/.test(u.protocol)) return { html: "", error: "bad_protocol" }
    if (/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|\[?::1)/i.test(u.hostname)) {
      return { html: "", error: "blocked_host" }
    }
  } catch { return { html: "", error: "bad_url" } }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; HatchBot/1.0; +https://hatch.io)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    })
    clearTimeout(timeout)
    if (res.status === 401 || res.status === 403) return { html: "", error: "login_gated" }
    if (!res.ok) return { html: "", error: `http_${res.status}` }
    if (!(res.headers.get("content-type") ?? "").includes("text/html")) return { html: "", error: "not_html" }
    return { html: await res.text() }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") return { html: "", error: "timeout" }
    return { html: "", error: "fetch_failed" }
  }
}

async function fetchStylesheets(urls: string[]): Promise<string> {
  let total = ""
  await Promise.all(urls.slice(0, 4).map(async u => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 4000)
      const res = await fetch(u, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; HatchBot/1.0)" } })
      clearTimeout(timeout)
      if (res.ok && (res.headers.get("content-type") ?? "").includes("css")) {
        total += "\n" + (await res.text()).slice(0, 120000) // cap each bundle
      }
    } catch { /* skip unreachable stylesheet */ }
  }))
  return total.slice(0, 400000)
}

const HEX = /^#[0-9a-fA-F]{6}$/
function clampScheme(v: unknown): "light" | "dark" { return v === "dark" ? "dark" : "light" }
function clampFont(v: unknown): "system" | "serif" | "mono" { return v === "serif" || v === "mono" ? v : "system" }
function clampShape(v: unknown): "rounded" | "pill" | "square" { return v === "pill" || v === "square" ? v : "rounded" }
function clampHex(v: unknown, fallback: string): string { return typeof v === "string" && HEX.test(v.trim()) ? v.trim() : fallback }
function optHex(v: unknown): string | undefined { return typeof v === "string" && HEX.test(v.trim()) ? v.trim() : undefined }
function optStr(v: unknown): string | undefined { return typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim() : undefined }

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase.from("users").select("account_id").eq("id", user.id).single()
    if (!profile?.account_id) return NextResponse.json({ error: "Account not found" }, { status: 404 })

    const { paywall_id, url, paste } = await request.json()
    if (!paywall_id) return NextResponse.json({ error: "paywall_id required" }, { status: 400 })
    if (!url && !paste) return NextResponse.json({ error: "Provide your app URL (or a description)." }, { status: 400 })

    const [{ data: paywall }, { data: plans }] = await Promise.all([
      supabase.from("paywalls").select("*").eq("id", paywall_id).single(),
      supabase.from("plans")
        .select("name, price_monthly, price_yearly, features")
        .eq("account_id", profile.account_id)
        .order("price_monthly", { ascending: true }),
    ])
    if (!paywall) return NextResponse.json({ error: "Paywall not found" }, { status: 404 })

    // ── Gather brand signals ──
    let signals: BrandSignals | null = null
    let signalsText: string
    if (paste) {
      signalsText = `USER-PROVIDED DESCRIPTION (no live design signals available):\n\n${String(paste).slice(0, 4000)}`
    } else {
      const { html, error } = await fetchHtml(url)
      if (error === "login_gated") {
        return NextResponse.json({ error: "Cette URL est protégée par login. Utilise une page publique (landing) ou colle une description.", error_code: "login_gated" }, { status: 422 })
      }
      if (error || !html) {
        return NextResponse.json({ error: `Impossible de charger cette URL (${error}). Vérifie qu'elle est publique.`, error_code: error }, { status: 422 })
      }
      // Follow linked CSS bundles — client-rendered SPAs (Lovable, Vite, etc.)
      // keep their real design tokens in the stylesheet, not the HTML shell.
      const extraCss = await fetchStylesheets(collectStylesheetUrls(html, url))
      signals = extractBrandSignals(html, url, extraCss)
      signalsText = summariseSignals(signals)
    }

    const plansSummary = (plans ?? []).map(p =>
      `${p.name}: $${Math.round((p.price_monthly ?? 0) / 100)}/mo${p.price_yearly > 0 ? ` ($${Math.round(p.price_yearly / 100)}/yr)` : ""} — ${(p.features ?? []).slice(0, 4).join(", ")}`
    ).join("\n") || "No plans configured yet"

    const userPrompt = `BRAND & CONTENT SIGNALS FROM THE HOST APP:\n${signalsText}\n\nPRICING PLANS:\n${plansSummary}\n\nPaywall internal name: ${paywall.name}\n\nDesign a paywall that looks native to this brand and convert it to the JSON spec.`

    const message = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 6000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userPrompt }],
    })

    const raw = message.content.find(b => b.type === "text")
    if (!raw || raw.type !== "text") return NextResponse.json({ error: "Unexpected AI response" }, { status: 500 })

    let parsed: {
      brand?: Record<string, unknown>
      display_mode?: string
      theme?: Record<string, unknown>
      blocks?: Array<{ type: string; props: Record<string, unknown> }>
      reasoning?: string
    }
    try {
      const jsonText = raw.text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim()
      parsed = JSON.parse(jsonText)
    } catch {
      return NextResponse.json({ error: "Failed to parse AI response", raw: raw.text.slice(0, 500) }, { status: 500 })
    }

    // ── Validate + sanitize theme ──
    const fallbackAccent = signals?.accentGuess && HEX.test(signals.accentGuess) ? signals.accentGuess : "#6366F1"
    const t = parsed.theme ?? {}
    const theme = {
      accentColor: clampHex(t.accentColor, fallbackAccent),
      colorScheme: clampScheme(t.colorScheme ?? signals?.colorScheme),
      fontFamily: clampFont(t.fontFamily ?? signals?.fontFamily),
      buttonShape: clampShape(t.buttonShape ?? signals?.buttonShape),
      background: optHex(t.background),
      backgroundGradient: optStr(t.backgroundGradient),
      surface: optHex(t.surface),
    }

    // ── Validate + hydrate blocks ──
    const hydratedBlocks = (parsed.blocks ?? [])
      .filter(b => VALID_BLOCK_TYPES.includes(b.type as BlockType))
      .slice(0, 12)
      .map(b => makeBlock(b.type as BlockType, b.props ?? {}))
    if (hydratedBlocks.length === 0) return NextResponse.json({ error: "AI returned no valid blocks" }, { status: 500 })

    const displayMode = parsed.display_mode === "fullscreen" ? "fullscreen" : "modal"

    // ── Persist (existing columns only — no migration) ──
    const service = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const existingDesign = (paywall.design ?? {}) as Record<string, string>
    const design: Record<string, string> = { ...existingDesign, accentColor: theme.accentColor, colorScheme: theme.colorScheme }
    if (theme.background) design.background = theme.background; else delete design.background
    if (theme.backgroundGradient) design.backgroundGradient = theme.backgroundGradient; else delete design.backgroundGradient
    if (theme.surface) design.surface = theme.surface; else delete design.surface

    await service.from("paywalls").update({
      blocks: hydratedBlocks,
      display_mode: displayMode,
      design,
      font_family: theme.fontFamily,
      button_shape: theme.buttonShape,
      // Keep chameleon ON: the AI theme is the base/editor preview, but on the live
      // site the SDK samples the real computed styles and matches them exactly.
      theme_mode: "auto",
      updated_at: new Date().toISOString(),
    }).eq("id", paywall_id)

    try {
      await service.from("agent_runs").insert({
        paywall_id, account_id: profile.account_id, run_type: "generation", status: "succeeded",
        reasoning: parsed.reasoning ?? null,
        output_summary: { source: paste ? "paste" : "site", blocks_count: hydratedBlocks.length, display_mode: displayMode, theme, brand: parsed.brand ?? null },
      })
    } catch { /* non-critical */ }

    return NextResponse.json({
      ok: true,
      brand: parsed.brand ?? null,
      theme,
      display_mode: displayMode,
      blocks: hydratedBlocks,
      reasoning: parsed.reasoning ?? null,
      signals: signals ? { logoUrl: signals.logoUrl, accentGuess: signals.accentGuess, palette: signals.palette.slice(0, 6), colorScheme: signals.colorScheme } : null,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    console.error("[generate-from-site]", msg)
    if (msg.includes("401") || msg.toLowerCase().includes("api key") || msg.toLowerCase().includes("authentication")) {
      return NextResponse.json({ error: "Clé Anthropic manquante ou invalide. Ajoute ANTHROPIC_API_KEY dans .env.local." }, { status: 500 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
