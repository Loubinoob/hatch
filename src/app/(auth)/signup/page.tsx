import { redirect } from "next/navigation"

// Signup is now handled on the unified login page (Sign up tab)
export default function SignupPage() {
  redirect("/login")
}
