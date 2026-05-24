/**
 * price-bandit.ts — Pure price selection logic for the Thompson bandit.
 *
 * Shared between:
 *   - /api/sdk/config  (live serving)
 *   - /api/dev/simulate-pricing  (simulator)
 *
 * Three phases:
 *   WARMUP       — any candidate < WARMUP_MIN → pick uniformly from least-served
 *                  (guarantees balanced initial exploration).
 *   ELIMINATION  — after warmup: drop candidates whose RPI ci_high < leader's RPI ci_low.
 *                  Prevents revenue from leaking to demonstrably dominated prices.
 *   THOMPSON     — revenue-weighted Thompson sampling on survivors; conv prob capped
 *                  at betaCI hi to prevent right-tail exploitation bias.
 */

import { betaSample, betaCI } from "./sampling"
import { DemandModelState, sampleFromDemandModel } from "./demand-model"
import type { SegmentInput } from "./segment"

export const WARMUP_MIN = 15   // min impressions per candidate before elimination

export interface PriceCandidate {
  id: string
  price_cents: number
  is_anchor: boolean
  interval?: string
}

export interface PricePosterior {
  price_candidate_id: string
  alpha: number
  beta: number
  impressions: number
  conversions?: number
}

export type SelectionMode = "warmup" | "thompson"

export interface SelectionResult {
  candidate: PriceCandidate
  mode: SelectionMode
}

/**
 * Select a price candidate for the current impression.
 *
 * @param candidates  Active price candidates for the plan.
 * @param posteriors  Per-candidate posteriors for the current segment
 *                    (or global fallback — caller's responsibility).
 */
export function selectPriceCandidate(
  candidates: PriceCandidate[],
  posteriors: PricePosterior[],
): SelectionResult {
  if (candidates.length === 0) throw new Error("No candidates to select from")
  if (candidates.length === 1) return { candidate: candidates[0], mode: "thompson" }

  const postMap = new Map<string, PricePosterior>(
    posteriors.map(p => [p.price_candidate_id, p])
  )

  // ── Warmup check ─────────────────────────────────────────────────────────
  const underThreshold = candidates.filter(
    c => (postMap.get(c.id)?.impressions ?? 0) < WARMUP_MIN
  )

  if (underThreshold.length > 0) {
    const minImpressions = Math.min(
      ...underThreshold.map(c => postMap.get(c.id)?.impressions ?? 0)
    )
    const leastServed = underThreshold.filter(
      c => (postMap.get(c.id)?.impressions ?? 0) === minImpressions
    )
    const chosen = leastServed[Math.floor(Math.random() * leastServed.length)]
    return { candidate: chosen, mode: "warmup" }
  }

  // ── Adaptive elimination ──────────────────────────────────────────────────
  // Compute RPI = posteriorMean × price_cents and its 95% CI for each candidate.
  // Anchor is always kept alive regardless — the guardrail is sacred.
  const rpiStats = candidates.map(c => {
    const post = postMap.get(c.id)
    const alpha = post?.alpha ?? 1
    const beta  = post?.beta  ?? 1
    const [ciLo, ciHi] = betaCI(alpha, beta)
    const rpiLo = ciLo * c.price_cents
    const rpiHi = ciHi * c.price_cents
    return { candidate: c, rpiLo, rpiHi }
  })

  // Find leader: highest rpiHi (most optimistic)
  const leaderRpiLo = Math.max(...rpiStats.map(s => s.rpiLo))

  // Survivors: anchor always survives; others survive if their rpiHi ≥ leaderRpiLo
  const survivors = rpiStats.filter(
    s => s.candidate.is_anchor || s.rpiHi >= leaderRpiLo
  )

  // Safety: never eliminate down to zero non-anchor candidates if anchor is the only survivor
  const survivingCandidates = survivors.length >= 1
    ? survivors.map(s => s.candidate)
    : candidates  // fallback: all candidates (should never happen)

  // ── Revenue-weighted Thompson sampling on survivors ───────────────────────
  // Cap conv prob at betaCI hi to prevent right-tail exploitation bias.
  const scored = survivingCandidates.map(c => {
    const post = postMap.get(c.id)
    const alpha = post?.alpha ?? 1
    const beta  = post?.beta  ?? 1
    const [, ciHi] = betaCI(alpha, beta)
    const rawSample  = betaSample(alpha, beta)
    const convProb   = Math.min(rawSample, ciHi)   // cap at credible interval upper bound
    return { candidate: c, score: convProb * c.price_cents }
  })
  scored.sort((a, b) => b.score - a.score)
  return { candidate: scored[0].candidate, mode: "thompson" }
}

/**
 * Demand-model price selection.
 *
 * Uses the Chapelle-Li logistic-regression posterior to Thompson-sample a price.
 * Falls back to the Beta-bandit when:
 *   - No model is loaded (cold start / table not yet migrated)
 *   - Model has < 1 observations
 *   - The sampled candidate is null (safety)
 *
 * @param model       Loaded (blended) DemandModelState — or null for fallback.
 * @param candidates  Active price candidates.
 * @param posteriors  Beta posteriors (needed for the fallback path).
 * @param seg         Segment input for feature construction.
 */
export function selectPriceWithDemandModel(
  model: DemandModelState | null,
  candidates: PriceCandidate[],
  posteriors: PricePosterior[],
  seg: SegmentInput,
): SelectionResult {
  if (model && model.n_obs >= 1) {
    const chosen = sampleFromDemandModel(model, candidates, seg)
    if (chosen) {
      return { candidate: chosen, mode: "thompson" }
    }
  }
  // Fallback: classic Beta-bandit (warmup + elimination + Thompson)
  return selectPriceCandidate(candidates, posteriors)
}
