import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  try {
    const { api_key } = await request.json()

    if (!api_key) {
      return NextResponse.json({ error: "api_key is required" }, { status: 400 })
    }

    const supabase = await createClient()

    // Look up user by API key
    const { data: user } = await supabase
      .from("users")
      .select("account_id")
      .eq("api_key", api_key)
      .single()

    if (!user?.account_id) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 })
    }

    // Update last_heartbeat_at on the account
    const { error } = await supabase
      .from("accounts")
      .update({ last_heartbeat_at: new Date().toISOString() })
      .eq("id", user.account_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("SDK heartbeat error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Also accept GET for simple ping (some integrations use GET)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const api_key = searchParams.get("api_key")

  if (!api_key) {
    return NextResponse.json({ error: "api_key is required" }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: user } = await supabase
    .from("users")
    .select("account_id")
    .eq("api_key", api_key)
    .single()

  if (!user?.account_id) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 })
  }

  await supabase
    .from("accounts")
    .update({ last_heartbeat_at: new Date().toISOString() })
    .eq("id", user.account_id)

  return NextResponse.json({ ok: true })
}
