/**
 * sampling.ts — Statistically correct samplers for Thompson sampling.
 *
 * betaSample(alpha, beta) uses Marsaglia-Tsang Gamma via Box-Muller.
 * Valid for alpha, beta >= 1 (always the case here since we clamp to max(1, …)).
 *
 * Replace the normal-approximation betaSample that was inlined in config/route.ts
 * and elasticity.ts — import from here instead.
 */

/** Box-Muller standard normal sample */
function randn(): number {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/**
 * Marsaglia-Tsang Gamma(shape, 1) sampler.
 * Requires shape >= 1 (guaranteed when caller clamps alpha/beta to max(1, …)).
 */
function gammaSample(shape: number): number {
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  while (true) {
    let x: number, v: number
    do {
      x = randn()
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = Math.random()
    if (u < 1 - 0.0331 * x * x * x * x) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

/**
 * True Beta(alpha, beta) sample via two Gamma draws.
 * Replaces the normal approximation — unbiased for any alpha/beta >= 1.
 */
export function betaSample(alpha: number, beta: number): number {
  const a = Math.max(1, alpha)
  const b = Math.max(1, beta)
  const x = gammaSample(a)
  const y = gammaSample(b)
  return x / (x + y)
}
