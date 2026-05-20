import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

// Public endpoint — receives events from the Hatch SDK
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { apiKey, event, properties, userId, sessionId, paywallId } = body

  if (!apiKey || !event) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: user } = await supabase.from("users").select("account_id").eq("api_key", apiKey).single()
  if (!user) return NextResponse.json({ error: "Invalid API key" }, { status: 401 })

  await supabase.from("events").insert({
    account_id: user.account_id,
    event_type: event,
    user_id_external: userId ?? null,
    session_id: sessionId ?? null,
    paywall_id: paywallId ?? null,
    ip: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip"),
    user_agent: request.headers.get("user-agent"),
    properties: properties ?? {},
  })

  // Update paywall view count
  if (event === "paywall_shown" && paywallId) {
    const { data: pw } = await supabase.from("paywalls").select("views").eq("id", paywallId).single()
    if (pw) {
      await supabase.from("paywalls").update({ views: (pw.views ?? 0) + 1 }).eq("id", paywallId)
    }
  }

  return NextResponse.json(
    { ok: true },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    }
  )
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  })
}
