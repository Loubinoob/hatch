import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatMoney(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

export function formatPercent(value: number, decimals = 1) {
  return `${value.toFixed(decimals)}%`
}

export function formatNumber(n: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact" }).format(n)
}

export function generateApiKey(prefix = "pk_live") {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  const random = Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
  return `${prefix}_${random}`
}
