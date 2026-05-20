import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are a conversion-rate optimizer helping build a pre-paywall qualification quiz for a SaaS product.

Given a project brief, generate 4-6 multiple-choice questions that:
1. Qualify the user's intent and urgency
2. Segment users by role, use case, or willingness to pay
3. Feel natural — like onboarding, not a sales interrogation
4. Each have 3-4 answer options

Rules:
- Questions should be short (under 12 words)
- Answers should be concise (under 6 words each)
- Vary question types: role identification, pain point, frequency of need, feature priority
- The last question should gauge urgency or budget readiness
- Return ONLY strictly valid JSON, no markdown, no explanation

JSON schema:
{
  "questions": [
    {
      "id": "string (slug, e.g. q1_role)",
      "question": "string",
      "type": "single_choice",
      "options": [
        { "value": "string (slug)", "label": "string" }
      ]
    }
  ]
}`

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { paywall_id } = await request.json()

    // Fetch the account's project brief
    const { data: profile } = await supabase
      .from("users")
      .select("account_id")
      .eq("id", user.id)
      .single()

    if (!profile?.account_id) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 })
    }

    const { data: brief } = await supabase
      .from("project_briefs")
      .select("app_description, icp_description, core_problem, emotional_drivers, key_benefits, tone_of_voice")
      .eq("account_id", profile.account_id)
      .maybeSingle()

    if (!brief?.app_description) {
      return NextResponse.json(
        { error: "Complete your Project Brief before generating quiz questions." },
        { status: 422 }
      )
    }

    const briefContext = [
      brief.app_description && `App: ${brief.app_description}`,
      brief.icp_description && `Ideal customer: ${brief.icp_description}`,
      brief.core_problem && `Core problem solved: ${brief.core_problem}`,
      brief.emotional_drivers?.length && `Emotional drivers: ${brief.emotional_drivers.join(", ")}`,
      brief.key_benefits?.length && `Key benefits: ${brief.key_benefits.join(", ")}`,
      brief.tone_of_voice && `Tone: ${brief.tone_of_voice}`,
    ].filter(Boolean).join("\n")

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: `Generate a pre-paywall qualification quiz for this app:\n\n${briefContext}`,
      }],
    })

    const raw = message.content[0]
    if (raw.type !== "text") {
      return NextResponse.json({ error: "Unexpected AI response" }, { status: 500 })
    }

    let parsed: { questions: unknown[] }
    try {
      const jsonText = raw.text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim()
      parsed = JSON.parse(jsonText)
    } catch {
      return NextResponse.json({ error: "Failed to parse AI response", raw: raw.text }, { status: 500 })
    }

    // Optionally save to paywall_quizzes if paywall_id provided
    if (paywall_id && parsed.questions?.length) {
      await supabase.from("paywall_quizzes").upsert({
        paywall_id,
        account_id: profile.account_id,
        questions: parsed.questions,
        is_active: false,
      }, { onConflict: "paywall_id" })
    }

    return NextResponse.json({ questions: parsed.questions })
  } catch (err) {
    console.error("generate-quiz-questions error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
