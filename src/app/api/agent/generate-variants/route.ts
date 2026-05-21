import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are an autonomous growth-optimization agent for a SaaS paywall. Your job is to generate variants of a paywall that test DIFFERENT HYPOTHESES, not just re-wordings.

You receive:
* The product brief (what the app does, who it's for, problem solved, drivers)
* The current "control" paywall config (headline, subheadline, CTA, accent color)
* Existing active variants with their conversion data
* Recent insights from previous experiments (memory)

You output new variants. Each variant must:
1. Test a DISTINCT angle (different emotional driver, different anchor, different urgency, different specificity level, different social proof angle, different CTA action verb). DO NOT generate cosmetic re-wordings.
2. Have a clear, falsifiable hypothesis ("Users will respond X% better to Y because Z").
3. Avoid angles that have already failed (check insights memory).

Return strict JSON:
{
  "variants": [
    {
      "name": "string (3-5 word descriptive label, e.g. 'ROI anchor v1')",
      "hypothesis": "string (1 sentence falsifiable)",
      "headline": "string",
      "subheadline": "string",
      "cta_copy": "string",
      "body_copy": "string (2-3 bullets, can use \\n)",
      "accent_color": "hex (one of: #6366F1, #8B5CF6, #EC4899, #10B981, #F59E0B, #3B82F6)",
      "emotional_driver": "string (the driver this variant targets)"
    }
  ],
  "strategy_summary": "string (1 sentence explaining the overall test plan)"
}`

export async function POST(request: Request) {
  const t0 = Date.now()

  // Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: profile } = await supabase.from("users").select("account_id").eq("id", user.id).single()
  if (!profile?.account_id) return NextResponse.json({ error: "Account not found" }, { status: 404 })

  const { paywall_id, count = 3, force = false } = await request.json()
  if (!paywall_id) return NextResponse.json({ error: "paywall_id required" }, { status: 400 })

  // Service client for writes that bypass RLS
  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Cost guard — max 10 agent runs per paywall per day
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count: runsToday } = await service
    .from("agent_runs")
    .select("*", { count: "exact", head: true })
    .eq("paywall_id", paywall_id)
    .gte("created_at", since)
  if ((runsToday ?? 0) >= 10) {
    return NextResponse.json({ error: "rate_limited", message: "Max 10 agent runs/day per paywall" }, { status: 429 })
  }

  // Fetch paywall
  const { data: paywall } = await service.from("paywalls").select("*").eq("id", paywall_id).single()
  if (!paywall) return NextResponse.json({ error: "Paywall not found" }, { status: 404 })

  // Fetch active variants
  const { data: activeVariants } = await service
    .from("paywall_variants")
    .select("id, name, headline, subheadline, cta_copy, views, conversions, posterior_alpha, posterior_beta, generated_by, hypothesis")
    .eq("paywall_id", paywall_id)
    .is("archived_at", null)

  // Skip if not forced and enough low-traffic variants exist
  if (!force && (activeVariants?.length ?? 0) >= 3) {
    const allUnderserved = activeVariants!.every(v => (v.views ?? 0) < 100)
    if (allUnderserved) {
      return NextResponse.json({
        skip: true,
        message: "Existing variants still collecting data (< 100 views each). Use force=true to override.",
        active_count: activeVariants!.length,
      })
    }
  }

  // Fetch brief
  const { data: brief } = await service.from("project_briefs").select("*").eq("account_id", profile.account_id).maybeSingle()

  // Fetch last 5 insights (L4 memory)
  const { data: insights } = await service
    .from("agent_insights")
    .select("insight, category, importance")
    .eq("account_id", profile.account_id)
    .eq("paywall_id", paywall_id)
    .order("importance", { ascending: false })
    .order("generated_at", { ascending: false })
    .limit(5)

  // Create run record
  const { data: run } = await service.from("agent_runs").insert({
    account_id: profile.account_id,
    paywall_id,
    run_type: "generation",
    status: "running",
    model_used: "claude-sonnet-4-6",
    input_summary: { active_variants: activeVariants?.length, has_brief: !!brief, insights_count: insights?.length },
  }).select().single()

  const controlVariant = activeVariants?.find(v => v.generated_by === "human") ?? activeVariants?.[0]
  const existingAngles = activeVariants?.map(v => `"${v.name}": ${v.headline}`).join("\n") ?? "None"
  const insightsMemo = insights?.length
    ? insights.map(i => `[${i.category}, importance ${i.importance}] ${i.insight}`).join("\n")
    : "No insights yet — first experiment."

  const userPrompt = `Generate ${count} paywall variants for this app.

PRODUCT BRIEF:
- App: ${brief?.app_description ?? paywall.headline ?? "Unknown app"}
- ICP: ${brief?.icp_description ?? "Unknown"}
- Problem: ${brief?.core_problem ?? "Unknown"}
- Drivers: ${brief?.emotional_drivers?.join(", ") ?? "productivity_gain, fear_of_missing_out"}
- Benefits: ${brief?.key_benefits?.join(", ") ?? "Unknown"}
- Tone: ${brief?.tone_of_voice ?? "professional"}

CURRENT CONTROL:
- Headline: ${controlVariant?.headline ?? paywall.headline}
- Subheadline: ${controlVariant?.subheadline ?? paywall.subheadline ?? ""}
- CTA: ${controlVariant?.cta_copy ?? paywall.cta_copy}

EXISTING ACTIVE VARIANTS (do NOT repeat these angles):
${existingAngles}

MEMORY — Past insights for this paywall:
${insightsMemo}

Generate ${count} variants, each testing a distinct hypothesis.`

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    })

    const raw = message.content[0]
    if (raw.type !== "text") throw new Error("Unexpected AI response type")

    const jsonText = raw.text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim()
    const parsed = JSON.parse(jsonText)

    // Insert variants
    const created = []
    for (const v of parsed.variants ?? []) {
      const { data: inserted } = await service.from("paywall_variants").insert({
        paywall_id,
        account_id: profile.account_id,
        name: v.name,
        hypothesis: v.hypothesis,
        generated_by: "ai",
        headline: v.headline,
        subheadline: v.subheadline,
        cta_copy: v.cta_copy,
        body_copy: v.body_copy,
        accent_color: v.accent_color,
        posterior_alpha: 1,
        posterior_beta: 1,
        traffic_split: null, // Managed by bandit
        is_control: false,
      }).select().single()
      if (inserted) created.push(inserted)
    }

    // Update run as succeeded
    await service.from("agent_runs").update({
      status: "succeeded",
      output_summary: { variants_created: created.length, strategy: parsed.strategy_summary },
      reasoning: parsed.strategy_summary,
      tokens_in: message.usage.input_tokens,
      tokens_out: message.usage.output_tokens,
      duration_ms: Date.now() - t0,
    }).eq("id", run?.id)

    return NextResponse.json({
      variants: created,
      strategy_summary: parsed.strategy_summary,
      variants_created: created.length,
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
