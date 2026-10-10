export const VITAL_RANGES = {
  systolic: { min: 50, max: 260 },
  diastolic: { min: 30, max: 160 },
  pulse: { min: 20, max: 300 },
  temperatureF: { min: 86, max: 113 },
  temperatureC: { min: 30, max: 45 },
  respiratoryRate: { min: 4, max: 60 },
  oxygenSaturation: { min: 0, max: 100 },
  weightKg: { min: 0.5, max: 500 },
  heightCm: { min: 30, max: 250 },
} as const

export const VITAL_WARNINGS = {
  lowOxygenSaturation: 92,
  feverF: 102,
  feverC: 38.9,
  lowPulse: 50,
  highPulse: 120,
} as const

export type TemperatureUnit = "F" | "C"
export type VitalAgeBand = "newborn" | "infant" | "child" | "adolescent" | "adult" | "elderly"

export interface VitalValues {
  bp_systolic?: number | null
  bp_diastolic?: number | null
  pulse?: number | null
  temperature?: number | null
  temperature_unit?: TemperatureUnit | null
  respiratory_rate?: number | null
  oxygen_saturation?: number | null
  weight?: number | null
  height_cm?: number | null
}

type VitalNormalRange = { min: number; max: number }
type VitalReference = {
  normal: {
    systolic: VitalNormalRange
    diastolic: VitalNormalRange
    pulse: VitalNormalRange
    temperatureF: VitalNormalRange
    temperatureC: VitalNormalRange
    respiratoryRate: VitalNormalRange
    oxygenSaturation: VitalNormalRange
    weightKg: VitalNormalRange
    heightCm: VitalNormalRange
  }
  typical: {
    systolic: number
    diastolic: number
    pulse: number
    temperatureF: number
    respiratoryRate: number
    oxygenSaturation: number
    weightKg: number
    heightCm: number
  }
  critical: {
    systolicLow: number
    systolicHigh: number
    diastolicHigh: number
    pulseLow: number
    pulseHigh: number
    temperatureFLow: number
    temperatureFHigh: number
    respiratoryRateLow: number
    respiratoryRateHigh: number
    oxygenSaturationLow: number
  }
}

const adultReference: VitalReference = {
  normal: {
    systolic: { min: 90, max: 120 }, diastolic: { min: 60, max: 80 }, pulse: { min: 60, max: 100 },
    temperatureF: { min: 97.7, max: 99.5 }, temperatureC: { min: 36.5, max: 37.5 },
    respiratoryRate: { min: 12, max: 20 }, oxygenSaturation: { min: 95, max: 100 },
    weightKg: { min: 45, max: 120 }, heightCm: { min: 140, max: 210 },
  },
  typical: { systolic: 120, diastolic: 80, pulse: 72, temperatureF: 98.6, respiratoryRate: 16, oxygenSaturation: 98, weightKg: 70, heightCm: 170 },
  critical: {
    systolicLow: 90, systolicHigh: 180, diastolicHigh: 120, pulseLow: 40, pulseHigh: 130,
    temperatureFLow: 95, temperatureFHigh: 103, respiratoryRateLow: 8, respiratoryRateHigh: 30, oxygenSaturationLow: 90,
  },
}

