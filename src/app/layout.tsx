import type { Metadata } from "next"
import { Inter, Bricolage_Grotesque, JetBrains_Mono } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/sonner"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
})

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
})

export const metadata: Metadata = {
  title: "Hatch — Paywall SDK for AI-built apps",
  description: "Add a paywall to your Lovable, Bolt, or Replit app in one line of code.",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark h-full">
      <body className={`${inter.variable} ${bricolage.variable} ${jetbrainsMono.variable} font-sans min-h-full`}>
        {children}
        <Toaster position="bottom-right" theme="dark" />
      </body>
    </html>
  )
}
