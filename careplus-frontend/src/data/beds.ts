export interface BedCategory {
  label: string
  total: number
  occupied: number
}

export const bedAvailability: BedCategory[] = [
  { label: "General Ward", total: 80, occupied: 57 },
  { label: "ICU", total: 20, occupied: 17 },
  { label: "Emergency", total: 15, occupied: 6 },
  { label: "Maternity", total: 25, occupied: 14 },
]

export const hospitalStats = [
  { value: 25, suffix: "+", label: "Specialist Doctors" },
  { value: 10, suffix: "+", label: "Departments" },
  { value: 18, suffix: "+", label: "Years of Service" },
  { value: 40000, suffix: "+", label: "Patients Treated" },
]

export const testimonials = [
  {
    name: "Fatima R.",
    text: "The cardiology team walked me through every step before my angioplasty. I never felt rushed or left guessing.",
    role: "Patient, Cardiology",
  },
  {
    name: "Ahsan M.",
    text: "Our daughter's NICU stay was frightening, but the pediatric nurses kept us informed every single day.",
    role: "Parent, Pediatrics",
  },
  {
    name: "Rabia S.",
    text: "Booked my mother's appointment online in under two minutes and the confirmation SMS made everything easy to plan around.",
    role: "Patient's Family",
  },
]
