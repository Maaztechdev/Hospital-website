import type { ApiUltrasoundOrder, ApiUltrasoundStructuredValue, ApiUltrasoundTemplate, ApiUltrasoundTemplateField } from "@/lib/api"

export const ULTRASOUND_SCAN_TYPES = ["Obstetric", "Abdomen", "KUB", "Renal", "Pelvis", "Thyroid", "Breast", "Doppler", "Other"] as const

const TEMPLATE_TYPES: ApiUltrasoundTemplateField["type"][] = ["organ", "text", "number", "date", "select", "estimatedDueDate", "gestationalAge"]

export function getTemplateFields(template?: ApiUltrasoundTemplate): ApiUltrasoundTemplateField[] {
  if (!template || !Array.isArray(template.sections)) return []
  return template.sections.filter((item): item is ApiUltrasoundTemplateField => {
    if (!item || typeof item !== "object") return false
    const field = item as Partial<ApiUltrasoundTemplateField>
    return typeof field.key === "string" && typeof field.label === "string" && typeof field.type === "string" && TEMPLATE_TYPES.includes(field.type as ApiUltrasoundTemplateField["type"])
  })
}

function matchesType(examType: string, templateType: string) {
  const exam = examType.trim().toLowerCase()
  const template = templateType.trim().toLowerCase()
  if (exam === template) return true
  if (template === "abdomen" && /abdominal|abdomen/.test(exam)) return true
  if (template === "obstetric" && /\b(ob|obs|obstetric|pregnan)/.test(exam)) return true
  if (template === "kub" && /\bkub\b/.test(exam)) return true
  if (template === "renal" && /renal|kidney/.test(exam)) return true
  if (template === "pelvis" && /pelvi/.test(exam)) return true
  if (template === "thyroid" && /thyroid/.test(exam)) return true
  if (template === "breast" && /breast/.test(exam)) return true
  if (template === "doppler" && /doppler/.test(exam)) return true
  return false
}

export function templateForOrder(templates: ApiUltrasoundTemplate[], order?: ApiUltrasoundOrder | null) {
  if (!order) return undefined
  return templates.find((template) => template.examinationType.toLowerCase() !== "other" && matchesType(order.examType, template.examinationType))
    ?? templates.find((template) => template.examinationType.toLowerCase() === "other")
}

export function initialStructuredData(fields: ApiUltrasoundTemplateField[], values?: Record<string, ApiUltrasoundStructuredValue> | null) {
  const initial: Record<string, ApiUltrasoundStructuredValue> = { ...values }
  for (const field of fields) {
    if (field.type === "organ" && !initial[field.key]) initial[field.key] = { status: "NORMAL", notes: "" }
  }
  return initial
}

function lmpDate(value: ApiUltrasoundStructuredValue | undefined) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function dateOffsetFromToday(value: Date) {
  const now = new Date()
  const inputDay = Date.UTC(value.getFullYear(), value.getMonth(), value.getDate())
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.floor((today - inputDay) / 86_400_000)
}

export function calculatedValue(field: ApiUltrasoundTemplateField, values: Record<string, ApiUltrasoundStructuredValue>) {
  if (field.type !== "estimatedDueDate" && field.type !== "gestationalAge") return ""
  const lmp = lmpDate(values[field.calculatedFrom ?? "lmp"])
  if (!lmp) return ""
  if (field.type === "estimatedDueDate") {
    const dueDate = new Date(lmp)
    dueDate.setDate(dueDate.getDate() + 280)
    return `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, "0")}-${String(dueDate.getDate()).padStart(2, "0")}`
  }
  const days = dateOffsetFromToday(lmp)
  if (days < 0) return ""
  return `${Math.floor(days / 7)} weeks ${days % 7} days`
}

export function generateFindings(fields: ApiUltrasoundTemplateField[], values: Record<string, ApiUltrasoundStructuredValue>, gender?: string) {
  return fields.flatMap((field) => {
    if (field.patientGender && field.patientGender !== gender) return []
    const value = values[field.key]
    if (field.type === "organ") {
      const organ = value && typeof value === "object" ? value : { status: "NORMAL", notes: "" }
      return [`${field.label}: ${organ.status === "ABNORMAL" ? "Abnormal" : "Normal"}${organ.notes ? ` — ${organ.notes}` : ""}.`]
    }
    const result = field.type === "estimatedDueDate" || field.type === "gestationalAge" ? calculatedValue(field, values) : value
    if (typeof result !== "string" && typeof result !== "number") return []
    const text = String(result).trim()
    return text ? [`${field.label}: ${text}${field.unit ? ` ${field.unit}` : ""}.`] : []
  }).join("\n")
}

export function fieldDisplayValue(field: ApiUltrasoundTemplateField, value: ApiUltrasoundStructuredValue | undefined) {
  if (field.type === "organ") {
    const organ = value && typeof value === "object" ? value : { status: "NORMAL", notes: "" }
    return `${organ.status === "ABNORMAL" ? "Abnormal" : "Normal"}${organ.notes ? ` — ${organ.notes}` : ""}`
  }
  if (value === null || value === undefined || value === "") return "Not recorded"
  return `${value}${field.unit && typeof value === "string" && field.type !== "date" ? ` ${field.unit}` : ""}`
}

export function validateStructuredData(fields: ApiUltrasoundTemplateField[], values: Record<string, ApiUltrasoundStructuredValue>) {
  for (const field of fields) {
    const value = values[field.key]
    if (field.type === "date" && typeof value === "string" && value) {
      const date = lmpDate(value)
      if (!date) return `${field.label} must be a valid date.`
      if (field.key === "lmp" && date.getTime() > Date.now()) return `${field.label} cannot be in the future.`
    }
    if (field.type === "number" && typeof value === "string" && value.trim()) {
      const number = Number(value)
      if (!Number.isFinite(number) || number < 0) return `${field.label} must be a non-negative number.`
    }
  }
  return ""
}

export function structuredDataForSave(fields: ApiUltrasoundTemplateField[], values: Record<string, ApiUltrasoundStructuredValue>) {
  const saved = { ...values }
  for (const field of fields) {
    if (field.type === "estimatedDueDate" || field.type === "gestationalAge") {
      saved[field.key] = calculatedValue(field, values)
    }
  }
  return saved
}
