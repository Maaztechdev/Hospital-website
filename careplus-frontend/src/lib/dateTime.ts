const HOSPITAL_TIMEZONE = "Asia/Karachi"
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function getHospitalDateKey(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HOSPITAL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "00"
  return `${part("year")}-${part("month")}-${part("day")}`
}

export function getHospitalDateKeyForTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp.slice(0, 10)
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HOSPITAL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "00"
  return `${part("year")}-${part("month")}-${part("day")}`
}

export function formatDate(value: string): string {
  if (!value) return "—"
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnly) {
    const month = Number(dateOnly[2])
    const day = Number(dateOnly[3])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${String(day).padStart(2, "0")} ${MONTHS[month - 1]} ${dateOnly[1]}`
    }
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: HOSPITAL_TIMEZONE,
  })
}

export function formatTime(value: string | Date): string {
  if (!value) return "—"
  const raw = value instanceof Date ? value.toISOString() : value
  const timeOnly = /^(\d{1,2}):(\d{2})$/.exec(raw)
  if (timeOnly) {
    const hour = Number(timeOnly[1])
    const minute = Number(timeOnly[2])
    if (hour > 23 || minute > 59) return raw
    const date = new Date(Date.UTC(2020, 0, 1, hour, minute))
    return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "UTC" })
  }
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: HOSPITAL_TIMEZONE,
  })
}

export function getTimeOfDayMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(value.trim())
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2])
  const meridiem = match[3]?.toUpperCase()
  if (minute > 59) return null
  if (meridiem) {
    if (hour < 1 || hour > 12) return null
    hour = hour % 12 + (meridiem === "PM" ? 12 : 0)
  } else if (hour > 23) return null
  return hour * 60 + minute
}

export function formatDateTime(value: string): string {
  if (!value) return "—"
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${formatDate(value)}, ${formatTime(value)}`
}

export function formatWeekday(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(`${value}T12:00:00+05:00`)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString("en-US", { weekday: "short", timeZone: HOSPITAL_TIMEZONE })
}

export function formatMonthDay(value: string | Date): string {
  return formatDate(value instanceof Date ? getHospitalDateKeyForTimestamp(value.toISOString()) : value).replace(/ \d{4}$/, "")
}
