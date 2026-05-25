/**
 * choice-model.ts — Multinomial Logit for joint paywall revenue optimisation
 *
 * Models the probability that a user chooses plan j (or no plan) given the full
 * price vector displayed on the paywall. Captures substitution effects:
 * raising Plan Pro's price can shift demand to Plan Basic or to no purchase.
 *
 * Model:
 *   utility_j  = a_j − b_j × price_norm_j
 *   P(choose j | menu) = exp(u_j) / (1 + Σ_i exp(u_i))
 *   P(no purchase)     = 1          / (1 + Σ_i exp(u_i))
 *
 *   a_j ∈ ℝ : base attractiveness (prior N(0,1))
 *   b_j ≥ 0 : price sensitivity (prior N(1,1) — price hurts conversion)
 *   price_norm_j = (p_j − anchor_j) / anchor_j
 *
 * Online Bayesian update (diagonal Gaussian, Chapelle–Li style):
 *   Each plan's (a_j, b_j) updated independently from the multinomial gradient.
 *   Cross-plan second-order terms are ignored (diagonal approximation).
 *
 * Thompson sampling → joint optimisation:
 *   Sample (a_j, b_j) ~ N(mean, 1/prec) for each plan,
 *   enumerate all price combinations (≤ 3^k combinations for k plans),
 *   serve the combination that maximises total expected revenue per impression.
 *
 * Minimum observations before activating: CHOICE_MODEL_MIN_OBS = 20
 */

/** Minimum observations before the joint optimiser overrides the per-plan bandit. */
export const CHOICE_MODEL_MIN_OBS = 20

/** Initial precision for all weight parameters (= 1/prior_variance). */
const PRIOR_PREC = 1.0

// ─── Types ────────────────────────────────────────────────────────────────────

/** Posterior parameters for one plan in the choice model. */
export interface PlanChoiceParams {
  /** Posterior mean for intercept (base attractiveness). */
  a_mean: number
  /** Posterior precision for intercept. */
  a_prec: number
  /** Posterior mean for price sensitivity (positive → higher price hurts conversion). */
  b_mean: number
  /** Posterior precision for price sensitivity. */
  b_prec: number
  /** Reference price used for normalisation (cents). */
  anchor_cents: number
}

/** Full choice model state for one paywall. Persisted to pricing_choice_models. */
export interface ChoiceModelState {
  /** Total observations (paywall impressions with known outcome). */
  n_obs: number
  /** Per-plan parameters, keyed by plan_id. */
  plan_params: Record<string, PlanChoiceParams>
}

// ─── Initialisation ──────────────────────────────────────────────────────────

export function initChoiceModel(): ChoiceModelState {
  return { n_obs: 0, plan_params: {} }
}

export function initPlanParams(anchorCents: number): PlanChoiceParams {
  return {
    a_mean:       0,          // neutral attractiveness prior
    a_prec:       PRIOR_PREC,
    b_mean:       1,          // weak prior: higher price reduces conversion
    b_prec:       PRIOR_PREC,
    anchor_cents: anchorCents,
  }
}

// ─── Numerics ─────────────────────────────────────────────────────────────────

function sigmoid(z: number): number {
  if (z >  30) return 1 - 1e-7
  if (z < -30) return 1e-7
  return 1 / (1 + Math.exp(-z))
}

