/**
 * price-bandit.ts — Pure price selection logic for the Thompson bandit.
 *
 * Shared between:
 *   - /api/sdk/config  (live serving)
 *   - /api/dev/simulate-pricing  (simulator)
 *
 * Two phases:
 *   WARMUP  — any candidate < WARMUP_IMPRESSIONS → pick uniformly from
 *             least-served candidates (guarantees balanced initial exploration).
 *   THOMPSON — all candidates explored → revenue-weighted Thompson sampling
 *             using a true Beta sampler (Marsaglia-Tsang).
 */

import { betaSample } from "./sampling"

export const WARMUP_IMPRESSIONS = 25

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
 *                    (or global fallback — caller's responsibility to provide
 *                    the right posteriors).
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
  // Find candidates that haven't been shown WARMUP_IMPRESSIONS times yet.
  const underThreshold = candidates.filter(
    c => (postMap.get(c.id)?.impressions ?? 0) < WARMUP_IMPRESSIONS
  )

  if (underThreshold.length > 0) {
    // Pick uniformly from the least-served candidates to maximise coverage.
    const minImpressions = Math.min(
      ...underThreshold.map(c => postMap.get(c.id)?.impressions ?? 0)
    )
    const leastServed = underThreshold.filter(
      c => (postMap.get(c.id)?.impressions ?? 0) === minImpressions
    )
    const chosen = leastServed[Math.floor(Math.random() * leastServed.length)]
    return { candidate: chosen, mode: "warmup" }
  }

  // ── Revenue-weighted Thompson sampling ───────────────────────────────────
  // E[revenue] = betaSample(alpha, beta) × price_cents
  const scored = candidates.map(c => {
    const post = postMap.get(c.id)
    const convProb = betaSample(post?.alpha ?? 1, post?.beta ?? 1)
    return { candidate: c, score: convProb * c.price_cents }
  })
  scored.sort((a, b) => b.score - a.score)
  return { candidate: scored[0].candidate, mode: "thompson" }
}
