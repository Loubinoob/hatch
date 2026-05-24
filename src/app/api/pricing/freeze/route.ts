import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * POST /api/pricing/freeze
 * Body: { plan_id: string }
 *
 * Pauses all exploration by deactivating every non-anchor price candidate.
 * The plan continues serving — only the anchor price is shown until unfrozen
 * (re-enable dynamic pricing or add candidates manually).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { plan_id } = await request.json()
  if (!plan_id) return NextResponse.json({ error: "plan_id required" }, { status: 400 })

  // Verify ownership
  const { data: profile } = await supabase.from("users").select("account_id").eq("id", user.id).single()
  if (!profile) return NextResponse.json({ error: "Account not found" }, { status: 404 })

  // Deactivate non-anchor candidates
  const { data, error } = await supabase
    .from("plan_price_candidates")
    .update({ is_active: false })
    .eq("plan_id", plan_id)
    .eq("account_id", profile.account_id)
    .eq("is_anchor", false)
    .select("id")

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, deactivated: data?.length ?? 0 })
}
