import { NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

// Use service client so heartbeat works without user auth session
function getSupabase() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS })
}

export async function POST(request: Request) {
  try {
    const { api_key } = await request.json()
    if (!api_key) {
      return NextResponse.json({ error: "api_key is required" }, { status: 400, headers: CORS })
    }

    const supabase = getSupabase()
    const { data: user } = await supabase
      .from("users")
      .select("account_id")
      .eq("api_key", api_key)
      .single()

    if (!user?.account_id) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS })
    }

    await supabase
      .from("accounts")
      .update({ last_heartbeat_at: new Date().toISOString() })
      .eq("id", user.account_id)

    return NextResponse.json({ ok: true }, { headers: CORS })
  } catch (err) {
    console.error("SDK heartbeat error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS })
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const api_key = searchParams.get("api_key")

  if (!api_key) {
    return NextResponse.json({ error: "api_key is required" }, { status: 400, headers: CORS })
  }

  const supabase = getSupabase()
  const { data: user } = await supabase
    .from("users")
    .select("account_id")
    .eq("api_key", api_key)
    .single()

  if (!user?.account_id) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS })
  }

  await supabase
    .from("accounts")
    .update({ last_heartbeat_at: new Date().toISOString() })
    .eq("id", user.account_id)

  return NextResponse.json({ ok: true }, { headers: CORS })
}
