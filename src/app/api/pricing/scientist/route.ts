import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"
import { computeElasticity, persistElasticity } from "@/lib/elasticity"
import { computeVariableImportance, persistVariableImportance } from "@/lib/variable-importance"
import { updateDataMaturity, MATURITY_THRESHOLD } from "@/lib/pricing-engine"
import { runInhouseModel, PricingDecision } from "@/lib/inhouse-pricing-model"
import { snapToLadder } from "@/lib/price-ladder"

/**
 * POST /api/pricing/scientist
 * Periodic AI pricing analysis: computes elasticity + variable importance,
 * then routes to Claude or in-house model based on data maturity.
 * Applies candidate actions with guardrails (snap, within bounds, anchor protected).
 *
 * Called by: /api/cron/pricing-tick  OR  manually from the dashboard
 * Body: { plan_id: string, account_id?: string, _cron?: boolean }
 */

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MAX_SCIENTIST_RUNS_PER_PLAN_PER_DAY = 5

const SCIENTIST_SYSTEM_PROMPT = `You are a world-class SaaS pricing data scientist.
You analyse price elasticity curves and segment data to recommend pricing actions.

You receive:
- An elasticity curve (price_cents, impressions, conversions, conv_rate, rpi_cents, ci_low, ci_high)
- Variable importance analysis (which audience segments respond differently to price)
- Past pricing insights from memory
- Current floor/ceiling constraints

You must output ONLY valid JSON — no markdown, no preamble:
{
  "optimalBySegment": { "global": number, "<segment_hash>": number },
  "topVariables": [
    {
      "variable": "string",
      "importance": number,
      "optimalPriceByValue": { "<value>": number },
      "rationale": "string"
    }
  ],
  "candidateActions": [
    { "action": "add" | "prune", "price_cents": number, "segment_hash": "string (optional)", "reason": "string" }
  ],
  "reasoning": "string (2-4 sentences for the founder)",
  "confidence": number
}

Rules:
- optimalBySegment: prices in cents, snapped to psychological ladder (900, 1200, 1900, 2400, 2900...)
- candidateActions: max 5 actions total
- Only prune if impressions >= 30 AND rpi < 70% of best candidate
- Only add prices within [floor_cents, ceiling_cents]
- Never prune the anchor candidate (is_anchor = true)
- confidence: 0-1, based on data volume and signal clarity
- If elasticity data is sparse (< 50 total impressions), say so and recommend waiting`

