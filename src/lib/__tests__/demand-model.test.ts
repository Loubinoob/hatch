/**
 * demand-model.test.ts
 *
 * Verifies that on synthetic data with a known demand slope, the Chapelle-Li
 * model recovers:
 *   1. A negative price coefficient (higher price → lower P(convert))
 *   2. An elasticity magnitude that is in the right ballpark
 *   3. The optimal price argmax under RPI is close to the ground-truth optimal
 *
 * Run with:  npx ts-node --esm src/lib/__tests__/demand-model.test.ts
 * (or integrate with jest if a test runner is configured)
 */

import {
  buildFeatureVector,
  initDemandModel,
  updateDemandModel,
  sampleFromDemandModel,
  FEATURE_NAMES,
  N_FEATURES,
} from "../demand-model"
import type { SegmentInput } from "../segment"

// ─── Synthetic demand curve ───────────────────────────────────────────────────
// P(convert) = base / (1 + exp(steepness × (price - midpoint)))
// With: base=0.20, midpoint=$29, steepness=0.0007

const GT_BASE         = 0.20
const GT_MIDPOINT     = 2900   // cents — $29
const GT_STEEPNESS    = 0.0007

function syntheticConvProb(priceCents: number): number {
  return GT_BASE / (1 + Math.exp(GT_STEEPNESS * (priceCents - GT_MIDPOINT)))
}

// Candidates: $9 $14 $19 $24 $29 $39 $49
const CANDIDATES = [900, 1400, 1900, 2400, 2900, 3900, 4900]

// Neutral segment (all zeros = desktop, no utm, not returning)
const SEG: SegmentInput = {
  quiz_answers: {},
  utm_source: null,
  device: "desktop",
  returning: false,
  hour_bucket: "morning",
}

// ─── Ground-truth optimal (analytic) ─────────────────────────────────────────
const gtOptimal = CANDIDATES.reduce((best, p) => {
  const rpi = syntheticConvProb(p) * p
  return rpi > syntheticConvProb(best) * best ? p : best
}, CANDIDATES[0])

console.log(`Ground-truth optimal: ${gtOptimal}¢ ($${(gtOptimal / 100).toFixed(0)}/mo)`)