// Reference ranges and typical values are for reference only, not diagnostic thresholds; clinicians should review them before use.
export const VITAL_REFERENCE_BY_AGE: Record<VitalAgeBand, VitalReference> = {
  newborn: {
    normal: {
      systolic: { min: 60, max: 90 }, diastolic: { min: 30, max: 60 }, pulse: { min: 100, max: 160 },
      temperatureF: { min: 97.7, max: 99.5 }, temperatureC: { min: 36.5, max: 37.5 },
      respiratoryRate: { min: 30, max: 60 }, oxygenSaturation: { min: 95, max: 100 },
      weightKg: { min: 2.5, max: 4.5 }, heightCm: { min: 45, max: 55 },
    },
    typical: { systolic: 75, diastolic: 45, pulse: 140, temperatureF: 98.6, respiratoryRate: 40, oxygenSaturation: 98, weightKg: 3.3, heightCm: 50 },
    critical: { systolicLow: 60, systolicHigh: 100, diastolicHigh: 70, pulseLow: 80, pulseHigh: 180, temperatureFLow: 95, temperatureFHigh: 103, respiratoryRateLow: 20, respiratoryRateHigh: 65, oxygenSaturationLow: 90 },
  },
  infant: {
    normal: {
      systolic: { min: 70, max: 100 }, diastolic: { min: 50, max: 65 }, pulse: { min: 100, max: 160 },
      temperatureF: { min: 97.7, max: 99.5 }, temperatureC: { min: 36.5, max: 37.5 },
      respiratoryRate: { min: 30, max: 53 }, oxygenSaturation: { min: 95, max: 100 },
      weightKg: { min: 4, max: 12 }, heightCm: { min: 55, max: 80 },
    },
    typical: { systolic: 85, diastolic: 55, pulse: 120, temperatureF: 98.6, respiratoryRate: 35, oxygenSaturation: 98, weightKg: 7.5, heightCm: 67 },
    critical: { systolicLow: 70, systolicHigh: 110, diastolicHigh: 75, pulseLow: 80, pulseHigh: 180, temperatureFLow: 95, temperatureFHigh: 103, respiratoryRateLow: 20, respiratoryRateHigh: 60, oxygenSaturationLow: 90 },
  },
  child: {
    normal: {
      systolic: { min: 80, max: 120 }, diastolic: { min: 50, max: 80 }, pulse: { min: 70, max: 120 },
      temperatureF: { min: 97.7, max: 99.5 }, temperatureC: { min: 36.5, max: 37.5 },
      respiratoryRate: { min: 18, max: 30 }, oxygenSaturation: { min: 95, max: 100 },
      weightKg: { min: 8, max: 60 }, heightCm: { min: 70, max: 165 },
    },
    typical: { systolic: 95, diastolic: 60, pulse: 90, temperatureF: 98.6, respiratoryRate: 24, oxygenSaturation: 98, weightKg: 25, heightCm: 125 },
    critical: { systolicLow: 80, systolicHigh: 140, diastolicHigh: 90, pulseLow: 60, pulseHigh: 160, temperatureFLow: 95, temperatureFHigh: 103, respiratoryRateLow: 12, respiratoryRateHigh: 40, oxygenSaturationLow: 90 },
  },
  adolescent: {
    normal: {
      systolic: { min: 90, max: 120 }, diastolic: { min: 60, max: 80 }, pulse: { min: 60, max: 100 },
      temperatureF: { min: 97.7, max: 99.5 }, temperatureC: { min: 36.5, max: 37.5 },
      respiratoryRate: { min: 12, max: 20 }, oxygenSaturation: { min: 95, max: 100 },
      weightKg: { min: 35, max: 100 }, heightCm: { min: 140, max: 200 },
    },
    typical: { systolic: 110, diastolic: 70, pulse: 80, temperatureF: 98.6, respiratoryRate: 16, oxygenSaturation: 98, weightKg: 60, heightCm: 165 },
    critical: { systolicLow: 90, systolicHigh: 160, diastolicHigh: 100, pulseLow: 40, pulseHigh: 130, temperatureFLow: 95, temperatureFHigh: 103, respiratoryRateLow: 8, respiratoryRateHigh: 30, oxygenSaturationLow: 90 },
  },
  adult: adultReference,
  elderly: {
    ...adultReference,
    normal: {
      ...adultReference.normal,
      systolic: { min: 90, max: 140 },
      diastolic: { min: 60, max: 90 },
      oxygenSaturation: { min: 92, max: 100 },
    },
    typical: { systolic: 130, diastolic: 75, pulse: 72, temperatureF: 98.6, respiratoryRate: 16, oxygenSaturation: 96, weightKg: 65, heightCm: 165 },
  },
}

