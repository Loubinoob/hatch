import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "x-hatch-key",
}

// ─── Thompson Sampling (pure math, zero LLM, < 5ms) ──────────────────────────
function thompsonSample(alpha: number, beta: number): number {
  const a = Math.max(1, alpha)
  const b = Math.max(1, beta)
  const mean = a / (a + b)
  const variance = (a * b) / ((a + b) ** 2 * (a + b + 1))
  const std = Math.sqrt(variance)
  // Box-Muller normal approximation for Beta distribution
  const u1 = Math.max(1e-10, Math.random())
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return Math.max(0, Math.min(1, mean + z * std))
}

type Variant = {
  id: string
  name: string
  headline: string | null
  subheadline: string | null
  cta_copy: string | null
  body_copy: string | null
  accent_color: string | null
  design: Record<string, unknown>
  posterior_alpha: number
  posterior_beta: number
}

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-hatch-key") ?? request.nextUrl.searchParams.get("key")
  const paywallId = request.nextUrl.searchParams.get("paywall")
  const sessionId = request.nextUrl.searchParams.get("session")

  if (!apiKey) {
    return NextResponse.json({ error: "Missing API key" }, { status: 401, headers: CORS_HEADERS })
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

  if (paywallId) {
    const { data: paywall } = await supabase
      .from("paywalls")
      .select("*, plans(*)")
      .eq("account_id", user.account_id)
      .eq("status", "live")
      .eq("id", paywallId)
      .single()

    if (!paywall) return NextResponse.json({ paywall: null }, { headers: CORS_HEADERS })

    const enriched = await applyVariant(supabase, paywall, sessionId, user.account_id)
    return NextResponse.json(
      { paywall: enriched },
      { headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } }
    )
  }

  const { data: paywalls } = await supabase
    .from("paywalls")
    .select("*, plans(*)")
    .eq("account_id", user.account_id)
    .eq("status", "live")
    .order("conversions", { ascending: false })

  if (!paywalls?.length) {
    return NextResponse.json(
      { paywalls: [] },
      { headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } }
    )
  }

  // Enrich the first (most-converting) paywall with variant selection
  const enrichedFirst = await applyVariant(supabase, paywalls[0], sessionId, user.account_id)
  const result = [enrichedFirst, ...paywalls.slice(1)]
  return NextResponse.json(
    { paywalls: result },
    { headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } }
  )
}

async function applyVariant(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  paywall: any,
  sessionId: string | null,
  accountId: string
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  // Get active (non-archived) variants
  const { data: variants } = await supabase
    .from("paywall_variants")
    .select("id, name, headline, subheadline, cta_copy, body_copy, accent_color, design, posterior_alpha, posterior_beta")
    .eq("paywall_id", paywall.id)
    .is("archived_at", null)

  if (!variants?.length) {
    return paywall // No variants — passthrough, zero overhead
  }

  // Thompson sampling — pick the variant with the highest sampled score
  const scores = (variants as Variant[]).map(v => ({
    variant: v,
    sample: thompsonSample(v.posterior_alpha ?? 1, v.posterior_beta ?? 1),
  }))
  const chosen = scores.sort((a, b) => b.sample - a.sample)[0].variant

  // Record the assignment (upsert — idempotent per session)
  if (sessionId) {
    await supabase.from("variant_assignments").upsert(
      {
        account_id: accountId,
        paywall_id: paywall.id,
        variant_id: chosen.id,
        session_id: sessionId,
        context: {},
      },
      { onConflict: "paywall_id,session_id", ignoreDuplicates: false }
    )
  }

  // Merge variant overrides onto base paywall config
  const merged = { ...paywall }
  if (chosen.headline) merged.headline = chosen.headline
  if (chosen.subheadline) merged.subheadline = chosen.subheadline
  if (chosen.cta_copy) merged.cta_copy = chosen.cta_copy
  if (chosen.accent_color) {
    merged.design = { ...(merged.design ?? {}), accentColor: chosen.accent_color }
  }
  if (chosen.design && Object.keys(chosen.design).length) {
    merged.design = { ...(merged.design ?? {}), ...chosen.design }
  }

  // Expose variant_id so SDK can include it in subsequent events
  merged._variant_id = chosen.id
  merged._variant_name = chosen.name

  return merged
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS })
}
