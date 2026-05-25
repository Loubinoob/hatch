import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { generatePriceCandidates, snapToLadder, ladderDistance } from "@/lib/price-ladder"

/**
 * POST /api/pricing/regenerate-candidates
 * Body: { plan_id?: string }   — omit to regenerate ALL plans for the account
 *
 * Narrows the active candidate window to ±1 ladder step from the anchor.
 * Preserves all existing posteriors (unlike /reset which wipes them).
 * Deactivates any candidates outside the ±1 window; inserts missing ±1 candidates.
 *
 * Use after updating generatePriceCandidates to fix stale wide windows in the DB.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: profile } = await supabase
    .from("users")
    .select("account_id")
    .eq("id", user.id)
    .single()
  if (!profile) return NextResponse.json({ error: "Account not found" }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const { plan_id } = body as { plan_id?: string }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Load plans to regenerate
  let plansQuery = service
    .from("plans")
    .select("id, name, price_monthly, price_floor_cents, price_ceiling_cents, dynamic_pricing_enabled")
    .eq("account_id", profile.account_id)

  if (plan_id) plansQuery = plansQuery.eq("id", plan_id)

  const { data: plans, error: plansErr } = await plansQuery
  if (plansErr) return NextResponse.json({ error: plansErr.message }, { status: 500 })
  if (!plans?.length) return NextResponse.json({ error: "No plans found" }, { status: 404 })

  let totalDeactivated = 0
  let totalAdded = 0
  const results: { plan_id: string; name: string; deactivated: number; added: number }[] = []

  for (const plan of plans) {
    if (!plan.dynamic_pricing_enabled) continue

    const anchorCents = plan.price_monthly ?? 0
    if (anchorCents <= 0) continue

    const snappedAnchor = snapToLadder(anchorCents)
    const floorCents   = plan.price_floor_cents  ? snapToLadder(plan.price_floor_cents)  : undefined
    const ceilCents    = plan.price_ceiling_cents ? snapToLadder(plan.price_ceiling_cents) : undefined

    // Compute strict ±1 window (always use "balanced" = [1,1])
    const validWindow = new Set(
      generatePriceCandidates(anchorCents, floorCents, ceilCents, "balanced")
    )

    // Fetch all existing active candidates
    const { data: existing } = await service
      .from("plan_price_candidates")
      .select("id, price_cents, is_anchor, is_active")
      .eq("plan_id", plan.id)
      .eq("account_id", profile.account_id)
      .eq("interval", "monthly")

    const existingActive = (existing ?? []).filter(c => c.is_active)
    const existingCents  = new Map((existing ?? []).map(c => [c.price_cents as number, c]))

    // 1. Deactivate candidates outside ±1 step (but never deactivate anchor)
    const toDeactivate = existingActive.filter(c => {
      if (c.is_anchor || c.price_cents === snappedAnchor) return false
      return !validWindow.has(c.price_cents) || ladderDistance(c.price_cents, snappedAnchor) > 1
    })

    if (toDeactivate.length > 0) {
      await service
        .from("plan_price_candidates")
        .update({ is_active: false })
        .in("id", toDeactivate.map(c => c.id))
      totalDeactivated += toDeactivate.length
    }

    // 2. Insert/activate ±1 window candidates that are missing or inactive
    const toUpsert = [...validWindow]
      .filter(price => {
        const existing = existingCents.get(price)
        return !existing || !existing.is_active
      })
      .map(price => ({
        plan_id:      plan.id,
        account_id:   profile.account_id,
        interval:     "monthly" as const,
        price_cents:  price,
        is_anchor:    price === snappedAnchor,
        is_active:    true,
        generated_by: "ai",
      }))

    if (toUpsert.length > 0) {
      const { error } = await service
        .from("plan_price_candidates")
        .upsert(toUpsert, { onConflict: "plan_id,interval,price_cents", ignoreDuplicates: false })
      if (!error) totalAdded += toUpsert.length
    }

    // Re-activate any previously deactivated ±1 window candidates
    const toReactivate = [...validWindow]
      .filter(price => {
        const c = existingCents.get(price)
        return c && !c.is_active
      })
    if (toReactivate.length > 0) {
      await service
        .from("plan_price_candidates")
        .update({ is_active: true })
        .eq("plan_id", plan.id)
        .in("price_cents", toReactivate)
    }

    const planDeactivated = toDeactivate.length
    const planAdded       = toUpsert.length
    results.push({ plan_id: plan.id, name: plan.name ?? "", deactivated: planDeactivated, added: planAdded })
    console.log(
      `[regenerate-candidates] plan="${plan.name}" anchor=$${snappedAnchor/100} ` +
      `window=[${[...validWindow].map(p => `$${p/100}`).join("/")}] ` +
      `deactivated=${planDeactivated} added=${planAdded}`
    )
  }

  return NextResponse.json({
    ok: true,
    plans_processed: results.length,
    total_deactivated: totalDeactivated,
    total_added: totalAdded,
    results,
  })
}
