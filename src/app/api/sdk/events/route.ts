import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = any

// Public endpoint — receives events from the Hatch SDK
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { apiKey, event, properties, userId, sessionId, paywallId, variantId } = body

  if (!apiKey || !event) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400, headers: CORS_HEADERS })
  }

  const supabase: Supa = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: user } = await supabase
    .from("users")
    .select("account_id")
    .eq("api_key", apiKey)
    .single()
  if (!user) return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS_HEADERS })

  console.log(`[sdk/events] ${event} | account=${user.account_id}${paywallId ? ` paywall=${paywallId}` : ""}${sessionId ? ` session=${sessionId.slice(0,8)}` : ""}`)

  // ─── Vercel geo enrichment ─────────────────────────────────────────────────
  const geo = {
    country:  request.headers.get("x-vercel-ip-country")         ?? null,
    region:   request.headers.get("x-vercel-ip-country-region")  ?? null,
    city:     request.headers.get("x-vercel-ip-city")            ?? null,
    timezone: request.headers.get("x-vercel-ip-timezone")        ?? null,
  }

  // ─── Resilient event insert ────────────────────────────────────────────────
  const CRITICAL_EVENT_FIELDS = ["account_id", "event_type"]
  const insertPayload: Record<string, unknown> = {
    account_id:       user.account_id,
    event_type:       event,
    user_id_external: userId   ?? null,
    session_id:       sessionId ?? null,
    paywall_id:       paywallId ?? null,
    ip:               request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip"),
    user_agent:       request.headers.get("user-agent"),
    properties:       { ...(properties ?? {}), variant_id: variantId ?? null, ...geo },
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    const { error: insertError } = await supabase.from("events").insert(insertPayload)
    if (!insertError) break
    const col = insertError.message?.match(/Could not find the '([a-z_]+)' column/i)?.[1]
    if (col && !CRITICAL_EVENT_FIELDS.includes(col) && col in insertPayload) {
      console.warn(`[sdk/events] Column '${col}' missing — dropping`)
      delete insertPayload[col]
      continue
    }
    console.error(`[sdk/events] Insert failed: ${insertError.message}`)
    break
  }

  // ─── paywall_impressions upsert ───────────────────────────────────────────
  if (paywallId && sessionId) {
    await upsertImpression(supabase, event, {
      account_id:       user.account_id,
      paywall_id:       paywallId,
      session_id:       sessionId,
      user_id_external: userId ?? null,
      variant_id:       variantId ?? null,
      properties:       properties ?? {},
      geo,
    })
  }

  // ─── price posterior: paywall_shown → impression ─────────────────────────
  if (event === "paywall_shown" && sessionId) {
    const { data: assignment } = await supabase
      .from("variant_assignments")
      .select("price_candidate_id, price_shown_cents, segment_hash")
      .eq("session_id", sessionId)
      .maybeSingle()
    if (assignment?.price_candidate_id) {
      const segHash = assignment.segment_hash ?? "global"
      await supabase.from("price_point_posteriors")
        .upsert({ price_candidate_id: assignment.price_candidate_id, segment_hash: segHash,
                  alpha: 1, beta: 1, impressions: 0, conversions: 0, revenue_cents: 0 },
                 { onConflict: "price_candidate_id,segment_hash", ignoreDuplicates: true })
      const { data: pp } = await supabase
        .from("price_point_posteriors")
        .select("impressions, beta")
        .eq("price_candidate_id", assignment.price_candidate_id)
        .eq("segment_hash", segHash)
        .single()
      if (pp) {
        await supabase.from("price_point_posteriors")
          .update({ impressions: (pp.impressions ?? 0) + 1, beta: (pp.beta ?? 1) + 1, updated_at: new Date().toISOString() })
          .eq("price_candidate_id", assignment.price_candidate_id)
          .eq("segment_hash", segHash)
      }
    }
  }

  // ─── paywall_shown: increment counters ────────────────────────────────────
  if (event === "paywall_shown" && paywallId) {
    // Resilient views increment — log errors so failures are visible in Vercel logs
    try {
      const { data: pw } = await supabase.from("paywalls").select("views").eq("id", paywallId).single()
      if (pw) {
        const { error: viewsErr } = await supabase.from("paywalls").update({ views: (pw.views ?? 0) + 1 }).eq("id", paywallId)
        if (viewsErr) console.error(`[sdk/events] paywalls.views increment failed: ${viewsErr.message}`)
      }
    } catch (err) {
      console.error("[sdk/events] paywalls.views increment exception:", err instanceof Error ? err.message : err)
    }

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

      const segmentHash = await lookupSegmentHash(supabase, paywallId, sessionId)
      if (segmentHash) {
        const { data: sp } = await supabase
          .from("variant_segment_posteriors")
          .select("alpha, beta, views")
          .eq("variant_id", resolvedVariantId)
          .eq("segment_hash", segmentHash)
          .maybeSingle()
        if (sp) {
          await supabase
            .from("variant_segment_posteriors")
            .update({ views: (sp.views ?? 0) + 1, beta: (sp.beta ?? 1) + 1, updated_at: new Date().toISOString() })
            .eq("variant_id", resolvedVariantId)
            .eq("segment_hash", segmentHash)
        }
      }
    }
  }

  // ─── price posterior: payment_success → conversion ───────────────────────
  if (event === "payment_success" && sessionId) {
    const { data: assignment } = await supabase
      .from("variant_assignments")
      .select("price_candidate_id, price_shown_cents, segment_hash")
      .eq("session_id", sessionId)
      .maybeSingle()
    if (assignment?.price_candidate_id) {
      const segHash = assignment.segment_hash ?? "global"
      const priceCents = assignment.price_shown_cents ?? 0
      const { data: pp } = await supabase
        .from("price_point_posteriors")
        .select("conversions, alpha, beta, revenue_cents")
        .eq("price_candidate_id", assignment.price_candidate_id)
        .eq("segment_hash", segHash)
        .single()
      if (pp) {
        await supabase.from("price_point_posteriors")
          .update({
            conversions:   (pp.conversions ?? 0) + 1,
            alpha:         (pp.alpha ?? 1) + 1,
            beta:          Math.max(1, (pp.beta ?? 2) - 1),
            revenue_cents: (pp.revenue_cents ?? 0) + priceCents,
            updated_at:    new Date().toISOString(),
          })
          .eq("price_candidate_id", assignment.price_candidate_id)
          .eq("segment_hash", segHash)
      }
    }
  }

  // ─── payment_success: variant posteriors ──────────────────────────────────
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
          posterior_beta: Math.max(1, (v.posterior_beta ?? 2) - 1),
        }).eq("id", resolvedVariantId)
      }

      const segmentHash = await lookupSegmentHash(supabase, paywallId, sessionId)
      if (segmentHash) {
        const { data: sp } = await supabase
          .from("variant_segment_posteriors")
          .select("alpha, beta, conversions")
          .eq("variant_id", resolvedVariantId)
          .eq("segment_hash", segmentHash)
          .maybeSingle()
        if (sp) {
          await supabase
            .from("variant_segment_posteriors")
            .update({
              conversions: (sp.conversions ?? 0) + 1,
              alpha: (sp.alpha ?? 1) + 1,
              beta: Math.max(1, (sp.beta ?? 2) - 1),
              updated_at: new Date().toISOString(),
            })
            .eq("variant_id", resolvedVariantId)
            .eq("segment_hash", segmentHash)
        }
      }
    }

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

