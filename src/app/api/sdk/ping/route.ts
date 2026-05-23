import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

// Lightweight diagnostic endpoint — called by the SDK on init() to verify
// that the API key is valid and events are being received.
export async function GET(request: NextRequest) {
  const apiKey = request.nextUrl.searchParams.get("key")
  if (!apiKey) {
    return NextResponse.json({ valid: false, error: "Missing key" }, { status: 400, headers: CORS_HEADERS })
  }

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: user } = await supabase
    .from("users")
    .select("account_id, accounts(app_name)")
    .eq("api_key", apiKey)
    .single()

  if (!user) {
    return NextResponse.json({ valid: false, error: "Invalid API key" }, { status: 200, headers: CORS_HEADERS })
  }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [{ count: events24h }, { count: views24h }, { data: lastEvent }] = await Promise.all([
    supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("account_id", user.account_id)
      .gte("created_at", since24h),
    supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("account_id", user.account_id)
      .eq("event_type", "paywall_shown")
      .gte("created_at", since24h),
    supabase
      .from("events")
      .select("event_type, created_at")
      .eq("account_id", user.account_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const appName = (user.accounts as any)?.app_name ?? null

  // Extract project ref from Supabase URL for cross-env comparison
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  const dbRef = supabaseUrl.match(/https?:\/\/([^.]+)\.supabase/)?.[1] ?? "unknown"

  return NextResponse.json(
    {
      valid: true,
      account: appName,
      account_id: user.account_id,
      db_ref: dbRef,
      events_24h: events24h ?? 0,
      views_24h: views24h ?? 0,
      last_event_type: lastEvent?.event_type ?? null,
      last_event_at: lastEvent?.created_at ?? null,
    },
    { headers: CORS_HEADERS }
  )
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS })
}
