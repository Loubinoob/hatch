import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type") as "magiclink" | "signup" | "recovery" | null
  const next = searchParams.get("next") ?? "/dashboard"
  const errorParam = searchParams.get("error")
  const errorDescription = searchParams.get("error_description")

  // Surface Supabase errors back to the login page
  if (errorParam) {
    const msg = errorDescription ?? errorParam
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(msg)}`
    )
  }

  const supabase = await createClient()

  // PKCE flow (email+password signup confirmation, OAuth)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return redirectAfterAuth(supabase, origin, next)
  }

  // OTP / magic link flow
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    if (!error) return redirectAfterAuth(supabase, origin, next)
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}

async function redirectAfterAuth(
  supabase: Awaited<ReturnType<typeof createClient>>,
  origin: string,
  next: string
) {
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data: profile } = await supabase
      .from("users")
      .select("onboarding_completed")
      .eq("id", user.id)
      .maybeSingle()

    // New user (no row yet) or onboarding incomplete → onboarding
    if (!profile?.onboarding_completed) {
      return NextResponse.redirect(`${origin}/onboarding`)
    }
  }
  return NextResponse.redirect(`${origin}${next}`)
}
