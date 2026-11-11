// Shared domain types for the Khalida Medicare Admin & Staff Management System (Phase 2).
// Frontend-only mock domain model — no backend contracts implied.

export type Role =
  | "admin"
  | "billing_manager"
  | "receptionist"
  | "doctor"
  | "lab_technician"
  | "pathologist"
  | "ultrasound_tech"
  | "ultrasound_technician"
  | "radiologist"
  | "pharmacist"
  | "nurse"

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrator",
  billing_manager: "Billing Manager",
  receptionist: "Receptionist",
  doctor: "Doctor",
  lab_technician: "Lab Technician",
  pathologist: "Pathologist",
  ultrasound_tech: "Ultrasound Technician",
  ultrasound_technician: "Ultrasound Technician",
  radiologist: "Radiologist",
  pharmacist: "Pharmacist",
  nurse: "Nurse",
}

export type Gender = "Male" | "Female" | "Other"
export type BloodGroup = "A+" | "A-" | "B+" | "B-" | "O+" | "O-" | "AB+" | "AB-"

export interface Patient {
  id?: string
  mrNumber: string
  name: string
  age: number
  dob?: string
  dateOfBirth?: string
  gender: Gender
  phone: string
  email?: string
  address?: string
  cnic?: string
  bloodGroup: BloodGroup
  allergies: string[]
  emergencyContact: string
  emergencyContactName?: string
  notes?: string
  registeredAt: string // ISO datetime
  lastVisit?: string
  balance: number
  status: "Active" | "Inactive"
}

export type AppointmentStatus =
  | "Pending Approval"
  | "Confirmed"
  | "Waiting"
  | "In Consultation"
  | "Done"
  | "Cancelled"
  | "Expired"
  | "No-show"

export type Priority = "Routine" | "Urgent" | "Emergency"

export interface Appointment {
  id: string
  token: number
  mrNumber: string
  patientName: string
  age?: number
  gender?: Gender
  doctorId: string
  doctorName: string
  department: string
  date: string // ISO date
  time: string // HH:mm
  type: "New Visit" | "Follow-up" | "Consultation"
  status: AppointmentStatus
  priority: Priority
  reason?: string
  chiefComplaint?: string
  rejectionReason?: string
  createdAt: string
  waitingSince?: string // ISO datetime, set when status becomes Waiting
}

export interface Doctor {
  id: string
  userId?: string
  name: string
  department: string
  designation: string
  slotsPerDay: string[] // e.g. ["09:00","09:20",...]
  specialization?: string
  specialty?: string
}

export type VisitStage =
  | "Registration"
  | "Appointment"
  | "OPD Consultation"
  | "Lab Order"
  | "Lab Result"
  | "Pharmacy Dispense"
  | "Ward Admission"
  | "OT Surgery"
  | "Discharge"
  | "Final Billing"

export interface TimelineEvent {
  id: string
  mrNumber: string
  stage: VisitStage
  datetime: string
  department: string
  staff: string
  status: string
  details?: string
}

export interface VitalSigns {
  bp: string
  systolic?: string
  diastolic?: string
  temperature: string
  temperatureUnit?: "F" | "C"
  pulse: string
  weight: string
  spo2: string
  respiratoryRate: string
  heightCm?: string
}

export interface PrescriptionItem {
  id: string
  medicineId?: string
  medicineName?: string
  medicine: string
  genericName?: string
  dosage?: string
  legacyDosage?: string
  doseAmount?: string | number
  doseUnit?: string
  route: string
  frequency?: string
  legacyFrequency?: string
  frequencyCode?: string
  duration?: string
  legacyDuration?: string
  durationDays?: number
  durationValue?: string | number
  durationUnit?: "days" | "weeks" | "months" | string
  instructions?: string
}

export interface Consultation {
  id: string
  appointmentId: string
  mrNumber: string
  patientName: string
  doctorId: string
  doctorName: string
  date: string
  vitals: VitalSigns
  chiefComplaint: string
  clinicalNotes: string
  diagnosis: string
  diagnosisCode?: string
  prescriptions: PrescriptionItem[]
  labRecommendations: string[]
  followUpDate?: string
  followUpInstructions?: string | null
  referral?: string
  status: "Draft" | "Signed"
  signedAt?: string
}

export type LabOrderStatus = "Ordered" | "Sample Collected" | "Processing" | "Completed" | "Verified" | "Cancelled"
export type LabInterpretation = "Normal" | "High" | "Low" | "Critical"

export interface LabOrder {
  id: string
  mrNumber: string
  patientName: string
  doctorName: string
  testName: string
  orderDate: string
  priority: Priority
  status: LabOrderStatus
  orderNumber?: string
  sampleCollectedAt?: string | null
  criticalResult?: boolean
  resultValue?: string
  resultUnit?: string
  referenceRange?: string
  interpretation?: LabInterpretation
  technicianNotes?: string
  reportFileName?: string
  verifiedBy?: string
  verifiedAt?: string
  verifiedDesignation?: string
}

