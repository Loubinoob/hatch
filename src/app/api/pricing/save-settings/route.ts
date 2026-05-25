import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

/**
 * POST /api/pricing/save-settings
 * Body: { plan_id, pricing_aggressiveness?, price_floor_cents?, price_ceiling_cents? }
 *
 * Resilient update: drops unknown columns if migration 016 not yet applied.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const { plan_id, pricing_aggressiveness, price_floor_cents, price_ceiling_cents } = body
  if (!plan_id) return NextResponse.json({ error: "plan_id required" }, { status: 400 })

  const { data: profile } = await supabase.from("users").select("account_id").eq("id", user.id).single()
  if (!profile) return NextResponse.json({ error: "Account not found" }, { status: 404 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Build updates — try full payload first, drop unknown columns on error
  const fullUpdates: Record<string, unknown> = {}
  if (pricing_aggressiveness !== undefined) fullUpdates.pricing_aggressiveness = pricing_aggressiveness
  if (price_floor_cents  !== undefined) fullUpdates.price_floor_cents  = price_floor_cents
  if (price_ceiling_cents !== undefined) fullUpdates.price_ceiling_cents = price_ceiling_cents

  const dropped: string[] = []
  const updates = { ...fullUpdates }
  const COL_RE = /Could not find the '([a-zA-Z_]+)' column/i

  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await service
      .from("plans")
      .update(updates)
      .eq("id", plan_id)
      .eq("account_id", profile.account_id)

    if (!error) return NextResponse.json({ ok: true, dropped })

    const col = error.message?.match(COL_RE)?.[1]
    if (col && col in updates) {
      dropped.push(col)
      delete updates[col]
      continue
    }

    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, dropped })
}
