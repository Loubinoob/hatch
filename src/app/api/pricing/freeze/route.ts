import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

/**
 * POST /api/pricing/freeze
 * Body: { plan_id: string, freeze?: boolean }
 *
 * Toggle-freeze dynamic pricing for a plan.
 *
 * freeze=true  (default): Set pricing_frozen=true. All users (even new ones)
 *   receive the anchor price. Bandit and scientist stop adjusting.
 *   Non-anchor candidates are deactivated.
 *
 * freeze=false: Unfreeze. Re-activate non-anchor candidates, clear flag.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const { plan_id, freeze = true } = body
  if (!plan_id) return NextResponse.json({ error: "plan_id required" }, { status: 400 })

  const { data: profile } = await supabase.from("users").select("account_id").eq("id", user.id).single()
  if (!profile) return NextResponse.json({ error: "Account not found" }, { status: 404 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  if (freeze) {
    // Set pricing_frozen = true (silent fail if column missing — migration 016 not applied yet)
    await service
      .from("plans")
      .update({ pricing_frozen: true })
      .eq("id", plan_id)
      .eq("account_id", profile.account_id)

    // Deactivate non-anchor candidates so only anchor price is served
    const { data, error } = await service
      .from("plan_price_candidates")
      .update({ is_active: false })
      .eq("plan_id", plan_id)
      .eq("account_id", profile.account_id)
      .eq("is_anchor", false)
      .select("id")

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, frozen: true, deactivated: data?.length ?? 0 })
  } else {
    // Unfreeze: clear flag and re-activate candidates
    await service
      .from("plans")
      .update({ pricing_frozen: false })
      .eq("id", plan_id)
      .eq("account_id", profile.account_id)

    const { data } = await service
      .from("plan_price_candidates")
      .update({ is_active: true })
      .eq("plan_id", plan_id)
      .eq("account_id", profile.account_id)
      .select("id")

    return NextResponse.json({ ok: true, frozen: false, reactivated: data?.length ?? 0 })
  }
}
