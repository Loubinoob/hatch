/**
 * demand-model.ts — Chapelle & Li (2011), Algorithm 3
 *
 * Online Bayesian logistic regression with a diagonal Gaussian approximation
 * to the posterior. Tracks how conversion probability changes with price for
 * each audience segment.
 *
 * Feature vector layout (positions never reorder — feature_names is authoritative):
 *   0: bias  (always 1)
 *   1: price_norm  = (price_cents - anchor_cents) / anchor_cents
 *   2-8: UTM one-hot  [organic, social, paid, email, referral, direct, other]
 *   9-11: device one-hot [mobile, tablet, (desktop is baseline)]
 *   12: is_returning  (0/1)
 *   13-19: price_norm × UTM  (interaction terms — signal for price elasticity by channel)
 *   20-21: price_norm × device  (interaction)
 *   22: price_norm × is_returning  (interaction)
 *   TOTAL: 23 features
 *
 * Posterior state per (plan_id, segment_hash):
 *   m[i] = posterior mean for weight i
 *   q[i] = posterior precision (1/variance)  — initialised to 1.0 (weak N(0,1) prior)
 *
 * Update (Algorithm 3):
 *   p  = sigmoid(m · x)
 *   q_i += x_i² · p · (1 - p)
 *   m_i += (y - p) · x_i / q_i
 *
 * Hierarchical borrowing:
 *   Segment model with n_obs < BORROW_THRESHOLD blends with the "global" model.
 *   blend_weight = n_obs / BORROW_THRESHOLD  (0 → all global, 1 → all segment)
 */

import { SegmentInput } from "./segment"
import { PriceCandidate } from "./price-bandit"

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum segment observations before we stop borrowing from the global model. */
export const BORROW_THRESHOLD = 30

/** Initial precision for all weights (= 1/prior_variance = 1/1.0 = 1.0). */
const PRIOR_PRECISION = 1.0

// ─── Feature engineering ──────────────────────────────────────────────────────

/** Canonical feature names in the exact order they appear in m_vec / q_vec. */
export const FEATURE_NAMES: string[] = [
  "bias",
  "price_norm",
  // UTM one-hot (baseline = "other")
  "utm_organic", "utm_social", "utm_paid", "utm_email", "utm_referral", "utm_direct",
  // device one-hot (baseline = "desktop")
  "dev_mobile", "dev_tablet",
  // returning
  "is_returning",
  // price × UTM interactions (price elasticity by channel)
  "px_utm_organic", "px_utm_social", "px_utm_paid",
  "px_utm_email", "px_utm_referral", "px_utm_direct",
  // price × device interactions
  "px_dev_mobile", "px_dev_tablet",
  // price × returning
  "px_returning",
]

export const N_FEATURES = FEATURE_NAMES.length // 20

function bucketUtmForDemand(utm: string | null | undefined): string {
  if (!utm) return "other"
  const s = utm.toLowerCase()
  if (["twitter", "x", "linkedin", "facebook", "instagram", "tiktok"].some(k => s.includes(k))) return "social"
  if (["google", "bing"].some(k => s.includes(k))) return "paid"
  if (s.includes("facebook_ads")) return "paid"
  if (["newsletter", "substack", "mailchimp", "email"].some(k => s.includes(k))) return "email"
  if (["referral", "partner"].some(k => s.includes(k))) return "referral"
  if (["organic", "seo"].some(k => s.includes(k))) return "organic"
  if (s === "direct" || s === "(direct)") return "direct"
  return "other"
}

/**
 * Build the feature vector x for a given (price, context) pair.
 * price_norm is clamped to [-1, 2] to prevent extreme extrapolation.
 */
