import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { computeSegmentHash, bucketHour } from "@/lib/segment"
import { withDefaults } from "@/lib/paywall-resilience"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "x-hatch-key",
}

// ─── Thompson Sampling helpers ────────────────────────────────────────────────

function betaSample(alpha: number, beta: number): number {
  const a = Math.max(1, alpha)
  const b = Math.max(1, beta)
  const mean = a / (a + b)
  const variance = (a * b) / ((a + b) ** 2 * (a + b + 1))
  const std = Math.sqrt(variance)
  const u1 = Math.max(1e-10, Math.random())
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return Math.max(0, Math.min(1, mean + z * std))
}

const SEGMENT_CONFIDENCE_THRESHOLD = 10

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

// ─── Plans helper — fetches plans by IDs in a single query ───────────────────
// We never use PostgREST embedded joins for plans because plans.account_id → accounts
// (not paywalls), so there is no FK path PostgREST can resolve.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchPlansForIds(supabase: any, planIds: string[]): Promise<any[]> {
  if (!planIds.length) return []
  const { data } = await supabase.from("plans").select("*").in("id", planIds)
  return data ?? []
}

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-hatch-key") ?? request.nextUrl.searchParams.get("key")
  const paywallId = request.nextUrl.searchParams.get("paywall")
  const sessionId = request.nextUrl.searchParams.get("session")

  // Segment signals from SDK
  const quizAnswersRaw = request.nextUrl.searchParams.get("quiz_answers")
  const utmSource      = request.nextUrl.searchParams.get("utm_source")
  const deviceRaw      = request.nextUrl.searchParams.get("device") as "mobile" | "desktop" | "tablet" | null
  const returningRaw   = request.nextUrl.searchParams.get("returning")
  const hourRaw        = request.nextUrl.searchParams.get("hour") as "morning" | "afternoon" | "evening" | "night" | null

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

  // Build segment from all available signals
  let quizAnswers: Record<string, string> = {}
  if (quizAnswersRaw) {
    try { quizAnswers = JSON.parse(quizAnswersRaw) } catch { /* ignore */ }
  }

  const { hash: segmentHash, features: segmentFeatures } = computeSegmentHash({
    quiz_answers:  quizAnswers,
    utm_source:    utmSource,
    device:        deviceRaw ?? "desktop",
    returning:     returningRaw === "1",
    hour_bucket:   hourRaw ?? bucketHour(),
  })

  // ── Single paywall by ID ────────────────────────────────────────────────────
  if (paywallId) {
    // Fetch paywall WITHOUT embedded join — plans has no FK to paywalls
    const { data: paywall } = await supabase
      .from("paywalls")
      .select("*")
      .eq("account_id", user.account_id)
      .eq("status", "live")
      .eq("id", paywallId)
      .single()

    if (!paywall) {
      // Look up the real reason: not found vs not live
      const { data: existing } = await supabase
        .from("paywalls")
        .select("id, status")
        .eq("id", paywallId)
        .eq("account_id", user.account_id)
        .single()
      const reason = existing ? "not_live" : "not_found"
      console.log(`[sdk/config] Paywall ${paywallId} not served: ${reason}${existing ? ` (actual status: ${existing.status})` : ""}`)
      return NextResponse.json({ paywall: null, reason }, { headers: CORS_HEADERS })
    }

    // Fetch plans + quiz in parallel
    const [plans, { data: quiz }] = await Promise.all([
      fetchPlansForIds(supabase, paywall.plan_ids ?? []),
      supabase
        .from("paywall_quizzes")
        .select("id, questions, completion_message, trigger_mode, is_active")
        .eq("paywall_id", paywallId)
        .eq("is_active", true)
        .maybeSingle(),
    ])

    const base = withDefaults({ ...paywall, plans })
    const enriched = await applyVariantContextual(
      supabase, base, sessionId, user.account_id, segmentHash, segmentFeatures
    )

    return NextResponse.json(
      {
        paywall: enriched,
        quiz: quiz?.trigger_mode !== "disabled" ? quiz : null,
        segment_hash: segmentHash,
      },
      { headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } }
    )
  }

  // ── List: first live paywall ────────────────────────────────────────────────
  const { data: paywalls } = await supabase
    .from("paywalls")
    .select("*")
    .eq("account_id", user.account_id)
    .eq("status", "live")
    .order("conversions", { ascending: false })

  if (!paywalls?.length) {
    return NextResponse.json(
      { paywalls: [] },
      { headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } }
    )
  }

  // Batch-fetch all plans referenced by any live paywall (single query)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allPlanIds: string[] = [...new Set((paywalls as any[]).flatMap(p => p.plan_ids ?? []))]
  const allPlans = await fetchPlansForIds(supabase, allPlanIds)
  const planMap = new Map(allPlans.map((p: { id: string }) => [p.id, p]))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paywallsWithPlans = (paywalls as any[]).map(p =>
    withDefaults({
      ...p,
      plans: (p.plan_ids ?? []).map((pid: string) => planMap.get(pid)).filter(Boolean),
    })
  )

  const enrichedFirst = await applyVariantContextual(
    supabase, paywallsWithPlans[0], sessionId, user.account_id, segmentHash, segmentFeatures
  )
  const result = [enrichedFirst, ...paywallsWithPlans.slice(1)]

  return NextResponse.json(
    { paywalls: result, segment_hash: segmentHash },
    { headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } }
  )
}

