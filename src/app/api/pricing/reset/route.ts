import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { generatePriceCandidates, snapToLadder } from "@/lib/price-ladder"
import type { PricingAggressiveness } from "@/lib/price-ladder"

/**
 * POST /api/pricing/reset
 * Body: { plan_id: string }
 *
 * Full reset: deletes all non-anchor candidates + wipes posteriors (including anchor's).
 * Regenerates a fresh narrow candidate window from the anchor using the plan's
 * current aggressiveness setting.
 * Also clears pricing_frozen so exploration resumes.
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

  // Load plan (safe base columns only)
  const { data: plan } = await service
    .from("plans")
    .select("id, price_monthly, price_floor_cents, price_ceiling_cents")
    .eq("id", plan_id)
    .eq("account_id", profile.account_id)
    .single()

  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

  // Load optional aggressiveness (silent fail)
  const { data: planExt } = await service
    .from("plans")
    .select("pricing_aggressiveness")
    .eq("id", plan_id)
    .maybeSingle()
  const aggressiveness: PricingAggressiveness = (planExt?.pricing_aggressiveness as PricingAggressiveness) ?? "balanced"

  // 1. Get all candidates for this plan
  const { data: candidates } = await service
    .from("plan_price_candidates")
    .select("id, is_anchor, price_cents")
    .eq("plan_id", plan_id)
    .eq("account_id", profile.account_id)

  const anchorIds    = (candidates ?? []).filter(c => c.is_anchor).map(c => c.id)
  const nonAnchorIds = (candidates ?? []).filter(c => !c.is_anchor).map(c => c.id)

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

  // 5. Clear pricing_frozen flag (silent fail if column missing)
  await service
    .from("plans")
    .update({ pricing_frozen: false })
    .eq("id", plan_id)
    .eq("account_id", profile.account_id)

  // 6. Regenerate fresh narrow candidate window from the anchor
  const anchorCents = plan.price_monthly ?? 0
  if (anchorCents > 0) {
    const floorCents  = plan.price_floor_cents  ? snapToLadder(plan.price_floor_cents)  : undefined
    const ceilCents   = plan.price_ceiling_cents ? snapToLadder(plan.price_ceiling_cents) : undefined
    const newCandidates = generatePriceCandidates(anchorCents, floorCents, ceilCents, aggressiveness)
    const snappedAnchor = snapToLadder(anchorCents)

    await service.from("plan_price_candidates").upsert(
      newCandidates.map(c => ({
        plan_id,
        account_id: profile.account_id,
        interval:   "monthly",
        price_cents: c,
        is_anchor:  c === snappedAnchor,
        is_active:  true,
        generated_by: "ai",
      })),
      { onConflict: "plan_id,interval,price_cents", ignoreDuplicates: true }
    )
    console.log(`[pricing/reset] Regenerated ${newCandidates.length} candidates for plan ${plan_id}`)
  }

  return NextResponse.json({
    ok: true,
    deleted: nonAnchorIds.length,
    anchor_reset: anchorIds.length,
    regenerated: true,
  })
}
