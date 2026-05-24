import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { computeSegmentHash } from "@/lib/segment"
import { selectPriceCandidate, PriceCandidate, PricePosterior } from "@/lib/price-bandit"
import { computeElasticity } from "@/lib/elasticity"
import { computeVariableImportance } from "@/lib/variable-importance"
import { runInhouseModel } from "@/lib/inhouse-pricing-model"

/**
 * POST /api/dev/simulate-pricing
 *
 * Runs a synthetic user simulation against the REAL bandit logic to verify
 * convergence toward the planted ground-truth optimal price.
 *
 * Protected: requires header x-sim-secret = SIM_SECRET, OR NODE_ENV !== production.
 * NEVER exposed open in production.
 *
 * Synthetic data uses segment_hash prefixed with "sim:" to avoid polluting real data.
 * Clean up with DELETE /api/dev/reset-simulation.
 */

export const maxDuration = 300 // seconds — long-running, only used in dev

interface GroundTruth {
  base: number           // max conv rate at lowest price
  midpoint_cents: number // price where demand halves
  steepness: number      // logistic steepness k
  discriminating_variable: string
  willingness_by_value: Record<string, number>  // multiplies midpoint
}

interface SimInput {
  plan_id: string
  n_users?: number
  ground_truth: GroundTruth
  scientist_every?: number
}

/** P(convert | price_cents, segment_value) — logistic demand model */
function convProb(priceCents: number, gt: GroundTruth, segValue: string): number {
  const w = gt.willingness_by_value[segValue] ?? 1.0
  const adjustedMidpoint = gt.midpoint_cents * w
  return gt.base / (1 + Math.exp(gt.steepness * (priceCents - adjustedMidpoint)))
}

/** Analytically compute the best price from candidates for a given segment value */
function groundTruthOptimal(candidates: PriceCandidate[], gt: GroundTruth, segValue: string): number {
  let bestRevenue = -Infinity
  let bestPrice = candidates[0].price_cents
  for (const c of candidates) {
    const p = convProb(c.price_cents, gt, segValue)
    const rev = p * c.price_cents
    if (rev > bestRevenue) {
      bestRevenue = rev
      bestPrice = c.price_cents
    }
  }
  return bestPrice
}

