import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are analyzing a web app to extract a structured marketing brief for paywall copy generation. Read the HTML and visible content provided. Infer:

- What the app does (1-2 sentences, specific)
- Its category (from: saas, productivity, developer-tools, ai-tools, design, marketing, finance, education, other)
- The ideal customer profile (who it's for, in 1-2 sentences)
- The core problem it solves
- 3-5 emotional drivers most likely to motivate purchase (from: fear_of_missing_out, desire_for_status, productivity_gain, cost_savings, competitive_edge, peace_of_mind, social_proof, exclusivity)
- 3-5 key benefits the user gets
- 2-3 likely competitors
- A price anchor framing (how to position pricing vs alternatives, 1 sentence)
- The tone of voice the brand uses (from: professional, friendly, bold, minimal, playful, urgent)

If the page is empty, login-gated, or you cannot infer information, return what you can with confidence: "low" on each ambiguous field.

Return ONLY strictly valid JSON — no markdown, no explanation. Do NOT invent data; if unclear, leave the field as empty string or empty array.

JSON schema:
{
  "app_description": "string",
  "app_category": "string",
  "icp_description": "string",
  "core_problem": "string",
  "emotional_drivers": ["string"],
  "key_benefits": ["string"],
  "competitors": ["string"],
  "price_anchor": "string",
  "tone_of_voice": "string",
  "ambiguities": ["string"],
  "confidence": "high" | "medium" | "low"
}`

async function extractPageContent(url: string): Promise<{ html: string; error?: string }> {
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

    if (res.status === 401 || res.status === 403) {
      return { html: "", error: "login_gated" }
    }
    if (!res.ok) {
      return { html: "", error: `http_${res.status}` }
    }

    const contentType = res.headers.get("content-type") ?? ""
    if (!contentType.includes("text/html")) {
      return { html: "", error: "not_html" }
    }

    const html = await res.text()
    return { html }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return { html: "", error: "timeout" }
    }
    return { html: "", error: "fetch_failed" }
  }
}

function stripHtml(html: string): string {
  // Extract meta tags + meaningful text, discard scripts/styles/noise
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""
  const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? ""
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? ""
  const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? ""
  const twitterDesc = html.match(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? ""

  // Strip scripts, styles, svg, nav, footer
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000) // cap body to avoid huge tokens

  return [
    `TITLE: ${title}`,
    `META DESCRIPTION: ${description || ogDesc || twitterDesc}`,
    `OG TITLE: ${ogTitle}`,
    `BODY TEXT: ${body}`,
  ].filter(l => !l.endsWith(": ")).join("\n\n")
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { url, paste } = await request.json()

    if (!url && !paste) {
      return NextResponse.json({ error: "Provide either 'url' or 'paste'" }, { status: 400 })
    }

    let pageContent: string
    let source: "url" | "paste"
    let fetchError: string | undefined

    if (paste) {
      source = "paste"
      pageContent = `USER-PROVIDED DESCRIPTION:\n\n${paste.slice(0, 4000)}`
    } else {
      source = "url"
      const { html, error } = await extractPageContent(url)
      fetchError = error

      if (error === "login_gated") {
        return NextResponse.json({
          error: "Couldn't access this URL — the page is login-gated. Try the 'Paste description' mode instead.",
          error_code: "login_gated",
        }, { status: 422 })
      }

      if (error && !html) {
        return NextResponse.json({
          error: `Couldn't fetch this URL (${error}). Check it's publicly accessible, or use 'Paste description' mode.`,
          error_code: error,
        }, { status: 422 })
      }

      pageContent = stripHtml(html)
    }

    const message = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: `Analyze this app and return a structured marketing brief as JSON:\n\n${pageContent}`,
      }],
    })

    const raw = message.content[0]
    if (raw.type !== "text") {
      return NextResponse.json({ error: "Unexpected AI response" }, { status: 500 })
    }

    let parsed: Record<string, unknown>
    try {
      const jsonText = raw.text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim()
      parsed = JSON.parse(jsonText)
    } catch {
      return NextResponse.json({ error: "Failed to parse AI response", raw: raw.text }, { status: 500 })
    }

    return NextResponse.json({
      brief: parsed,
      source,
      fetch_error: fetchError ?? null,
    })
  } catch (err: unknown) {
    console.error("Analyze-app error:", err)
    // Surface Anthropic auth errors clearly
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("401") || msg.toLowerCase().includes("api key") || msg.toLowerCase().includes("authentication")) {
      return NextResponse.json({ error: "Anthropic API key manquante ou invalide. Vérifie ANTHROPIC_API_KEY dans .env.local." }, { status: 500 })
    }
    return NextResponse.json({ error: msg || "Internal server error" }, { status: 500 })
  }
}
