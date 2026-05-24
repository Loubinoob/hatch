import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

/**
 * GET /api/cron/pricing-tick
 * Runs daily at 3am via Vercel cron (Hobby plan: once/day max).
 * Triggers the pricing scientist for plans with enough new impressions.
 *
 * Conditions to trigger:
 * - Plan has dynamic_pricing_enabled = true
 * - At least 30 new paywall impressions since last scientist run
 * - Fewer than 5 scientist runs in the last 24h for this plan (cost guard)
 */

const MIN_NEW_IMPRESSIONS = 30
const MAX_SCIENTIST_RUNS_PER_PLAN_PER_DAY = 5

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const since6h = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // Find all plans with dynamic pricing enabled
  const { data: plans } = await service
    .from("plans")
    .select("id, account_id, name, price_monthly")
    .eq("dynamic_pricing_enabled", true)

  if (!plans?.length) {
    return NextResponse.json({ ok: true, triggered: 0, message: "No dynamic pricing plans" })
  }

  const planIds = plans.map((p: { id: string }) => p.id)

  // Count new paywall impressions per plan in last 6h
  // paywall_impressions has plan_id (via paywall → plan relationship)
  // We use price_point_posteriors updates as a proxy for impressions
  // Simpler: check price_point_posteriors.updated_at or use events table
  // Use events table with event_type = 'paywall_shown' as source of truth
  const { data: recentImpressions } = await service
    .from("events")
    .select("account_id")
    .eq("event_type", "paywall_shown")
    .gte("created_at", since6h)

  // Map account → impression count
  const impressionsByAccount: Record<string, number> = {}
  for (const ev of recentImpressions ?? []) {
    if (!ev.account_id) continue
    impressionsByAccount[ev.account_id] = (impressionsByAccount[ev.account_id] ?? 0) + 1
  }

  // Check scientist runs in last 24h per plan
  const { data: recentRuns } = await service
    .from("pricing_scientist_runs")
    .select("plan_id")
    .in("plan_id", planIds)
    .gte("created_at", since24h)

  const runsByPlan: Record<string, number> = {}
  for (const run of recentRuns ?? []) {
    runsByPlan[run.plan_id] = (runsByPlan[run.plan_id] ?? 0) + 1
  }

  const triggered: string[] = []
  const skipped: { plan_id: string; reason: string }[] = []
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? ""

  for (const plan of plans as { id: string; account_id: string; name: string }[]) {
    // Cost guard
    if ((runsByPlan[plan.id] ?? 0) >= MAX_SCIENTIST_RUNS_PER_PLAN_PER_DAY) {
      skipped.push({ plan_id: plan.id, reason: "rate_limited (5 runs/day)" })
      continue
    }

    // Check if enough impressions for this account
    const accountImpressions = impressionsByAccount[plan.account_id] ?? 0
    if (accountImpressions < MIN_NEW_IMPRESSIONS) {
      skipped.push({ plan_id: plan.id, reason: `insufficient_impressions (${accountImpressions} < ${MIN_NEW_IMPRESSIONS})` })
      continue
    }

    // Trigger scientist for this plan
    try {
      const res = await fetch(`${origin}/api/pricing/scientist`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-secret": process.env.CRON_SECRET ?? "",
        },
        body: JSON.stringify({
          plan_id: plan.id,
          account_id: plan.account_id,
          _cron: true,
        }),
      })

      if (res.ok) {
        triggered.push(plan.id)
        console.log(`[pricing-tick] ✅ Triggered scientist for plan ${plan.id} (${plan.name})`)
      } else {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        skipped.push({ plan_id: plan.id, reason: `scientist_error: ${err.error ?? res.status}` })
        console.warn(`[pricing-tick] ❌ Scientist failed for plan ${plan.id}: ${err.error ?? res.status}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      skipped.push({ plan_id: plan.id, reason: `fetch_error: ${msg}` })
      console.warn(`[pricing-tick] ❌ fetch error for plan ${plan.id}: ${msg}`)
    }
  }

  console.log(`[pricing-tick] ✅ Done — triggered=${triggered.length} skipped=${skipped.length}`)

  return NextResponse.json({
    ok: true,
    triggered: triggered.length,
    skipped: skipped.length,
    plan_ids_triggered: triggered,
    plan_ids_skipped: skipped,
  })
}
