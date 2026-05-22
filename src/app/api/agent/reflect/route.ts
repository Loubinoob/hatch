import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are an autonomous experimentation analyst. You analyze paywall variant performance to extract structured learnings and produce concrete actions.

You receive variant performance data with conv rates, Bayesian CIs, and past insights.

Produce:
1. ACTIONS: archive losers, promote winners, request new variants when needed.
2. INSIGHTS: durable observations about what works and why.
3. LESSONS: structured patterns (positive or negative) with segment conditions.
4. ANTI-PATTERNS: specific things to never re-test (failed approaches).
5. SUMMARY: 2-4 sentences for the founder.

Rules:
- Only archive variants with > 100 views AND clearly negative lift (CI entirely below control).
- Only promote to control if statistically superior with > 200 views.
- Lessons must be declarative, specific, and reusable across paywalls.
- Anti-patterns must be actionable (a future generator can use them to avoid a specific approach).

Return strict JSON:
{
  "actions": [
    { "type": "archive", "variant_id": "uuid", "reason": "string" },
    { "type": "promote_to_control", "variant_id": "uuid", "reason": "string" },
    { "type": "request_new_variants", "angle": "string", "reason": "string" }
  ],
  "insights": [
    {
      "insight": "string (1 declarative sentence)",
      "category": "copy|pricing|timing|audience|design|cta|social_proof|other",
      "importance": 1-10,
      "learning_type": "positive_pattern|negative_pattern|observation|hypothesis",
      "segment_conditions": {},
      "evidence_summary": "string"
    }
  ],
  "antipatterns": [
    {
      "pattern_type": "angle|wording|price_anchor|design|cta_style|length|tone",
      "description": "string (1 declarative sentence)",
      "evidence": { "variant_names": [], "avg_conv": 0.0, "baseline_conv": 0.0 },
      "confidence": 0.0
    }
  ],
  "summary": "string (2-4 sentences for founder)"
}`

function betaStats(alpha: number, beta: number) {
  const a = Math.max(1, alpha)
  const b = Math.max(1, beta)
  const mean = a / (a + b)
  const variance = (a * b) / ((a + b) ** 2 * (a + b + 1))
  const std = Math.sqrt(variance)
  return {
    mean,
    lower: Math.max(0, mean - 1.96 * std),
    upper: Math.min(1, mean + 1.96 * std),
    ci_width: 3.92 * std,
  }
}

const MAX_ACCOUNT_RUNS_PER_DAY = 30

export async function POST(request: Request) {
  const t0 = Date.now()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // Allow cron calls with x-cron-secret header (no user session in cron)
  const cronSecret = request.headers.get("x-cron-secret")
  const isValidCron = cronSecret === process.env.CRON_SECRET
  if (!user && !isValidCron) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const { paywall_id, _cron, account_id: cronAccountId } = body
  if (!paywall_id) return NextResponse.json({ error: "paywall_id required" }, { status: 400 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  let accountId: string
  if (_cron && isValidCron && cronAccountId) {
    accountId = cronAccountId
  } else {
    const { data: profile } = await supabase.from("users").select("account_id").eq("id", user!.id).single()
    if (!profile?.account_id) return NextResponse.json({ error: "Account not found" }, { status: 404 })
    accountId = profile.account_id
  }

  // Account-level cost guard
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count: runsToday } = await service
    .from("agent_runs")
    .select("*", { count: "exact", head: true })
    .eq("account_id", accountId)
    .in("run_type", ["generation", "reflection"])
    .gte("created_at", since)
  if ((runsToday ?? 0) >= MAX_ACCOUNT_RUNS_PER_DAY) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 })
  }

  const [{ data: paywall }, { data: variants }, { data: pastInsights }, { data: antipatterns }] = await Promise.all([
    service.from("paywalls").select("*").eq("id", paywall_id).single(),
    service.from("paywall_variants")
      .select("id, name, headline, subheadline, cta_copy, views, conversions, posterior_alpha, posterior_beta, generated_by, hypothesis, is_control, archived_at, archive_reason, last_ci_width")
      .eq("paywall_id", paywall_id)
      .order("created_at", { ascending: true }),
    service.from("agent_insights")
      .select("id, insight, category, importance, learning_type, confirmed_count")
      .eq("account_id", accountId)
      .eq("paywall_id", paywall_id)
      .order("importance", { ascending: false })
      .limit(20),
    service.from("agent_antipatterns")
      .select("description, pattern_type, confidence")
      .eq("account_id", accountId)
      .eq("active", true)
      .limit(10),
  ])

  if (!paywall) return NextResponse.json({ error: "Paywall not found" }, { status: 404 })
  if (!variants?.length) return NextResponse.json({ error: "No variants to reflect on" }, { status: 400 })

  const activeVariants = variants.filter(v => !v.archived_at)
  const controlVariant = activeVariants.find(v => v.is_control) ?? activeVariants[0]

  const variantStats = activeVariants.map(v => {
    const stats = betaStats(v.posterior_alpha ?? 1, v.posterior_beta ?? 1)
    const controlStats = betaStats(controlVariant.posterior_alpha ?? 1, controlVariant.posterior_beta ?? 1)
    const lift = controlStats.mean > 0
      ? ((stats.mean - controlStats.mean) / controlStats.mean * 100).toFixed(1) + "%"
      : "N/A"
    return {
      id: v.id,
      name: v.name,
      is_control: v.is_control,
      generated_by: v.generated_by,
      hypothesis: v.hypothesis,
      headline: v.headline,
      views: v.views ?? 0,
      conversions: v.conversions ?? 0,
      conv_rate: (stats.mean * 100).toFixed(2) + "%",
      ci_95: `[${(stats.lower * 100).toFixed(2)}%, ${(stats.upper * 100).toFixed(2)}%]`,
      ci_width: stats.ci_width,
      ci_width_str: (stats.ci_width * 100).toFixed(2) + "%",
      lift_vs_control: v.is_control ? "baseline" : lift,
      sufficient_data: (v.views ?? 0) >= 100,
      prev_ci_width: v.last_ci_width,
    }
  })

  // ─── Plateau detection ────────────────────────────────────────────────────
  const totalViews = activeVariants.reduce((s, v) => s + (v.views ?? 0), 0)
  let plateauDetected = false
  if (totalViews >= 200 && activeVariants.length > 0) {
    plateauDetected = variantStats.every(v => {
      if (!v.prev_ci_width) return false
      const reduction = (v.prev_ci_width - v.ci_width) / v.prev_ci_width
      return reduction < 0.05 // CI tightened by less than 5% — plateau
    })
  }

  const archivedSummary = variants
    .filter(v => v.archived_at)
    .map(v => `"${v.name}" (archived: ${v.archive_reason})`)
    .join(", ")

  const pastInsightsMemo = pastInsights?.length
    ? pastInsights.map(i => `[${i.category}, ${i.importance}/10, ${i.learning_type}] ${i.insight}`).join("\n")
    : "None yet."

  const antipatternsMemo = antipatterns?.length
    ? antipatterns.map(a => `[${a.pattern_type}, confidence ${a.confidence}] ${a.description}`).join("\n")
    : "None."

  const { data: run } = await service.from("agent_runs").insert({
    account_id: accountId,
    paywall_id,
    run_type: "reflection",
    status: "running",
    model_used: "claude-opus-4-7",
    input_summary: {
      active_variants: activeVariants.length,
      total_views: totalViews,
      plateau_detected: plateauDetected,
    },
  }).select().single()

  const userPrompt = `Analyze these paywall variants and produce actions, insights, lessons, and anti-patterns.

