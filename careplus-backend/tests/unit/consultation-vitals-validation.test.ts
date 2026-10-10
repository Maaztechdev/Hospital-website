import { createConsultationSchema, updateConsultationSchema } from "../../src/modules/consultations/consultations.validators";
import { getAgeBand, getCriticalVitals, getVitalNormalRanges } from "../../src/common/validation/vitals";

const appointmentId = "123e4567-e89b-42d3-a456-426614174000";
const validVitals = {
  bp_systolic: 120,
  bp_diastolic: 80,
  temperature: 98.6,
  temperature_unit: "F",
  pulse: 78,
  respiratory_rate: 16,
  oxygen_saturation: 98,
  weight: 65,
  height_cm: 170,
};

describe("Consultation vital validation", () => {
  it("accepts normal values and valid Celsius measurements", () => {
    expect(createConsultationSchema.safeParse({ appointmentId, vitals: validVitals }).success).toBe(true);
    expect(updateConsultationSchema.safeParse({ vitals: { temperature: 37, temperature_unit: "C" } }).success).toBe(true);
    expect(createConsultationSchema.safeParse({ appointmentId, vitals: { ...validVitals, pulse: 34 } }).success).toBe(true);
  });

  it("accepts explicitly null unrecorded measurements", () => {
    expect(createConsultationSchema.safeParse({
      appointmentId,
      vitals: {
        bp_systolic: null,
        bp_diastolic: null,
        temperature: null,
        temperature_unit: null,
        pulse: null,
        respiratory_rate: null,
        oxygen_saturation: null,
        weight: null,
        height_cm: null,
      },
    }).success).toBe(true);
  });

  it.each([
    { ...validVitals, bp_systolic: 23 },
    { ...validVitals, bp_diastolic: undefined },
    { ...validVitals, bp_diastolic: 130 },
    { ...validVitals, pulse: 301 },
    { ...validVitals, temperature: 114 },
    { ...validVitals, respiratory_rate: 61 },
    { ...validVitals, oxygen_saturation: -1 },
    { ...validVitals, oxygen_saturation: 101 },
    { ...validVitals, weight: 501 },
    { ...validVitals, height_cm: 251 },
  ])("rejects invalid values (%s)", (vitals) => {
    expect(createConsultationSchema.safeParse({ appointmentId, vitals }).success).toBe(false);
  });

  it.each([
    [0, 0, "newborn"],
    [0, 6, "infant"],
    [8, null, "child"],
    [16, null, "adolescent"],
    [35, null, "adult"],
    [70, null, "elderly"],
  ] as const)("selects the reference ranges for age %s years / %s months", (age, months, expectedBand) => {
    expect(getAgeBand(age, months)).toBe(expectedBand);
    expect(getVitalNormalRanges(expectedBand).pulse.min).toBeGreaterThan(0);
  });

  it("applies age-specific critical thresholds on the server-side shared rules", () => {
    expect(getCriticalVitals({ oxygen_saturation: 66 }, 35).map((item) => item.label)).toEqual(["SpO2"]);
    expect(getCriticalVitals({ pulse: 165 }, 8).map((item) => item.label)).toEqual(["Pulse"]);
    expect(getCriticalVitals({ pulse: 120 }, 35)).toEqual([]);
    expect(getCriticalVitals({ temperature: 40, temperature_unit: "C" }, 35)[0]).toMatchObject({ value: 40, unit: "°C" });
  });
});
