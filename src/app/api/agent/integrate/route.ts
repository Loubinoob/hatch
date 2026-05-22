import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are a Hatch paywall integration specialist. Given the HTML content of a web app and the paywall configuration to integrate, identify the exact integration points and generate ready-to-paste code snippets.

Your analysis must be practical and specific — reference actual elements visible in the app HTML.

Return ONLY strict JSON, no markdown, no explanation:
{
  "integration_points": [
    {
      "location": "Human-readable description (e.g. 'Upgrade button in the top navigation bar')",
      "trigger_code": "hatch.show('PAYWALL_ID')",
      "context": "1-sentence rationale for why this placement makes sense"
    }
  ],
  "identify_snippet": "// Paste this right after your user signs in:\\nhatch.identify(userId, { email: userEmail })",
  "identify_context": "Short description of where auth happens in this app (e.g. 'After Supabase signIn() resolves')",
  "gating_suggestion": "// Optional: programmatically gate a premium feature\\nif (!await hatch.isSubscribed()) {\\n  hatch.show('PAYWALL_ID')\\n  return\\n}",
  "test_steps": [
    "Open your Lovable app preview",
    "Open the browser console (F12)",
    "Type hatch.debug() to confirm SDK is loaded",
    "Click the button/link where you added hatch.show() to trigger the paywall"
  ],
  "confidence": "high",
  "notes": "Any important observations about this specific app"
}

Rules:
- Replace PAYWALL_ID with the actual paywall ID provided
- If the app HTML is limited or login-gated, still return the most logical integration points based on the app description
- Always include at least 2 integration_points — even if guessing, be specific (e.g. 'Upgrade CTA in the sidebar' is better than 'somewhere in the app')
- The identify_snippet must reference realistic variable names typical for the framework detected
- confidence must be "high" if HTML was rich, "medium" if limited, "low" if page was gated/empty`

async function fetchAppContent(url: string): Promise<{ content: string; error?: string }> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; HatchBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
    })
    clearTimeout(timeout)

    if (res.status === 401 || res.status === 403) return { content: "", error: "login_gated" }
    if (!res.ok) return { content: "", error: `http_${res.status}` }

    const html = await res.text()

    // Extract meaningful content (same pattern as analyze-app)
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""
    const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? ""
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? ""
    const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? ""

    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<svg[\s\S]*?<\/svg>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000)

    const content = [
      `TITLE: ${title}`,
      `META DESCRIPTION: ${description || ogDesc}`,
      `OG TITLE: ${ogTitle}`,
      `BODY TEXT: ${body}`,
    ].filter(l => !l.endsWith(": ")).join("\n\n")

    return { content }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return { content: "", error: "timeout" }
    return { content: "", error: "fetch_failed" }
  }
}

export async function POST(request: Request) {
  const t0 = Date.now()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { paywall_id, app_url } = await request.json()
  if (!paywall_id || !app_url) {
    return NextResponse.json({ error: "paywall_id and app_url are required" }, { status: 400 })
  }

  const service = createServiceClient()

  // Get account
  const { data: profile } = await supabase.from("users").select("account_id").eq("id", user.id).single()
  if (!profile?.account_id) return NextResponse.json({ error: "Account not found" }, { status: 404 })
  const accountId = profile.account_id

  // Fetch paywall + plans + brief in parallel
  const [{ data: paywall }, { data: plans }, { data: brief }] = await Promise.all([
    service.from("paywalls").select("id, name, headline, cta_copy, template").eq("id", paywall_id).single(),
    service.from("plans").select("name, price_monthly, features").eq("account_id", accountId).eq("is_active", true),
    service.from("project_briefs").select("app_description, icp_description, app_category").eq("account_id", accountId).maybeSingle(),
  ])

  if (!paywall) return NextResponse.json({ error: "Paywall not found" }, { status: 404 })

  // Fetch app content
  const { content: appContent, error: fetchError } = await fetchAppContent(app_url)

  // Build context for AI
  const paywallContext = [
    `Paywall ID: ${paywall.id}`,
    `Paywall name: ${paywall.name}`,
    `Headline: ${paywall.headline ?? "Unlock full access"}`,
    `CTA: ${paywall.cta_copy ?? "Get started"}`,
    `Template: ${paywall.template ?? "classic-modal"}`,
    plans?.length ? `Plans: ${plans.map(p => `${p.name} ($${p.price_monthly}/mo)`).join(", ")}` : "",
    brief?.app_description ? `App description: ${brief.app_description}` : "",
    brief?.icp_description ? `Target user: ${brief.icp_description}` : "",
  ].filter(Boolean).join("\n")

  const appContext = appContent
    ? `APP URL: ${app_url}\n\n${appContent}`
    : `APP URL: ${app_url}\n\n[Page content unavailable — ${fetchError ?? "unknown error"}. Analyze based on URL and app description only.]`

  // Insert agent run record
  const { data: run } = await service.from("agent_runs").insert({
    account_id: accountId,
    paywall_id,
    run_type: "integration",
    status: "running",
    model_used: "claude-sonnet-4-6",
    input_summary: { app_url, fetch_error: fetchError ?? null },
  }).select().single()

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: `Analyze this app and generate integration snippets for the Hatch paywall.

PAYWALL CONFIG:
${paywallContext}

APP CONTENT:
${appContext}

Generate the integration guide. Replace all instances of PAYWALL_ID with: ${paywall.id}`,
      }],
    })

    const raw = message.content[0]
    if (raw.type !== "text") throw new Error("Unexpected AI response")

    const jsonText = raw.text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim()

    const parsed = JSON.parse(jsonText)

    // Update agent run as succeeded
    await service.from("agent_runs").update({
      status: "succeeded",
      reasoning: parsed.notes ?? null,
      output_summary: {
        integration_points: parsed.integration_points?.length ?? 0,
        confidence: parsed.confidence,
        app_url,
        fetch_error: fetchError ?? null,
      },
      tokens_in: message.usage.input_tokens,
      tokens_out: message.usage.output_tokens,
      duration_ms: Date.now() - t0,
    }).eq("id", run?.id)

    return NextResponse.json({
      ...parsed,
      paywall_id,
      app_url,
      fetch_status: fetchError ? "limited" : "ok",
      run_id: run?.id,
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await service.from("agent_runs").update({
      status: "failed",
      error_message: msg,
      duration_ms: Date.now() - t0,
    }).eq("id", run?.id)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