export function getAgeBand(ageYears?: number | null, ageMonths?: number | null): VitalAgeBand {
  const months = ageMonths ?? (ageYears == null ? null : ageYears * 12)
  if (months !== null && months < 1) return "newborn"
  if (months !== null && months < 12) return "infant"
  const years = ageYears ?? (months === null ? 18 : months / 12)
  if (years < 13) return "child"
  if (years < 18) return "adolescent"
  if (years >= 65) return "elderly"
  return "adult"
}

export function getAgeInMonthsFromDateOfBirth(dateOfBirth?: string | Date | null, now = new Date()) {
  if (!dateOfBirth) return null
  const birth = dateOfBirth instanceof Date ? dateOfBirth : new Date(dateOfBirth)
  if (!Number.isFinite(birth.getTime()) || birth > now) return null
  return Math.floor((now.getTime() - birth.getTime()) / (30.4375 * 24 * 60 * 60 * 1000))
}

export function getTemperatureRange(unit: TemperatureUnit) {
  return unit === "F" ? VITAL_RANGES.temperatureF : VITAL_RANGES.temperatureC
}

export function getVitalNormalRanges(ageBand: VitalAgeBand) {
  return VITAL_REFERENCE_BY_AGE[ageBand].normal
}

export function getTypicalVitals(ageBand: VitalAgeBand) {
  return VITAL_REFERENCE_BY_AGE[ageBand].typical
}

const criticalVitalLabels = {
  bp_systolic: "Systolic",
  bp_diastolic: "Diastolic",
  pulse: "Pulse",
  temperature: "Temperature",
  respiratory_rate: "Respiratory rate",
  oxygen_saturation: "SpO2",
} as const

type CriticalVitalKey = keyof typeof criticalVitalLabels
export type CriticalVital = { key: CriticalVitalKey; label: string; value: number; unit: string }

export function getCriticalVitals(values: VitalValues, ageYears?: number | null, ageMonths?: number | null): CriticalVital[] {
  const thresholds = VITAL_REFERENCE_BY_AGE[getAgeBand(ageYears, ageMonths)].critical
  const critical: CriticalVital[] = []
  const add = (key: CriticalVitalKey, value: number | null | undefined, unit: string, predicate: (n: number) => boolean) => {
    if (typeof value === "number" && Number.isFinite(value) && predicate(value)) critical.push({ key, label: criticalVitalLabels[key], value, unit })
  }
  add("bp_systolic", values.bp_systolic, "mmHg", (value) => value < thresholds.systolicLow || value > thresholds.systolicHigh)
  add("bp_diastolic", values.bp_diastolic, "mmHg", (value) => value > thresholds.diastolicHigh)
  add("pulse", values.pulse, "bpm", (value) => value < thresholds.pulseLow || value > thresholds.pulseHigh)
  const temperature = values.temperature_unit === "C" && values.temperature != null
    ? values.temperature * (9 / 5) + 32
    : values.temperature
  if (values.temperature != null && temperature != null && (temperature > thresholds.temperatureFHigh || temperature < thresholds.temperatureFLow)) {
    critical.push({
      key: "temperature",
      label: criticalVitalLabels.temperature,
      value: values.temperature,
      unit: `°${values.temperature_unit ?? "F"}`,
    })
  }
  add("respiratory_rate", values.respiratory_rate, "/min", (value) => value < thresholds.respiratoryRateLow || value > thresholds.respiratoryRateHigh)
  add("oxygen_saturation", values.oxygen_saturation, "%", (value) => value < thresholds.oxygenSaturationLow)
  return critical
}

export function isCriticalVitals(values: VitalValues, ageYears?: number | null, ageMonths?: number | null) {
  return getCriticalVitals(values, ageYears, ageMonths).length > 0
}
