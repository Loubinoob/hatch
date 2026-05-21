import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function POST(request: Request) {
  try {
    const { email } = await request.json()
    if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 })

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Find the user by email
    const { data: { users }, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000, page: 1 })
    if (listError) return NextResponse.json({ error: listError.message }, { status: 500 })

    const target = users.find(u => u.email?.toLowerCase() === email.toLowerCase())
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 })

    // Confirm the email
    const { error: updateError } = await admin.auth.admin.updateUserById(target.id, {
      email_confirm: true,
    })
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
