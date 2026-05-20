import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "x-hatch-key",
}

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-hatch-key") ?? request.nextUrl.searchParams.get("key")
  const paywallId = request.nextUrl.searchParams.get("paywall")

  if (!apiKey) {
    return NextResponse.json({ error: "Missing API key" }, { status: 401 })
  }

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: user } = await supabase.from("users").select("account_id").eq("api_key", apiKey).single()
  if (!user) return NextResponse.json({ error: "Invalid API key" }, { status: 401 })

  if (paywallId) {
    const { data: paywall } = await supabase
      .from("paywalls")
      .select("*, plans(*)")
      .eq("account_id", user.account_id)
      .eq("status", "live")
      .eq("id", paywallId)
      .single()
    return NextResponse.json({ paywall: paywall ?? null }, { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=30" } })
  }

  const { data: paywalls } = await supabase
    .from("paywalls")
    .select("*, plans(*)")
    .eq("account_id", user.account_id)
    .eq("status", "live")
    .order("conversions", { ascending: false })

  return NextResponse.json(
    { paywalls: paywalls ?? [] },
    { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=30" } }
  )
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS })
}