export async function POST(request: NextRequest) {
  const t0 = Date.now()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Allow cron calls
  const cronSecret = request.headers.get("x-cron-secret")
  const isValidCron = cronSecret === process.env.CRON_SECRET
  if (!user && !isValidCron) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const { plan_id, _cron, account_id: cronAccountId } = body
  if (!plan_id) return NextResponse.json({ error: "plan_id required" }, { status: 400 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  let accountId: string
  if (_cron && isValidCron && cronAccountId) {
    accountId = cronAccountId
  } else {
    const { data: profile } = await supabase
      .from("users")
      .select("account_id")
      .eq("id", user!.id)
      .single()
    if (!profile?.account_id) return NextResponse.json({ error: "Account not found" }, { status: 404 })
    accountId = profile.account_id
  }

  // Load plan
  const { data: plan } = await service
    .from("plans")
    .select("id, name, price_monthly, price_floor_cents, price_ceiling_cents, dynamic_pricing_enabled, account_id")
    .eq("id", plan_id)
    .eq("account_id", accountId)
    .single()

  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })
  if (!plan.dynamic_pricing_enabled) {
    return NextResponse.json({ skipped: true, reason: "dynamic_pricing_enabled is false" })
  }

  const anchorCents = plan.price_monthly ?? 0
  const floorCents = plan.price_floor_cents ?? Math.round(anchorCents * 0.5)
  const ceilingCents = plan.price_ceiling_cents ?? Math.round(anchorCents * 2.0)

  // ── Cost guard: max 5 scientist runs/plan/day ─────────────────────────────
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count: runsToday } = await service
    .from("pricing_scientist_runs")
    .select("*", { count: "exact", head: true })
    .eq("plan_id", plan_id)
    .gte("created_at", since)

  if ((runsToday ?? 0) >= MAX_SCIENTIST_RUNS_PER_PLAN_PER_DAY) {
    return NextResponse.json({ error: "rate_limited", runs_today: runsToday }, { status: 429 })
  }

  // ── Compute elasticity + variable importance in parallel ──────────────────
  const [elasticityGlobal, variableImportance, { maturityScore, engine }] = await Promise.all([
    computeElasticity(service, plan_id, null),
    computeVariableImportance(service, plan_id, accountId, anchorCents),
    updateDataMaturity(service, plan_id, "global"),
  ])

  // Compute per-segment elasticity for top variable values
  const elasticityBySegment = new Map<string, Awaited<ReturnType<typeof computeElasticity>> & object>()
  if (variableImportance.length > 0 && maturityScore >= 0.3) {
    const topVar = variableImportance[0]
    const topValues = Object.keys(topVar.optimal_price_by_value).slice(0, 3)
    await Promise.all(
      topValues.map(async (val) => {
        const result = await computeElasticity(service, plan_id, val)
        if (result) elasticityBySegment.set(val, result)
      })
    )
  }

  // Persist elasticity snapshot
  if (elasticityGlobal) {
    await persistElasticity(service, accountId, plan_id, elasticityGlobal, null, {})
  }

  // Persist variable importance
  if (variableImportance.length > 0) {
    await persistVariableImportance(service, accountId, plan_id, variableImportance)
  }

  // ── Load past pricing insights from agent_insights ────────────────────────
  const { data: pricingInsights } = await service
    .from("agent_insights")
    .select("insight, category, importance, learning_type")
    .eq("account_id", accountId)
    .eq("pricing_related", true)
    .order("importance", { ascending: false })
    .limit(10)

  // ── Load anchor candidate (protected from pruning) ────────────────────────
  const { data: anchorCandidate } = await service
    .from("plan_price_candidates")
    .select("id, price_cents")
    .eq("plan_id", plan_id)
    .eq("is_anchor", true)
    .eq("is_active", true)
    .maybeSingle()

  const anchorPriceCents = anchorCandidate?.price_cents ?? snapToLadder(anchorCents)

  // ── Route to Claude or in-house model ─────────────────────────────────────
  let decision: PricingDecision
  let modelUsed: string | null = null
  let tokensIn = 0
  let tokensOut = 0
  const runType = maturityScore < 0.1 ? "cold_start" : "analysis"

  if (engine === "claude" || maturityScore < MATURITY_THRESHOLD) {
    // Use Claude for low-maturity plans
    try {
      const curveStr = elasticityGlobal
        ? elasticityGlobal.curve.map(p =>
            `  ${(p.price_cents / 100).toFixed(0)}/mo: ${p.impressions} impr, ${p.conversions} conv, ` +
            `conv_rate=${(p.conv_rate * 100).toFixed(2)}%, RPI=${Math.round(p.rpi_cents)}¢, ` +
            `CI=[${(p.ci_low * 100).toFixed(2)}%,${(p.ci_high * 100).toFixed(2)}%]`
          ).join("\n")
        : "No elasticity data yet (insufficient impressions)"

      const varImpStr = variableImportance.length > 0
        ? variableImportance.slice(0, 5).map(v =>
            `  ${v.variable_name} (importance=${v.importance_score.toFixed(2)}, spread=${Math.round(v.revenue_spread_cents)}¢): ` +
            Object.entries(v.optimal_price_by_value)
              .map(([k, v]) => `${k}=$${Math.round(v / 100)}`)
              .join(", ")
          ).join("\n")
        : "No variable importance data yet"

      const insightsStr = pricingInsights?.length
        ? pricingInsights.map(i => `  [${i.category}, ${i.importance}/10] ${i.insight}`).join("\n")
        : "  None yet"

      const userPrompt = `Analyse this pricing data and recommend actions for plan "${plan.name}".

DATA MATURITY: ${(maturityScore * 100).toFixed(0)}% (${maturityScore < 0.3 ? "sparse — reason from value" : "moderate — use elasticity"})

ELASTICITY CURVE (global):
${curveStr}

VARIABLE IMPORTANCE:
${varImpStr}

CONSTRAINTS:
- floor: $${Math.round(floorCents / 100)}/mo (${floorCents}¢)
- ceiling: $${Math.round(ceilingCents / 100)}/mo (${ceilingCents}¢)
- anchor candidate: $${Math.round(anchorPriceCents / 100)}/mo (NEVER prune this one)

PAST PRICING INSIGHTS:
${insightsStr}

Produce pricing recommendations. If data is sparse, reason from value and set up experiments.`

      const message = await anthropic.messages.create({
        model: "claude-opus-4-7",
        max_tokens: 2048,
        system: SCIENTIST_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      })

      tokensIn = message.usage.input_tokens
      tokensOut = message.usage.output_tokens
      modelUsed = "claude-opus-4-7"

      const raw = message.content[0]
      if (raw.type !== "text") throw new Error("Unexpected AI response type")

      const jsonText = raw.text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim()

      const parsed = JSON.parse(jsonText)
      decision = {
        optimalBySegment: parsed.optimalBySegment ?? {},
        topVariables: parsed.topVariables ?? [],
        candidateActions: (parsed.candidateActions ?? []).slice(0, 5),
        reasoning: parsed.reasoning ?? "No reasoning provided",
        confidence: parsed.confidence ?? 0,
        engine: "claude",
      }
      console.log(`[pricing/scientist] Claude analysis: ${decision.candidateActions.length} actions, confidence=${decision.confidence}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[pricing/scientist] Claude failed, falling back to in-house: ${msg}`)
      decision = await runInhouseModel(
        elasticityGlobal,
        elasticityBySegment as Map<string, Parameters<typeof runInhouseModel>[1] extends Map<string, infer V> ? V : never>,
        variableImportance,
        floorCents,
        ceilingCents,
      )
    }
  } else {
    // In-house model for mature plans
    decision = await runInhouseModel(
      elasticityGlobal,
      elasticityBySegment as Map<string, Parameters<typeof runInhouseModel>[1] extends Map<string, infer V> ? V : never>,
      variableImportance,
      floorCents,
      ceilingCents,
    )
    console.log(`[pricing/scientist] In-house model: ${decision.candidateActions.length} actions, confidence=${decision.confidence}`)
  }

  // ── Apply candidate actions with guardrails ────────────────────────────────
  const actionsApplied: typeof decision.candidateActions = []

  for (const action of decision.candidateActions) {
    // Guardrail: snap to ladder
    const snapped = snapToLadder(action.price_cents)

    // Guardrail: within bounds
    if (snapped < floorCents || snapped > ceilingCents) {
      console.log(`[pricing/scientist] Skipping ${action.action} ${snapped}¢ — out of bounds [${floorCents}¢, ${ceilingCents}¢]`)
      continue
    }

    // Guardrail: never prune anchor
    if (action.action === "prune" && snapped === anchorPriceCents) {
      console.log(`[pricing/scientist] Skipping prune of anchor price ${snapped}¢`)
      continue
    }

    if (action.action === "add") {
      const { error } = await service
        .from("plan_price_candidates")
        .upsert({
          plan_id,
          account_id: accountId,
          interval: "monthly",
          price_cents: snapped,
          is_anchor: false,
          is_active: true,
        }, { onConflict: "plan_id,interval,price_cents", ignoreDuplicates: true })

      if (!error) {
        actionsApplied.push({ ...action, price_cents: snapped })
        console.log(`[pricing/scientist] Added candidate ${snapped}¢: ${action.reason}`)
      }
    } else if (action.action === "prune") {
      const { error } = await service
        .from("plan_price_candidates")
        .update({ is_active: false })
        .eq("plan_id", plan_id)
        .eq("price_cents", snapped)
        .eq("is_anchor", false)

      if (!error) {
        actionsApplied.push({ ...action, price_cents: snapped })
        console.log(`[pricing/scientist] Pruned candidate ${snapped}¢: ${action.reason}`)
      }
    }
  }

  // ── Save pricing insight to agent_insights if noteworthy ──────────────────
  if (decision.confidence >= 0.5 && elasticityGlobal?.optimal_price_cents) {
    const insightText = `Plan "${plan.name}": $${Math.round(elasticityGlobal.optimal_price_cents / 100)}/mo maximises revenue per impression (confidence ${Math.round(decision.confidence * 100)}%)`
    const { data: existing } = await service
      .from("agent_insights")
      .select("id")
      .eq("account_id", accountId)
      .eq("insight", insightText)
      .maybeSingle()

    if (!existing) {
      await service.from("agent_insights").insert({
        account_id: accountId,
        insight: insightText,
        category: "pricing",
        importance: Math.round(decision.confidence * 8 + 2),
        learning_type: "positive_pattern",
        segment_conditions: {},
        evidence: {
          plan_id,
          optimal_price_cents: elasticityGlobal.optimal_price_cents,
          confidence: decision.confidence,
        },
        pricing_related: true,
      })
    }
  }

  // ── Log scientist run ──────────────────────────────────────────────────────
  await service.from("pricing_scientist_runs").insert({
    account_id: accountId,
    plan_id,
    run_type: runType,
    engine: decision.engine,
    data_maturity: maturityScore,
    reasoning: decision.reasoning,
    actions: actionsApplied,
    model_used: modelUsed,
    tokens_in: tokensIn || null,
    tokens_out: tokensOut || null,
    duration_ms: Date.now() - t0,
  })

  console.log(
    `[pricing/scientist] ✅ plan=${plan_id} engine=${decision.engine} maturity=${maturityScore.toFixed(2)} ` +
    `actions=${actionsApplied.length} duration=${Date.now() - t0}ms`
  )

  return NextResponse.json({
    ok: true,
    engine: decision.engine,
    maturity_score: maturityScore,
    confidence: decision.confidence,
    reasoning: decision.reasoning,
    actions_applied: actionsApplied,
    optimal_by_segment: decision.optimalBySegment,
    top_variables: decision.topVariables.slice(0, 3),
    duration_ms: Date.now() - t0,
  })
}
