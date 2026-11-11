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

export function describeFrequency(code: string) {
  return FREQUENCY_OPTIONS.find((option) => option.code === code)?.description ?? code
}
