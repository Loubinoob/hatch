import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { withPlanDefaults } from "@/lib/plan-resilience"
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

  // Load all plans
  const { data: rawPlans } = await supabase
    .from("plans")
    .select("id, name, price_monthly, price_yearly, dynamic_pricing_enabled, pricing_aggressiveness, price_floor_cents, price_ceiling_cents, pricing_segment_keys, is_active")
    .eq("account_id", accountId)
    .order("sort_order")

  const plans = (rawPlans ?? []).map(p => withPlanDefaults(p as Record<string, unknown>))

  if (plans.length === 0) {
    return <PricingClient plans={[]} accountId={accountId} planData={{}} />
  }

  const planIds = plans.map((p: Record<string, unknown>) => p.id as string)

  // Load all data in parallel
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

    supabase
      .from("price_point_posteriors")
      .select("price_candidate_id, segment_hash, alpha, beta, impressions, conversions, revenue_cents, updated_at")
      .eq("segment_hash", "global"),

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
      .select("id, plan_id, run_type, engine, reasoning, actions, data_maturity, duration_ms, created_at")
      .in("plan_id", planIds)
      .order("created_at", { ascending: false })
      .limit(50),

    supabase
      .from("pricing_data_maturity")
      .select("plan_id, segment_hash, total_impressions, total_conversions, maturity_score, preferred_engine, updated_at")
      .in("plan_id", planIds)
      .eq("segment_hash", "global"),

    supabase
      .from("pricing_demand_models")
      .select("plan_id, segment_hash, n_obs, anchor_cents, updated_at")
      .in("plan_id", planIds)
      .eq("segment_hash", "global"),
  ])

  const candidates = candidatesRes.data ?? []
  const posteriors = posteriorsRes.data ?? []
  const elasticityRows = elasticityRes.data ?? []
  const viRows = variableImportanceRes.data ?? []
  const scientistRuns = scientistRunsRes.data ?? []
  const maturityRows = maturityRes.data ?? []
  const demandModels = demandModelsRes.data ?? []

  // Build posterior map keyed by price_candidate_id
  const posteriorMap = new Map(posteriors.map(p => [p.price_candidate_id, p]))

  // Build per-plan data
  const planData: Record<string, unknown> = {}

  for (const plan of plans) {
    const planId = plan.id as string
    const anchorCents = plan.price_monthly as number

    const planCandidates = candidates
      .filter(c => c.plan_id === planId)
      .map(c => ({
        ...c,
        posterior: posteriorMap.get(c.id) ?? null,
      }))

    // Latest elasticity snapshot for this plan
    const latestElasticity = elasticityRows.find(e => e.plan_id === planId) ?? null

    // Top variable importance entries for this plan
    const planVI = viRows.filter(v => v.plan_id === planId).slice(0, 5)

    // Scientist runs for this plan
    const planRuns = scientistRuns.filter(r => r.plan_id === planId).slice(0, 10)

    // Maturity
    const maturity = maturityRows.find(m => m.plan_id === planId) ?? null

    // Demand model
    const demandModel = demandModels.find(d => d.plan_id === planId) ?? null

    // Incremental revenue calculation
    const anchorCandidate = planCandidates.find(c => c.is_anchor)
    const anchorPost = anchorCandidate?.posterior
    const totalImpressions = planCandidates.reduce((s, c) => s + (c.posterior?.impressions ?? 0), 0)
    const totalRevenueCents = planCandidates.reduce((s, c) => s + Number(c.posterior?.revenue_cents ?? 0), 0)
    const anchorConvRate = anchorPost && anchorPost.impressions > 0
      ? anchorPost.conversions / anchorPost.impressions
      : null
    const counterfactualRevenue = anchorConvRate !== null
      ? Math.round(anchorConvRate * anchorCents * totalImpressions)
      : null
    const incrementalRevenueCents = counterfactualRevenue !== null
      ? totalRevenueCents - counterfactualRevenue
      : null

    planData[planId] = {
      candidates: planCandidates,
      latestElasticity,
      variableImportance: planVI,
      scientistRuns: planRuns,
      maturity,
      demandModel,
      totalImpressions,
      totalRevenueCents,
      incrementalRevenueCents,
      anchorConvRate,
    }
  }

  return (
    <PricingClient
      plans={plans as Record<string, unknown>[]}
      accountId={accountId}
      planData={planData}
    />
  )
}
