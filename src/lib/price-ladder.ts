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

const AGGRESSIVENESS_MULTIPLIERS: Record<PricingAggressiveness, number[]> = {
  // conservative: ±10% around anchor — minimal variance, safest
  conservative: [0.90, 1.0, 1.10],
  // balanced: -15% to +30% — default, healthy exploration without shock
  balanced:     [0.85, 1.0, 1.15, 1.30],
  // aggressive: -30% to +45% — fast learning, more price variance
  aggressive:   [0.70, 0.85, 1.0, 1.20, 1.45],
}

/**
 * Generate a spread of price candidates around an anchor price,
 * modulated by the founder's aggressiveness setting.
 *
 * @param anchorCents       Founder's original price (cents)
 * @param aggressiveness    Conservative / balanced / aggressive
 * @param floorCents        Minimum allowed price
 * @param ceilingCents      Maximum allowed price
 * @returns                 Array of prices in cents (always includes snapped anchor)
 */
export function generatePriceCandidates(
  anchorCents: number,
  floorCents?: number,
  ceilingCents?: number,
  aggressiveness: PricingAggressiveness = "balanced",
): number[] {
  const floor   = floorCents   ?? Math.round(anchorCents * 0.5)
  const ceiling = ceilingCents ?? Math.round(anchorCents * 2.0)

  const multipliers = AGGRESSIVENESS_MULTIPLIERS[aggressiveness] ?? AGGRESSIVENESS_MULTIPLIERS.balanced
  const snappedAnchor = snapToLadder(anchorCents)

  // Generate raw candidates at each multiplier, snap each to ladder
  const rawSet = multipliers.map(m => snapToLadder(Math.round(anchorCents * m)))

  // Always include the snapped anchor
  rawSet.push(snappedAnchor)

  return [...new Set(rawSet)]
    .filter(c => c >= floor && c <= ceiling && c > 0)
    .sort((a, b) => a - b)
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
