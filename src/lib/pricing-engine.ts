/**
 * pricing-engine.ts — Common interface + maturity gating.
 *
 * Exposes runPricingScientist() which routes to Claude or the in-house model
 * based on data maturity. Swapping engines requires no changes to callers.
 *
 * Maturity sigmoid: reaches MATURITY_THRESHOLD (~0.6) at ~100 conversions + 4 distinct prices.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = any

export type { PricingDecision } from "./inhouse-pricing-model"
export const MATURITY_THRESHOLD = 0.6

// ── Maturity score formula ────────────────────────────────────────────────────
// convScore: sigmoid on conversions, centred at 100, scale 50
// priceScore: linear, saturates at 4 distinct prices
// maturity = 0.7 × convScore + 0.3 × priceScore
export function computeMaturityScore(
  totalImpressions: number,
  totalConversions: number,
  distinctPricesTested: number
): number {
  void totalImpressions  // available for future use
  const convScore = 1 / (1 + Math.exp(-(totalConversions - 100) / 50))
  const priceScore = Math.min(1, distinctPricesTested / 4)
  return convScore * 0.7 + priceScore * 0.3
}

// ── Update pricing_data_maturity for a plan ───────────────────────────────────
export async function updateDataMaturity(
  supabase: Supa,
  planId: string,
  segmentHash = "global"
): Promise<{ maturityScore: number; engine: "claude" | "in_house_model" }> {
  // Load all candidates for this plan
  const { data: candidates } = await supabase
    .from("plan_price_candidates")
    .select("id")
    .eq("plan_id", planId)
    .eq("is_active", true)

  const candidateIds = (candidates ?? []).map((c: { id: string }) => c.id)
  let totalImpressions = 0
  let totalConversions = 0
  const distinctCandidates = new Set<string>()

  if (candidateIds.length > 0) {
    let query = supabase
      .from("price_point_posteriors")
      .select("price_candidate_id, impressions, conversions")
      .in("price_candidate_id", candidateIds)

    if (segmentHash !== "global") {
      query = query.eq("segment_hash", segmentHash)
    }

    const { data: posteriors } = await query
    for (const p of posteriors ?? []) {
      totalImpressions += p.impressions ?? 0
      totalConversions += p.conversions ?? 0
      if ((p.impressions ?? 0) > 0) distinctCandidates.add(p.price_candidate_id)
    }
  }

  const maturityScore = computeMaturityScore(totalImpressions, totalConversions, distinctCandidates.size)
  const engine: "claude" | "in_house_model" = maturityScore >= MATURITY_THRESHOLD ? "in_house_model" : "claude"

  await supabase.from("pricing_data_maturity").upsert({
    plan_id: planId,
    segment_hash: segmentHash,
    total_impressions: totalImpressions,
    total_conversions: totalConversions,
    distinct_prices_tested: distinctCandidates.size,
    maturity_score: maturityScore,
    preferred_engine: engine,
    updated_at: new Date().toISOString(),
  }, { onConflict: "plan_id,segment_hash" })

  return { maturityScore, engine }
}
