import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"
import { makeBlock } from "@/lib/blocks/utils"
import type { BlockType } from "@/lib/blocks/types"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// The valid block types the AI is allowed to produce
const VALID_BLOCK_TYPES: BlockType[] = [
  "hero", "plans", "features", "testimonials", "logos",
  "comparison", "faq", "urgency", "guarantee", "video", "stats", "footer",
]

const SYSTEM_PROMPT = `You are an expert SaaS conversion designer specialising in paywall screens. Your job is to design a complete, high-converting paywall using a block-based system.

You will receive a project brief and must return a JSON object describing the optimal paywall layout for that product. Do NOT wrap the JSON in markdown. Output raw JSON only.

Available block types and their configurable props:

hero        – eyebrow(str|null), headline(str), subheadline(str|null), alignment("left"|"center")
plans       – ctaCopy(str), yearlyToggle(bool)
features    – title(str|null), items([{icon:str,text:str}])
testimonials– title(str|null), items([{quote:str,author:str,role:str}])
logos       – title(str|null), items([{name:str}])
comparison  – title(str|null), rows([{feature:str,values:[str,str]}])
faq         – title(str|null), items([{question:str,answer:str}])
urgency     – text(str), subtext(str|null)
guarantee   – text(str)
video       – title(str|null), url(str|null)
stats       – items([{value:str,label:str}])
footer      – text(str), showPoweredBy(bool)

Return this exact structure:
{
  "display_mode": "modal" | "fullscreen",
  "theme": {
    "accentColor": "#hexcolor",
    "fontFamily": "system" | "serif" | "mono",
    "buttonShape": "rounded" | "pill" | "square"
  },
  "blocks": [
    { "type": "<block_type>", "props": { ...block-specific props } }
  ],
  "reasoning": "1-2 sentences explaining the layout choices"
}

Guidelines:
- Always include a hero block first and a plans block
- Always include a footer block last
- A modal paywall should have 3-5 blocks (compact)
- A fullscreen paywall can have 6-10 blocks (more content, social proof, etc.)
- Choose display_mode based on what suits the product best
- Write copy that is specific to the product, not generic filler
- The plans block always shows the actual plan data — you just provide ctaCopy
- For features/testimonials/comparison, write realistic, specific content
- Return at most 10 blocks total`

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase
      .from("users").select("account_id").eq("id", user.id).single()

    if (!profile?.account_id) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 })
    }

    const { paywall_id } = await request.json()
    if (!paywall_id) return NextResponse.json({ error: "paywall_id required" }, { status: 400 })

    // Fetch paywall, brief and plans in parallel
    const [{ data: paywall }, { data: brief }, { data: plans }] = await Promise.all([
      supabase.from("paywalls").select("*").eq("id", paywall_id).single(),
      supabase.from("project_briefs").select("*").eq("account_id", profile.account_id).single(),
      supabase.from("plans")
        .select("name, price_monthly, price_yearly, features")
        .eq("account_id", profile.account_id)
        .order("price_monthly", { ascending: true }),
    ])

    if (!paywall) return NextResponse.json({ error: "Paywall not found" }, { status: 404 })

    if (!brief?.completed_at) {
      return NextResponse.json({
        error: "Complete your Project Brief in Settings before using AI generation.",
      }, { status: 400 })
    }

    const plansSummary = (plans ?? []).map(p =>
      `${p.name}: $${Math.round(p.price_monthly / 100)}/mo${p.price_yearly > 0 ? ` ($${Math.round(p.price_yearly / 100)}/yr)` : ""} — features: ${(p.features ?? []).slice(0, 4).join(", ")}`
    ).join("\n") || "No plans configured yet"

    const userPrompt = `Design a high-converting paywall for this product:

App: ${brief.app_description}
Category: ${brief.app_category ?? "SaaS"}
Target customer: ${brief.icp_description}
Problem solved: ${brief.core_problem}
Key benefits: ${(brief.key_benefits ?? []).join(", ")}
Tone of voice: ${brief.tone_of_voice ?? "professional"}
Competitors: ${(brief.competitors ?? []).join(", ") || "N/A"}

Pricing plans:
${plansSummary}

Paywall name: ${paywall.name}
Current headline: ${paywall.headline ?? "(none)"}

Design the optimal paywall blocks for this product. Make the copy specific and compelling.`

    const message = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    })

    const raw = message.content[0]
    if (raw.type !== "text") {
      return NextResponse.json({ error: "Unexpected AI response" }, { status: 500 })
    }

    // Strip markdown fences if present
    const jsonText = raw.text
      .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim()

    let parsed: {
      display_mode: "modal" | "fullscreen"
      theme: { accentColor?: string; fontFamily?: string; buttonShape?: string }
      blocks: Array<{ type: string; props: Record<string, unknown> }>
      reasoning: string
    }

    try {
      parsed = JSON.parse(jsonText)
    } catch {
      return NextResponse.json({ error: "Failed to parse AI response", raw: raw.text }, { status: 500 })
    }

    // Validate and hydrate blocks
    const hydratedBlocks = (parsed.blocks ?? [])
      .filter(b => VALID_BLOCK_TYPES.includes(b.type as BlockType))
      .slice(0, 12)
      .map(b => makeBlock(b.type as BlockType, b.props ?? {}))

    if (hydratedBlocks.length === 0) {
      return NextResponse.json({ error: "AI returned no valid blocks" }, { status: 500 })
    }

    // Persist to DB using service role (bypasses RLS for updates)
    const service = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    await service.from("paywalls").update({
      blocks: hydratedBlocks,
      display_mode: parsed.display_mode ?? "modal",
      updated_at: new Date().toISOString(),
    }).eq("id", paywall_id)

    // Log to agent_runs
    try {
      await service.from("agent_runs").insert({
        paywall_id,
        account_id: profile.account_id,
        run_type: "generation",
        status: "succeeded",
        reasoning: parsed.reasoning,
        output_summary: {
          blocks_count: hydratedBlocks.length,
          display_mode: parsed.display_mode,
          theme: parsed.theme,
          block_types: hydratedBlocks.map(b => b.type),
        },
      })
    } catch {
      // Non-critical — log failure silently
    }

    return NextResponse.json({
      ok: true,
      display_mode: parsed.display_mode,
      theme: parsed.theme,
      blocks: hydratedBlocks,
      reasoning: parsed.reasoning,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    console.error("[generate-paywall]", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
