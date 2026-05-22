import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { computeSegmentHash, bucketHour } from "@/lib/segment"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

// Public endpoint — called by SDK after quiz completion to persist responses
export async function POST(request: NextRequest) {
  const body = await request.json()
  const {
    apiKey,
    paywallId,
    quizId,
    sessionId,
    userIdExternal,
    answers,        // { q1_role: "developer", q2_intent: "high" }
    segmentHash,    // passed back from config response
    utmSource,
    device,
    returning,
  } = body

  if (!apiKey || !answers) {
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

  // Compute segment hash from quiz answers (authoritative source)
  const { hash: computedHash, features } = computeSegmentHash({
    quiz_answers: answers,
    utm_source: utmSource ?? null,
    device: device ?? "desktop",
    returning: returning === true || returning === "1",
    hour_bucket: bucketHour(),
  })

  const resolvedSegmentHash = segmentHash ?? computedHash

  // Upsert quiz response
  await supabase.from("quiz_responses").upsert(
    {
      account_id: user.account_id,
      paywall_id: paywallId ?? null,
      quiz_id: quizId ?? null,
      session_id: sessionId ?? null,
      user_id_external: userIdExternal ?? null,
      answers,
      segment_hash: resolvedSegmentHash,
      derived_features: features,
    },
    { onConflict: "quiz_id,session_id", ignoreDuplicates: false }
  )

  return NextResponse.json({ ok: true, segment_hash: resolvedSegmentHash }, { headers: CORS_HEADERS })
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS })
}
