import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"
import { generatePriceCandidates, snapToLadder } from "@/lib/price-ladder"

/**
 * POST /api/pricing/cold-start
 * Value-based pricing via Claude Opus — generates smarter initial price candidates
 * than the mechanical spread, grounded in the project brief (ICP, competitors, benefits).
 *
 * FALLBACK: if no project brief or Claude fails → mechanical generatePriceCandidates()
 * Body: { plan_id: string }
 */

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are a world-class SaaS pricing strategist. Your job is to propose
initial price points for a subscription plan based on value delivered, ICP willingness-to-pay,
and competitive landscape.

You receive:
- A project brief (what the app does, who it's for, key benefits, competitors, price anchor)
- The plan name and current price

You must output ONLY valid JSON — no markdown, no preamble:
{
  "candidates_usd": [number],        // 3-6 monthly prices in whole dollars to A/B test
  "recommended_anchor_usd": number,  // which price to start showing most users
  "floor_usd": number,               // minimum price to ever test (50-70% of anchor)
  "ceiling_usd": number,             // maximum price to ever test (150-250% of anchor)
  "reasoning": "string"              // 2-4 sentences for the founder explaining the logic
}

Rules:
- All prices must be whole dollar amounts (no decimals)
- Candidates must be psychologically natural (9, 12, 19, 24, 29, 39, 49, 59, 79, 99, 119, 149, 199...)
- Include the recommended_anchor in candidates
- recommended_anchor should be your best single hypothesis for revenue-maximizing price
- floor_usd = min(candidates), ceiling_usd = max(candidates) × 1.25 (rounded to ladder)
- If competitors charge $X, test above and below their price — don't just copy
- Consider value-based pricing: what is the ROI this product delivers to the ICP?
- 3 candidates minimum, 6 maximum`

export async function POST(request: NextRequest) {
  const t0 = Date.now()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const { plan_id } = body
  if (!plan_id) return NextResponse.json({ error: "plan_id required" }, { status: 400 })

  const { data: profile } = await supabase
    .from("users")
    .select("account_id")
    .eq("id", user.id)
    .single()
  if (!profile?.account_id) return NextResponse.json({ error: "Account not found" }, { status: 404 })

  const accountId = profile.account_id

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Load plan + project brief in parallel
  const [{ data: plan }, { data: brief }] = await Promise.all([
    service
      .from("plans")
      .select("id, name, price_monthly, price_floor_cents, price_ceiling_cents, dynamic_pricing_enabled, account_id")
      .eq("id", plan_id)
      .eq("account_id", accountId)
      .single(),
    service
      .from("project_briefs")
      .select("app_description, icp_description, core_problem, key_benefits, competitors, price_anchor, emotional_drivers")
      .eq("account_id", accountId)
      .maybeSingle(),
  ])

  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

  if (!plan.dynamic_pricing_enabled) {
    return NextResponse.json({ skipped: true, reason: "dynamic_pricing_enabled is false" })
  }

  const anchorCents = plan.price_monthly ?? 0
  if (anchorCents <= 0) {
    return NextResponse.json({ skipped: true, reason: "price_monthly is 0" })
  }

  const anchorDollars = Math.round(anchorCents / 100)

  // ── Try Claude if we have a brief ─────────────────────────────────────────
  let claudeSucceeded = false
  let candidateCents: number[] = []
  let floorCents = plan.price_floor_cents ?? Math.round(anchorCents * 0.5)
  let ceilingCents = plan.price_ceiling_cents ?? Math.round(anchorCents * 2.0)
  let reasoning = "Mechanical spread bootstrap (no project brief available)"
  let tokensIn = 0
  let tokensOut = 0

  if (brief?.app_description) {
    const userPrompt = `Generate value-based pricing candidates for this SaaS plan.

PLAN: "${plan.name}"
CURRENT PRICE: $${anchorDollars}/month

PROJECT BRIEF:
- App: ${brief.app_description}
- ICP: ${brief.icp_description ?? "Not specified"}
- Core problem solved: ${brief.core_problem ?? "Not specified"}
- Key benefits: ${Array.isArray(brief.key_benefits) ? brief.key_benefits.join(", ") : (brief.key_benefits ?? "Not specified")}
- Competitors: ${Array.isArray(brief.competitors) ? brief.competitors.join(", ") : (brief.competitors ?? "None mentioned")}
- Existing price anchor context: ${brief.price_anchor ?? "Not specified"}
- Emotional drivers: ${Array.isArray(brief.emotional_drivers) ? brief.emotional_drivers.join(", ") : "Not specified"}

Based on this, propose the optimal initial price points to A/B test.`

    try {
      const message = await anthropic.messages.create({
        model: "claude-opus-4-7",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      })

      tokensIn = message.usage.input_tokens
      tokensOut = message.usage.output_tokens

      const raw = message.content[0]
      if (raw.type !== "text") throw new Error("Unexpected AI response type")

      const jsonText = raw.text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim()

      const parsed = JSON.parse(jsonText)

      // Validate required fields
      if (!Array.isArray(parsed.candidates_usd) || parsed.candidates_usd.length < 2) {
        throw new Error("Invalid candidates_usd from Claude")
      }
      if (typeof parsed.recommended_anchor_usd !== "number") {
        throw new Error("Missing recommended_anchor_usd from Claude")
      }

      const anchorFromClaude = Math.round(parsed.recommended_anchor_usd) * 100
      floorCents = Math.round((parsed.floor_usd ?? parsed.candidates_usd[0]) * 100)
      ceilingCents = Math.round((parsed.ceiling_usd ?? parsed.candidates_usd[parsed.candidates_usd.length - 1] * 1.25) * 100)
      reasoning = parsed.reasoning ?? reasoning

      // Snap all candidates to price ladder, filter within [floor, ceiling]
      const rawCents = parsed.candidates_usd.map((d: number) => snapToLadder(Math.round(d) * 100))
      candidateCents = [...new Set(rawCents as number[])]
        .filter((c) => c >= floorCents && c <= ceilingCents && c > 0)
        .sort((a, b) => a - b)

      // Ensure anchor is included
      const snappedAnchor = snapToLadder(anchorFromClaude)
      if (!candidateCents.includes(snappedAnchor)) {
        candidateCents.push(snappedAnchor)
        candidateCents.sort((a, b) => a - b)
      }

      claudeSucceeded = true
      console.log(`[pricing/cold-start] Claude generated ${candidateCents.length} candidates for plan ${plan_id}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[pricing/cold-start] Claude failed, falling back to mechanical: ${msg}`)
    }
  } else {
    console.log(`[pricing/cold-start] No project brief for account ${accountId} — using mechanical bootstrap`)
  }

  // ── Mechanical fallback ────────────────────────────────────────────────────
  if (!claudeSucceeded || candidateCents.length < 2) {
    candidateCents = generatePriceCandidates(anchorCents, floorCents, ceilingCents)
    reasoning = "Mechanical spread bootstrap: anchor ±30-70% snapped to price ladder."
    console.log(`[pricing/cold-start] Mechanical fallback: ${candidateCents.length} candidates`)
  }

  if (candidateCents.length === 0) {
    return NextResponse.json({ error: "Could not generate price candidates" }, { status: 500 })
  }

  // ── Determine which candidate is anchor ───────────────────────────────────
  const anchorSnapped = snapToLadder(anchorCents)

  // ── Upsert price candidates ────────────────────────────────────────────────
  const rows = candidateCents.map((priceCents) => ({
    plan_id: plan.id,
    account_id: plan.account_id,
    interval: "monthly",
    price_cents: priceCents,
    is_anchor: priceCents === anchorSnapped,
    is_active: true,
  }))

  const { error: upsertError } = await service
    .from("plan_price_candidates")
    .upsert(rows, { onConflict: "plan_id,interval,price_cents", ignoreDuplicates: true })

  if (upsertError) {
    console.warn("[pricing/cold-start] upsert failed:", upsertError.message)
    return NextResponse.json({ ok: false, error: upsertError.message }, { status: 500 })
  }

  // ── Update plan floor/ceiling from Claude suggestion ──────────────────────
  await service
    .from("plans")
    .update({
      price_floor_cents: floorCents,
      price_ceiling_cents: ceilingCents,
    })
    .eq("id", plan_id)

  // ── Log scientist run ──────────────────────────────────────────────────────
  await service.from("pricing_scientist_runs").insert({
    account_id: accountId,
    plan_id,
    run_type: "cold_start",
    engine: claudeSucceeded ? "claude" : "in_house_model",
    data_maturity: 0,
    reasoning,
    actions: rows.map((r) => ({
      action: "add",
      price_cents: r.price_cents,
      is_anchor: r.is_anchor,
    })),
    model_used: claudeSucceeded ? "claude-opus-4-7" : null,
    tokens_in: tokensIn || null,
    tokens_out: tokensOut || null,
    duration_ms: Date.now() - t0,
  })

  console.log(
    `[pricing/cold-start] ✅ plan=${plan_id} engine=${claudeSucceeded ? "claude" : "mechanical"} candidates=${candidateCents.join(",")} floor=${floorCents} ceiling=${ceilingCents}`
  )

  return NextResponse.json({
    ok: true,
    engine: claudeSucceeded ? "claude" : "mechanical",
    candidates: candidateCents,
    floor_cents: floorCents,
    ceiling_cents: ceilingCents,
    reasoning,
    duration_ms: Date.now() - t0,
  })
}