// ─── Contextual Thompson bandit ───────────────────────────────────────────────
async function applyVariantContextual(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  paywall: any,
  sessionId: string | null,
  accountId: string,
  segmentHash: string,
  segmentFeatures: Record<string, unknown>,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const { data: variants } = await supabase
    .from("paywall_variants")
    .select("id, name, headline, subheadline, cta_copy, body_copy, accent_color, design, posterior_alpha, posterior_beta")
    .eq("paywall_id", paywall.id)
    .is("archived_at", null)

  const variantCount = variants?.length ?? 0
  console.log(`[sdk/config] Paywall ${paywall.id} is live — ${variantCount} active variant(s)`)

  // No variants: serve the base paywall as-is (no A/B test running)
  if (!variantCount) {
    console.log(`[sdk/config] No variants — serving base paywall for ${paywall.id}`)
    return paywall
  }

  // Fetch segment-level posteriors for this (variant_id, segment_hash) pair
  const { data: segPosteriors } = await supabase
    .from("variant_segment_posteriors")
    .select("variant_id, alpha, beta, views")
    .in("variant_id", (variants as Variant[]).map(v => v.id))
    .eq("segment_hash", segmentHash)

  const segMap = new Map(
    (segPosteriors ?? []).map((s: { variant_id: string; alpha: number; beta: number; views: number }) => [s.variant_id, s])
  )

  // Contextual Thompson: blend segment+global weighted by confidence
  const scores = (variants as Variant[]).map(v => {
    const seg = segMap.get(v.id) as { alpha: number; beta: number; views: number } | undefined
    const segObs = seg ? (seg.alpha + seg.beta - 2) : 0
    const segWeight = Math.min(1, segObs / SEGMENT_CONFIDENCE_THRESHOLD)

    const segSample    = seg ? betaSample(seg.alpha, seg.beta) : 0
    const globalSample = betaSample(v.posterior_alpha ?? 1, v.posterior_beta ?? 1)
    const finalSample  = segWeight * segSample + (1 - segWeight) * globalSample

    return { variant: v, sample: finalSample }
  })

  const chosen = scores.sort((a, b) => b.sample - a.sample)[0].variant
  console.log(`[sdk/config] Selected variant ${chosen.id} (${chosen.name}) for segment ${segmentHash}`)

  // Bootstrap segment posteriors for any variant not yet seen in this segment
  const missingVariants = (variants as Variant[]).filter(v => !segMap.has(v.id))
  if (missingVariants.length > 0) {
    await supabase.from("variant_segment_posteriors").upsert(
      missingVariants.map(v => ({
        variant_id: v.id,
        segment_hash: segmentHash,
        segment_features: segmentFeatures,
        alpha: 1, beta: 1, views: 0, conversions: 0,
      })),
      { onConflict: "variant_id,segment_hash", ignoreDuplicates: true }
    )
  }

  // Record assignment
  if (sessionId) {
    await supabase.from("variant_assignments").upsert(
      {
        account_id: accountId,
        paywall_id: paywall.id,
        variant_id: chosen.id,
        session_id: sessionId,
        segment_hash: segmentHash,
        context: { segment_hash: segmentHash, segment_features: segmentFeatures },
      },
      { onConflict: "paywall_id,session_id", ignoreDuplicates: false }
    )
  }

  // Merge variant overrides onto base paywall
  const merged = { ...paywall }
  if (chosen.headline)    merged.headline    = chosen.headline
  if (chosen.subheadline) merged.subheadline = chosen.subheadline
  if (chosen.cta_copy)    merged.cta_copy    = chosen.cta_copy
  if (chosen.accent_color) {
    merged.design = { ...(merged.design ?? {}), accentColor: chosen.accent_color }
  }
  if (chosen.design && Object.keys(chosen.design).length) {
    merged.design = { ...(merged.design ?? {}), ...chosen.design }
  }

  merged._variant_id   = chosen.id
  merged._variant_name = chosen.name

  return merged
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS })
}
