export type LabParameterInterpretation = "LOW" | "NORMAL" | "HIGH" | "CRITICAL_LOW" | "CRITICAL_HIGH"

export interface LabRangeCandidate {
  gender: "MALE" | "FEMALE" | "ANY"
  ageMinDays: number | null
  ageMaxDays: number | null
  low: number | string | null
  high: number | string | null
  criticalLow: number | string | null
  criticalHigh: number | string | null
}

export interface LabCriticalThresholdDefaults {
  criticalLow?: number | string | null
  criticalHigh?: number | string | null
}

function numeric(value: number | string | null) {
  return value == null ? null : Number(value)
}

function ageMatches(range: LabRangeCandidate, ageDays: number) {
  return (range.ageMinDays == null || ageDays >= range.ageMinDays)
    && (range.ageMaxDays == null || ageDays <= range.ageMaxDays)
}

function narrowestFirst(ranges: LabRangeCandidate[]) {
  return [...ranges].sort((left, right) => {
    const leftSpan = (left.ageMaxDays ?? Number.MAX_SAFE_INTEGER) - (left.ageMinDays ?? 0)
    const rightSpan = (right.ageMaxDays ?? Number.MAX_SAFE_INTEGER) - (right.ageMinDays ?? 0)
    return leftSpan - rightSpan
  })
}

export function resolveLabReferenceRange(
  ranges: LabRangeCandidate[],
  gender?: string | null,
  ageDays?: number | null,
): LabRangeCandidate | null {
  const recognizedGender = gender === "MALE" || gender === "FEMALE" ? gender : null
  const genderGroups = recognizedGender
    ? [ranges.filter((range) => range.gender === recognizedGender), ranges.filter((range) => range.gender === "ANY")]
    : [ranges.filter((range) => range.gender === "ANY")]

  for (const group of genderGroups) {
    const eligible = ageDays == null
      ? group.filter((range) => range.ageMinDays == null && range.ageMaxDays == null)
      : group.filter((range) => ageMatches(range, ageDays))
    const selected = narrowestFirst(eligible)[0]
    if (selected) return selected
  }
  return null
}

export function applyLabCriticalThresholdDefaults<T extends LabRangeCandidate>(
  range: T | null,
  defaults?: LabCriticalThresholdDefaults,
): T | null {
  if (!range) return null
  return {
    ...range,
    criticalLow: range.criticalLow ?? defaults?.criticalLow ?? null,
    criticalHigh: range.criticalHigh ?? defaults?.criticalHigh ?? null,
  }
}

export function interpretLabValue(value: number, range: LabRangeCandidate | null): LabParameterInterpretation | null {
  if (!range) return null
  const criticalLow = numeric(range.criticalLow)
  const criticalHigh = numeric(range.criticalHigh)
  const low = numeric(range.low)
  const high = numeric(range.high)
  if (criticalLow != null && value <= criticalLow) return "CRITICAL_LOW"
  if (criticalHigh != null && value >= criticalHigh) return "CRITICAL_HIGH"
  if (low != null && value < low) return "LOW"
  if (high != null && value > high) return "HIGH"
  return "NORMAL"
}

export function formatLabReferenceRange(range: LabRangeCandidate | null) {
  if (!range) return null
  const low = numeric(range.low)
  const high = numeric(range.high)
  const normalRange = low == null && high == null
    ? "—"
    : `${low == null ? "—" : low} – ${high == null ? "—" : high}`
  const criticalLow = numeric(range.criticalLow)
  const criticalHigh = numeric(range.criticalHigh)
  if (criticalLow == null && criticalHigh == null) return normalRange
  return `${normalRange} (critical: ${criticalLow == null ? "—" : `≤ ${criticalLow}`} / ${criticalHigh == null ? "—" : `≥ ${criticalHigh}`})`
}