PAYWALL: "${paywall.headline}"
${plateauDetected ? "\n⚠️ PLATEAU DETECTED: CI widths have stopped narrowing. Recommend requesting new variants.\n" : ""}
ACTIVE VARIANTS PERFORMANCE:
${variantStats.map(v => `
Variant: "${v.name}" (id: ${v.id})
  - Type: ${v.is_control ? "CONTROL (baseline)" : v.generated_by === "ai" ? "AI-generated" : "Human"}
  - Hypothesis: ${v.hypothesis ?? "N/A"}
  - Headline: ${v.headline ?? "Same as control"}
  - Views: ${v.views} | Conversions: ${v.conversions}
  - Conv rate: ${v.conv_rate} | 95% CI: ${v.ci_95}
  - CI width: ${v.ci_width_str} | Lift vs control: ${v.lift_vs_control}
  - Sufficient data (>100 views): ${v.sufficient_data}
  - Previous CI width: ${v.prev_ci_width != null ? (v.prev_ci_width * 100).toFixed(2) + "%" : "N/A (first check)"}`).join("\n")}

PREVIOUSLY ARCHIVED:
${archivedSummary || "None"}

KNOWN ANTI-PATTERNS (for context when generating new insights):
${antipatternsMemo}

CUMULATIVE INSIGHTS:
${pastInsightsMemo}

