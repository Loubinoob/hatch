import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"
import { computeElasticity, persistElasticity } from "@/lib/elasticity"
import { computeVariableImportance, persistVariableImportance } from "@/lib/variable-importance"
import { updateDataMaturity, MATURITY_THRESHOLD } from "@/lib/pricing-engine"
import { runInhouseModel, PricingDecision } from "@/lib/inhouse-pricing-model"
import { snapToLadder, ladderDistance, hillClimbingActions } from "@/lib/price-ladder"
import { loadDemandModel, extractVariableImportance as extractDemandVI, BORROW_THRESHOLD } from "@/lib/demand-model"

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

  // Load plan — only guaranteed-safe columns to avoid PGRST error on missing columns
  // pricing_aggressiveness / pricing_frozen are fetched separately (silent fail)
  const { data: plan, error: planError } = await service
    .from("plans")
    .select("id, name, price_monthly, price_floor_cents, price_ceiling_cents, dynamic_pricing_enabled, account_id, pricing_segment_keys")
    .eq("id", plan_id)
    .eq("account_id", accountId)
    .single()

  if (!plan) {
    const detail = planError ? ` (${planError.message})` : ""
    return NextResponse.json({ error: `Plan not found${detail}` }, { status: 404 })
  }
  if (!plan.dynamic_pricing_enabled) {
    return NextResponse.json({ skipped: true, reason: "dynamic_pricing_enabled is false" })
  }

  // Optional columns — silent fail if migration 016 not yet applied
  const { data: planExt } = await service
    .from("plans")
    .select("pricing_aggressiveness, pricing_frozen")
    .eq("id", plan_id)
    .maybeSingle()

  if (planExt?.pricing_frozen === true) {
    return NextResponse.json({ skipped: true, reason: "pricing_frozen" })
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

  // ── Augment variable importance with demand-model interaction coefficients ─
  // When the demand model has enough observations, extract importance scores from
  // price × context interaction coefficients and merge them with the Beta-bandit
  // variable importance (giving demand model a boost of +0.1 importance bonus to
  // signal that it uses a richer evidence source).
  const globalDemandModel = await loadDemandModel(service, plan_id, "global").catch(() => null)
  if (globalDemandModel && globalDemandModel.n_obs >= BORROW_THRESHOLD) {
    const demandVI = extractDemandVI(globalDemandModel)
    for (const dvi of demandVI) {
      const existing = variableImportance.find(v => v.variable_name === dvi.variable_name)
      if (existing) {
        // Blend: take max of the two importance scores (conservative merge)
        existing.importance_score = Math.max(existing.importance_score, dvi.importance_score)
      } else {
        // New variable only found by demand model — push with minimal evidence
        variableImportance.push({
          variable_name:          dvi.variable_name,
          importance_score:       dvi.importance_score,
          revenue_spread_cents:   0,
          optimal_price_by_value: {},
          evidence:               { source: "demand_model", n_obs: globalDemandModel.n_obs },
        })
      }
    }
    console.log(`[scientist] Demand model augmented VI: ${demandVI.map(d => `${d.variable_name}=${d.importance_score.toFixed(3)}`).join(", ")}`)
  }

  // ── Activate / deactivate pricing segment keys ────────────────────────────
  // A variable is activated as a pricing dimension when:
  //   1. importance_score >= 0.4  (meaningful WTP variation across values)
  //   2. min volume per value >= 50 impressions  (enough data to trust the signal)
  //   3. revenue spread vs global RPI >= 15%  (economically worth the fragmentation)
  // Top 2 variables max — more would fragment segments too aggressively.
  const globalRpi = elasticityGlobal?.optimal_price_cents
    ? (elasticityGlobal.curve.find(p => p.price_cents === elasticityGlobal.optimal_price_cents)?.rpi_cents ?? 0)
    : 0

  const qualifiedKeys: string[] = []
  for (const vi of variableImportance) {
    if (qualifiedKeys.length >= 2) break

    const meetsImportance = vi.importance_score >= 0.4
    const optimalPrices = Object.values(vi.optimal_price_by_value ?? {}) as number[]
    const meetsVolume = Object.values(vi.optimal_price_by_value ?? {}).length > 0 &&
      // proxy: importance_score correlates with volume; check top-level sample_size if available
      (vi as { sample_size?: number }).sample_size == null
        ? true  // no sample_size field — rely on importance_score
        : ((vi as { sample_size?: number }).sample_size ?? 0) / Math.max(1, optimalPrices.length) >= 50

    const revenueSpread = optimalPrices.length >= 2
      ? Math.max(...optimalPrices) - Math.min(...optimalPrices)
      : 0
    const meetsRevenue = globalRpi > 0
      ? revenueSpread / globalRpi >= 0.15
      : revenueSpread > 0  // if no global RPI, any spread qualifies

    if (meetsImportance && meetsVolume && meetsRevenue) {
      qualifiedKeys.push(vi.variable_name)
    }
  }

  // Only update if keys actually changed
  const currentKeys: string[] = Array.isArray(plan.pricing_segment_keys)
    ? plan.pricing_segment_keys
    : []
  const keysChanged =
    qualifiedKeys.length !== currentKeys.length ||
    qualifiedKeys.some(k => !currentKeys.includes(k))

  let segmentKeysNote = ""
  if (keysChanged) {
    await service
      .from("plans")
      .update({ pricing_segment_keys: qualifiedKeys })
      .eq("id", plan_id)

    if (qualifiedKeys.length === 0) {
      segmentKeysNote = `Deactivated all pricing segments — pooling all traffic globally (was: [${currentKeys.join(", ")}]).`
    } else {
      segmentKeysNote = `Updated pricing segment keys: [${qualifiedKeys.join(", ")}] (was: [${currentKeys.join(", ")}]). Bandit will now segment by these variables.`
    }
    console.log(`[scientist] plan=${plan_id} ${segmentKeysNote}`)
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
    // ── Hybrid: in-house model for quantitative output + Claude Sonnet for reasoning ──
    // The in-house model handles argmax-RPI (numbers). Claude interprets WHY and what
    // it means for the founder — so we never regress in intelligence at high maturity.
    decision = await runInhouseModel(
      elasticityGlobal,
      elasticityBySegment as Map<string, Parameters<typeof runInhouseModel>[1] extends Map<string, infer V> ? V : never>,
      variableImportance,
      floorCents,
      ceilingCents,
    )
    console.log(`[pricing/scientist] In-house model: ${decision.candidateActions.length} actions, confidence=${decision.confidence}`)

    // Claude Sonnet enriches the reasoning field (non-blocking, non-fatal)
    try {
      const topVarStr = decision.topVariables.slice(0, 2)
        .map(v => `${v.variable} (importance ${Math.round(v.importance * 100)}%): ${v.rationale}`)
        .join("; ")
      const actionsStr = decision.candidateActions
        .map(a => `${a.action} $${Math.round(a.price_cents / 100)} — ${a.reason}`)
        .join("; ")
      const reasoningMsg = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 400,
        messages: [{
          role: "user",
          content: `You are a pricing expert. In 2-4 sentences, explain what this pricing data means for the founder in plain language. Be concrete and actionable.

Plan: "${plan.name}"
Global optimal price: $${Math.round((decision.optimalBySegment["global"] ?? anchorCents) / 100)}/mo
Confidence: ${Math.round(decision.confidence * 100)}%
Top variables: ${topVarStr || "none yet"}
Actions taken: ${actionsStr || "none"}
Data maturity: ${Math.round(maturityScore * 100)}%

Respond in 2-4 sentences, no JSON, no bullet points.`,
        }],
      })
      const raw = reasoningMsg.content[0]
      if (raw.type === "text" && raw.text.trim()) {
        decision = { ...decision, reasoning: raw.text.trim() }
        tokensIn += reasoningMsg.usage.input_tokens
        tokensOut += reasoningMsg.usage.output_tokens
        modelUsed = "in_house_model+claude-sonnet-4-5"
      }
    } catch (err) {
      // Non-fatal — in-house reasoning still available
      console.warn("[pricing/scientist] Sonnet reasoning call failed:", err instanceof Error ? err.message : err)
    }
  }

  // ── Apply candidate actions with guardrails ────────────────────────────────
  const actionsApplied: typeof decision.candidateActions = []

  // B.5: Find current dominant price (highest RPI among candidates with data)
  // Used to enforce the "max 1 ladder step per run" anti-shock rule.
  const { data: currentCandidates } = await service
    .from("plan_price_candidates")
    .select("id, price_cents, is_anchor, is_active")
    .eq("plan_id", plan_id)
    .eq("is_active", true)

  const { data: currentPosteriors } = await service
    .from("price_point_posteriors")
    .select("price_candidate_id, alpha, beta, impressions, conversions, revenue_cents")
    .in("price_candidate_id", (currentCandidates ?? []).map((c: { id: string }) => c.id))
    .eq("segment_hash", "global")

  const postMap = new Map((currentPosteriors ?? []).map(
    (p: { price_candidate_id: string; alpha: number; beta: number; impressions: number; conversions: number; revenue_cents: number }) =>
      [p.price_candidate_id, p]
  ))

  let dominantPriceCents = anchorPriceCents
  let bestRpi = 0
  for (const c of currentCandidates ?? []) {
    const post = postMap.get(c.id)
    if (post && post.impressions >= 5) {
      const rpi = (post.conversions / post.impressions) * c.price_cents
      if (rpi > bestRpi) { bestRpi = rpi; dominantPriceCents = c.price_cents }
    }
  }

  // ── Maturity check: only hill-climb when data is solid ───────────────────────
  // Conditions: (1) dominant has ≥100 impressions AND ≥30% of plan's traffic
  //             (2) dominant's RPI credibility interval clears the runner-up's CI
  //             (3) plan is not conservative (conservative = stable window always)
  const aggressiveness = planExt?.pricing_aggressiveness ?? "balanced"
  const isConservative = aggressiveness === "conservative"

  const dominantCandidate = (currentCandidates ?? []).find(
    (c: { price_cents: number }) => c.price_cents === dominantPriceCents
  )
  const dominantPost  = dominantCandidate ? postMap.get(dominantCandidate.id) : null
  const dominantImpressions = dominantPost?.impressions ?? 0
  const totalImpressionsPlan = (currentPosteriors ?? []).reduce(
    (sum: number, p: { impressions: number }) => sum + (p.impressions ?? 0), 0
  )
  const dominantTrafficShare = totalImpressionsPlan > 0
    ? dominantImpressions / totalImpressionsPlan : 0

  // Approximate 95% CI for Beta distribution via normal approximation
  function betaCI95(alpha: number, beta: number): [number, number] {
    const n  = alpha + beta
    const mu = alpha / n
    const sigma = Math.sqrt(Math.max(0, mu * (1 - mu) / (n + 1)))
    return [mu - 1.96 * sigma, mu + 1.96 * sigma]
  }
  const candidateRpiCIs = (currentCandidates ?? [])
    .map((c: { id: string; price_cents: number }) => {
      const post = postMap.get(c.id)
      const alpha = post?.alpha ?? 1
      const beta  = post?.beta  ?? 1
      const [lo, hi] = betaCI95(alpha, beta)
      return {
        price_cents: c.price_cents,
        rpiLow:  lo * c.price_cents,
        rpiHigh: hi * c.price_cents,
      }
    })
    .sort((a: { rpiLow: number; rpiHigh: number }, b: { rpiLow: number; rpiHigh: number }) =>
      (b.rpiLow + b.rpiHigh) / 2 - (a.rpiLow + a.rpiHigh) / 2
    )
  const winner   = candidateRpiCIs[0] as { rpiLow: number; rpiHigh: number } | undefined
  const runnerUp = candidateRpiCIs[1] as { rpiHigh: number } | undefined
  const isClearWinner = winner && runnerUp
    ? winner.rpiLow > runnerUp.rpiHigh
    : false

  const isMature = dominantImpressions >= 100
    && dominantTrafficShare >= 0.30
    && isClearWinner

  const allowHillClimbing = !isConservative && isMature

  if (!allowHillClimbing) {
    const reason = isConservative
      ? "conservative plan — window is fixed"
      : `not mature yet (dominant: ${dominantImpressions} impr, ${(dominantTrafficShare * 100).toFixed(0)}% traffic, clearWinner=${isClearWinner})`
    if ((currentCandidates ?? []).length > 0) {
      console.log(`[pricing/scientist] Hill-climbing skipped — ${reason}`)
    }
  } else {
    console.log(
      `[pricing/scientist] ✅ Mature — dominant=$${dominantPriceCents / 100} ` +
      `(${dominantImpressions} impr, ${(dominantTrafficShare * 100).toFixed(0)}% traffic, clearWinner=true). Hill-climbing allowed.`
    )
  }

  // ── Hill-climbing: slide the testing window 1 step toward the winner ─────────
  // Only runs when the test is mature (≥100 impr dominant, ≥30% traffic, clear winner)
  // and the plan is not conservative.
  const currentCandidatePrices = (currentCandidates ?? [])
    .filter((c: { is_active: boolean }) => c.is_active)
    .map((c: { price_cents: number }) => c.price_cents)
  const hillActions = allowHillClimbing
    ? hillClimbingActions(currentCandidatePrices, dominantPriceCents, anchorPriceCents, floorCents, ceilingCents)
    : []

  if (hillActions.length > 0) {
    const hillSummary = hillActions.map(a => `${a.action} $${Math.round(a.price_cents/100)}`).join(", ")
    console.log(
      `[pricing/scientist] Hill-climbing: ${hillSummary} ` +
      `(dominant=$${dominantPriceCents/100}, ${dominantImpressions} impr, ${(dominantTrafficShare*100).toFixed(0)}% traffic)`
    )
    // Prepend hill-climbing actions (high-priority), deduplicate with LLM actions
    const existingPriceCents = new Set(decision.candidateActions.map(a => snapToLadder(a.price_cents)))
    const newHillActions = hillActions.filter(a => !existingPriceCents.has(snapToLadder(a.price_cents)))
    decision = { ...decision, candidateActions: [...newHillActions, ...decision.candidateActions].slice(0, 6) }

    // Enrich reasoning with maturity event
    const maturityNote = `[Matured at $${dominantPriceCents/100} — ${dominantImpressions} impr, ${(dominantTrafficShare*100).toFixed(0)}% traffic, clear winner → shifting window: ${hillSummary}]`
    decision = { ...decision, reasoning: decision.reasoning + `\n\n${maturityNote}` }
  }

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

    // B.5: Progressive moves — never ADD a price more than 1 ladder step from dominant
    // (prune actions are allowed at any distance — they reduce variance, not increase it)
    if (action.action === "add") {
      const dist = ladderDistance(snapped, dominantPriceCents)
      if (dist > 1) {
        console.log(`[pricing/scientist] Skipping add ${snapped}¢ — ${dist} steps from dominant ${dominantPriceCents}¢ (max 1)`)
        continue
      }
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
    reasoning: segmentKeysNote
      ? `${decision.reasoning}\n\n[Segmentation] ${segmentKeysNote}`
      : decision.reasoning,
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
    pricing_segment_keys: qualifiedKeys,
    segment_keys_changed: keysChanged,
    duration_ms: Date.now() - t0,
  })
}
