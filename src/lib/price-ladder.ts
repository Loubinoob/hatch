/**
 * Price ladder — psychological pricing.
 *
 * All dynamic price candidates MUST be snapped to this ladder.
 * Never show an arbitrary price like $16.83 to end-users.
 */

/** Monthly prices in dollars that feel natural to buyers. */
const LADDER_USD = [5, 7, 9, 12, 15, 19, 24, 29, 34, 39, 44, 49, 59, 69, 79, 89, 99, 119, 149, 199, 249, 299]

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

/**
 * Generate a spread of price candidates around an anchor price.
 * Returns 3–5 unique prices snapped to the ladder, within [floor, ceiling].
 *
 * @param anchorCents     The founder's original price (cents)
 * @param floorCents      Minimum allowed price (default: 50% of anchor)
 * @param ceilingCents    Maximum allowed price (default: 200% of anchor)
 * @returns               Array of prices in cents, always includes the anchor
 */
export function generatePriceCandidates(
  anchorCents: number,
  floorCents?: number,
  ceilingCents?: number,
): number[] {
  const floor   = floorCents   ?? Math.round(anchorCents * 0.5)
  const ceiling = ceilingCents ?? Math.round(anchorCents * 2.0)

  const anchorDollars = anchorCents / 100
  // Spread: ~-30%, anchor, ~+35%, ~+70%
  const rawCandidates = [
    anchorDollars * 0.70,
    anchorDollars,
    anchorDollars * 1.35,
    anchorDollars * 1.70,
  ]

  const snapped = rawCandidates.map(d => snapToLadder(d * 100))

  return [...new Set(snapped)]
    .filter(c => c >= floor && c <= ceiling && c > 0)
    .sort((a, b) => a - b)
}

/** Format a price in cents to a display string (e.g. 2999 → "$29.99") */
export function formatPrice(cents: number, currency = "USD"): string {
  const symbols: Record<string, string> = {
    USD: "$", EUR: "€", GBP: "£", CAD: "C$", AUD: "A$", JPY: "¥",
  }
  const sym = symbols[currency] ?? "$"
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
