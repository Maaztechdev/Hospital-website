import type { LucideIcon } from "lucide-react"
import {
  Ambulance, ScanLine, FlaskConical, Syringe, Baby, Stethoscope,
  HeartPulse, BriefcaseMedical, Pill, Home,
} from "lucide-react"

export interface Service {
  id: string
  name: string
  icon: LucideIcon
  description: string
  priceFrom: string
  duration: string
}

export const services: Service[] = [
  { id: "emergency-care", name: "Emergency Care", icon: Ambulance, description: "24/7 emergency response with a dedicated trauma bay and ambulance dispatch.", priceFrom: "PKR 3,500", duration: "As needed" },
  { id: "diagnostic-imaging", name: "Diagnostic Imaging", icon: ScanLine, description: "X-ray, ultrasound, CT and MRI scans with same-day reporting for most cases.", priceFrom: "PKR 2,000", duration: "30–60 min" },
  { id: "laboratory-tests", name: "Laboratory Tests", icon: FlaskConical, description: "Blood work, pathology and microbiology testing with digital report delivery.", priceFrom: "PKR 800", duration: "Same day" },
  { id: "minor-procedures", name: "Minor Procedures", icon: Syringe, description: "Outpatient procedures including wound care, biopsies and suturing.", priceFrom: "PKR 4,000", duration: "20–45 min" },
  { id: "maternity-care", name: "Maternity Care", icon: Baby, description: "Prenatal checkups, delivery services and postnatal support.", priceFrom: "PKR 15,000", duration: "Varies" },
  { id: "general-consultation", name: "General Consultation", icon: Stethoscope, description: "Same-day consultations with our general medicine physicians.", priceFrom: "PKR 1,500", duration: "20 min" },
  { id: "cardiac-screening", name: "Cardiac Screening", icon: HeartPulse, description: "ECG, echocardiogram and stress testing for heart health assessment.", priceFrom: "PKR 5,000", duration: "45 min" },
  { id: "surgical-procedures", name: "Surgical Procedures", icon: BriefcaseMedical, description: "Elective and emergency surgeries with pre- and post-op care included.", priceFrom: "PKR 50,000", duration: "Varies" },
  { id: "pharmacy-services", name: "Pharmacy Services", icon: Pill, description: "24/7 on-site pharmacy with prescription dispensing and counseling.", priceFrom: "Market price", duration: "10 min" },
  { id: "home-care", name: "Home Care Visits", icon: Home, description: "Nurse-led home visits for post-discharge patients within city limits.", priceFrom: "PKR 3,000", duration: "1 hour" },
]
