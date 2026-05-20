import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const DRIVER_LABELS: Record<string, string> = {
  fear_of_missing_out: "Fear of Missing Out",
  desire_for_status: "Desire for Status",
  productivity_gain: "Productivity Gain",
  cost_savings: "Cost Savings",
  competitive_edge: "Competitive Edge",
  peace_of_mind: "Peace of Mind",
  social_proof: "Social Proof",
  exclusivity: "Exclusivity / VIP",
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase
      .from("users")
      .select("account_id")
      .eq("id", user.id)
      .single()

    if (!profile?.account_id) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 })
    }

    // Fetch project brief
    const { data: brief } = await supabase
      .from("project_briefs")
      .select("*")
      .eq("account_id", profile.account_id)
      .single()

    if (!brief?.completed_at) {
      return NextResponse.json({
        error: "Project brief not completed. Please complete your Project Brief in Settings before generating AI copy.",
      }, { status: 400 })
    }

    // Get plans for pricing context
    const { data: plans } = await supabase
      .from("plans")
      .select("name, price_monthly, price_yearly, features")
      .eq("account_id", profile.account_id)
      .order("price_monthly", { ascending: true })

    const { paywall_id, emotional_drivers } = await request.json()

    const driversToGenerate: string[] = emotional_drivers?.length
      ? emotional_drivers
      : brief.emotional_drivers?.length
        ? brief.emotional_drivers.slice(0, 3)
        : ["productivity_gain", "fear_of_missing_out", "desire_for_status"]

    const plansSummary = plans?.map(p =>
      `${p.name}: $${p.price_monthly / 100}/mo (yearly: $${p.price_yearly / 100}/yr)`
    ).join(", ") ?? "No plans configured yet"

    const systemPrompt = `You are a world-class SaaS copywriter specializing in high-converting paywall and upgrade screens. You write copy that feels genuine, specific, and tailored — never generic. You understand the emotional psychology of purchasing decisions and write copy that speaks directly to the user's motivations.

Your output must be valid JSON. No markdown, no explanation — just the JSON object.`

    const userPrompt = `Generate paywall copy for this app:

**App:** ${brief.app_description}
**Category:** ${brief.app_category ?? "SaaS"}
**Target customer (ICP):** ${brief.icp_description}
**Core problem solved:** ${brief.core_problem}
**Key benefits:** ${brief.key_benefits?.join(", ")}
**Competitors:** ${brief.competitors?.join(", ") ?? "N/A"}
**Price anchor:** ${brief.price_anchor ?? "Not specified"}
**Tone:** ${brief.tone_of_voice ?? "professional"}
**Pricing:** ${plansSummary}

Generate 3 paywall copy variations, one for each of these emotional drivers: ${driversToGenerate.map(d => DRIVER_LABELS[d] ?? d).join(", ")}.

For each variation, return:
- emotional_driver: the driver key (e.g. "fear_of_missing_out")
- headline: A powerful, specific headline (max 10 words). No generic phrases like "Unlock Premium Features".
- subheadline: A 1-2 sentence supporting statement that adds specificity and urgency (max 25 words).
- cta_text: Call-to-action button text (2-5 words, action-oriented).
- body_copy: 2-3 bullet points highlighting key benefits. Each bullet starts with an emoji.
- tone: How this copy feels (e.g. "urgent", "aspirational", "reassuring").

Respond with this exact JSON structure:
{
  "variations": [
    {
      "emotional_driver": "string",
      "headline": "string",
      "subheadline": "string",
      "cta_text": "string",
      "body_copy": "string",
      "tone": "string"
    }
  ]
}`

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
      messages: [{ role: "user", content: userPrompt }],
      system: systemPrompt,
    })

    const rawContent = message.content[0]
    if (rawContent.type !== "text") {
      return NextResponse.json({ error: "Unexpected response from AI" }, { status: 500 })
    }

    let parsed: { variations: Array<{
      emotional_driver: string
      headline: string
      subheadline: string
      cta_text: string
      body_copy: string
      tone: string
    }> }

    try {
      // Strip markdown code blocks if present
      const jsonText = rawContent.text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim()
      parsed = JSON.parse(jsonText)
    } catch {
      return NextResponse.json({ error: "Failed to parse AI response", raw: rawContent.text }, { status: 500 })
    }

    // Save suggestions to DB
    if (parsed.variations?.length) {
      for (const v of parsed.variations) {
        await supabase.from("paywall_copy_suggestions").insert({
          account_id: profile.account_id,
          paywall_id: paywall_id ?? null,
          emotional_driver: v.emotional_driver,
          headline: v.headline,
          subheadline: v.subheadline,
          cta_text: v.cta_text,
          body_copy: v.body_copy,
          tone: v.tone,
        })
      }
    }

    return NextResponse.json({ variations: parsed.variations })
  } catch (err) {
    console.error("AI copy generation error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
