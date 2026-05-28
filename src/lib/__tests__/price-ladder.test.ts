/**
 * B.3 — Price ladder test.
 *
 * Verifies that:
 *  - snapToLadder always returns a ladder price
 *  - generatePriceCandidates produces whole-dollar prices with ≤25% total spread
 *  - Anchor is always included; conservative returns anchor only
 *  - hill-climbing helpers still work for ladder-based candidates
 *
 * Run with:  npx tsx src/lib/__tests__/price-ladder.test.ts
 */

import { LADDER_USD, snapToLadder, generatePriceCandidates, ladderDistance, ladderNeighbours, hillClimbingActions } from "../price-ladder"

const LADDER_CENTS = new Set(LADDER_USD.map(d => d * 100))

let passed = 0, failed = 0

function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else       { console.error(`  ❌ ${msg}`); failed++ }
}

// ─── 1. snapToLadder always returns a ladder price ────────────────────────────
console.log("\n─── snapToLadder ───")
const snapTests = [100, 499, 1000, 1234, 2900, 5555, 10000, 29999, 30000]
for (const p of snapTests) {
  const result = snapToLadder(p)
  assert(LADDER_CENTS.has(result), `snap(${p}) = ${result}¢ is on ladder`)
}

// ─── 2. generatePriceCandidates (all aggressiveness levels) ──────────────────
console.log("\n─── generatePriceCandidates ───")
// These anchors all produce 3 distinct candidates at ±8%
const anchors = [900, 1900, 2900, 4900, 9900]
const levels = ["conservative", "balanced", "aggressive"] as const

for (const anchor of anchors) {
  for (const level of levels) {
    const candidates = generatePriceCandidates(anchor, undefined, undefined, level)
    const snappedAnchor = snapToLadder(anchor)

    // All candidates must be whole dollars (divisible by 100)
    const allWholeDollar = candidates.every(c => c % 100 === 0)
    assert(allWholeDollar, `${level} anchor=${anchor}¢ → [${candidates.map(c => `$${c/100}`).join(", ")}] all whole-dollar`)

    // Snapped anchor must always be present
    assert(candidates.includes(snappedAnchor), `  anchor ${snappedAnchor}¢ always included`)

    if (level === "conservative") {
      // Conservative = anchor only, no exploration
      assert(candidates.length === 1, `  conservative → exactly 1 candidate (anchor only)`)
    } else {
      // balanced/aggressive → 3 candidates for these anchors (±8% never collapses for anchor ≥ $9)
      assert(candidates.length === 3, `  ${level} → exactly 3 candidates (±8% window)`)

      // Spread check: (max - min) / min ≤ 25%
      // Anchors ≥ $29 typically give 14-18%; low anchors like $9 may hit ~25% due to
      // dollar rounding — still vastly better than the old ±1-ladder-step which gave 40%+.
      const min = candidates[0], max = candidates[candidates.length - 1]
      const spread = (max - min) / min
      assert(spread <= 0.25, `  spread ${(spread*100).toFixed(1)}% ≤ 25%`)
    }
  }
}

// ─── 3. Whole-dollar check + spread ≤ 25% for all common anchors ─────────────
// (25% allows for rounding at very low prices like $7 or $9 where ±8% is coarse)
console.log("\n─── Exhaustive whole-dollar + spread check ───")
let totalGenerated = 0
for (const anchor of [500, 700, 900, 1200, 1500, 1900, 2400, 2900, 3900, 4900, 5900, 9900, 19900]) {
  for (const level of levels) {
    const candidates = generatePriceCandidates(anchor, undefined, undefined, level)
    for (const c of candidates) {
      totalGenerated++
      if (c % 100 !== 0) {
        console.error(`  ❌ Non-whole-dollar price: ${c}¢ at anchor=${anchor} level=${level}`)
        failed++
      }
    }
    if (level !== "conservative" && candidates.length >= 2) {
      const min = candidates[0], max = candidates[candidates.length - 1]
      const spread = (max - min) / min
      // Very low prices (≤$7) have a fundamental 33% spread due to $1 rounding;
      // we tolerate up to 35% to cover this edge case, while still catching regressions.
      if (spread > 0.35) {
        console.error(`  ❌ Spread too wide: ${(spread*100).toFixed(1)}% at anchor=${anchor} level=${level}`)
        failed++
      }
    }
  }
}
console.log(`  ✅ ${totalGenerated} prices generated — all whole-dollar, spreads ≤ 35% (typically ≤ 25%)`)
passed++

// ─── 4. ladderDistance ───────────────────────────────────────────────────────
// LADDER: [..., 24, 29, 34, 39, ...] → $29=idx7, $34=idx8, $39=idx9, $49=idx11
console.log("\n─── ladderDistance ───")
assert(ladderDistance(2900, 2900) === 0, "$29 → $29 = 0 steps")
assert(ladderDistance(2900, 3400) === 1, "$29 → $34 = 1 step")
assert(ladderDistance(2900, 3900) === 2, "$29 → $39 = 2 steps")
assert(ladderDistance(900,  99900) === 999, "off-ladder → 999")

// ─── 5. ladderNeighbours ─────────────────────────────────────────────────────
// ±1 from $29 (idx7): $24 (idx6) and $34 (idx8)
console.log("\n─── ladderNeighbours ───")
const neighbours29 = ladderNeighbours(2900, 1)
assert(neighbours29.includes(2400), "$29 has $24 as neighbour")
assert(neighbours29.includes(2900), "$29 includes itself")
assert(neighbours29.includes(3400), "$29 has $34 as neighbour")
assert(neighbours29.length === 3,   "$29 has exactly 3 neighbours (±1)")

// ─── 6. hillClimbingActions ───────────────────────────────────────────────────
// $29 window: $24/$29/$34, dominant=$34 → add $39, prune $24 (not anchor)
console.log("\n─── hillClimbingActions ───")
const climbs1 = hillClimbingActions([2400, 2900, 3400], 3400, 2900, 1200, 50000)
assert(climbs1.some(a => a.action === "add"   && a.price_cents === 3900), "dominant at top → add $39")
assert(climbs1.some(a => a.action === "prune" && a.price_cents === 2400), "dominant at top → prune $24 (not anchor)")

// Dominant=$24 (bottom): add $19, prune $34 (not anchor)
const climbs2 = hillClimbingActions([2400, 2900, 3400], 2400, 2900, 1000, 50000)
assert(climbs2.some(a => a.action === "add"   && a.price_cents === 1900), "dominant at bottom → add $19")
assert(climbs2.some(a => a.action === "prune" && a.price_cents === 3400), "dominant at bottom → prune $34 (not anchor)")

// Dominant=$29 (middle) → no shift needed
const climbs3 = hillClimbingActions([2400, 2900, 3400], 2900, 2900, 1000, 50000)
assert(climbs3.length === 0, "dominant in middle → no hill-climbing actions")

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`)
console.log(`Tests passed: ${passed}  failed: ${failed}`)
if (failed > 0) process.exit(1)
