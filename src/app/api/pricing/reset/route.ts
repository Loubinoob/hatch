import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

/**
 * POST /api/pricing/reset
 * Body: { plan_id: string }
 *
 * Full reset: deletes all non-anchor candidates + wipes posteriors (including anchor's).
 * The pricing engine bootstraps fresh candidates on the next cron run or cold-start call.
 * Use when the price anchor has changed significantly.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { plan_id } = await request.json()
  if (!plan_id) return NextResponse.json({ error: "plan_id required" }, { status: 400 })

  const { data: profile } = await supabase.from("users").select("account_id").eq("id", user.id).single()
  if (!profile) return NextResponse.json({ error: "Account not found" }, { status: 404 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // 1. Get all candidates for this plan
  const { data: candidates } = await service
    .from("plan_price_candidates")
    .select("id, is_anchor")
    .eq("plan_id", plan_id)
    .eq("account_id", profile.account_id)

  if (!candidates?.length) return NextResponse.json({ ok: true, deleted: 0 })

  const anchorIds = candidates.filter(c => c.is_anchor).map(c => c.id)
  const nonAnchorIds = candidates.filter(c => !c.is_anchor).map(c => c.id)

  // 2. Reset anchor posteriors (keep candidate, wipe posterior stats)
  if (anchorIds.length > 0) {
    await service
      .from("price_point_posteriors")
      .update({ alpha: 1, beta: 1, impressions: 0, conversions: 0, revenue_cents: 0 })
      .in("price_candidate_id", anchorIds)
  }

  // 3. Delete non-anchor candidates (posteriors cascade)
  if (nonAnchorIds.length > 0) {
    await service
      .from("plan_price_candidates")
      .delete()
      .in("id", nonAnchorIds)
  }

  // 4. Reset demand model observations for this plan
  await service
    .from("pricing_demand_models")
    .update({ n_obs: 0, m_vec: [], q_vec: [] })
    .eq("plan_id", plan_id)
    .eq("account_id", profile.account_id)

  return NextResponse.json({ ok: true, deleted: nonAnchorIds.length, anchor_reset: anchorIds.length })
}