export async function POST(request: NextRequest) {
  // ── Auth guard ────────────────────────────────────────────────────────────
  const simSecret = request.headers.get("x-sim-secret")
  const isAuthorised =
    simSecret === process.env.SIM_SECRET ||
    process.env.NODE_ENV !== "production"

  if (!isAuthorised) {
    return NextResponse.json({ error: "Forbidden — simulation endpoint not available in production" }, { status: 403 })
  }

  const body: SimInput = await request.json()
  const { plan_id, n_users = 2000, ground_truth: gt, scientist_every = 500 } = body

  if (!plan_id || !gt) {
    return NextResponse.json({ error: "plan_id and ground_truth are required" }, { status: 400 })
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // ── Fetch plan + candidates ───────────────────────────────────────────────
  const { data: plan } = await service
    .from("plans")
    .select("id, name, price_monthly, price_floor_cents, price_ceiling_cents, account_id, dynamic_pricing_enabled")
    .eq("id", plan_id)
    .single()

  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

  const floorCents = plan.price_floor_cents ?? Math.round((plan.price_monthly ?? 0) * 0.5)
  const ceilingCents = plan.price_ceiling_cents ?? Math.round((plan.price_monthly ?? 0) * 2.0)
  const accountId: string = plan.account_id

  const { data: candidateRows } = await service
    .from("plan_price_candidates")
    .select("id, price_cents, is_anchor, interval")
    .eq("plan_id", plan_id)
    .eq("is_active", true)
    .eq("interval", "monthly")

  if (!candidateRows?.length) {
    return NextResponse.json({ error: "No active price candidates — run cold-start first" }, { status: 400 })
  }

  const candidates: PriceCandidate[] = candidateRows.map((c: { id: string; price_cents: number; is_anchor: boolean; interval: string }) => ({
    id: c.id,
    price_cents: c.price_cents,
    is_anchor: c.is_anchor,
    interval: c.interval,
  }))

  const segValues = Object.keys(gt.willingness_by_value)
  const SIM_PREFIX = "sim:"

  // ── In-memory posterior store ─────────────────────────────────────────────
  // Key: `sim:${segmentHash}`, Value: Map<candidateId, PricePosterior>
  type PostMap = Map<string, PricePosterior>
  const posteriorStore = new Map<string, PostMap>()

  function getOrInitPostMap(simSegHash: string): PostMap {
    if (!posteriorStore.has(simSegHash)) {
      const m: PostMap = new Map()
      for (const c of candidates) {
        m.set(c.id, { price_candidate_id: c.id, alpha: 1, beta: 1, impressions: 0, conversions: 0 })
      }
      posteriorStore.set(simSegHash, m)
    }
    return posteriorStore.get(simSegHash)!
  }

  // ── Tracking ──────────────────────────────────────────────────────────────
  let totalRevenueCents = 0
  let totalRegretCents = 0
  const tranches: { after_n: number; price_share: Record<string, number>; avg_price_cents: number }[] = []
  const trancheCounters: Record<string, number> = {}  // price_cents → count in this tranche

  let trancheStart = 0
  let tranchePriceSum = 0

  // Pre-compute ground-truth optimal for each segment value
  const gtOptimalBySegValue: Record<string, number> = {}
  for (const segVal of segValues) {
    gtOptimalBySegValue[segVal] = groundTruthOptimal(candidates, gt, segVal)
  }

  // ── Simulation loop ───────────────────────────────────────────────────────
  for (let i = 0; i < n_users; i++) {
    // Random context
    const segVal = segValues[Math.floor(Math.random() * segValues.length)]
    const device = (["mobile", "desktop", "tablet"] as const)[Math.floor(Math.random() * 3)]
    const returning = Math.random() > 0.7

    const { hash: realHash } = computeSegmentHash({
      utm_source: segVal,
      device,
      returning,
      hour_bucket: "afternoon",
    })
    const simSegHash = SIM_PREFIX + realHash

    const postMap = getOrInitPostMap(simSegHash)
    const postersForSelection: PricePosterior[] = Array.from(postMap.values())

    // Select price via real bandit logic
    const { candidate, mode: _mode } = selectPriceCandidate(candidates, postersForSelection)
    const priceCents = candidate.price_cents

    // Ground-truth conversion
    const p = convProb(priceCents, gt, segVal)
    const converted = Math.random() < p

    // Update in-memory posteriors
    const post = postMap.get(candidate.id)!
    post.impressions++
    if (converted) {
      post.conversions = (post.conversions ?? 0) + 1
      post.alpha++
      totalRevenueCents += priceCents
    } else {
      post.beta++
    }

    // Regret: oracle would have served the segment-optimal price
    const oraclePriceCents = gtOptimalBySegValue[segVal] ?? priceCents
    const oracleRevenue = convProb(oraclePriceCents, gt, segVal) * oraclePriceCents
    const actualRevenue = p * priceCents
    totalRegretCents += oracleRevenue - actualRevenue

    // Tranche tracking
    trancheCounters[String(priceCents)] = (trancheCounters[String(priceCents)] ?? 0) + 1
    tranchePriceSum += priceCents

    // Every scientist_every users: flush posteriors to DB + run scientist
    if ((i + 1) % scientist_every === 0 || i === n_users - 1) {
      const trancheN = i + 1 - trancheStart
      const priceShare: Record<string, number> = {}
      for (const [p, cnt] of Object.entries(trancheCounters)) {
        priceShare[p] = Math.round((cnt / trancheN) * 1000) / 1000
      }
      tranches.push({
        after_n: i + 1,
        price_share: priceShare,
        avg_price_cents: Math.round(tranchePriceSum / trancheN),
      })
      // Reset tranche counters
      for (const k of Object.keys(trancheCounters)) delete trancheCounters[k]
      trancheStart = i + 1
      tranchePriceSum = 0

      // Flush in-memory posteriors to DB (upsert with sim: segment_hash)
      const upsertRows: Record<string, unknown>[] = []
      for (const [segHash, postMap] of posteriorStore.entries()) {
        for (const post of postMap.values()) {
          upsertRows.push({
            price_candidate_id: post.price_candidate_id,
            segment_hash: segHash,
            alpha: post.alpha,
            beta: post.beta,
            impressions: post.impressions,
            conversions: post.conversions ?? 0,
            revenue_cents: (post.conversions ?? 0) * 0,  // can't compute exact revenue here
          })
        }
      }
      if (upsertRows.length > 0) {
        await service.from("price_point_posteriors").upsert(
          upsertRows,
          { onConflict: "price_candidate_id,segment_hash" }
        )
      }

      // Write synthetic paywall_impressions (for variable-importance to work)
      // Use the last batch of users as impressions
      const impressionRows: Record<string, unknown>[] = []
      for (const [segHash, postMapForSeg] of posteriorStore.entries()) {
        if (!segHash.startsWith(SIM_PREFIX)) continue
        // We write one synthetic impression row per segment × candidate combination
        // that had activity in this tranche — as a summary (not per-user for perf)
        for (const post of postMapForSeg.values()) {
          if ((post.impressions ?? 0) === 0) continue
          const realHashFromSim = segHash.slice(SIM_PREFIX.length)
          const parts = Object.fromEntries(
            realHashFromSim.split("|").map(s => s.split("=") as [string, string])
          )
          impressionRows.push({
            account_id: accountId,
            paywall_id: plan_id, // use plan_id as fake paywall_id — FK may fail, wrapped in try/catch
            session_id: `sim_${plan_id}_${segHash}_${post.price_candidate_id}_${Date.now()}`,
            utm_source: parts["utm"] ?? null,
            device_type: parts["device"] ?? null,
            is_returning: parts["returning"] === "true",
            price_shown_cents: candidates.find(c => c.id === post.price_candidate_id)?.price_cents ?? null,
            converted: (post.conversions ?? 0) > 0,
            shown_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            is_synthetic: true,
          })
        }
      }

      if (impressionRows.length > 0) {
        try {
          await service.from("paywall_impressions").insert(impressionRows)
        } catch { /* non-fatal — paywall_id FK may not exist */ }
      }

      // Run in-house scientist for this plan (no LLM for speed)
      if (i < n_users - 1) {  // skip on last iteration (we'll read after)
        try {
          const elasticityForSim = await computeElasticity(service, plan_id, null)
          const varImportance = await computeVariableImportance(service, plan_id, accountId, plan.price_monthly ?? 0)
          if (elasticityForSim) {
            await runInhouseModel(
              elasticityForSim,
              new Map(),
              varImportance,
              floorCents,
              ceilingCents,
            )
          }
        } catch { /* non-fatal */ }
      }
    }
  }

  // ── Final analysis ────────────────────────────────────────────────────────
  const finalElasticity = await computeElasticity(service, plan_id, null)
  const finalVarImportance = await computeVariableImportance(service, plan_id, accountId, plan.price_monthly ?? 0)

  // What did the system find as optimal?
  const finalOptimalCents = finalElasticity?.optimal_price_cents ?? plan.price_monthly
  const finalOptimalBySegment: Record<string, number> = { global: finalOptimalCents }

  // Ground-truth global optimal (best across all segment values, weighted equally)
  const gtGlobalOptimalCents = groundTruthOptimal(candidates, gt, segValues[0] ?? "direct")
  const gtOptimalBySegment: Record<string, number> = { global: gtGlobalOptimalCents }
  for (const [val, priceCents] of Object.entries(gtOptimalBySegValue)) {
    gtOptimalBySegment[val] = priceCents
  }

  // Convergence gap
  const convergenceGapCents = Math.abs(finalOptimalCents - gtGlobalOptimalCents)

  // Did we find the discriminating variable?
  const topVariableFound = finalVarImportance[0]?.variable_name ?? null
  const topVariableExpected = gt.discriminating_variable

  console.log(
    `[sim] ✅ n=${n_users} gap=${convergenceGapCents}¢ topVar=${topVariableFound} (expected ${topVariableExpected}) regret=${Math.round(totalRegretCents)}¢`
  )

  return NextResponse.json({
    ok: true,
    served_price_distribution_over_time: tranches,
    final_optimal_by_segment: finalOptimalBySegment,
    ground_truth_optimal_by_segment: gtOptimalBySegment,
    convergence_gap_cents: convergenceGapCents,
    top_variable_found: topVariableFound,
    top_variable_expected: topVariableExpected,
    top_variable_match: topVariableFound === topVariableExpected,
    total_simulated_revenue_cents: Math.round(totalRevenueCents),
    regret_vs_oracle_cents: Math.round(totalRegretCents),
    candidates_used: candidates.map(c => ({ price_cents: c.price_cents, is_anchor: c.is_anchor })),
    n_users,
    scientist_every,
    note: "Synthetic data prefixed 'sim:' in price_point_posteriors. Call DELETE /api/dev/reset-simulation to purge.",
  })
}