export interface Medicine {
  id: string
  name: string
  genericName: string
  strength: string
  batchNumber: string
  expiryDate: string
  currentStock: number
  reorderLevel: number
  sellingPrice: number
  status: "In Stock" | "Low Stock" | "Out of Stock" | "Near Expiry"
}

export interface StockMovement {
  id: string
  medicineId: string
  medicineName: string
  type: "Stock In" | "Dispense" | "Return" | "Adjustment"
  quantity: number
  reason?: string
  date: string
  staff: string
}

export type InvoiceStatus = "Paid" | "Partial" | "Refunded" | "Partially Refunded" | "Unpaid" | "Void"
export type InvoiceDepartment = "RECEPTION" | "LAB" | "PHARMACY" | "ULTRASOUND" | "IPD"

export interface InvoiceLineItem {
  id: string
  category: "Consultation" | "Lab" | "Medicine" | "Ward" | "OT" | "Other"
  description: string
  qty: number
  unitPrice: number
  discount: number
}

export interface Payment {
  id: string
  type?: "PAYMENT" | "REFUND"
  amount: number
  method: "Cash" | "Card" | "Bank Transfer" | "Mobile Wallet" | "Online"
  date: string
  receivedBy?: string
  referenceNumber?: string
  notes?: string
  reason?: string
  reversed?: boolean
}

export interface Invoice {
  id: string
  invoiceNumber?: string
  department?: InvoiceDepartment | null
  grandTotal?: number
  paidAmount?: number
  balanceAmount?: number
  mrNumber: string
  patientName: string
  date: string
  lineItems: InvoiceLineItem[]
  payments: Payment[]
  status: InvoiceStatus
  voidReason?: string
  voidedAt?: string
  voidedBy?: string
  auditTrail: { action: string; date: string; by: string; note?: string }[]
}

export type NotificationUrgency = "Critical" | "Actionable" | "Informational"

export interface AppNotification {
  id: string
  title: string
  description: string
  time: string
  read: boolean
  urgency?: NotificationUrgency
  whatsappEligible?: boolean
  patientName?: string
  patientPhone?: string
}

/* ============================= Phase 3 — Ward / OT ============================= */

export type WardType = "General Ward" | "Private Room" | "ICU"
export type BedStatus = "Available" | "Occupied" | "Reserved" | "Cleaning" | "Maintenance"

export interface Bed {
  id: string
  bedNumber: string
  ward: WardType
  room: string
  status: BedStatus
  dailyRate: number
  // Occupancy context (present when Occupied/Reserved)
  admissionId?: string
  mrNumber?: string
  patientName?: string
  doctorName?: string
  admittedAt?: string
  depositPending?: boolean
  roundDoneToday?: boolean
}

export type AdmissionStatus = "Admitted" | "Discharged" | "Transferred Out"
export type AdmissionType = "Emergency" | "Planned" | "Referral" | "Transfer" | "Day care"

export interface Admission {
  id: string
  mrNumber: string
  patientName: string
  bedId: string
  bedNumber: string
  ward: WardType
  doctorId: string
  doctorName: string
  admissionType: AdmissionType
  admissionDate: string
  reason: string
  depositAmount: number
  dailyRate?: number
  notes?: string
  status: AdmissionStatus
  dischargeDate?: string
  dischargeSummary?: string
  outstandingBalance: number
}

export interface TransferRecord {
  id: string
  admissionId: string
  mrNumber: string
  patientName: string
  fromBedId: string
  fromBedNumber: string
  fromWard: WardType
  toBedId: string
  toBedNumber: string
  toWard: WardType
  reason: string
  date: string
  by: string
}

export type OTStatus = "Scheduled" | "Pre-op" | "In Progress" | "Recovery" | "Completed" | "Cancelled" | "Postponed"

export interface ChecklistItem {
  id: string
  label: string
  done: boolean
}

export interface OTActivityEntry {
  id: string
  action: string
  by: string
  at: string
}

export interface SurgeryStatusEvent {
  id: string
  surgeryId: string
  fromStatus?: string | null
  toStatus: string
  changedBy: string
  actorName: string
  reason?: string | null
  createdAt: string
}

export interface Surgery {
  id: string
  mrNumber: string
  patientName: string
  procedureName: string
  surgeonId: string
  surgeonName: string
  assistantSurgeonName?: string
  otRoom: string
  priority?: "Elective" | "Urgent" | "Emergency"
  anesthesiaType?: string
  scheduledDate: string // ISO date
  scheduledTime: string // HH:mm
  durationMinutes: number
  status: OTStatus
  notes?: string
  preOpChecklist: ChecklistItem[]
  activityLog: OTActivityEntry[]
  intraoperativeNotes?: string | null
  outcomeNotes?: string | null
  postOpNotes?: string | null
  emergencyOverrideReason?: string | null
  postponeReason?: string | null
  statusEvents?: SurgeryStatusEvent[]
  admissionId?: string | null
  otCharge?: number | null
}

export type AuditActionType = string

export interface AuditLogEntry {
  id: string
  actionType: AuditActionType
  action: string
  entity: string
  entityId: string
  by: string
  role: string
  date: string
  details?: string
}
