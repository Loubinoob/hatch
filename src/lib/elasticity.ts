/**
 * elasticity.ts — Pure computation, no LLM.
 * Aggregates price_point_posteriors into an elasticity curve with Bayesian CI.
 * Called before every Pricing Scientist run, and persisted as price_elasticity_snapshots.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = any

export interface ElasticityPoint {
  price_cents: number
  impressions: number
  conversions: number
  conv_rate: number
  rpi_cents: number  // revenue per impression = conv_rate × price
  ci_low: number     // 95% Bayesian credible interval on conv_rate
  ci_high: number
}

export interface ElasticityResult {
  curve: ElasticityPoint[]
  optimal_price_cents: number
  optimal_rpi_cents: number
  confidence: number  // 0-1
}

// ── Bayesian 95% credible interval for Beta(alpha, beta) ─────────────────────
// Uses normal approximation (accurate when alpha+beta > 5)
function betaCI(alpha: number, beta: number): [number, number] {
  const a = Math.max(1, alpha)
  const b = Math.max(1, beta)
  const mean = a / (a + b)
  const variance = (a * b) / ((a + b) ** 2 * (a + b + 1))
  const std = Math.sqrt(variance)
  const z = 1.96
  return [Math.max(0, mean - z * std), Math.min(1, mean + z * std)]
}

// ── Compute elasticity curve for a plan ──────────────────────────────────────
export async function computeElasticity(
  supabase: Supa,
  planId: string,
  segmentHash?: string | null
): Promise<ElasticityResult | null> {
  const { data: candidates } = await supabase
    .from("plan_price_candidates")
    .select("id, price_cents, is_anchor")
    .eq("plan_id", planId)
    .eq("is_active", true)
    .eq("interval", "monthly")

  if (!candidates?.length) return null

  const candidateIds = candidates.map((c: { id: string }) => c.id)

  let query = supabase
    .from("price_point_posteriors")
    .select("price_candidate_id, alpha, beta, impressions, conversions")
    .in("price_candidate_id", candidateIds)

  if (segmentHash) {
    query = query.eq("segment_hash", segmentHash)
  }

  const { data: posteriors } = await query

  // Aggregate across all matching rows (multiple segments if no filter)
  const postMap = new Map<string, { alpha: number; beta: number; impressions: number; conversions: number }>()
  for (const p of posteriors ?? []) {
    const ex = postMap.get(p.price_candidate_id) ?? { alpha: 1, beta: 1, impressions: 0, conversions: 0 }
    postMap.set(p.price_candidate_id, {
      alpha: ex.alpha + Math.max(0, (p.alpha ?? 1) - 1),
      beta: ex.beta + Math.max(0, (p.beta ?? 1) - 1),
      impressions: ex.impressions + (p.impressions ?? 0),
      conversions: ex.conversions + (p.conversions ?? 0),
    })
  }

  const curve: ElasticityPoint[] = candidates.map((c: { id: string; price_cents: number }) => {
    const post = postMap.get(c.id) ?? { alpha: 1, beta: 1, impressions: 0, conversions: 0 }
    // Use posterior mean when no real data yet (Beta prior)
    const convRate = post.impressions > 0
      ? post.conversions / post.impressions
      : post.alpha / (post.alpha + post.beta)
    const rpiCents = convRate * c.price_cents
    const [ciLow, ciHigh] = betaCI(post.alpha, post.beta)
    return {
      price_cents: c.price_cents,
      impressions: post.impressions,
      conversions: post.conversions,
      conv_rate: convRate,
      rpi_cents: rpiCents,
      ci_low: ciLow,
      ci_high: ciHigh,
    }
  }).sort((a: ElasticityPoint, b: ElasticityPoint) => a.price_cents - b.price_cents)

  if (!curve.length) return null

  const optimal = curve.reduce(
    (best, p) => p.rpi_cents > best.rpi_cents ? p : best,
    curve[0]
  )

  // Confidence = blend of volume signal and RPI separation from second-best
  const totalImpressions = curve.reduce((s, p) => s + p.impressions, 0)
  const volumeConf = 1 - Math.exp(-totalImpressions / 100)  // asymptotic to 1

  const secondBestRpi = curve
    .filter(p => p.price_cents !== optimal.price_cents)
    .reduce((max, p) => Math.max(max, p.rpi_cents), 0)
  const separationConf = optimal.rpi_cents > 0
    ? Math.min(1, (optimal.rpi_cents - secondBestRpi) / optimal.rpi_cents)
    : 0

  const confidence = Math.round((volumeConf * 0.6 + separationConf * 0.4) * 100) / 100

  return {
    curve,
    optimal_price_cents: optimal.price_cents,
    optimal_rpi_cents: optimal.rpi_cents,
    confidence,
  }
}

// ── Persist snapshot to DB ────────────────────────────────────────────────────
export async function persistElasticity(
  supabase: Supa,
  accountId: string,
  planId: string,
  result: ElasticityResult,
  segmentHash?: string | null,
  segmentFeatures?: Record<string, unknown>
): Promise<void> {
  await supabase.from("price_elasticity_snapshots").insert({
    account_id: accountId,
    plan_id: planId,
    segment_hash: segmentHash ?? null,
    segment_features: segmentFeatures ?? {},
    curve: result.curve,
    optimal_price_cents: result.optimal_price_cents,
    optimal_rpi_cents: result.optimal_rpi_cents,
    confidence: result.confidence,
    computed_at: new Date().toISOString(),
  })
}
