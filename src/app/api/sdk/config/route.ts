import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { computeSegmentHash, computePricingSegmentHash, bucketHour, SegmentInput } from "@/lib/segment"
import { withDefaults } from "@/lib/paywall-resilience"
import { generatePriceCandidates, snapToLadder } from "@/lib/price-ladder"
import { selectPriceCandidate, selectPriceWithDemandModel } from "@/lib/price-bandit"
import { betaSample } from "@/lib/sampling"
import { loadEffectiveDemandModel } from "@/lib/demand-model"
import { loadChoiceModel, findBestPriceVector, CHOICE_MODEL_MIN_OBS } from "@/lib/choice-model"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "x-hatch-key",
}

/**
 * DJB2 hash — fast, non-cryptographic, good distribution for fingerprinting.
 * Used to derive a stable server-side user key from IP + User-Agent when the
 * client-side `uid` param is unavailable (incognito mode, localStorage blocked).
 */
function hashFP(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i)
  return (h >>> 0).toString(36)
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchPlansForIds(supabase: any, planIds: string[]): Promise<any[]> {
  if (!planIds.length) return []
  const { data } = await supabase.from("plans").select("*").in("id", planIds).order("price_monthly", { ascending: true })
  return data ?? []
}

// ─── Revenue-weighted price bandit with sticky user assignment ────────────────
// For each plan with dynamic_pricing_enabled, select a price candidate via
// Thompson sampling maximising EXPECTED REVENUE = P(convert) × price.
// If the user (identified by userKey) already has an assignment, return it
// immediately without running the bandit — prices are stable per user.
async function applyDynamicPricing(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plans: any[],
  sessionId: string | null,
  paywallId: string,
  accountId: string,
  segmentHash: string,
  segmentInput: SegmentInput,
  userKey: string | null,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ plans: any[]; priceAssignments: Record<string, { candidateId: string; cents: number; pricingSegHash: string }>; allPlanPrices: Record<string, number> }> {
  const priceAssignments: Record<string, { candidateId: string; cents: number; pricingSegHash: string }> = {}

  // ── Sticky assignment check: if user was here before, return same prices ────
  if (userKey) {
    const { data: stickyRow } = await supabase
      .from("variant_assignments")
      .select("all_plan_prices")
      .eq("paywall_id", paywallId)
      .eq("user_key", userKey)
      .not("all_plan_prices", "eq", "{}")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    const stickyPrices = stickyRow?.all_plan_prices as Record<string, number> | null
    if (stickyPrices && Object.keys(stickyPrices).length > 0) {
      console.log(`[sdk/config] Sticky prices for user ${userKey.slice(0, 16)}: ${JSON.stringify(stickyPrices)}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const enrichedPlans = plans
        .map((plan: any) => {
          const stickyPrice = stickyPrices[plan.id]
          if (stickyPrice && plan.dynamic_pricing_enabled !== false && !plan.pricing_frozen) {
            return { ...plan, price_monthly: stickyPrice }
          }
          return plan
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .sort((a: any, b: any) => (a.price_monthly ?? 0) - (b.price_monthly ?? 0))
      return { plans: enrichedPlans, priceAssignments: {}, allPlanPrices: stickyPrices }
    }
  }

  // ── No existing assignment — run bandit for each plan ────────────────────────
  // Cache candidates fetched per-plan so joint optimiser can reuse them
  const planCandidatesCache = new Map<string, Array<{ id: string; price_cents: number; is_anchor: boolean }>>()

  const enrichedPlans = await Promise.all(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plans.map(async (plan: any) => {
      try {
        // Skip if dynamic pricing disabled or frozen on this plan
        if (plan.dynamic_pricing_enabled === false) return plan
        if (plan.pricing_frozen === true) {
          console.log(`[sdk/config] Plan "${plan.name}" is frozen — serving anchor price`)
          return plan
        }

        // Compute pricing-specific segment hash for this plan
        const activeKeys: string[] = Array.isArray(plan.pricing_segment_keys)
          ? plan.pricing_segment_keys
          : []
        const pricingSegHash = computePricingSegmentHash(segmentInput, activeKeys)

        // Fetch active candidates for this plan + interval
        const { data: candidates } = await supabase
          .from("plan_price_candidates")
          .select("id, price_cents, interval, is_anchor")
          .eq("plan_id", plan.id)
          .eq("interval", "monthly")
          .eq("is_active", true)

        // Lazy bootstrap: no candidates yet → generate them and use anchor price now
        if (!candidates?.length) {
          await bootstrapPriceCandidates(supabase, plan, accountId)
          return plan
        }

        // ── Filter to valid ±8% window — silently ignore stale wide candidates ──
        // This ensures old DB rows (e.g. $19/$39 for a $29 anchor) never reach the
        // bandit even before the founder runs "Reset candidates to ±8% window".
        const validPrices = new Set(
          generatePriceCandidates(
            plan.price_monthly ?? 0,
            plan.price_floor_cents  || undefined,
            plan.price_ceiling_cents || undefined,
            plan.pricing_aggressiveness ?? "balanced",
          )
        )
        const windowCandidates = (candidates as Array<{ id: string; price_cents: number; is_anchor: boolean }>)
          .filter(c => validPrices.has(c.price_cents))
        // If every existing candidate is outside the new window (fresh plan with stale
        // data) fall back to the full candidate list so we always serve something.
        const activeCandidates = windowCandidates.length > 0 ? windowCandidates : candidates

        // Cache for joint optimisation post-processing
        planCandidatesCache.set(plan.id, activeCandidates)

        // Fetch posteriors for this pricing segment (+ global fallback)
        const [{ data: segPosts }, { data: globalPosts }] = await Promise.all([
          supabase
            .from("price_point_posteriors")
            .select("price_candidate_id, alpha, beta, impressions")
            .in("price_candidate_id", activeCandidates.map((c: { id: string }) => c.id))
            .eq("segment_hash", pricingSegHash),
          supabase
            .from("price_point_posteriors")
            .select("price_candidate_id, alpha, beta, impressions")
            .in("price_candidate_id", activeCandidates.map((c: { id: string }) => c.id))
            .eq("segment_hash", "global"),
        ])

        // Merge: prefer pricing-segment if available, fall back to global for warmup
        const segMap = new Map(
          (segPosts ?? []).map((p: { price_candidate_id: string; alpha: number; beta: number; impressions: number }) =>
            [p.price_candidate_id, p]
          )
        )
        const globalMap = new Map(
          (globalPosts ?? []).map((p: { price_candidate_id: string; alpha: number; beta: number; impressions: number }) =>
            [p.price_candidate_id, p]
          )
        )
        const effectivePosteriors = activeCandidates.map((c: { id: string }) => {
          return segMap.get(c.id) ?? globalMap.get(c.id) ?? { price_candidate_id: c.id, alpha: 1, beta: 1, impressions: 0 }
        })

        // Revenue-weighted Thompson with warmup guard + adaptive elimination.
        // Prefer Chapelle-Li demand model when available; fall back to Beta-bandit.
        const demandModel = await loadEffectiveDemandModel(
          supabase, plan.id, pricingSegHash, plan.price_monthly ?? 0
        ).catch(() => null)

        const { candidate: chosen, mode: selectionMode } = demandModel && demandModel.n_obs >= 1
          ? selectPriceWithDemandModel(demandModel, activeCandidates, effectivePosteriors, segmentInput)
          : selectPriceCandidate(activeCandidates, effectivePosteriors)

        const modelLabel = demandModel && demandModel.n_obs >= 1 ? "demand" : "beta"
        console.log(`[sdk/config] ${modelLabel}/${selectionMode} pick for plan "${plan.name}": ${chosen.price_cents}¢ (seg ${pricingSegHash.slice(0, 30)})`)

        // Bootstrap posteriors for any candidate not yet seen in this pricing segment
        const missingCandidates = activeCandidates.filter((c: { id: string }) => !segMap.has(c.id))
        if (missingCandidates.length > 0) {
          await supabase.from("price_point_posteriors").upsert(
            missingCandidates.map((c: { id: string }) => ({
              price_candidate_id: c.id,
              segment_hash: pricingSegHash,
              alpha: 1, beta: 1, impressions: 0, conversions: 0, revenue_cents: 0,
            })),
            { onConflict: "price_candidate_id,segment_hash", ignoreDuplicates: true }
          )
        }

        // Record price assignment
        priceAssignments[plan.id] = { candidateId: chosen.id, cents: chosen.price_cents, pricingSegHash }

        return { ...plan, price_monthly: chosen.price_cents, _dynamic_price_candidate_id: chosen.id }

      } catch (err) {
        console.warn(`[sdk/config] Price bandit failed for plan ${plan.id}:`, err)
        return plan
      }
    })
  )

  // Build allPlanPrices map for sticky persistence
  const allPlanPrices: Record<string, number> = {}
  for (const [planId, pa] of Object.entries(priceAssignments)) {
    allPlanPrices[planId] = pa.cents
  }

  // Sort plans by effective price ascending — cheapest plan always shown first
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  enrichedPlans.sort((a: any, b: any) => (a.price_monthly ?? 0) - (b.price_monthly ?? 0))

  // ── Joint paywall optimisation (multinomial logit) ────────────────────────────
  // When the choice model has ≥ CHOICE_MODEL_MIN_OBS observations for this paywall,
  // enumerate all price combinations across plans and serve the vector that maximises
  // total expected revenue (Σ P(choose j | menu) × p_j).
  // This captures substitution effects — e.g. raising Pro's price can boost Basic revenue.
  if (Object.keys(priceAssignments).length >= 2) {
    try {
      const choiceModel = await loadChoiceModel(supabase, paywallId)
      if (choiceModel && choiceModel.n_obs >= CHOICE_MODEL_MIN_OBS) {
        const candidatesPerPlan: Record<string, number[]> = {}
        for (const planId of Object.keys(priceAssignments)) {
          const cached = planCandidatesCache.get(planId)
          if (cached && cached.length > 0) {
            candidatesPerPlan[planId] = cached.map((c: { price_cents: number }) => c.price_cents)
          }
        }
        const jointPrices = findBestPriceVector(choiceModel, candidatesPerPlan)
        if (Object.keys(jointPrices).length > 0) {
          // Override per-plan bandit prices with joint optimal prices
          for (let i = 0; i < enrichedPlans.length; i++) {
            const jp = jointPrices[(enrichedPlans[i] as Record<string, unknown>).id as string]
            if (jp) {
              enrichedPlans[i] = { ...(enrichedPlans[i] as Record<string, unknown>), price_monthly: jp }
              allPlanPrices[(enrichedPlans[i] as Record<string, unknown>).id as string] = jp
            }
          }
          const summary = Object.entries(jointPrices)
            .map(([id, p]) => `${id.slice(0, 8)}→$${p / 100}`)
            .join(" | ")
          console.log(
            `[sdk/config] Joint opt (${choiceModel.n_obs} obs) for paywall ${paywallId}: ${summary}`
          )
        }
      }
    } catch (e) {
      // Non-fatal — fall through to per-plan prices
      console.warn("[sdk/config] Joint optimisation failed:", e instanceof Error ? e.message : e)
    }
  }

  // Update variant_assignments with chosen price + pricing_segment_hash (featured plan)
  const featuredPlanId = plans.find((p: { is_popular: boolean }) => p.is_popular)?.id ?? plans[0]?.id
  if (sessionId && featuredPlanId && priceAssignments[featuredPlanId]) {
    const pa = priceAssignments[featuredPlanId]
    await supabase.from("variant_assignments")
      .update({
        price_candidate_id: pa.candidateId,
        price_shown_cents: pa.cents,
        pricing_segment_hash: pa.pricingSegHash,
      })
      .eq("paywall_id", paywallId)
      .eq("session_id", sessionId)
  }

  return { plans: enrichedPlans, priceAssignments, allPlanPrices }
}

async function bootstrapPriceCandidates(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plan: any,
  accountId: string,
) {
  try {
    const anchorCents: number = plan.price_monthly ?? 0
    if (anchorCents <= 0) return

    const floorCents  = plan.price_floor_cents  ? snapToLadder(plan.price_floor_cents)  : undefined
    const ceilCents   = plan.price_ceiling_cents ? snapToLadder(plan.price_ceiling_cents) : undefined
    const aggressiveness = plan.pricing_aggressiveness ?? "balanced"
    const candidates  = generatePriceCandidates(anchorCents, floorCents, ceilCents, aggressiveness)

    await supabase.from("plan_price_candidates").upsert(
      candidates.map(c => ({
        plan_id:      plan.id,
        account_id:   accountId,
        interval:     "monthly",
        price_cents:  c,
        is_anchor:    c === snapToLadder(anchorCents),
        is_active:    true,
        generated_by: "ai",
      })),
      { onConflict: "plan_id,interval,price_cents", ignoreDuplicates: true }
    )
    console.log(`[sdk/config] Bootstrapped ${candidates.length} price candidates for plan "${plan.name}"`)
  } catch (err) {
    console.warn(`[sdk/config] Failed to bootstrap price candidates for plan ${plan.id}:`, err)
  }
}

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-hatch-key") ?? request.nextUrl.searchParams.get("key")
  const paywallId = request.nextUrl.searchParams.get("paywall")
  const sessionId = request.nextUrl.searchParams.get("session")
  const userKey   = request.nextUrl.searchParams.get("uid") ?? null

  // ── Server-side IP fingerprint fallback ────────────────────────────────────
  // When uid is null (incognito mode, localStorage blocked, first visit), derive
  // a stable fingerprint from the client's IP + User-Agent so prices stay sticky
  // even without client-side persistence.  Prefix "fp_" distinguishes it from
  // real user IDs ("anon_…" or app-defined user IDs).
  const clientIp = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim()
                || request.headers.get("x-real-ip")
                || ""
  const ua       = request.headers.get("user-agent") ?? ""
  const ipKey    = clientIp ? "fp_" + hashFP(clientIp + ua) : null

  // Prefer explicit uid (stable across IPs), fall back to IP fingerprint
  const effectiveUserKey = userKey ?? ipKey

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

  const segmentInput: SegmentInput = {
    quiz_answers:  quizAnswers,
    utm_source:    utmSource,
    device:        deviceRaw ?? "desktop",
    returning:     returningRaw === "1",
    hour_bucket:   hourRaw ?? bucketHour(),
  }
  const { hash: segmentHash, features: segmentFeatures } = computeSegmentHash(segmentInput)

  // ── Single paywall by ID ────────────────────────────────────────────────────
  if (paywallId) {
    const { data: paywall } = await supabase
      .from("paywalls")
      .select("*")
      .eq("account_id", user.account_id)
      .eq("status", "live")
      .eq("id", paywallId)
      .single()

    if (!paywall) {
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

    const { plans: pricedPlans, allPlanPrices } = await applyDynamicPricing(
      supabase, plans, sessionId, paywallId, user.account_id, segmentHash, segmentInput, effectiveUserKey
    )
    const base = withDefaults({ ...paywall, plans: pricedPlans })
    const enriched = await applyVariantContextual(
      supabase, base, sessionId, user.account_id, segmentHash, segmentFeatures, effectiveUserKey, allPlanPrices
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

  // Batch-fetch all plans referenced by any live paywall
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allPlanIds: string[] = [...new Set((paywalls as any[]).flatMap(p => p.plan_ids ?? []))]
  const allPlans = await fetchPlansForIds(supabase, allPlanIds)
  const planMap = new Map(allPlans.map((p: { id: string }) => [p.id, p]))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paywallsWithPlans = (paywalls as any[]).map(p =>
    withDefaults({
      ...p,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      plans: ((p.plan_ids ?? []).map((pid: string) => planMap.get(pid)).filter(Boolean) as any[])
        .sort((a: any, b: any) => (a.price_monthly ?? 0) - (b.price_monthly ?? 0)),
    })
  )

  // Dynamic pricing on the first (featured) paywall's plans
  const firstPaywall = paywallsWithPlans[0]
  const { plans: pricedFirstPlans, allPlanPrices } = await applyDynamicPricing(
    supabase, firstPaywall.plans ?? [], sessionId, firstPaywall.id, user.account_id, segmentHash, segmentInput, effectiveUserKey
  )
  const firstWithPricing = { ...firstPaywall, plans: pricedFirstPlans }

  const enrichedFirst = await applyVariantContextual(
    supabase, firstWithPricing, sessionId, user.account_id, segmentHash, segmentFeatures, effectiveUserKey, allPlanPrices
  )
  const result = [enrichedFirst, ...paywallsWithPlans.slice(1)]

  return NextResponse.json(
    { paywalls: result, segment_hash: segmentHash },
    { headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } }
  )
}

// ─── Contextual Thompson bandit (variant selection) ───────────────────────────
// Sticky: if userKey already has a variant assignment for this paywall, return it
// without running the bandit — users see the same variant on every visit.
async function applyVariantContextual(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  paywall: any,
  sessionId: string | null,
  accountId: string,
  segmentHash: string,
  segmentFeatures: Record<string, unknown>,
  userKey: string | null,
  allPlanPrices: Record<string, number>,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const { data: variants } = await supabase
    .from("paywall_variants")
    .select("id, name, headline, subheadline, cta_copy, body_copy, accent_color, design, posterior_alpha, posterior_beta")
    .eq("paywall_id", paywall.id)
    .is("archived_at", null)

  const variantCount = variants?.length ?? 0
  console.log(`[sdk/config] Paywall ${paywall.id} is live — ${variantCount} active variant(s)`)

  if (!variantCount) {
    // No variants — just persist sticky price assignment for this user
    if (userKey && sessionId && Object.keys(allPlanPrices).length > 0) {
      await supabase.from("variant_assignments").upsert(
        {
          account_id:     accountId,
          paywall_id:     paywall.id,
          variant_id:     null,
          session_id:     sessionId,
          segment_hash:   segmentHash,
          user_key:       userKey,
          all_plan_prices: allPlanPrices,
          context:        { segment_hash: segmentHash, segment_features: segmentFeatures },
        },
        { onConflict: "paywall_id,session_id", ignoreDuplicates: false }
      )
    }
    console.log(`[sdk/config] No variants — serving base paywall for ${paywall.id}`)
    return paywall
  }

  // ── Sticky variant check ────────────────────────────────────────────────────
  if (userKey) {
    const { data: stickyVariant } = await supabase
      .from("variant_assignments")
      .select("variant_id")
      .eq("paywall_id", paywall.id)
      .eq("user_key", userKey)
      .not("variant_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (stickyVariant?.variant_id) {
      const chosen = (variants as Variant[]).find(v => v.id === stickyVariant.variant_id)
      if (chosen) {
        console.log(`[sdk/config] Sticky variant ${chosen.id} (${chosen.name}) for user ${userKey.slice(0, 16)}`)
        return mergeVariantOntoPaywall(paywall, chosen)
      }
    }
  }

  // ── Fetch segment-level posteriors ─────────────────────────────────────────
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

  // Record assignment (includes user_key + all_plan_prices for sticky lookup)
  if (sessionId) {
    await supabase.from("variant_assignments").upsert(
      {
        account_id:      accountId,
        paywall_id:      paywall.id,
        variant_id:      chosen.id,
        session_id:      sessionId,
        segment_hash:    segmentHash,
        user_key:        userKey,
        all_plan_prices: Object.keys(allPlanPrices).length > 0 ? allPlanPrices : undefined,
        context:         { segment_hash: segmentHash, segment_features: segmentFeatures },
      },
      { onConflict: "paywall_id,session_id", ignoreDuplicates: false }
    )
  }

  return mergeVariantOntoPaywall(paywall, chosen)
}

// ─── Merge variant copy/design overrides onto base paywall ───────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mergeVariantOntoPaywall(paywall: any, chosen: Variant): any {
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