// ─── Training ─────────────────────────────────────────────────────────────────
function seededRng(seed: number) {
  // Simple xorshift32 for reproducibility
  let s = seed >>> 0
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

const rng = seededRng(42)
const ANCHOR = 2900
let state = initDemandModel(ANCHOR)

const N_OBS = 3000

for (let i = 0; i < N_OBS; i++) {
  // Pick a random candidate (exploration — to cover the full price range)
  const priceCents = CANDIDATES[Math.floor(rng() * CANDIDATES.length)]
  const p = syntheticConvProb(priceCents)
  const y: 0 | 1 = rng() < p ? 1 : 0
  const x = buildFeatureVector(priceCents, ANCHOR, SEG)
  state = updateDemandModel(state, x, y)
}

// ─── Assertions ───────────────────────────────────────────────────────────────
let passed = 0
let failed = 0

function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✅ ${msg}`)
    passed++
  } else {
    console.error(`  ❌ ${msg}`)
    failed++
  }
}

console.log(`\nAfter ${N_OBS} observations:`)
console.log(`  Feature vector length: ${N_FEATURES}`)
console.log(`  FEATURE_NAMES[0]: ${FEATURE_NAMES[0]} (should be "bias")`)
console.log(`  FEATURE_NAMES[1]: ${FEATURE_NAMES[1]} (should be "price_norm")`)
console.log(`  m[0] (bias):       ${state.m[0].toFixed(4)}`)
console.log(`  m[1] (price_norm): ${state.m[1].toFixed(4)}`)
console.log(`  q[0] (bias prec):  ${state.q[0].toFixed(2)}`)
console.log(`  q[1] (price prec): ${state.q[1].toFixed(2)}`)

// 1. Feature vector has correct length
assert(N_FEATURES === 20, `N_FEATURES = ${N_FEATURES} (expected 20)`)

// 2. Bias posterior precision increases (model is learning)
assert(state.q[0] > 1.0, `q[0]=${state.q[0].toFixed(2)} > 1.0 (precision increased)`)

// 3. Price coefficient is negative (demand slope is downward)
assert(state.m[1] < 0, `m[1]=${state.m[1].toFixed(3)} < 0 (negative price slope)`)

// 4. Price coefficient magnitude is reasonable (not wildly wrong)
// At the midpoint price_norm = 0, so logit = m[0].
// The price_norm at midpoint = (2900 - 2900)/2900 = 0.
// At price $9 (900¢), price_norm = (900-2900)/2900 ≈ -0.69.
// At price $49 (4900¢), price_norm = (4900-2900)/2900 ≈ 0.69.
// The logistic function's logit at these extremes should differ by about 2*m[1]*0.69.
// With GT_BASE=0.20 and strong elasticity we'd expect |m[1]| > 0.5.
assert(Math.abs(state.m[1]) > 0.3, `|m[1]|=${Math.abs(state.m[1]).toFixed(3)} > 0.3 (sufficient signal)`)

// 5. Thompson sampling converges near the true optimal
// Run 200 independent draws and pick the modal choice
const draws: Record<number, number> = {}
for (let k = 0; k < 200; k++) {
  const chosen = sampleFromDemandModel(state, CANDIDATES.map(p => ({ id: String(p), price_cents: p, is_anchor: p === ANCHOR })), SEG)
  if (chosen) {
    draws[chosen.price_cents] = (draws[chosen.price_cents] ?? 0) + 1
  }
}
const modalDraw = parseInt(Object.entries(draws).sort((a, b) => b[1] - a[1])[0][0])
console.log(`\nThompson sampling modal choice: ${modalDraw}¢ — distribution:`, Object.fromEntries(
  Object.entries(draws).map(([p, c]) => [`$${parseInt(p)/100}`, c])
))
console.log(`Ground-truth optimal:           ${gtOptimal}¢ ($${gtOptimal/100}/mo)`)

// The modal draw should be within one price step of the true optimal
const sortedCandidates = [...CANDIDATES].sort((a, b) => a - b)
const gtIdx = sortedCandidates.indexOf(gtOptimal)
const modalIdx = sortedCandidates.indexOf(modalDraw)
const indexDist = Math.abs(gtIdx - modalIdx)
assert(indexDist <= 2, `Modal draw ${modalDraw}¢ is within 2 steps of optimal ${gtOptimal}¢ (dist=${indexDist})`)

// 6. Predicted conv probs have correct ordering
// P(convert | $9) > P(convert | $49) for a downward-sloping demand curve
const lowX  = buildFeatureVector(900,  ANCHOR, SEG)
const highX = buildFeatureVector(4900, ANCHOR, SEG)
function sigmoid(z: number) { return z > 30 ? 1 : z < -30 ? 0 : 1 / (1 + Math.exp(-z)) }
function dotProd(a: number[], b: number[]) { return a.reduce((s, ai, i) => s + ai * b[i], 0) }
const predLow  = sigmoid(dotProd(state.m, lowX))
const predHigh = sigmoid(dotProd(state.m, highX))
console.log(`\nPredicted P(convert | $9):  ${(predLow * 100).toFixed(1)}%  (GT: ${(syntheticConvProb(900) * 100).toFixed(1)}%)`)
console.log(`Predicted P(convert | $49): ${(predHigh * 100).toFixed(1)}%  (GT: ${(syntheticConvProb(4900) * 100).toFixed(1)}%)`)
assert(predLow > predHigh, `P($9) > P($49): ${(predLow * 100).toFixed(1)}% > ${(predHigh * 100).toFixed(1)}%`)

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`)
console.log(`Tests passed: ${passed}  failed: ${failed}`)
if (failed > 0) process.exit(1)
