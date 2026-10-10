import { z } from "zod"

export const DOSE_UNITS = ["tablet", "capsule", "ml", "mg", "drops", "puff", "unit"] as const
export const ROUTE_OPTIONS = ["Oral", "IV", "IM", "Topical", "Inhaled", "Subcutaneous", "Rectal", "Ophthalmic", "Otic", "Nasal"] as const
export const DURATION_UNITS = ["days", "weeks", "months"] as const
export const FREQUENCY_CODES = ["OD", "BD", "TDS", "QID", "HS", "SOS", "Q6H", "Q8H", "Q12H", "STAT"] as const

export const FREQUENCY_OPTIONS = [
  { code: "OD", description: "Once daily" },
  { code: "BD", description: "Twice daily" },
  { code: "TDS", description: "Three times daily" },
  { code: "QID", description: "Four times daily" },
  { code: "HS", description: "At bedtime" },
  { code: "SOS", description: "As needed" },
  { code: "Q6H", description: "Every 6 hours" },
  { code: "Q8H", description: "Every 8 hours" },
  { code: "Q12H", description: "Every 12 hours" },
  { code: "STAT", description: "Immediately, once" },
] as const

export type DoseUnit = (typeof DOSE_UNITS)[number]
export type PrescriptionRoute = (typeof ROUTE_OPTIONS)[number]
export type DurationUnit = (typeof DURATION_UNITS)[number]
export type FrequencyCode = (typeof FREQUENCY_CODES)[number]

function prescriptionNumberSchema(label: string, max: number, integer = false) {
  let numberSchema = z.number({
    required_error: `${label} is missing.`,
    invalid_type_error: `${label} must be a number.`,
  }).finite().positive(`${label} must be greater than zero.`).max(max, `${label} is too large.`)
  if (integer) numberSchema = numberSchema.int(`${label} must be a whole number.`)
  return z.preprocess(
    (value) => value === "" || value === null || value === undefined
      ? undefined
      : typeof value === "string" ? Number(value) : value,
    numberSchema,
  )
}

export const prescriptionItemSchema = z.object({
  medicineId: z.string().uuid().nullable().optional().transform((value) => value ?? undefined),
  isCatalogItem: z.boolean({ required_error: "Choose a catalog medicine or select Other (not in catalog)." }),
  medicineName: z.string().trim().min(1, "Medicine is missing.").max(200),
  doseAmount: prescriptionNumberSchema("Dose", 10000),
  doseUnit: z.enum(DOSE_UNITS, { required_error: "Dose unit is missing." }),
  route: z.enum(ROUTE_OPTIONS, { required_error: "Route is missing." }),
  frequencyCode: z.enum(FREQUENCY_CODES, { required_error: "Frequency is missing." }),
  durationValue: prescriptionNumberSchema("Duration", 3650, true),
  durationUnit: z.enum(DURATION_UNITS, { required_error: "Duration unit is missing." }),
  instructions: z.string().max(500).nullable().optional().transform((value) => value ?? undefined),
}).superRefine((item, context) => {
  if (item.isCatalogItem && !item.medicineId) {
    context.addIssue({
      code: "custom",
      path: ["medicineId"],
      message: "Select a medicine from the pharmacy catalog.",
    })
  }
  if (!item.isCatalogItem && item.medicineId) {
    context.addIssue({
      code: "custom",
      path: ["medicineId"],
      message: "Other (not in catalog) cannot reference a catalog medicine.",
    })
  }
})

export const prescriptionItemsSchema = z.array(prescriptionItemSchema).min(1, "Add at least one medicine.")
  .superRefine((items, context) => {
    const firstById = new Map<string, number>()
    const firstByName = new Map<string, number>()
    items.forEach((item, index) => {
      const normalizedName = normalizeMedicineName(item.medicineName)
      const duplicateIndex = item.medicineId
        ? firstById.get(item.medicineId) ?? firstByName.get(normalizedName)
        : firstByName.get(normalizedName)
      if (duplicateIndex !== undefined) {
        context.addIssue({
          code: "custom",
          path: [index, "medicineName"],
          message: `Medicine duplicates Medicine ${duplicateIndex + 1}.`,
        })
        return
      }
      if (item.medicineId) firstById.set(item.medicineId, index)
      if (normalizedName) firstByName.set(normalizedName, index)
    })
  })

export function describeFrequency(code: string) {
  return FREQUENCY_OPTIONS.find((option) => option.code === code)?.description ?? code
}

export function normalizeMedicineName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

export function hasDuplicateMedicine(
  items: Array<{ medicineId?: string | null; medicineName: string }>,
) {
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  return items.some((item) => {
    if (item.medicineId) {
      if (seenIds.has(item.medicineId)) return true
      seenIds.add(item.medicineId)
    }
    const name = normalizeMedicineName(item.medicineName)
    if (name && seenNames.has(name)) return true
    if (name) seenNames.add(name)
    return false
  })
}

const MEDICATION_ALLERGY_GROUPS = [
  { allergens: ["penicillin"], medications: ["penicillin", "amoxicillin", "ampicillin", "augmentin", "flucloxacillin"] },
  { allergens: ["cephalosporin"], medications: ["cephalosporin", "cephalexin", "cefazolin", "cefuroxime", "cefixime", "ceftriaxone"] },
  { allergens: ["sulfa", "sulfonamide"], medications: ["sulfamethoxazole", "trimethoprim", "co-trimoxazole", "sulfasalazine"] },
  { allergens: ["nsaid", "aspirin"], medications: ["aspirin", "ibuprofen", "naproxen", "diclofenac", "ketorolac"] },
  { allergens: ["paracetamol", "acetaminophen"], medications: ["paracetamol", "acetaminophen"] },
  { allergens: ["tetracycline"], medications: ["tetracycline", "doxycycline", "minocycline"] },
  { allergens: ["macrolide"], medications: ["azithromycin", "clarithromycin", "erythromycin"] },
] as const

export function getMedicationAllergyMatches(
  allergies: string[],
  ...medicationNames: Array<string | null | undefined>
) {
  const medicines = medicationNames
    .filter((name): name is string => Boolean(name?.trim()))
    .map(normalizeMedicineName)
  const matches = new Set<string>()

  for (const allergy of allergies) {
    const normalizedAllergy = normalizeMedicineName(allergy)
    if (!normalizedAllergy) continue
    if (medicines.some((medicine) => medicine.includes(normalizedAllergy) || normalizedAllergy.includes(medicine))) {
      matches.add(allergy)
      continue
    }
    for (const group of MEDICATION_ALLERGY_GROUPS) {
      const allergyMatchesGroup = group.allergens.some((term) => normalizedAllergy.includes(normalizeMedicineName(term)))
      const medicineMatchesGroup = group.medications.some((term) =>
        medicines.some((medicine) => medicine.includes(normalizeMedicineName(term))),
      )
      if (allergyMatchesGroup && medicineMatchesGroup) {
        matches.add(allergy)
        break
      }
    }
  }

  return [...matches]
}
