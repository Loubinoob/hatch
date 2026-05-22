import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are an autonomous growth-optimization agent. You generate paywall variants that test new hypotheses while LEARNING from past experiments.

You receive:
* Product brief (what the app does, who it's for, problem solved, emotional drivers)
* Current "control" paywall
* Existing active variants with conversion data
* POSITIVE PATTERNS that have worked across this account's paywalls → use as priors
* ANTI-PATTERNS that have failed → avoid completely
* TOP-CONVERTING VARIANTS history (study what worked)

Generation rules:
1. Each variant tests a DIFFERENT angle (emotional driver, anchor, urgency level, social proof type, CTA action). NOT cosmetic re-wordings.
2. Each variant has a clear, falsifiable hypothesis ("Users will respond X% better to Y because Z").
3. If a positive pattern strongly applies, generate one variant that explicitly leverages it.
4. NEVER reproduce an anti-pattern's structure, wording style, or angle.
5. If plateau_detected=true, generate variants that explore completely new territory.

Return strict JSON:
{
  "variants": [
    {
      "name": "string (3-5 words, descriptive, e.g. 'ROI anchor v1')",
      "hypothesis": "string (1 falsifiable sentence)",
      "headline": "string",
      "subheadline": "string",
      "cta_copy": "string",
      "body_copy": "string (2-3 bullets, use \\n)",
      "accent_color": "hex",
      "emotional_driver": "string"
    }
  ],
  "applied_priors": ["description of positive pattern used, if any"],
  "avoided_antipatterns": ["description of antipattern avoided, if any"],
  "strategy_summary": "1 sentence explaining the overall test plan and expected learnings"
}`

// Account-level cost guard
const MAX_AGENT_RUNS_PER_DAY = 30

export async function POST(request: Request) {
  const t0 = Date.now()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: profile } = await supabase.from("users").select("account_id").eq("id", user.id).single()
  if (!profile?.account_id) return NextResponse.json({ error: "Account not found" }, { status: 404 })

  const { paywall_id, count = 3, force = false, plateau_detected = false } = await request.json()
  if (!paywall_id) return NextResponse.json({ error: "paywall_id required" }, { status: 400 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Account-level cost guard
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count: runsToday } = await service
    .from("agent_runs")
    .select("*", { count: "exact", head: true })
    .eq("account_id", profile.account_id)
    .in("run_type", ["generation", "reflection"])
    .gte("created_at", since)

  if ((runsToday ?? 0) >= MAX_AGENT_RUNS_PER_DAY) {
    return NextResponse.json({ error: "rate_limited", message: `Max ${MAX_AGENT_RUNS_PER_DAY} agent runs/day` }, { status: 429 })
  }

  // Fetch paywall + active variants
  const [{ data: paywall }, { data: activeVariants }, { data: brief }] = await Promise.all([
    service.from("paywalls").select("*").eq("id", paywall_id).single(),
    service.from("paywall_variants")
      .select("id, name, headline, subheadline, cta_copy, views, conversions, posterior_alpha, posterior_beta, generated_by, hypothesis")
      .eq("paywall_id", paywall_id)
      .is("archived_at", null),
    service.from("project_briefs").select("*").eq("account_id", profile.account_id).maybeSingle(),
  ])

  if (!paywall) return NextResponse.json({ error: "Paywall not found" }, { status: 404 })

  // Skip guard (unless forced or plateau detected)
  if (!force && !plateau_detected && (activeVariants?.length ?? 0) >= 3) {
    const allUnderserved = activeVariants!.every(v => (v.views ?? 0) < 100)
    if (allUnderserved) {
      return NextResponse.json({
        skip: true,
        message: "Existing variants still collecting data (< 100 views each). Use force=true to override.",
        active_count: activeVariants!.length,
      })
    }
  }

  // ─── Memory: paywall-specific insights ─────────────────────────────────────
  const { data: paywallInsights } = await service
    .from("agent_insights")
    .select("insight, category, importance, learning_type")
    .eq("account_id", profile.account_id)
    .eq("paywall_id", paywall_id)
    .order("importance", { ascending: false })
    .limit(5)

  // ─── Cross-paywall positive patterns ───────────────────────────────────────
  const { data: positivePatterns } = await service
    .from("agent_insights")
    .select("insight, category, importance")
    .eq("account_id", profile.account_id)
    .eq("learning_type", "positive_pattern")
    .order("importance", { ascending: false })
    .limit(10)

  // ─── Anti-patterns to avoid ────────────────────────────────────────────────
  const { data: antipatterns } = await service
    .from("agent_antipatterns")
    .select("id, pattern_type, description, confidence")
    .eq("account_id", profile.account_id)
    .eq("active", true)
    .order("confidence", { ascending: false })
    .limit(10)

  // ─── Top-converting variants cross-paywall ─────────────────────────────────
  const { data: topVariants } = await service
    .from("paywall_variants")
    .select("name, headline, cta_copy, views, conversions, posterior_alpha, posterior_beta")
    .eq("account_id", profile.account_id)
    .is("archived_at", null)
    .gte("views", 50)
    .order("posterior_alpha", { ascending: false })
    .limit(5)

  // Create run record
  const { data: run } = await service.from("agent_runs").insert({
    account_id: profile.account_id,
    paywall_id,
    run_type: "generation",
    status: "running",
    model_used: "claude-sonnet-4-6",
    input_summary: {
      active_variants: activeVariants?.length,
      has_brief: !!brief,
      antipatterns_count: antipatterns?.length,
      positive_patterns_count: positivePatterns?.length,
      plateau_detected,
    },
  }).select().single()

  const controlVariant = activeVariants?.find(v => v.generated_by === "human") ?? activeVariants?.[0]
  const existingAngles = activeVariants?.map(v => `"${v.name}": ${v.headline} (${v.views} views, ${((v.conversions ?? 0) / Math.max(1, v.views) * 100).toFixed(1)}% conv)`).join("\n") ?? "None"

  const userPrompt = `Generate ${count} paywall variants for this app.
${plateau_detected ? "\n⚠️ PLATEAU DETECTED — all current variants have converged. Explore COMPLETELY NEW territory.\n" : ""}
PRODUCT BRIEF:
- App: ${brief?.app_description ?? paywall.headline ?? "Unknown app"}
- ICP: ${brief?.icp_description ?? "Unknown"}
- Problem: ${brief?.core_problem ?? "Unknown"}
- Emotional drivers: ${brief?.emotional_drivers?.join(", ") ?? "productivity_gain, fear_of_missing_out"}
- Key benefits: ${brief?.key_benefits?.join(", ") ?? "Unknown"}
- Tone: ${brief?.tone_of_voice ?? "professional"}

CURRENT CONTROL:
- Headline: ${controlVariant?.headline ?? paywall.headline}
- Subheadline: ${controlVariant?.subheadline ?? paywall.subheadline ?? ""}
- CTA: ${controlVariant?.cta_copy ?? paywall.cta_copy}

ACTIVE VARIANTS (do NOT repeat these angles):
${existingAngles}

POSITIVE PATTERNS (use as priors — these angles have WORKED for this account):
${positivePatterns?.length ? positivePatterns.map(p => `[${p.category}, importance ${p.importance}] ${p.insight}`).join("\n") : "No confirmed positive patterns yet."}

ANTI-PATTERNS (NEVER reproduce these — they have FAILED):
${antipatterns?.length ? antipatterns.map(a => `[${a.pattern_type}, confidence ${a.confidence}] ${a.description}`).join("\n") : "No anti-patterns documented yet."}

TOP-CONVERTING VARIANTS HISTORY (what has worked):
${topVariants?.length ? topVariants.map(v => `"${v.name}": "${v.headline}" — ${v.views} views, ${((v.posterior_alpha ?? 1) / ((v.posterior_alpha ?? 1) + (v.posterior_beta ?? 1)) * 100).toFixed(1)}% est. conv`).join("\n") : "Not enough history yet."}

MEMORY — Paywall-specific insights:
${paywallInsights?.length ? paywallInsights.map(i => `[${i.category}, ${i.importance}/10, ${i.learning_type}] ${i.insight}`).join("\n") : "First experiment — no prior data."}

Generate ${count} variants, each testing a distinct hypothesis. Apply positive priors where relevant. Avoid all anti-patterns.`

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    })

    const raw = message.content[0]
    if (raw.type !== "text") throw new Error("Unexpected AI response type")

    const jsonText = raw.text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim()
    const parsed = JSON.parse(jsonText)

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
        traffic_split: null,
        is_control: false,
      }).select().single()
      if (inserted) created.push(inserted)
    }

    await service.from("agent_runs").update({
      status: "succeeded",
      output_summary: {
        variants_created: created.length,
        strategy: parsed.strategy_summary,
        applied_priors: parsed.applied_priors ?? [],
        avoided_antipatterns: parsed.avoided_antipatterns ?? [],
      },
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