Extract structured learnings. For anti-patterns, be specific enough that a future generator can avoid them.`

  try {
    const message = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 3000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    })

    const raw = message.content[0]
    if (raw.type !== "text") throw new Error("Unexpected AI response")

    const jsonText = raw.text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim()
    const parsed = JSON.parse(jsonText)

    const actionsApplied: string[] = []

    // Execute actions
    for (const action of (parsed.actions ?? [])) {
      if (action.type === "archive" && action.variant_id) {
        await service.from("paywall_variants").update({
          archived_at: new Date().toISOString(),
          archive_reason: action.reason,
        }).eq("id", action.variant_id)
        const v = activeVariants.find(x => x.id === action.variant_id)
        actionsApplied.push(`Archived "${v?.name ?? action.variant_id}": ${action.reason}`)
      }

      if (action.type === "promote_to_control" && action.variant_id) {
        await service.from("paywall_variants").update({ is_control: false }).eq("paywall_id", paywall_id).eq("is_control", true)
        await service.from("paywall_variants").update({ is_control: true }).eq("id", action.variant_id)
        const v = activeVariants.find(x => x.id === action.variant_id)
        actionsApplied.push(`Promoted "${v?.name ?? action.variant_id}" to control: ${action.reason}`)
      }

      if (action.type === "request_new_variants") {
        try {
          const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? ""
          await fetch(`${origin}/api/agent/generate-variants`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Cookie": request.headers.get("cookie") ?? "" },
            body: JSON.stringify({ paywall_id, count: 2, force: true, plateau_detected: plateauDetected }),
          })
          actionsApplied.push(`Requested new variants (angle: ${action.angle})`)
        } catch { /* non-fatal */ }
      }
    }

    // Insert/update insights with deduplication
    const insightsInserted = []
    for (const insight of (parsed.insights ?? [])) {
      // Check if exact insight already exists (dedup)
      const existing = pastInsights?.find(p => p.insight === insight.insight)
      if (existing) {
        await service.from("agent_insights").update({
          confirmed_count: (existing.confirmed_count ?? 0) + 1,
          last_confirmed_at: new Date().toISOString(),
          importance: Math.min(10, (existing.importance ?? 5) + 1),
        }).eq("id", existing.id)
        continue
      }
      const { data: ins } = await service.from("agent_insights").insert({
        account_id: accountId,
        paywall_id,
        insight: insight.insight,
        category: insight.category,
        importance: Math.min(10, Math.max(1, insight.importance ?? 5)),
        learning_type: insight.learning_type ?? "observation",
        segment_conditions: insight.segment_conditions ?? {},
        evidence: { summary: insight.evidence_summary },
      }).select().single()
      if (ins) insightsInserted.push(ins)
    }

    // Insert anti-patterns
    for (const ap of (parsed.antipatterns ?? [])) {
      if (!ap.description) continue
      // Avoid duplicates by checking description
      const { data: existing } = await service
        .from("agent_antipatterns")
        .select("id")
        .eq("account_id", accountId)
        .eq("description", ap.description)
        .maybeSingle()
      if (!existing) {
        await service.from("agent_antipatterns").insert({
          account_id: accountId,
          pattern_type: ap.pattern_type ?? "angle",
          description: ap.description,
          evidence: ap.evidence ?? {},
          confidence: Math.min(1, Math.max(0, ap.confidence ?? 0.5)),
          active: true,
        })
      }
    }

    // Update CI widths on variants for next plateau check
    for (const vs of variantStats) {
      await service.from("paywall_variants").update({
        last_ci_width: vs.ci_width,
        last_ci_check_at: new Date().toISOString(),
      }).eq("id", vs.id)
    }

    // If plateau + enough data, auto-trigger new generation
    if (plateauDetected && totalViews >= 200) {
      try {
        const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? ""
        await fetch(`${origin}/api/agent/generate-variants`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Cookie": request.headers.get("cookie") ?? "" },
          body: JSON.stringify({ paywall_id, count: 3, force: true, plateau_detected: true }),
        })
        actionsApplied.push("Auto-triggered new variant generation (plateau detected)")
      } catch { /* non-fatal */ }
    }

    await service.from("agent_runs").update({
      status: "succeeded",
      reasoning: parsed.summary,
      output_summary: {
        actions_taken: actionsApplied.length,
        insights_generated: insightsInserted.length,
        antipatterns_generated: (parsed.antipatterns ?? []).length,
        actions: actionsApplied,
        plateau_detected: plateauDetected,
      },
      tokens_in: message.usage.input_tokens,
      tokens_out: message.usage.output_tokens,
      duration_ms: Date.now() - t0,
    }).eq("id", run?.id)

    return NextResponse.json({
      summary: parsed.summary,
      actions_taken: actionsApplied,
      insights_generated: insightsInserted.length,
      antipatterns_generated: (parsed.antipatterns ?? []).length,
      plateau_detected: plateauDetected,
      new_insights: insightsInserted,
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await service.from("agent_runs").update({
      status: "failed", error_message: msg, duration_ms: Date.now() - t0,
    }).eq("id", run?.id)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
