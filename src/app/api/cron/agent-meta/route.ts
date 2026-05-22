import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"

export const dynamic = "force-dynamic"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const META_SYSTEM_PROMPT = `You are a strategic growth analyst reviewing experiments across multiple paywalls of the same product.

Your goal: find HIGHER-ORDER PATTERNS that span individual paywalls.

Look for:
- Audience segments that systematically prefer certain angles
- Time-of-day or device patterns in conversion data
- Pricing anchors that consistently outperform
- Words/phrases/emotional triggers that recur in winning variants
- Categories of approaches that consistently fail

Return strict JSON:
{
  "insights": [
    {
      "insight": "string (1 declarative sentence, cross-paywall scope)",
      "category": "copy|pricing|timing|audience|design|cta|social_proof|other",
      "importance": 1-10,
      "learning_type": "positive_pattern|negative_pattern|observation",
      "segment_conditions": {},
      "evidence_summary": "string (which paywalls, sample sizes, deltas)"
    }
  ],
  "antipatterns": [
    {
      "pattern_type": "angle|wording|price_anchor|design|cta_style|length|tone",
      "description": "string (1 sentence, declarative)",
      "evidence": { "paywall_count": 0, "avg_conv_delta": -0.0 },
      "confidence": 0.0
    }
  ],
  "strategic_recommendation": "string (2-3 sentences: what should be tested in the next 7 days across all paywalls)"
}`

// Max 5 meta-reflections per account per day
const MAX_META_RUNS = 5

export async function GET(request: NextRequest) {
  const secret = request.headers.get("authorization")
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Get all accounts that had agent activity in the last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: activeAccounts } = await service
    .from("agent_runs")
    .select("account_id")
    .gte("created_at", sevenDaysAgo)
    .eq("status", "succeeded")

  if (!activeAccounts?.length) {
    return NextResponse.json({ ok: true, message: "No active accounts in last 7 days" })
  }

  const accountIds = [...new Set(activeAccounts.map(r => r.account_id).filter(Boolean))]
  const results = []

  for (const accountId of accountIds) {
    try {
      // Cost guard per account
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { count: metaRuns } = await service
        .from("agent_runs")
        .select("*", { count: "exact", head: true })
        .eq("account_id", accountId)
        .eq("run_type", "meta_reflection")
        .gte("created_at", since24h)
      if ((metaRuns ?? 0) >= MAX_META_RUNS) {
        results.push({ account_id: accountId, status: "rate_limited" })
        continue
      }

      // Fetch all paywall-level insights from last 7 days
      const [{ data: insights }, { data: paywalls }] = await Promise.all([
        service
          .from("agent_insights")
          .select("insight, category, importance, learning_type, paywall_id")
          .eq("account_id", accountId)
          .gte("generated_at", sevenDaysAgo)
          .order("importance", { ascending: false })
          .limit(50),
        service
          .from("paywalls")
          .select("id, headline, views, conversions")
          .eq("account_id", accountId)
          .eq("status", "live"),
      ])

      if (!insights?.length) {
        results.push({ account_id: accountId, status: "skipped", reason: "no insights" })
        continue
      }

      // Build paywall summary
      const paywallSummary = (paywalls ?? []).map(p => {
        const convRate = p.views > 0 ? ((p.conversions / p.views) * 100).toFixed(2) + "%" : "—"
        return `"${p.headline}" (${p.views} views, ${convRate} conv)`
      }).join("\n")

      const insightSummary = (insights ?? []).map(i =>
        `[${i.category}, ${i.importance}/10, ${i.learning_type}] ${i.insight} (paywall: ${i.paywall_id})`
      ).join("\n")

      const { data: run } = await service.from("agent_runs").insert({
        account_id: accountId,
        paywall_id: null,
        run_type: "meta_reflection",
        status: "running",
        model_used: "claude-opus-4-7",
        input_summary: { insights_count: insights.length, paywalls_count: paywalls?.length },
      }).select().single()

      const userPrompt = `Review 7-day experiment data across all paywalls for this account.

PAYWALLS:
${paywallSummary || "No live paywalls."}

RECENT INSIGHTS (last 7 days across all paywalls):
${insightSummary}

Synthesize cross-paywall patterns. Focus on what's universal vs. paywall-specific.`

      const message = await anthropic.messages.create({
        model: "claude-opus-4-7",
        max_tokens: 2000,
        system: META_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      })

      const raw = message.content[0]
      if (raw.type !== "text") throw new Error("Unexpected AI response")

      const jsonText = raw.text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim()
      const parsed = JSON.parse(jsonText)

      // Insert cross-paywall insights (paywall_id = null = account-level)
      let insightsCreated = 0
      for (const insight of (parsed.insights ?? [])) {
        await service.from("agent_insights").insert({
          account_id: accountId,
          paywall_id: null, // Global to account
          insight: insight.insight,
          category: insight.category,
          importance: Math.min(10, Math.max(1, insight.importance ?? 5)),
          learning_type: insight.learning_type ?? "observation",
          segment_conditions: insight.segment_conditions ?? {},
          evidence: { summary: insight.evidence_summary },
        })
        insightsCreated++
      }

      // Insert new anti-patterns
      for (const ap of (parsed.antipatterns ?? [])) {
        const { data: existing } = await service
          .from("agent_antipatterns")
          .select("id")
          .eq("account_id", accountId)
          .eq("description", ap.description)
          .maybeSingle()
        if (!existing) {
          await service.from("agent_antipatterns").insert({
            account_id: accountId,
            pattern_type: ap.pattern_type ?? "angle",
            description: ap.description,
            evidence: ap.evidence ?? {},
            confidence: Math.min(1, Math.max(0, ap.confidence ?? 0.5)),
            active: true,
          })
        }
      }

      await service.from("agent_runs").update({
        status: "succeeded",
        reasoning: parsed.strategic_recommendation,
        output_summary: {
          insights_created: insightsCreated,
          antipatterns_created: (parsed.antipatterns ?? []).length,
          strategic_recommendation: parsed.strategic_recommendation,
        },
        tokens_in: message.usage.input_tokens,
        tokens_out: message.usage.output_tokens,
      }).eq("id", run?.id)

      results.push({ account_id: accountId, status: "ok", insights_created: insightsCreated })

    } catch (err) {
      results.push({ account_id: accountId, status: "error", error: err instanceof Error ? err.message : String(err) })
    }
  }

  return NextResponse.json({ ok: true, accounts_processed: results.length, results })
}
