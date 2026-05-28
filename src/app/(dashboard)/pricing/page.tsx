import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { redirect } from "next/navigation"
import { withPlanDefaults } from "@/lib/plan-resilience"
import { revenuePerImpression, generatePriceCandidates } from "@/lib/price-ladder"
import type { PricingAggressiveness } from "@/lib/price-ladder"
import { computeRevenueComparison } from "@/lib/choice-model"
import type { ChoiceModelState, PlanChoiceParams } from "@/lib/choice-model"
import PricingClient from "./PricingClient"

export const dynamic = "force-dynamic"

export default async function PricingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: profile } = await supabase
    .from("users")
    .select("account_id")
    .eq("id", user.id)
    .single()
  if (!profile?.account_id) redirect("/login")

  const accountId: string = profile.account_id

  // ── Stage 1: safe base columns only (guaranteed in schema v001) ──────────────
  // NEVER include optional/recent columns here — missing columns cause a PGRST
  // error that makes the whole query return null → "No plans yet" false positive.
  const { data: basePlans, error: basePlansError } = await supabase
    .from("plans")
    .select("id, name, price_monthly, price_yearly, is_active, sort_order, dynamic_pricing_enabled")
    .eq("account_id", accountId)
    .order("sort_order")

  if (basePlansError) {
    return (
      <PricingClient
        plans={[]}
        accountId={accountId}
        planData={{}}
        loadError={`Database error: ${basePlansError.message} — run: npx supabase db push`}
      />
    )
  }

  if (!basePlans?.length) {
    return <PricingClient plans={[]} accountId={accountId} planData={{}} />
  }

  // ── Stage 2: optional columns (silent fail if migration 015 not yet applied) ─
  const { data: extData } = await supabase
    .from("plans")
    .select("id, pricing_aggressiveness, price_floor_cents, price_ceiling_cents, pricing_segment_keys, pricing_frozen")
    .eq("account_id", accountId)

  const extMap = new Map((extData ?? []).map(e => [e.id as string, e]))

  const plans = basePlans.map(p =>
    withPlanDefaults({ ...p, ...(extMap.get(p.id) ?? {}) } as Record<string, unknown>)
  )

  const planIds = plans.map(p => p.id as string)

  // ── Load all pricing data in parallel ──────────────────────────────────────
  const [
    candidatesRes,
    posteriorsRes,
    elasticityRes,
    variableImportanceRes,
    scientistRunsRes,
    maturityRes,
    demandModelsRes,
  ] = await Promise.all([
    supabase
      .from("plan_price_candidates")
      .select("id, plan_id, price_cents, is_anchor, is_active, interval, generated_by, created_at")
      .in("plan_id", planIds)
      .eq("interval", "monthly")
      .order("price_cents"),

    // All segments (not just global) — aggregate in code for accurate impression counts
    supabase
      .from("price_point_posteriors")
      .select("price_candidate_id, segment_hash, impressions, conversions, revenue_cents"),

    supabase
      .from("price_elasticity_snapshots")
      .select("plan_id, curve, optimal_price_cents, optimal_rpi_cents, confidence, computed_at")
      .in("plan_id", planIds)
      .order("computed_at", { ascending: false }),

    supabase
      .from("pricing_variable_importance")
      .select("plan_id, variable_name, importance_score, optimal_price_by_value, revenue_spread_cents, evidence, computed_at")
      .in("plan_id", planIds)
      .order("importance_score", { ascending: false }),

    supabase
      .from("pricing_scientist_runs")
      .select("id, plan_id, run_type, engine, reasoning, actions, data_maturity, duration_ms, created_at, model_used, optimal_by_segment")
      .in("plan_id", planIds)
      .order("created_at", { ascending: false })
      .limit(60),

    supabase
      .from("pricing_data_maturity")
      .select("plan_id, segment_hash, total_impressions, total_conversions, maturity_score, preferred_engine, updated_at")
      .in("plan_id", planIds)
      .eq("segment_hash", "global"),

    // Full demand model data (m_vec / q_vec) for demand curve rendering
    supabase
      .from("pricing_demand_models")
      .select("plan_id, segment_hash, n_obs, anchor_cents, feature_names, m_vec, q_vec, updated_at")
      .in("plan_id", planIds)
      .eq("segment_hash", "global"),
  ])

  const candidates = candidatesRes.data ?? []
  const allPosteriors = posteriorsRes.data ?? []
  const elasticityRows = elasticityRes.data ?? []
  const viRows = variableImportanceRes.data ?? []
  const scientistRuns = scientistRunsRes.data ?? []
  const maturityRows = maturityRes.data ?? []
  const demandModels = demandModelsRes.data ?? []

  // ── Auto-cleanup: deactivate stale wide candidates in the DB ─────────────────
  // Runs on every page load using the service role (bypasses RLS).
  // Silently deactivates any candidate outside the ±8% window — no button needed.
  // Fire-and-await so the display below always reflects the clean state.
  if (candidates.length > 0) {
    const service = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    await Promise.allSettled(
      plans.map(async plan => {
        const anchorCents = plan.price_monthly as number
        if (!anchorCents) return
        const validWindow = new Set(
          generatePriceCandidates(
            anchorCents,
            (plan.price_floor_cents as number) || undefined,
            (plan.price_ceiling_cents as number) || undefined,
            ((plan.pricing_aggressiveness as string) ?? "balanced") as PricingAggressiveness,
          )
        )
        const toDeactivate = candidates.filter(
          c => c.plan_id === plan.id
            && c.is_active
            && !c.is_anchor
            && !validWindow.has(c.price_cents as number)
        )
        if (toDeactivate.length > 0) {
          console.log(`[pricing/page] Auto-deactivating ${toDeactivate.length} stale candidates for plan "${plan.name as string}"`)
          await service
            .from("plan_price_candidates")
            .update({ is_active: false })
            .in("id", toDeactivate.map(c => c.id as string))
          // Reflect the deactivation in the in-memory array so display below is immediate
          for (const c of toDeactivate) {
            (c as Record<string, unknown>).is_active = false
          }
        }
      })
    )
  }

  // ── Aggregate posteriors across all non-sim segments ─��───────────────────────
  const posteriorAgg = new Map<string, {
    impressions: number; conversions: number; revenue_cents: number
  }>()
  for (const p of allPosteriors) {
    if (typeof p.segment_hash === "string" && p.segment_hash.startsWith("sim:")) continue
    const ex = posteriorAgg.get(p.price_candidate_id) ?? { impressions: 0, conversions: 0, revenue_cents: 0 }
    posteriorAgg.set(p.price_candidate_id, {
      impressions:   ex.impressions   + (p.impressions ?? 0),
      conversions:   ex.conversions   + (p.conversions ?? 0),
      revenue_cents: ex.revenue_cents + Number(p.revenue_cents ?? 0),
    })
  }

  // ── Build per-plan data bundles ───────────────────────────────────────────────
  const planData: Record<string, unknown> = {}

  for (const plan of plans) {
    const planId = plan.id as string
    const anchorCents = plan.price_monthly as number

    // ±8% window — only display candidates within the valid testing range.
    // Even if the DB still has stale wide rows (race between page load and cleanup above),
    // this filter guarantees the UI never shows them.
    const validDisplayPrices = new Set(
      generatePriceCandidates(
        anchorCents,
        (plan.price_floor_cents as number) || undefined,
        (plan.price_ceiling_cents as number) || undefined,
        ((plan.pricing_aggressiveness as string) ?? "balanced") as PricingAggressiveness,
      )
    )

    const planCandidates = candidates
      .filter(c => c.plan_id === planId && (c.is_anchor || validDisplayPrices.has(c.price_cents as number)))
      .map(c => {
        const post = posteriorAgg.get(c.id) ?? { impressions: 0, conversions: 0, revenue_cents: 0 }
        return {
          ...c,
          impressions:   post.impressions,
          conversions:   post.conversions,
          revenue_cents: post.revenue_cents,
          rpi:           revenuePerImpression(post.conversions, post.impressions, c.price_cents),
        }
      })

    const latestElasticity = elasticityRows.find(e => e.plan_id === planId) ?? null
    const planVI           = viRows.filter(v => v.plan_id === planId).slice(0, 5)
    const planRuns         = scientistRuns.filter(r => r.plan_id === planId).slice(0, 10)
    const maturity         = maturityRows.find(m => m.plan_id === planId) ?? null
    const demandModel      = demandModels.find(d => d.plan_id === planId) ?? null

    // Incremental revenue vs all-anchor baseline
    const anchorCandidate  = planCandidates.find(c => c.is_anchor)
    const totalImpressions = planCandidates.reduce((s, c) => s + c.impressions, 0)
    const totalRevenueCents = planCandidates.reduce((s, c) => s + c.revenue_cents, 0)
    const anchorConvRate   = anchorCandidate && anchorCandidate.impressions > 0
      ? anchorCandidate.conversions / anchorCandidate.impressions : null
    const counterfactual   = anchorConvRate !== null
      ? Math.round(anchorConvRate * anchorCents * totalImpressions) : null
    const incrementalRevenueCents = counterfactual !== null ? totalRevenueCents - counterfactual : null

    // Optimal by segment from most recent scientist run that has it
    const latestRunWithSegments = planRuns.find(
      r => r.optimal_by_segment && Object.keys(r.optimal_by_segment ?? {}).length > 1
    )

    planData[planId] = {
      candidates: planCandidates,
      latestElasticity,
      variableImportance: planVI,
      scientistRuns: planRuns,
      maturity,
      demandModel,          // includes m_vec, q_vec for demand curve
      totalImpressions,
      totalRevenueCents,
      incrementalRevenueCents,
      anchorConvRate,
      optimalBySegment: latestRunWithSegments?.optimal_by_segment ?? null,
    }
  }

  // ── Load paywalls + choice models for joint revenue optimisation ────────────
  const { data: paywalls } = await supabase
    .from("paywalls")
    .select("id, name, plan_ids")
    .eq("account_id", accountId)
    .eq("status", "live")

  const paywallIds = (paywalls ?? []).map(p => p.id as string)
  const { data: choiceModelRows } = paywallIds.length > 0
    ? await supabase
        .from("pricing_choice_models")
        .select("paywall_id, n_obs, plan_params, updated_at")
        .in("paywall_id", paywallIds)
    : { data: null }

  // Pre-compute joint vs independent revenue comparison per paywall (server-side)
  const choiceModelData: Record<string, { n_obs: number; joint_rpi_cents: number; independent_rpi_cents: number; updated_at: string | null }> = {}

  for (const cm of choiceModelRows ?? []) {
    const paywall = (paywalls ?? []).find(p => p.id === cm.paywall_id)
    if (!paywall) continue

    const paywallPlanIds: string[] = Array.isArray(paywall.plan_ids) ? paywall.plan_ids : []
    const candidatesPerPlan: Record<string, number[]> = {}
    for (const planId of paywallPlanIds) {
      const planCands = candidates.filter(c => c.plan_id === planId).map(c => c.price_cents as number)
      if (planCands.length > 0) candidatesPerPlan[planId] = planCands
    }

    const state: ChoiceModelState = {
      n_obs:       cm.n_obs ?? 0,
      plan_params: (cm.plan_params as Record<string, PlanChoiceParams>) ?? {},
    }

    const comparison = computeRevenueComparison(state, candidatesPerPlan)
    choiceModelData[cm.paywall_id as string] = {
      n_obs:                cm.n_obs ?? 0,
      joint_rpi_cents:      comparison?.jointRpiCents ?? 0,
      independent_rpi_cents: comparison?.independentRpiCents ?? 0,
      updated_at:           cm.updated_at as string | null ?? null,
    }
  }

  // For paywalls that have no choice model yet, include n_obs=0 placeholder
  for (const pw of paywalls ?? []) {
    if (!choiceModelData[pw.id as string]) {
      choiceModelData[pw.id as string] = { n_obs: 0, joint_rpi_cents: 0, independent_rpi_cents: 0, updated_at: null }
    }
  }

  const paywallsForClient = (paywalls ?? []).map(p => ({
    id:       p.id as string,
    name:     p.name as string,
    plan_ids: (p.plan_ids as string[]) ?? [],
  }))

  return (
    <PricingClient
      plans={plans}
      accountId={accountId}
      planData={planData}
      paywalls={paywallsForClient}
      choiceModelData={choiceModelData}
    />
  )
}