// ─── paywall_impressions maintenance ─────────────────────────────────────────

async function upsertImpression(
  supabase: Supa,
  event: string,
  ctx: {
    account_id: string
    paywall_id: string
    session_id: string
    user_id_external: string | null
    variant_id: string | null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: Record<string, any>
    geo: { country: string | null; region: string | null; city: string | null; timezone: string | null }
  }
) {
  const p = ctx.properties
  const now = new Date().toISOString()

  try {
    if (event === "paywall_shown") {
      // Full upsert — insert on first impression
      const row: Record<string, unknown> = {
        account_id:       ctx.account_id,
        paywall_id:       ctx.paywall_id,
        session_id:       ctx.session_id,
        user_id_external: ctx.user_id_external,
        // Context
        device_type:     p.device_type   ?? p.device ?? null,
        os:              p.os             ?? null,
        browser:         p.browser        ?? null,
        viewport_w:      p.viewport_w     ?? null,
        viewport_h:      p.viewport_h     ?? null,
        utm_source:      p.utm_source     ?? null,
        utm_medium:      p.utm_medium     ?? null,
        utm_campaign:    p.utm_campaign   ?? null,
        utm_content:     p.utm_content    ?? null,
        utm_term:        p.utm_term       ?? null,
        referrer:        p.referrer        ?? null,
        referrer_domain: p.referrer_domain ?? null,
        landing_page:    p.landing_page    ?? null,
        language:        p.language        ?? null,
        hour_of_day:     p.hour_of_day     ?? (p.hour_bucket ? null : null),
        day_of_week:     p.day_of_week     ?? null,
        is_weekend:      p.is_weekend      ?? null,
        is_returning:    p.is_returning    ?? p.returning ?? null,
        session_count:   p.session_count   ?? null,
        segment_hash:    p.segment_hash    ?? null,
        // Geo (server-side)
        country:  ctx.geo.country,
        region:   ctx.geo.region,
        city:     ctx.geo.city,
        timezone: ctx.geo.timezone,
        // Exposition
        variant_id:        ctx.variant_id ?? null,
        price_shown_cents: p.price_shown_cents ?? null,
        interval_shown:    p.interval_shown ?? null,
        trigger_type:      p.trigger_type  ?? null,
        shown_at:          now,
        updated_at:        now,
      }
      // Resilient upsert — drop unknown columns on conflict
      for (let attempt = 0; attempt < 15; attempt++) {
        const { error } = await supabase
          .from("paywall_impressions")
          .upsert(row, { onConflict: "paywall_id,session_id", ignoreDuplicates: false })
        if (!error) return
        // Table not yet created — skip silently
        if (error.message?.includes("does not exist") || error.message?.includes("relation")) return
        const col = error.message?.match(/Could not find the '([a-z_]+)' column/i)?.[1]
        if (col && col in row) { delete row[col]; continue }
        console.warn(`[sdk/events] impression upsert failed: ${error.message}`)
        return
      }
      return
    }

    // For all other events — update the existing row if it exists
    const updates: Record<string, unknown> = { updated_at: now }

    if (event === "billing_toggle_changed") {
      updates.toggled_billing = true
    } else if (event === "scroll_depth" && typeof p.percent === "number") {
      // Fetch current max and compare
      const { data: row } = await supabase
        .from("paywall_impressions")
        .select("scroll_depth_max")
        .eq("paywall_id", ctx.paywall_id)
        .eq("session_id", ctx.session_id)
        .maybeSingle()
      updates.scroll_depth_max = Math.max(row?.scroll_depth_max ?? 0, p.percent)
    } else if (event === "plan_hovered" && p.plan_id) {
      const { data: row } = await supabase
        .from("paywall_impressions")
        .select("hovered_plans")
        .eq("paywall_id", ctx.paywall_id)
        .eq("session_id", ctx.session_id)
        .maybeSingle()
      const existing: string[] = Array.isArray(row?.hovered_plans) ? row.hovered_plans : []
      if (!existing.includes(p.plan_id)) {
        updates.hovered_plans = [...existing, p.plan_id]
      } else {
        return // no change
      }
    } else if (event === "checkout_started") {
      updates.reached_checkout = true
    } else if (event === "paywall_dismissed") {
      updates.dismissed     = true
      updates.dismiss_method = p.method ?? null
      updates.dwell_ms      = p.dwell_ms ?? null
    } else if (event === "quiz_completed") {
      updates.quiz_completed = true
      updates.quiz_answers   = p.answers ?? {}
    } else if (event === "payment_success") {
      updates.converted    = true
      updates.converted_at = now
      updates.revenue_cents = p.amount_cents ?? p.price_shown_cents ?? null
      updates.plan_id      = p.plan_id ?? null
    } else {
      return // no impression update needed
    }

    await supabase
      .from("paywall_impressions")
      .update(updates)
      .eq("paywall_id", ctx.paywall_id)
      .eq("session_id", ctx.session_id)

  } catch (err) {
    // Entirely non-fatal — table may not exist yet
    console.warn("[sdk/events] impression update skipped:", err instanceof Error ? err.message : err)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function lookupVariantId(supabase: Supa, paywallId: string, sessionId: string | null): Promise<string | null> {
  if (!sessionId) return null
  const { data } = await supabase
    .from("variant_assignments")
    .select("variant_id")
    .eq("paywall_id", paywallId)
    .eq("session_id", sessionId)
    .maybeSingle()
  return data?.variant_id ?? null
}

async function lookupSegmentHash(supabase: Supa, paywallId: string, sessionId: string | null): Promise<string | null> {
  if (!sessionId) return null
  const { data } = await supabase
    .from("variant_assignments")
    .select("segment_hash")
    .eq("paywall_id", paywallId)
    .eq("session_id", sessionId)
    .maybeSingle()
  return data?.segment_hash ?? null
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS })
}
