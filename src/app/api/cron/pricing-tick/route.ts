import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

/*
 * GET /api/cron/pricing-tick
 *
 * Runs every 4 hours (vercel.json cron: "0 *-slash-4 * * *").
 * Triggers the Pricing Scientist for every plan with dynamic_pricing_enabled
 * that has received >= 20 new impressions since its last scientist run.
 *
 * Cost guards:
 *   - max 6 scientist runs per plan per 24h
 *   - min 20 new impressions since last run
 */

const MIN_NEW_IMPRESSIONS        = 20
const MAX_SCIENTIST_RUNS_PER_DAY = 6

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // ── 1. All plans with dynamic pricing ────────────────────────────────────
  const { data: plans } = await service
    .from("plans")
    .select("id, account_id, name")
    .eq("dynamic_pricing_enabled", true)

  if (!plans?.length) {
    return NextResponse.json({ ok: true, triggered: 0, message: "No dynamic pricing plans" })
  }

  const planIds = plans.map((p: { id: string }) => p.id)

  // ── 2. Last run timestamp per plan ────────────────────────────────────────
  const { data: latestRuns } = await service
    .from("pricing_scientist_runs")
    .select("plan_id, created_at")
    .in("plan_id", planIds)
    .order("created_at", { ascending: false })

  const lastRunByPlan: Record<string, string> = {}
  for (const run of latestRuns ?? []) {
    if (!lastRunByPlan[run.plan_id]) lastRunByPlan[run.plan_id] = run.created_at
  }

  // ── 3. Run count per plan in last 24h ─────────────────────────────────────
  const { data: recentRuns } = await service
    .from("pricing_scientist_runs")
    .select("plan_id")
    .in("plan_id", planIds)
    .gte("created_at", since24h)

  const runsByPlan: Record<string, number> = {}
  for (const run of recentRuns ?? []) {
    runsByPlan[run.plan_id] = (runsByPlan[run.plan_id] ?? 0) + 1
  }

  // ── 4. Active candidate IDs per plan ─────────────────────────────────────
  const { data: allCandidates } = await service
    .from("plan_price_candidates")
    .select("id, plan_id")
    .in("plan_id", planIds)
    .eq("is_active", true)

  const candidatesByPlan: Record<string, string[]> = {}
  for (const c of allCandidates ?? []) {
    if (!candidatesByPlan[c.plan_id]) candidatesByPlan[c.plan_id] = []
    candidatesByPlan[c.plan_id].push(c.id)
  }

  // ── Main loop ─────────────────────────────────────────────────────────────
  const triggered: string[] = []
  const skipped: { plan_id: string; reason: string }[] = []
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

  for (const plan of plans as { id: string; account_id: string; name: string }[]) {
    // Cost guard
    if ((runsByPlan[plan.id] ?? 0) >= MAX_SCIENTIST_RUNS_PER_DAY) {
      skipped.push({ plan_id: plan.id, reason: `rate_limited (${MAX_SCIENTIST_RUNS_PER_DAY}/day)` })
      continue
    }

    // Count new impressions since last run via posteriors
    const candidateIds = candidatesByPlan[plan.id] ?? []
    let newImpressions = 0

    if (candidateIds.length > 0) {
      const since = lastRunByPlan[plan.id] ?? since24h
      const { data: posts } = await service
        .from("price_point_posteriors")
        .select("impressions")
        .in("price_candidate_id", candidateIds)
        .gte("updated_at", since)
        .not("segment_hash", "like", "sim:%")

      newImpressions = (posts ?? []).reduce(
        (sum: number, p: { impressions: number }) => sum + (p.impressions ?? 0), 0
      )
    }

    if (newImpressions < MIN_NEW_IMPRESSIONS) {
      skipped.push({ plan_id: plan.id, reason: `low_traffic (${newImpressions}/${MIN_NEW_IMPRESSIONS})` })
      continue
    }

    // Trigger scientist
    try {
      const res = await fetch(`${origin}/api/pricing/scientist`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-secret": process.env.CRON_SECRET ?? "",
        },
        body: JSON.stringify({ plan_id: plan.id, account_id: plan.account_id, _cron: true }),
      })

      if (res.ok) {
        triggered.push(plan.id)
        console.log(`[pricing-tick] ✅ "${plan.name}" — ${newImpressions} new impressions`)
      } else {
        const err = await res.json().catch(() => ({}))
        skipped.push({ plan_id: plan.id, reason: `scientist_error: ${(err as { error?: string }).error ?? res.status}` })
      }
    } catch (err) {
      skipped.push({ plan_id: plan.id, reason: `fetch_error: ${err instanceof Error ? err.message : err}` })
    }
  }

  console.log(`[pricing-tick] ✅ triggered=${triggered.length} skipped=${skipped.length}`)

  return NextResponse.json({
    ok: true,
    triggered: triggered.length,
    skipped:   skipped.length,
    plan_ids_triggered: triggered,
    plan_ids_skipped:   skipped,
  })
}
