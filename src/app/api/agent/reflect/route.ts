import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are an autonomous experimentation analyst. Given variant performance data, your job is to:

1. Identify which variants are clear winners (high conv rate, narrow CI, > 100 views)
2. Identify which are clear losers (low conv rate, narrow CI, > 100 views)
3. Identify ambiguous cases (not enough data, overlapping CIs)
4. Extract LEARNINGS — patterns about what works for THIS specific app and audience

You produce concrete actions and durable insights.

Output strict JSON:
{
  "actions": [
    {
      "type": "archive",
      "variant_id": "uuid",
      "reason": "string (1 sentence)"
    },
    {
      "type": "promote_to_control",
      "variant_id": "uuid",
      "reason": "string"
    },
    {
      "type": "request_new_variants",
      "angle": "string (specific direction for next generation)",
      "reason": "string"
    }
  ],
  "insights": [
    {
      "insight": "string (1 declarative sentence, e.g. 'Urgency framing outperforms scarcity framing by 40% for this audience')",
      "category": "copy|pricing|timing|audience|design|cta|social_proof|other",
      "importance": 1-10,
      "evidence_summary": "string (variant names, sample sizes, conv deltas)"
    }
  ],
  "summary": "string (3-5 sentences, written to be shown to the founder)"
}`

// Bayesian CI on Beta(alpha, beta) — normal approximation
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

export async function POST(request: Request) {
  const t0 = Date.now()

  // Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: profile } = await supabase.from("users").select("account_id").eq("id", user.id).single()
  if (!profile?.account_id) return NextResponse.json({ error: "Account not found" }, { status: 404 })

  const { paywall_id } = await request.json()
  if (!paywall_id) return NextResponse.json({ error: "paywall_id required" }, { status: 400 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Cost guard
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count: runsToday } = await service
    .from("agent_runs")
    .select("*", { count: "exact", head: true })
    .eq("paywall_id", paywall_id)
    .gte("created_at", since)
  if ((runsToday ?? 0) >= 10) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 })
  }

  // Fetch paywall + all variants (active + archived)
  const [{ data: paywall }, { data: variants }, { data: pastInsights }] = await Promise.all([
    service.from("paywalls").select("*").eq("id", paywall_id).single(),
    service.from("paywall_variants")
      .select("id, name, headline, subheadline, cta_copy, views, conversions, posterior_alpha, posterior_beta, generated_by, hypothesis, is_control, archived_at, archive_reason")
      .eq("paywall_id", paywall_id)
      .order("created_at", { ascending: true }),
    service.from("agent_insights")
      .select("insight, category, importance")
      .eq("account_id", profile.account_id)
      .eq("paywall_id", paywall_id)
      .order("importance", { ascending: false })
      .limit(20),
  ])

  if (!paywall) return NextResponse.json({ error: "Paywall not found" }, { status: 404 })
  if (!variants?.length) return NextResponse.json({ error: "No variants to reflect on" }, { status: 400 })

  // Calculate stats for each active variant
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
      ci_width: (stats.ci_width * 100).toFixed(2) + "%",
      lift_vs_control: v.is_control ? "baseline" : lift,
      sufficient_data: (v.views ?? 0) >= 100,
    }
  })

  const archivedSummary = variants
    .filter(v => v.archived_at)
    .map(v => `"${v.name}" (archived: ${v.archive_reason})`)
    .join(", ")

  const pastInsightsMemo = pastInsights?.length
    ? pastInsights.map(i => `[${i.category}, ${i.importance}/10] ${i.insight}`).join("\n")
    : "None yet."

  // Create run record
  const { data: run } = await service.from("agent_runs").insert({
    account_id: profile.account_id,
    paywall_id,
    run_type: "reflection",
    status: "running",
    model_used: "claude-opus-4-7",
    input_summary: { active_variants: activeVariants.length, total_views: activeVariants.reduce((s, v) => s + (v.views ?? 0), 0) },
  }).select().single()

  const userPrompt = `Analyze these paywall variants and produce actions + insights.

PAYWALL: "${paywall.headline}"

ACTIVE VARIANTS PERFORMANCE:
${variantStats.map(v => `
Variant: "${v.name}" (id: ${v.id})
  - Type: ${v.is_control ? "CONTROL (baseline)" : v.generated_by === "ai" ? "AI-generated" : "Human"}
  - Hypothesis: ${v.hypothesis ?? "N/A"}
  - Headline: ${v.headline ?? "Same as control"}
  - Views: ${v.views} | Conversions: ${v.conversions}
  - Conv rate: ${v.conv_rate} | 95% CI: ${v.ci_95}
  - CI width: ${v.ci_width} (narrow = confident)
  - Lift vs control: ${v.lift_vs_control}
  - Sufficient data (>100 views): ${v.sufficient_data}`).join("\n")}

PREVIOUSLY ARCHIVED VARIANTS:
${archivedSummary || "None"}

CUMULATIVE INSIGHTS (memory):
${pastInsightsMemo}

Produce concrete actions (archive losers, promote winners) and extract learnings.
Only recommend archiving variants with > 100 views and clearly negative lift.
Only promote to control if statistically superior to current control with > 200 views.`

  try {
    const message = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 2500,
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
        // Demote old control
        await service.from("paywall_variants").update({ is_control: false })
          .eq("paywall_id", paywall_id).eq("is_control", true)
        // Promote new control
        await service.from("paywall_variants").update({ is_control: true })
          .eq("id", action.variant_id)
        const v = activeVariants.find(x => x.id === action.variant_id)
        actionsApplied.push(`Promoted "${v?.name ?? action.variant_id}" to control: ${action.reason}`)
      }

      if (action.type === "request_new_variants") {
        // Trigger L1 generation with the specified angle embedded
        try {
          const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? ""
          await fetch(`${origin}/api/agent/generate-variants`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Cookie": request.headers.get("cookie") ?? "" },
            body: JSON.stringify({ paywall_id, count: 2, force: true }),
          })
          actionsApplied.push(`Requested new variants (angle: ${action.angle})`)
        } catch { /* non-fatal */ }
      }
    }

    // Insert new insights
    const insightsInserted = []
    for (const insight of (parsed.insights ?? [])) {
      const { data: ins } = await service.from("agent_insights").insert({
        account_id: profile.account_id,
        paywall_id,
        insight: insight.insight,
        category: insight.category,
        importance: Math.min(10, Math.max(1, insight.importance ?? 5)),
        evidence: { summary: insight.evidence_summary },
      }).select().single()
      if (ins) insightsInserted.push(ins)
    }

    // Update run
    await service.from("agent_runs").update({
      status: "succeeded",
      reasoning: parsed.summary,
      output_summary: {
        actions_taken: actionsApplied.length,
        insights_generated: insightsInserted.length,
        actions: actionsApplied,
      },
      tokens_in: message.usage.input_tokens,
      tokens_out: message.usage.output_tokens,
      duration_ms: Date.now() - t0,
    }).eq("id", run?.id)

    return NextResponse.json({
      summary: parsed.summary,
      actions_taken: actionsApplied,
      insights_generated: insightsInserted.length,
      new_insights: insightsInserted,
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
