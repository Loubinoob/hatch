import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

// Public endpoint — receives events from the Hatch SDK
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { apiKey, event, properties, userId, sessionId, paywallId, variantId } = body

  if (!apiKey || !event) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400, headers: CORS_HEADERS })
  }

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: user } = await supabase
    .from("users")
    .select("account_id")
    .eq("api_key", apiKey)
    .single()
  if (!user) return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS_HEADERS })

  // Store the event
  await supabase.from("events").insert({
    account_id: user.account_id,
    event_type: event,
    user_id_external: userId ?? null,
    session_id: sessionId ?? null,
    paywall_id: paywallId ?? null,
    ip: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip"),
    user_agent: request.headers.get("user-agent"),
    properties: { ...(properties ?? {}), variant_id: variantId ?? null },
  })

  // ─── paywall_shown ────────────────────────────────────────────────────────
  if (event === "paywall_shown" && paywallId) {
    // Update paywall-level view counter
    const { data: pw } = await supabase.from("paywalls").select("views").eq("id", paywallId).single()
    if (pw) await supabase.from("paywalls").update({ views: (pw.views ?? 0) + 1 }).eq("id", paywallId)

    // Update variant posterior — a view is a "miss" (beta += 1)
    const resolvedVariantId = variantId ?? await lookupVariantId(supabase, paywallId, sessionId)
    if (resolvedVariantId) {
      const { data: v } = await supabase
        .from("paywall_variants")
        .select("views, posterior_beta")
        .eq("id", resolvedVariantId)
        .single()
      if (v) {
        await supabase.from("paywall_variants").update({
          views: (v.views ?? 0) + 1,
          posterior_beta: (v.posterior_beta ?? 1) + 1,
        }).eq("id", resolvedVariantId)
      }
    }
  }

  // ─── payment_success ──────────────────────────────────────────────────────
  if (event === "payment_success" && paywallId) {
    const resolvedVariantId = variantId ?? await lookupVariantId(supabase, paywallId, sessionId)
    if (resolvedVariantId) {
      const { data: v } = await supabase
        .from("paywall_variants")
        .select("conversions, posterior_alpha, posterior_beta")
        .eq("id", resolvedVariantId)
        .single()
      if (v) {
        await supabase.from("paywall_variants").update({
          conversions: (v.conversions ?? 0) + 1,
          posterior_alpha: (v.posterior_alpha ?? 1) + 1,
          // Rebalance: this view converted, so undo the beta++ from paywall_shown
          posterior_beta: Math.max(1, (v.posterior_beta ?? 2) - 1),
        }).eq("id", resolvedVariantId)
      }
    }
    // Mark the assignment as converted
    if (sessionId && paywallId) {
      await supabase.from("variant_assignments")
        .update({ converted_at: new Date().toISOString() })
        .eq("paywall_id", paywallId)
        .eq("session_id", sessionId)
        .is("converted_at", null)
    }
  }

  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS })
}

async function lookupVariantId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  paywallId: string,
  sessionId: string | null
): Promise<string | null> {
  if (!sessionId) return null
  const { data } = await supabase
    .from("variant_assignments")
    .select("variant_id")
    .eq("paywall_id", paywallId)
    .eq("session_id", sessionId)
    .maybeSingle()
  return data?.variant_id ?? null
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS })
}