function randn(): number {
  // Box-Muller transform
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function clampUtility(u: number) { return Math.max(-30, Math.min(30, u)) }

// ─── Inference ────────────────────────────────────────────────────────────────

/**
 * Compute choice probabilities using posterior mean parameters.
 * Returns P(choose j) for each plan in menuCents, plus P(no purchase).
 */
export function computeChoiceProbabilities(
  params: Record<string, PlanChoiceParams>,
  menuCents: Record<string, number>,
): { planProbs: Record<string, number>; noPurchaseProb: number } {
  const planProbs: Record<string, number> = {}
  let denom = 1  // the no-purchase option contributes 1

  for (const [planId, priceCents] of Object.entries(menuCents)) {
    const p = params[planId]
    if (!p) continue
    const priceNorm = p.anchor_cents > 0
      ? (priceCents - p.anchor_cents) / p.anchor_cents
      : 0
    const eu = Math.exp(clampUtility(p.a_mean - p.b_mean * priceNorm))
    planProbs[planId] = eu
    denom += eu
  }

  for (const id of Object.keys(planProbs)) {
    planProbs[id] = (planProbs[id] ?? 0) / denom
  }
  return { planProbs, noPurchaseProb: 1 / denom }
}

// ─── Online update ────────────────────────────────────────────────────────────

/**
 * Update the choice model with one paywall impression.
 *
 * Call this on `paywall_dismissed` (chosenId = null) and
 * `payment_success` (chosenId = plan_id that was purchased).
 *
 * @param state       Current model state (treated as immutable)
 * @param menuCents   All plan prices shown: { plan_id → price_cents }
 * @param chosenId    Which plan the user chose, or null for no purchase
 * @param anchorMap   Anchor (monthly) prices per plan (for initialising new plans)
 */
export function updateChoiceModel(
  state: ChoiceModelState,
  menuCents: Record<string, number>,
  chosenId: string | null,
  anchorMap: Record<string, number>,
): ChoiceModelState {
  const planIds = Object.keys(menuCents)
  if (planIds.length === 0) return state

  const newParams = { ...state.plan_params }

  // Initialise new plans with prior
  for (const id of planIds) {
    if (!newParams[id]) {
      newParams[id] = initPlanParams(anchorMap[id] ?? menuCents[id] ?? 0)
    }
  }

  // Compute softmax with current means
  let denom = 1
  const expUs: Record<string, number> = {}
  for (const id of planIds) {
    const p = newParams[id]!
    const priceNorm = p.anchor_cents > 0
      ? (menuCents[id]! - p.anchor_cents) / p.anchor_cents
      : 0
    const eu = Math.exp(clampUtility(p.a_mean - p.b_mean * priceNorm))
    expUs[id] = eu
    denom += eu
  }

  const probs: Record<string, number> = {}
  for (const id of planIds) {
    probs[id] = (expUs[id] ?? 0) / denom
  }

  // Diagonal Laplace update for each plan
  for (const id of planIds) {
    const p = { ...newParams[id]! }
    const priceNorm = p.anchor_cents > 0
      ? (menuCents[id]! - p.anchor_cents) / p.anchor_cents
      : 0
    const pj  = probs[id] ?? 0
    const yj  = chosenId === id ? 1 : 0
    const res = yj - pj  // residual

    // Hessian diagonal: P(j)(1 − P(j)) for a_j
    const hA = pj * (1 - pj)
    // Hessian diagonal: P(j)(1 − P(j)) × price_norm² for b_j
    const hB = hA * priceNorm * priceNorm

    p.a_prec = Math.max(PRIOR_PREC, p.a_prec + hA)
    p.b_prec = Math.max(PRIOR_PREC, p.b_prec + hB)

    p.a_mean = p.a_mean + res  / p.a_prec
    p.b_mean = p.b_mean - res * priceNorm / p.b_prec

    newParams[id] = p
  }

  return { n_obs: state.n_obs + 1, plan_params: newParams }
}

// ─── Joint optimisation via Thompson sampling ─────────────────────────────────

/**
 * Find the price vector that maximises expected total paywall revenue per impression.
 *
 * Draws one set of parameters (Thompson sample), enumerates all combinations of
 * price candidates, and returns the combination with the highest total RPI.
 *
 * @param state              Current model state
 * @param candidatesPerPlan  { plan_id → [candidate prices in cents] }
 * @returns                  { plan_id → best price in cents }, or {} if model not ready
 */
export function findBestPriceVector(
  state: ChoiceModelState,
  candidatesPerPlan: Record<string, number[]>,
): Record<string, number> {
  if (state.n_obs < CHOICE_MODEL_MIN_OBS) return {}

  const planIds = Object.keys(candidatesPerPlan).filter(id => (candidatesPerPlan[id] ?? []).length > 0)
  if (planIds.length === 0) return {}

  // Thompson sample: draw one set of params
  const sampledParams: Record<string, { a: number; b: number; anchor: number }> = {}
  for (const id of planIds) {
    const p = state.plan_params[id] ?? initPlanParams(0)
    const aStd = Math.sqrt(1 / Math.max(PRIOR_PREC, p.a_prec))
    const bStd = Math.sqrt(1 / Math.max(PRIOR_PREC, p.b_prec))
    sampledParams[id] = {
      a:      p.a_mean + aStd * randn(),
      b:      p.b_mean + bStd * randn(),
      anchor: p.anchor_cents,
    }
  }

  // Enumerate all combinations via cartesian product
  const combinations = cartesianProduct(planIds.map(id => candidatesPerPlan[id]!))

  let bestRPI = -Infinity
  let bestCombo = combinations[0] ?? []

  for (const combo of combinations) {
    // Compute utilities
    let denom = 1
    const expUs: number[] = []
    for (let i = 0; i < planIds.length; i++) {
      const id = planIds[i]!
      const sp = sampledParams[id]!
      const priceNorm = sp.anchor > 0
        ? (combo[i]! - sp.anchor) / sp.anchor
        : 0
      const eu = Math.exp(clampUtility(sp.a - sp.b * priceNorm))
      expUs.push(eu)
      denom += eu
    }

    // Total RPI = Σ P(choose j) × price_j
    let totalRPI = 0
    for (let i = 0; i < planIds.length; i++) {
      const pj = (expUs[i] ?? 0) / denom
      totalRPI += pj * (combo[i] ?? 0)
    }

    if (totalRPI > bestRPI) {
      bestRPI = totalRPI
      bestCombo = combo
    }
  }

  const result: Record<string, number> = {}
  for (let i = 0; i < planIds.length; i++) {
    result[planIds[i]!] = bestCombo[i]!
  }
  return result
}

/**
 * Compute joint vs independent revenue comparison for the /pricing dashboard.
 *
 * Independent: each plan priced to maximise P(j) × p_j in isolation (ignores substitution).
 * Joint:       price vector from findBestPriceVector (accounts for substitution).
 *
 * @returns null if model has < CHOICE_MODEL_MIN_OBS observations
 */
export function computeRevenueComparison(
  state: ChoiceModelState,
  candidatesPerPlan: Record<string, number[]>,
): { jointRpiCents: number; independentRpiCents: number } | null {
  if (state.n_obs < CHOICE_MODEL_MIN_OBS) return null

  const planIds = Object.keys(candidatesPerPlan).filter(id => (candidatesPerPlan[id] ?? []).length > 0)
  const params  = state.plan_params

  // Independent optimum: per-plan sigmoid RPI (no cross effects)
  let independentRpiCents = 0
  for (const id of planIds) {
    const p = params[id]
    if (!p) continue
    let best = 0
    for (const cents of candidatesPerPlan[id] ?? []) {
      const priceNorm = p.anchor_cents > 0 ? (cents - p.anchor_cents) / p.anchor_cents : 0
      const pConvert  = sigmoid(p.a_mean - p.b_mean * priceNorm)
      const rpi = pConvert * cents
      if (rpi > best) best = rpi
    }
    independentRpiCents += best
  }

  // Joint optimum
  const bestVec = findBestPriceVector(state, candidatesPerPlan)
  if (Object.keys(bestVec).length === 0) return null

  let denom = 1
  const expUs: number[] = []
  for (const id of planIds) {
    const p = params[id]
    if (!p) { expUs.push(0); continue }
    const cents     = bestVec[id] ?? p.anchor_cents
    const priceNorm = p.anchor_cents > 0 ? (cents - p.anchor_cents) / p.anchor_cents : 0
    const eu = Math.exp(clampUtility(p.a_mean - p.b_mean * priceNorm))
    expUs.push(eu)
    denom += eu
  }

  let jointRpiCents = 0
  for (let i = 0; i < planIds.length; i++) {
    const pj = (expUs[i] ?? 0) / denom
    jointRpiCents += pj * (bestVec[planIds[i]!] ?? 0)
  }

  return { jointRpiCents, independentRpiCents }
}

// ─── Cartesian product ────────────────────────────────────────────────────────

function cartesianProduct<T>(arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]]
  const [first, ...rest] = arrays
  const subProducts = cartesianProduct(rest)
  const result: T[][] = []
  for (const a of first ?? []) {
    for (const sub of subProducts) {
      result.push([a, ...sub])
    }
  }
  return result
}