export function buildFeatureVector(
  priceCents: number,
  anchorCents: number,
  seg: SegmentInput,
): number[] {
  const priceNorm = anchorCents > 0
    ? Math.max(-1, Math.min(2, (priceCents - anchorCents) / anchorCents))
    : 0

  const utm = bucketUtmForDemand(seg.utm_source)
  const dev = (seg.device ?? "desktop").toLowerCase()
  const ret = seg.returning ? 1 : 0

  // UTM one-hot (6 non-baseline categories; "other" is the baseline → all zeros)
  const uOrg = utm === "organic"  ? 1 : 0
  const uSoc = utm === "social"   ? 1 : 0
  const uPd  = utm === "paid"     ? 1 : 0
  const uEm  = utm === "email"    ? 1 : 0
  const uRef = utm === "referral" ? 1 : 0
  const uDir = utm === "direct"   ? 1 : 0

  // Device one-hot (mobile / tablet; desktop is baseline)
  const dMob = dev === "mobile" ? 1 : 0
  const dTab = dev === "tablet" ? 1 : 0

  const x = [
    1,          // bias
    priceNorm,  // price
    uOrg, uSoc, uPd, uEm, uRef, uDir,   // UTM (6)
    dMob, dTab,                           // device (2)
    ret,                                  // returning (1)
    // interactions price × UTM (6)
    priceNorm * uOrg, priceNorm * uSoc, priceNorm * uPd,
    priceNorm * uEm,  priceNorm * uRef, priceNorm * uDir,
    // interactions price × device (2)
    priceNorm * dMob, priceNorm * dTab,
    // interaction price × returning (1)
    priceNorm * ret,
  ]

  if (x.length !== N_FEATURES) {
    throw new Error(`buildFeatureVector: expected ${N_FEATURES} features, got ${x.length}`)
  }

  return x
}

// ─── Posterior state ──────────────────────────────────────────────────────────

export interface DemandModelState {
  /** Number of observations used to fit this model. */
  n_obs: number
  /** Reference price for normalisation. */
  anchor_cents: number
  /** Ordered feature names (canonical — always FEATURE_NAMES). */
  feature_names: string[]
  /** Posterior mean vector (length = N_FEATURES). */
  m: number[]
  /** Posterior precision vector (length = N_FEATURES, all > 0). */
  q: number[]
}

/** Return a freshly initialised (prior) model state. */
export function initDemandModel(anchorCents: number): DemandModelState {
  return {
    n_obs:         0,
    anchor_cents:  anchorCents,
    feature_names: FEATURE_NAMES,
    m: new Array(N_FEATURES).fill(0),
    q: new Array(N_FEATURES).fill(PRIOR_PRECISION),
  }
}

// ─── Sigmoid ──────────────────────────────────────────────────────────────────

function sigmoid(z: number): number {
  if (z >  30) return 1 - 1e-7
  if (z < -30) return 1e-7
  return 1 / (1 + Math.exp(-z))
}

