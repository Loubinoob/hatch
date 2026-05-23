import { NextRequest, NextResponse } from "next/server"

// Diagnostic endpoint — shows environment config without revealing secrets.
// Protected by DEBUG_SECRET env var (or open in development).
export async function GET(request: NextRequest) {
  const secret = process.env.DEBUG_SECRET
  const isDev = process.env.NODE_ENV === "development"

  // In production, require ?secret=xxx matching DEBUG_SECRET env var
  if (!isDev) {
    if (!secret) {
      return NextResponse.json({ error: "Set DEBUG_SECRET env var to use this endpoint in production" }, { status: 403 })
    }
    const provided = request.nextUrl.searchParams.get("secret")
    if (provided !== secret) {
      return NextResponse.json({ error: "Invalid secret" }, { status: 403 })
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  const dbRef = supabaseUrl.match(/https?:\/\/([^.]+)\.supabase/)?.[1] ?? "unknown"

  return NextResponse.json({
    env: process.env.NODE_ENV,
    db_ref: dbRef,
    supabase_url: supabaseUrl || "(not set)",
    app_url: process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "(not set)",
    vercel_env: process.env.VERCEL_ENV || "local",
    vercel_region: process.env.VERCEL_REGION || null,
    has_service_role_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    has_stripe_secret: !!process.env.STRIPE_SECRET_KEY,
    has_stripe_webhook_secret: !!process.env.STRIPE_WEBHOOK_SECRET,
    has_openai_key: !!process.env.OPENAI_API_KEY,
    has_debug_secret: !!secret,
  })
}
