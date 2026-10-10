import type { BloodGroup } from "@/dashboard/types"

// Shared formatting utilities for the dashboard. Keep all PKR/date/id
// formatting centralized here so every module stays consistent.

export function formatCurrency(amount: number): string {
  const rounded = new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(Math.round(amount))
  return `PKR ${rounded}`
}

const HOSPITAL_TIMEZONE = "Asia/Karachi"
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function getHospitalDateKey(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: HOSPITAL_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date())
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "00"
  return `${part("year")}-${part("month")}-${part("day")}`
}

export function getHospitalDateKeyForTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp.slice(0, 10)
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: HOSPITAL_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date)
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "00"
  return `${part("year")}-${part("month")}-${part("day")}`
}

export function addDaysToDateKey(dateKey: string, daysToAdd: number): string {
  let [year, month, day] = dateKey.split("-").map(Number)
  const isLeapYear = (value: number) => value % 4 === 0 && (value % 100 !== 0 || value % 400 === 0)
  const daysInMonth = (value: number, monthIndex: number) => monthIndex === 2 ? (isLeapYear(value) ? 29 : 28) : [4, 6, 9, 11].includes(monthIndex) ? 30 : 31

  while (daysToAdd > 0) {
    const remaining = daysInMonth(year, month) - day
    if (daysToAdd <= remaining) { day += daysToAdd; daysToAdd = 0 }
    else { daysToAdd -= remaining + 1; day = 1; month += 1; if (month > 12) { month = 1; year += 1 } }
  }
  while (daysToAdd < 0) {
    if (-daysToAdd < day) { day += daysToAdd; daysToAdd = 0 }
    else { daysToAdd += day; month -= 1; if (month < 1) { month = 12; year -= 1 }; day = daysInMonth(year, month) }
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

export function weekdayIndexForDateKey(dateKey: string): number {
  const [yearValue, month, day] = dateKey.split("-").map(Number)
  const year = yearValue - (month < 3 ? 1 : 0)
  const monthOffsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]
  return (year + Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400) + monthOffsets[month - 1] + day) % 7
}

export function formatDate(iso: string): string {
  if (!iso) return "—"
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (dateOnly) {
    const month = Number(dateOnly[2])
    const day = Number(dateOnly[3])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${String(day).padStart(2, "0")} ${MONTHS[month - 1]} ${dateOnly[1]}`
  }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: HOSPITAL_TIMEZONE })
}

export function formatDateTime(iso: string): string {
  if (!iso) return "—"
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return formatDate(iso)
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${formatDate(iso)}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: HOSPITAL_TIMEZONE })}`
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


export function isValidPhone(phone: string): boolean {
  return /^03\d{9}$/.test(phone.replace(/\D/g, ""))
}

export function formatPakistaniPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "").slice(0, 11)
  return digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits
}

export function normalizePakistaniPhone(phone: string): string {
  return phone.replace(/\D/g, "")
}

export function formatPakistaniCNIC(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 13)
  if (digits.length <= 5) return digits
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`
}

export function displayPakistaniPhone(phone: string | null | undefined): string {
  if (!phone?.trim()) return "—"
  const digits = normalizePakistaniPhone(phone)
  return digits.length === 11 && digits.startsWith("03")
    ? `${digits.slice(0, 4)}-${digits.slice(4)}`
    : formatPakistaniPhone(phone)
}

const BLOOD_GROUP_LABELS: Record<string, BloodGroup> = {
  A_POS: "A+", A_NEG: "A-",
  B_POS: "B+", B_NEG: "B-",
  O_POS: "O+", O_NEG: "O-",
  AB_POS: "AB+", AB_NEG: "AB-",
  "A+": "A+", "A-": "A-",
  "B+": "B+", "B-": "B-",
  "O+": "O+", "O-": "O-",
  "AB+": "AB+", "AB-": "AB-",
}

export function formatBloodGroup(value: string | null | undefined): BloodGroup | "—" {
  if (!value) return "—"
  return BLOOD_GROUP_LABELS[value] ?? "—"
}

export function toApiBloodGroup(value: string): string {
  const label = formatBloodGroup(value)
  return label === "—" ? value : label.replace("+", "_POS").replace("-", "_NEG")
}

export function isValidCNIC(cnic: string): boolean {
  if (!cnic) return true
  return /^\d{5}-\d{7}-\d{1}$/.test(formatPakistaniCNIC(cnic))
}