function dot(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

// ─── Algorithm 3 update ───────────────────────────────────────────────────────

/**
 * Chapelle & Li 2011, Algorithm 3 — one observation update.
 *
 * @param state  Current posterior state (treated as immutable).
 * @param x      Feature vector for this observation.
 * @param y      Label: 1 = conversion, 0 = impression-without-conversion.
 * @returns New posterior state.
 */
export function updateDemandModel(
  state: DemandModelState,
  x: number[],
  y: 0 | 1,
): DemandModelState {
  const { m, q } = state
  const p = sigmoid(dot(m, x))

  const newM = [...m]
  const newQ = [...q]

  for (let i = 0; i < N_FEATURES; i++) {
    const xi = x[i]
    if (xi === 0) continue  // skip zero features (sparsity optimisation)
    newQ[i] = Math.max(PRIOR_PRECISION, newQ[i] + xi * xi * p * (1 - p))
    newM[i] = newM[i] + ((y - p) * xi) / newQ[i]
  }

  return { ...state, m: newM, q: newQ, n_obs: state.n_obs + 1 }
}

// ─── Thompson sampling from the demand model ──────────────────────────────────

/**
 * Thompson-sample a weight vector from the posterior and pick the candidate
 * that maximises expected revenue = P(convert | w, price) × price_cents.
 *
 * Returns null if the model has < 2 features initialised (safety guard).
 */
export function sampleFromDemandModel(
  state: DemandModelState,
  candidates: PriceCandidate[],
  seg: SegmentInput,
): PriceCandidate | null {
  if (!state || state.n_obs < 1 || candidates.length === 0) return null

  // Sample w_i ~ N(m_i, 1/q_i)
  const w = state.m.map((mi, i) => {
    const std = Math.sqrt(1 / Math.max(PRIOR_PRECISION, state.q[i]))
    return mi + std * randn()
  })

  // Score each candidate
  let bestCandidate: PriceCandidate | null = null
  let bestScore = -Infinity

  for (const c of candidates) {
    const x = buildFeatureVector(c.price_cents, state.anchor_cents, seg)
    const p = sigmoid(dot(w, x))
    const score = p * c.price_cents
    if (score > bestScore) {
      bestScore = score
      bestCandidate = c
    }
  }

  return bestCandidate
}

/** Box-Muller standard normal sample (self-contained copy to avoid circular deps). */
function randn(): number {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// ─── Variable importance from interaction coefficients ────────────────────────

export interface DemandVariableImportance {
  /** Variable name e.g. "utm_source", "device", "is_returning" */
  variable_name: string
  /** Absolute mean of the price-interaction coefficient (higher = more discriminating). */
  importance_score: number
  /** Human-readable note. */
  note: string
}

/**
 * Extract which context variables are most price-discriminating from the
 * interaction coefficients. Larger |m[px_X]| means price elasticity varies
 * more across values of X — a strong signal for segmentation.
 */
export function extractVariableImportance(state: DemandModelState): DemandVariableImportance[] {
  if (state.n_obs < BORROW_THRESHOLD) return []

  const interactionMap: Record<string, string[]> = {
    utm_source:   ["px_utm_organic", "px_utm_social", "px_utm_paid", "px_utm_email", "px_utm_referral", "px_utm_direct"],
    device:       ["px_dev_mobile", "px_dev_tablet"],
    is_returning: ["px_returning"],
  }

  const results: DemandVariableImportance[] = []

  for (const [variable, interactions] of Object.entries(interactionMap)) {
    const magnitudes = interactions
      .map(name => {
        const idx = FEATURE_NAMES.indexOf(name)
        return idx >= 0 ? Math.abs(state.m[idx]) : 0
      })
      .filter(v => v > 0)

    if (magnitudes.length === 0) continue

    // Mean absolute interaction coefficient as importance proxy
    const importance = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length
    const precision  = interactions
      .map(name => {
        const idx = FEATURE_NAMES.indexOf(name)
        return idx >= 0 ? state.q[idx] : PRIOR_PRECISION
      })
    const avgPrecision = precision.reduce((a, b) => a + b, 0) / precision.length

    results.push({
      variable_name:    variable,
      importance_score: Math.round(importance * 1000) / 1000,
      note: `avg_precision=${avgPrecision.toFixed(1)} n_obs=${state.n_obs}`,
    })
  }

  return results.sort((a, b) => b.importance_score - a.importance_score)
}

// ─── Price elasticity for analytics ──────────────────────────────────────────

export interface DemandCurvePoint {
  price_cents:  number
  conv_prob:    number   // posterior mean P(convert)
  conv_low:     number   // 2.5th percentile (1000 MC samples would be ideal; here normal approx)
  conv_high:    number   // 97.5th percentile
  rpi_cents:    number   // revenue per impression = conv_prob × price_cents
}

/**
 * Evaluate the posterior-mean demand curve over a grid of price points.
 * Also returns the 95% predictive interval via a linear approximation on the
 * logit scale.
 */
export function evaluateDemandCurve(
  state: DemandModelState,
  priceLadder: number[],
  seg: SegmentInput,
): DemandCurvePoint[] {
  return priceLadder.map(priceCents => {
    const x = buildFeatureVector(priceCents, state.anchor_cents, seg)
    const logit_mean = dot(state.m, x)

    // Variance of the linear predictor: Var[w·x] = x^T diag(1/q) x = sum_i x_i²/q_i
    let varLogit = 0
    for (let i = 0; i < N_FEATURES; i++) {
      varLogit += (x[i] * x[i]) / Math.max(PRIOR_PRECISION, state.q[i])
    }
    const stdLogit = Math.sqrt(varLogit)

    const conv_prob  = sigmoid(logit_mean)
    const conv_low   = sigmoid(logit_mean - 1.96 * stdLogit)
    const conv_high  = sigmoid(logit_mean + 1.96 * stdLogit)

    return {
      price_cents: priceCents,
      conv_prob,
      conv_low,
      conv_high,
      rpi_cents: conv_prob * priceCents,
    }
  })
}

// ─── Persistence helpers ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = any

export async function loadDemandModel(
  supabase: Supa,
  planId: string,
  segmentHash: string,
): Promise<DemandModelState | null> {
  try {
    const { data, error } = await supabase
      .from("pricing_demand_models")
      .select("n_obs, anchor_cents, feature_names, m_vec, q_vec")
      .eq("plan_id", planId)
      .eq("segment_hash", segmentHash)
      .maybeSingle()

    if (error || !data) return null

    // Safety: if stored feature vector length differs from current N_FEATURES
    // (e.g. after a feature set upgrade), discard and reinitialise.
    if (!Array.isArray(data.m_vec) || data.m_vec.length !== N_FEATURES) return null

    return {
      n_obs:         data.n_obs ?? 0,
      anchor_cents:  data.anchor_cents,
      feature_names: data.feature_names ?? FEATURE_NAMES,
      m:             data.m_vec,
      q:             data.q_vec,
    }
  } catch {
    return null
  }
}

export async function saveDemandModel(
  supabase: Supa,
  planId: string,
  accountId: string,
  segmentHash: string,
  state: DemandModelState,
): Promise<void> {
  try {
    await supabase.from("pricing_demand_models").upsert(
      {
        plan_id:       planId,
        account_id:    accountId,
        segment_hash:  segmentHash,
        n_obs:         state.n_obs,
        anchor_cents:  state.anchor_cents,
        feature_names: state.feature_names,
        m_vec:         state.m,
        q_vec:         state.q,
        updated_at:    new Date().toISOString(),
      },
      { onConflict: "plan_id,segment_hash" }
    )
  } catch (err) {
    // Non-fatal — table may not exist yet on older deployments
    console.warn("[demand-model] saveDemandModel failed:", err instanceof Error ? err.message : err)
  }
}

/**
 * Load, update with a new observation, and save in one atomic helper.
 * Handles the global and segment models separately (hierarchical pooling).
 *
 * @param y  1 = conversion, 0 = dismissed/no-conversion
 */
export async function onlineUpdateDemandModel(
  supabase: Supa,
  planId: string,
  accountId: string,
  priceCents: number,
  anchorCents: number,
  segmentHash: string,
  seg: SegmentInput,
  y: 0 | 1,
): Promise<void> {
  const x = buildFeatureVector(priceCents, anchorCents, seg)

  // Always update global model
  const globalState = (await loadDemandModel(supabase, planId, "global"))
    ?? initDemandModel(anchorCents)
  const updatedGlobal = updateDemandModel(globalState, x, y)
  await saveDemandModel(supabase, planId, accountId, "global", updatedGlobal)

  // Update segment-specific model if this isn't already "global"
  if (segmentHash !== "global") {
    const segState = (await loadDemandModel(supabase, planId, segmentHash))
      ?? initDemandModel(anchorCents)
    const updatedSeg = updateDemandModel(segState, x, y)
    await saveDemandModel(supabase, planId, accountId, segmentHash, updatedSeg)
  }
}

/**
 * Load the best-available model for Thompson sampling.
 * Returns a blended state if segment model has < BORROW_THRESHOLD observations.
 */
export async function loadEffectiveDemandModel(
  supabase: Supa,
  planId: string,
  segmentHash: string,
  anchorCents: number,
): Promise<DemandModelState> {
  const [segModel, globalModel] = await Promise.all([
    segmentHash !== "global" ? loadDemandModel(supabase, planId, segmentHash) : null,
    loadDemandModel(supabase, planId, "global"),
  ])

  // If no data at all, return uninformative prior
  if (!globalModel && !segModel) return initDemandModel(anchorCents)

  // If only global exists, use it
  if (!segModel) return globalModel ?? initDemandModel(anchorCents)

  // If segment has enough data, use it directly
  if (segModel.n_obs >= BORROW_THRESHOLD) return segModel

  // Hierarchical pooling: blend segment ← global
  const blendWeight = segModel.n_obs / BORROW_THRESHOLD   // 0 → 1
  const base = globalModel ?? initDemandModel(anchorCents)

  return {
    ...segModel,
    m: segModel.m.map((mi, i) => blendWeight * mi + (1 - blendWeight) * base.m[i]),
    q: segModel.q.map((qi, i) => blendWeight * qi + (1 - blendWeight) * base.q[i]),
  }
}
