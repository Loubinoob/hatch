/**
 * Price ladder — psychological pricing.
 *
 * All dynamic price candidates MUST be snapped to this ladder.
 * Never show an arbitrary price like $16.83 to end-users.
 */

/** Monthly prices in dollars that feel natural to buyers. Exported for tests + analytics. */
export const LADDER_USD = [5, 7, 9, 12, 15, 19, 24, 29, 34, 39, 44, 49, 59, 69, 79, 89, 99, 119, 149, 199, 249, 299]

/**
 * Snap a price (in cents) to the nearest ladder entry.
 * @param targetCents   Target price in cents
 * @param charm         If true, subtract 1 cent (e.g. $29 → $28.99 = 2899¢)
 * @returns             Nearest ladder price in cents
 */
export function snapToLadder(targetCents: number, charm = false): number {
  const targetDollars = targetCents / 100
  let nearest = LADDER_USD.reduce((a, b) =>
    Math.abs(b - targetDollars) < Math.abs(a - targetDollars) ? b : a
  )
  if (charm) nearest = nearest - 0.01
  return Math.round(nearest * 100)
}

// ─── B.4 — Aggressiveness ─────────────────────────────────────────────────────

/** Exploration amplitude per aggressiveness level. */
export type PricingAggressiveness = "conservative" | "balanced" | "aggressive"

/**
 * Ladder steps per aggressiveness level: [stepsDown, stepsUp].
 * Each rung is ~10-20% of the anchor, so the window stays psychologically coherent.
 *
 *  conservative  → ±1 step  → 3 candidates, e.g. $24/$29/$34
 *  balanced      → ±1 step  → 3 candidates (default)
 *  aggressive    → -1/+2    → up to 4 candidates, e.g. $24/$29/$34/$39
 *
 * Maximum window: 2 steps from anchor. No brutal price jumps.
 */
const AGGRESSIVENESS_STEPS: Record<PricingAggressiveness, [number, number]> = {
  conservative: [1, 1],
  balanced:     [1, 1],
  aggressive:   [1, 2],
}

/**
 * Generate a narrow spread of price candidates by walking the price ladder,
 * modulated by the founder's aggressiveness setting.
 *
 * All returned prices are guaranteed to be on LADDER_USD.
 * Always includes the snapped anchor as one of the candidates.
 *
 * @param anchorCents    Founder's original price (cents)
 * @param floorCents     Minimum allowed price (defaults to 50% of anchor)
 * @param ceilingCents   Maximum allowed price (defaults to 200% of anchor)
 * @param aggressiveness conservative / balanced / aggressive
 * @returns              Sorted array of prices in cents, all on ladder
 */
export function generatePriceCandidates(
  anchorCents: number,
  floorCents?: number,
  ceilingCents?: number,
  aggressiveness: PricingAggressiveness = "balanced",
): number[] {
  const snappedAnchor = snapToLadder(anchorCents)
  const anchorIdx     = LADDER_USD.indexOf(snappedAnchor / 100)

  const floor   = floorCents   ?? Math.round(anchorCents * 0.5)
  const ceiling = ceilingCents ?? Math.round(anchorCents * 2.0)

  // Anchor not on ladder (shouldn't happen) → return just the snapped anchor
  if (anchorIdx < 0) return [snappedAnchor]

  const [downSteps, upSteps] = AGGRESSIVENESS_STEPS[aggressiveness] ?? AGGRESSIVENESS_STEPS.balanced

  const candidates = new Set<number>([snappedAnchor])

  for (let step = 1; step <= downSteps; step++) {
    const idx = anchorIdx - step
    if (idx >= 0) {
      const price = LADDER_USD[idx] * 100
      if (price >= floor && price > 0) candidates.add(price)
    }
  }

  for (let step = 1; step <= upSteps; step++) {
    const idx = anchorIdx + step
    if (idx < LADDER_USD.length) {
      const price = LADDER_USD[idx] * 100
      if (price <= ceiling && price > 0) candidates.add(price)
    }
  }

  return [...candidates].sort((a, b) => a - b)
}

/**
 * Compute the hill-climbing window shift: given current candidates and the
 * dominant price (highest RPI), return add/prune actions to slide the testing
 * window one step toward the winner.
 *
 * Used by the Pricing Scientist to implement progressive exploration.
 */
