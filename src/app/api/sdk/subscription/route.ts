import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

// GET /api/sdk/subscription?key=pk_xxx&userId=...
// Returns active subscription status for an end-user (called by SDK)
export async function GET(request: NextRequest) {
  const apiKey = request.nextUrl.searchParams.get("key")
  const userId = request.nextUrl.searchParams.get("userId")
  const email = request.nextUrl.searchParams.get("email")

  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  }

  if (!apiKey) return NextResponse.json({ error: "Missing API key" }, { status: 401, headers: CORS })

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: user } = await supabase.from("users").select("account_id").eq("api_key", apiKey).single()
  if (!user) return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS })

  let query = supabase
    .from("subscribers")
    .select("subscription_status, plan_id, trial_ends_at, current_period_end, plans(name, price_monthly, features)")
    .eq("account_id", user.account_id)

  if (userId) query = query.eq("external_user_id", userId)
  else if (email) query = query.eq("email", email)
  else return NextResponse.json({ subscription: null }, { headers: CORS })

  const { data: subscriber } = await query.maybeSingle()

  return NextResponse.json(
    {
      subscription: subscriber
        ? {
            status: subscriber.subscription_status,
            plan: subscriber.plans,
            trialEndsAt: subscriber.trial_ends_at,
            periodEnd: subscriber.current_period_end,
            isActive: ["active", "trialing"].includes(subscriber.subscription_status),
          }
        : null,
    },
    { headers: { ...CORS, "Cache-Control": "no-store" } }
  )
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  })
}
