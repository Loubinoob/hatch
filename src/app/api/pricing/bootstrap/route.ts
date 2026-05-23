import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { generatePriceCandidates, snapToLadder } from "@/lib/price-ladder"

/**
 * POST /api/pricing/bootstrap
 * Pre-generate price candidates for a plan so they're ready before the first impression.
 * Body: { plan_id: string }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { plan_id } = await request.json()
  if (!plan_id) return NextResponse.json({ error: "plan_id required" }, { status: 400 })

  const { data: profile } = await supabase.from("users").select("account_id").eq("id", user.id).single()
  if (!profile?.account_id) return NextResponse.json({ error: "Account not found" }, { status: 404 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: plan } = await service
    .from("plans")
    .select("id, price_monthly, price_floor_cents, price_ceiling_cents, dynamic_pricing_enabled, account_id")
    .eq("id", plan_id)
    .eq("account_id", profile.account_id)
    .single()

  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

  if (!plan.dynamic_pricing_enabled) {
    return NextResponse.json({ skipped: true, reason: "dynamic_pricing_enabled is false" })
  }

  const anchorCents = plan.price_monthly ?? 0
  if (anchorCents <= 0) {
    return NextResponse.json({ skipped: true, reason: "price_monthly is 0" })
  }

  const candidates = generatePriceCandidates(
    anchorCents,
    plan.price_floor_cents ?? undefined,
    plan.price_ceiling_cents ?? undefined,
  )

  const rows = candidates.map(priceCents => ({
    plan_id:    plan.id,
    account_id: plan.account_id,
    interval:   "monthly",
    price_cents: priceCents,
    is_anchor:  priceCents === snapToLadder(anchorCents),
    is_active:  true,
  }))

  const { error } = await service
    .from("plan_price_candidates")
    .upsert(rows, { onConflict: "plan_id,interval,price_cents", ignoreDuplicates: true })

  if (error) {
    // Table may not exist in this environment — non-fatal
    console.warn("[pricing/bootstrap] upsert failed:", error.message)
    return NextResponse.json({ ok: true, created: 0, warning: error.message })
  }

  console.log(`[pricing/bootstrap] Bootstrapped ${rows.length} candidates for plan ${plan_id}`)
  return NextResponse.json({ ok: true, created: rows.length, price_cents: candidates })
}