export function hillClimbingActions(
  candidatePrices: number[],
  dominantPriceCents: number,
  anchorPriceCents: number,
  floorCents: number,
  ceilingCents: number,
): { action: "add" | "prune"; price_cents: number; reason: string }[] {
  const sorted = [...candidatePrices].sort((a, b) => a - b)
  const windowLow  = sorted[0]
  const windowHigh = sorted[sorted.length - 1]
  if (!windowLow || !windowHigh) return []

  const dominantIdx   = LADDER_USD.indexOf(dominantPriceCents / 100)
  const windowHighIdx = LADDER_USD.indexOf(windowHigh / 100)
  const windowLowIdx  = LADDER_USD.indexOf(windowLow / 100)
  if (dominantIdx < 0 || windowHighIdx < 0 || windowLowIdx < 0) return []

  const actions: { action: "add" | "prune"; price_cents: number; reason: string }[] = []

  if (dominantPriceCents >= windowHigh) {
    // Dominant is at the top → explore one step higher
    const nextIdx = windowHighIdx + 1
    if (nextIdx < LADDER_USD.length) {
      const next = LADDER_USD[nextIdx] * 100
      if (next <= ceilingCents) {
        actions.push({ action: "add", price_cents: next, reason: `Hill-climbing up: dominant $${Math.round(dominantPriceCents/100)} is at ceiling, testing $${Math.round(next/100)}` })
        // Prune lowest if it's not the anchor and distinct from dominant
        if (windowLow !== anchorPriceCents && windowLow !== dominantPriceCents) {
          actions.push({ action: "prune", price_cents: windowLow, reason: `Hill-climbing up: shrinking window from $${Math.round(windowLow/100)} as winner pulls higher` })
        }
      }
    }
  } else if (dominantPriceCents <= windowLow) {
    // Dominant is at the bottom → explore one step lower
    if (windowLowIdx > 0) {
      const next = LADDER_USD[windowLowIdx - 1] * 100
      if (next >= floorCents) {
        actions.push({ action: "add", price_cents: next, reason: `Hill-climbing down: dominant $${Math.round(dominantPriceCents/100)} is at floor, testing $${Math.round(next/100)}` })
        // Prune highest if it's not the anchor and distinct from dominant
        if (windowHigh !== anchorPriceCents && windowHigh !== dominantPriceCents) {
          actions.push({ action: "prune", price_cents: windowHigh, reason: `Hill-climbing down: shrinking window from $${Math.round(windowHigh/100)} as winner pulls lower` })
        }
      }
    }
  }

  return actions
}

// ─── B.5 — Progressive-move helpers ──────────────────────────────────────────

/**
 * Distance in ladder steps between two prices.
 * Returns 999 if either price is not on the ladder.
 */
export function ladderDistance(p1Cents: number, p2Cents: number): number {
  const idx1 = LADDER_USD.indexOf(p1Cents / 100)
  const idx2 = LADDER_USD.indexOf(p2Cents / 100)
  if (idx1 < 0 || idx2 < 0) return 999
  return Math.abs(idx1 - idx2)
}

/**
 * Neighbouring ladder prices within ±maxSteps of the given price.
 */
export function ladderNeighbours(priceCents: number, maxSteps = 1): number[] {
  const idx = LADDER_USD.indexOf(priceCents / 100)
  if (idx < 0) return [priceCents]
  const lo = Math.max(0, idx - maxSteps)
  const hi = Math.min(LADDER_USD.length - 1, idx + maxSteps)
  return LADDER_USD.slice(lo, hi + 1).map(d => d * 100)
}

// ─── Formatting & metrics ─────────────────────────────────────────────────────

/** Format a price in cents to a display string (e.g. 2900 → "$29") */
export function formatPrice(cents: number, currency = "USD"): string {
  const symbols: Record<string, string> = {
    USD: "$", EUR: "€", GBP: "£", CAD: "C$", AUD: "A$", JPY: "¥",
  }
  const sym   = symbols[currency] ?? "$"
  const whole = Math.floor(cents / 100)
  const frac  = cents % 100
  return frac === 0 ? `${sym}${whole}` : `${sym}${whole}.${frac.toString().padStart(2, "0")}`
}

/** Revenue per impression — the metric we maximise */
export function revenuePerImpression(
  conversions: number,
  impressions: number,
  priceCents: number,
): number {
  if (impressions === 0) return 0
  return (conversions / impressions) * priceCents
}