// ─── Persistence helpers ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = any

export async function loadChoiceModel(
  supabase: Supa,
  paywallId: string,
): Promise<ChoiceModelState | null> {
  try {
    const { data, error } = await supabase
      .from("pricing_choice_models")
      .select("n_obs, plan_params")
      .eq("paywall_id", paywallId)
      .maybeSingle()
    if (error || !data) return null
    return {
      n_obs:       data.n_obs ?? 0,
      plan_params: (data.plan_params as Record<string, PlanChoiceParams>) ?? {},
    }
  } catch {
    return null
  }
}

export async function saveChoiceModel(
  supabase: Supa,
  paywallId: string,
  accountId: string,
  state: ChoiceModelState,
): Promise<void> {
  try {
    await supabase.from("pricing_choice_models").upsert(
      {
        paywall_id:  paywallId,
        account_id:  accountId,
        n_obs:       state.n_obs,
        plan_params: state.plan_params,
        updated_at:  new Date().toISOString(),
      },
      { onConflict: "paywall_id" }
    )
  } catch (err) {
    console.warn("[choice-model] save failed:", err instanceof Error ? err.message : err)
  }
}

/**
 * Load → update → save in one call. Non-fatal (silent catch).
 */
export async function onlineUpdateChoiceModel(
  supabase: Supa,
  paywallId: string,
  accountId: string,
  menuCents: Record<string, number>,
  chosenPlanId: string | null,
  anchorMap: Record<string, number>,
): Promise<void> {
  const current = (await loadChoiceModel(supabase, paywallId)) ?? initChoiceModel()
  const updated = updateChoiceModel(current, menuCents, chosenPlanId, anchorMap)
  await saveChoiceModel(supabase, paywallId, accountId, updated)
}
