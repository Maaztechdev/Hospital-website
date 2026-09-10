// Shared formatting utilities for the dashboard. Keep all PKR/date/id
// formatting centralized here so every module stays consistent.

export function formatCurrency(amount: number): string {
  const rounded = Math.round(amount)
  const currency = (() => { try { return JSON.parse(localStorage.getItem("careplus.hospitalProfile") || "{}").currency || "PKR" } catch { return "PKR" } })()
  return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(rounded)
}

function hospitalTimezone() {
  try { return JSON.parse(localStorage.getItem("careplus.hospitalProfile") || "{}").timezone || "Asia/Karachi" } catch { return "Asia/Karachi" }
}

export function formatDate(iso: string): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: hospitalTimezone() })
}

export function formatDateTime(iso: string): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${formatDate(iso)}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: hospitalTimezone() })}`
}

export function formatTimeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffSec = Math.max(0, Math.floor((now - then) / 1000))
  if (diffSec < 60) return "just now"
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} min ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr} hr ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay} day${diffDay > 1 ? "s" : ""} ago`
}

export function formatWaitingTime(iso?: string): string {
  if (!iso) return "—"
  const then = new Date(iso).getTime()
  const diffMin = Math.max(0, Math.floor((Date.now() - then) / 60000))
  const h = Math.floor(diffMin / 60)
  const m = diffMin % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

let mrCounter = 124
export function generateMRNumber(): string {
  mrCounter += 1
  const year = new Date().getFullYear()
  return `MR-${year}-${String(mrCounter).padStart(6, "0")}`
}

let idCounter = 1000
export function generateId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${idCounter}`
}

export function calcAge(dob: string): number {
  const birth = new Date(dob)
  if (Number.isNaN(birth.getTime())) return 0
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const m = now.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--
  return age
}

export function isValidPhone(phone: string): boolean {
  return /^(\+92|0)3\d{9}$/.test(phone.replace(/[\s-]/g, ""))
}

export function isValidCNIC(cnic: string): boolean {
  if (!cnic) return true
  return /^\d{5}-\d{7}-\d{1}$/.test(cnic)
}
