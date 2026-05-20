import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// Uses service role to create a user with email already confirmed —
// no confirmation email sent, no rate limit hit.
export async function POST(request: Request) {
  try {
    const { email, password, name } = await request.json()

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 })
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name ?? "" },
    })

    if (error) {
      // "User already registered" → still a success from the caller's POV
      // (they'll get the real error on signInWithPassword)
      if (error.message.toLowerCase().includes("already registered") ||
          error.message.toLowerCase().includes("already been registered")) {
        return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
