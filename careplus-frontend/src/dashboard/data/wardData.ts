import type { Bed, Admission, TransferRecord, Surgery, AuditLogEntry, WardType } from "@/dashboard/types"

const today = new Date()
const iso = (daysOffset = 0, h = 9, m = 0) => {
  const d = new Date(today)
  d.setDate(d.getDate() + daysOffset)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}
const isoDate = (daysOffset = 0) => iso(daysOffset).slice(0, 10)

export const OT_ROOMS = ["OT-1", "OT-2", "OT-3"]

/* -------------------------------- Beds -------------------------------- */
// 10 General Ward, 8 Private Room, 6 ICU = 24 beds total.

function mkBed(partial: Omit<Bed, "id">): Bed {
  return { id: `bed-${partial.bedNumber}`, ...partial }
}

export const BEDS: Bed[] = [
  // General Ward — G-101..G-110
  mkBed({ bedNumber: "G-101", ward: "General Ward", room: "Room 101", status: "Occupied", dailyRate: 3500, admissionId: "adm-1", mrNumber: "MR-2026-000103", patientName: "Zainab Bibi", doctorName: "Dr. Ayesha Malik", admittedAt: iso(-3, 10, 15) }),
  mkBed({ bedNumber: "G-102", ward: "General Ward", room: "Room 101", status: "Available", dailyRate: 3500 }),
  mkBed({ bedNumber: "G-103", ward: "General Ward", room: "Room 102", status: "Cleaning", dailyRate: 3500 }),
  mkBed({ bedNumber: "G-104", ward: "General Ward", room: "Room 102", status: "Available", dailyRate: 3500 }),
  mkBed({ bedNumber: "G-105", ward: "General Ward", room: "Room 103", status: "Occupied", dailyRate: 3500, admissionId: "adm-2", mrNumber: "MR-2026-000108", patientName: "Imran Khalid", doctorName: "Dr. Bilal Hassan", admittedAt: iso(-1, 16, 30) }),
  mkBed({ bedNumber: "G-106", ward: "General Ward", room: "Room 103", status: "Reserved", dailyRate: 3500 }),
  mkBed({ bedNumber: "G-107", ward: "General Ward", room: "Room 104", status: "Available", dailyRate: 3500 }),
  mkBed({ bedNumber: "G-108", ward: "General Ward", room: "Room 104", status: "Maintenance", dailyRate: 3500 }),
  mkBed({ bedNumber: "G-109", ward: "General Ward", room: "Room 105", status: "Available", dailyRate: 3500 }),
  mkBed({ bedNumber: "G-110", ward: "General Ward", room: "Room 105", status: "Available", dailyRate: 3500 }),

  // Private Rooms — P-201..P-208
  mkBed({ bedNumber: "P-201", ward: "Private Room", room: "Suite 201", status: "Occupied", dailyRate: 9000, admissionId: "adm-3", mrNumber: "MR-2026-000106", patientName: "Usman Tariq", doctorName: "Dr. Bilal Hassan", admittedAt: iso(-2, 9, 0) }),
  mkBed({ bedNumber: "P-202", ward: "Private Room", room: "Suite 202", status: "Available", dailyRate: 9000 }),
  mkBed({ bedNumber: "P-203", ward: "Private Room", room: "Suite 203", status: "Cleaning", dailyRate: 9000 }),
  mkBed({ bedNumber: "P-204", ward: "Private Room", room: "Suite 204", status: "Available", dailyRate: 9000 }),
  mkBed({ bedNumber: "P-205", ward: "Private Room", room: "Suite 205", status: "Reserved", dailyRate: 9000 }),
  mkBed({ bedNumber: "P-206", ward: "Private Room", room: "Suite 206", status: "Available", dailyRate: 9000 }),
  mkBed({ bedNumber: "P-207", ward: "Private Room", room: "Suite 207", status: "Available", dailyRate: 9000 }),
  mkBed({ bedNumber: "P-208", ward: "Private Room", room: "Suite 208", status: "Maintenance", dailyRate: 9000 }),

  // ICU — ICU-01..ICU-06
  mkBed({ bedNumber: "ICU-01", ward: "ICU", room: "ICU Bay 1", status: "Occupied", dailyRate: 22000, admissionId: "adm-4", mrNumber: "MR-2026-000101", patientName: "Fatima Zahra", doctorName: "Dr. Ayesha Malik", admittedAt: iso(0, 6, 40) }),
  mkBed({ bedNumber: "ICU-02", ward: "ICU", room: "ICU Bay 1", status: "Available", dailyRate: 22000 }),
  mkBed({ bedNumber: "ICU-03", ward: "ICU", room: "ICU Bay 2", status: "Reserved", dailyRate: 22000 }),
  mkBed({ bedNumber: "ICU-04", ward: "ICU", room: "ICU Bay 2", status: "Available", dailyRate: 22000 }),
  mkBed({ bedNumber: "ICU-05", ward: "ICU", room: "ICU Bay 3", status: "Cleaning", dailyRate: 22000 }),
  mkBed({ bedNumber: "ICU-06", ward: "ICU", room: "ICU Bay 3", status: "Available", dailyRate: 22000 }),
]

/* ------------------------------ Admissions ------------------------------ */

export const ADMISSIONS: Admission[] = [
  { id: "adm-1", mrNumber: "MR-2026-000103", patientName: "Zainab Bibi", bedId: "bed-G-101", bedNumber: "G-101", ward: "General Ward", doctorId: "doc-1", doctorName: "Dr. Ayesha Malik", admissionType: "Emergency", admissionDate: iso(-3, 10, 15), reason: "Chest pain, observation for suspected angina", depositAmount: 15000, status: "Admitted", outstandingBalance: 8500 },
  { id: "adm-2", mrNumber: "MR-2026-000108", patientName: "Imran Khalid", bedId: "bed-G-105", bedNumber: "G-105", ward: "General Ward", doctorId: "doc-2", doctorName: "Dr. Bilal Hassan", admissionType: "Planned", admissionDate: iso(-1, 16, 30), reason: "Elective knee replacement — pre-op workup", depositAmount: 40000, status: "Admitted", outstandingBalance: 0 },
  { id: "adm-3", mrNumber: "MR-2026-000106", patientName: "Usman Tariq", bedId: "bed-P-201", bedNumber: "P-201", ward: "Private Room", doctorId: "doc-2", doctorName: "Dr. Bilal Hassan", admissionType: "Planned", admissionDate: iso(-2, 9, 0), reason: "Post-op recovery, fracture fixation", depositAmount: 60000, status: "Admitted", outstandingBalance: 12000 },
  { id: "adm-4", mrNumber: "MR-2026-000101", patientName: "Fatima Zahra", bedId: "bed-ICU-01", bedNumber: "ICU-01", ward: "ICU", doctorId: "doc-1", doctorName: "Dr. Ayesha Malik", admissionType: "Emergency", admissionDate: iso(0, 6, 40), reason: "Hypertensive crisis, close monitoring", depositAmount: 50000, status: "Admitted", outstandingBalance: 22000 },
]

export const TRANSFERS: TransferRecord[] = [
  { id: "trf-1", admissionId: "adm-3", mrNumber: "MR-2026-000106", patientName: "Usman Tariq", fromBedId: "bed-G-107", fromBedNumber: "G-107", fromWard: "General Ward", toBedId: "bed-P-201", toBedNumber: "P-201", toWard: "Private Room", reason: "Family requested private room for post-op recovery", date: iso(-1, 14, 0), by: "Nurse Amna Riaz" },
]

/* -------------------------------- Surgery -------------------------------- */

let checklistCounter = 0
function mkChecklist(labels: string[], doneCount = 0): Surgery["preOpChecklist"] {
  return labels.map((label, i) => {
    checklistCounter += 1
    return { id: `chk-${checklistCounter}`, label, done: i < doneCount }
  })
}

const STANDARD_CHECKLIST = [
  "Consent form signed",
  "Fasting confirmed (NPO 8 hrs)",
  "Pre-anesthesia assessment complete",
  "Site marked & verified",
  "Blood products available/cross-matched",
  "Implants/equipment confirmed",
  "Antibiotic prophylaxis given",
]

export const SURGERIES: Surgery[] = [
  {
    id: "sur-1", mrNumber: "MR-2026-000108", patientName: "Imran Khalid", procedureName: "Total Knee Replacement (Right)",
    surgeonId: "doc-2", surgeonName: "Dr. Bilal Hassan", otRoom: "OT-1", scheduledDate: isoDate(0), scheduledTime: "14:00", durationMinutes: 120,
    status: "Pre-op", notes: "Elective. Patient admitted for pre-op workup.",
    preOpChecklist: mkChecklist(STANDARD_CHECKLIST, 5),
    activityLog: [
      { id: "act-1", action: "Surgery scheduled", by: "Dr. Bilal Hassan", at: iso(-2, 11, 0) },
      { id: "act-2", action: "Status changed to Pre-op", by: "Nurse Amna Riaz", at: iso(0, 11, 0) },
    ],
  },
  {
    id: "sur-2", mrNumber: "MR-2026-000106", patientName: "Usman Tariq", procedureName: "Fracture Fixation — Tibia (Follow-up debridement)",
    surgeonId: "doc-2", surgeonName: "Dr. Bilal Hassan", otRoom: "OT-2", scheduledDate: isoDate(0), scheduledTime: "10:00", durationMinutes: 90,
    status: "In Progress", notes: "Second-look debridement post fixation.",
    preOpChecklist: mkChecklist(STANDARD_CHECKLIST, 7),
    activityLog: [
      { id: "act-3", action: "Surgery scheduled", by: "Dr. Bilal Hassan", at: iso(-3, 9, 0) },
      { id: "act-4", action: "Status changed to Pre-op", by: "Nurse Amna Riaz", at: iso(0, 8, 30) },
      { id: "act-5", action: "Status changed to In Progress", by: "Dr. Bilal Hassan", at: iso(0, 10, 0) },
    ],
  },
  {
    id: "sur-3", mrNumber: "MR-2026-000101", patientName: "Fatima Zahra", procedureName: "Diagnostic Coronary Angiography",
    surgeonId: "doc-1", surgeonName: "Dr. Ayesha Malik", otRoom: "OT-3", scheduledDate: isoDate(0), scheduledTime: "16:30", durationMinutes: 60,
    status: "Scheduled", notes: "To evaluate hypertensive crisis with chest discomfort.",
    preOpChecklist: mkChecklist(STANDARD_CHECKLIST, 2),
    activityLog: [{ id: "act-6", action: "Surgery scheduled", by: "Dr. Ayesha Malik", at: iso(0, 7, 0) }],
  },
  {
    id: "sur-4", mrNumber: "MR-2026-000103", patientName: "Zainab Bibi", procedureName: "Cardiac Stress Echocardiography",
    surgeonId: "doc-1", surgeonName: "Dr. Ayesha Malik", otRoom: "OT-1", scheduledDate: isoDate(-1), scheduledTime: "09:00", durationMinutes: 45,
    status: "Completed", notes: "Routine evaluation.",
    preOpChecklist: mkChecklist(STANDARD_CHECKLIST, 7),
    activityLog: [
      { id: "act-7", action: "Surgery scheduled", by: "Dr. Ayesha Malik", at: iso(-3, 9, 0) },
      { id: "act-8", action: "Status changed to Pre-op", by: "Nurse Amna Riaz", at: iso(-1, 8, 30) },
      { id: "act-9", action: "Status changed to In Progress", by: "Dr. Ayesha Malik", at: iso(-1, 9, 0) },
      { id: "act-10", action: "Status changed to Recovery", by: "Dr. Ayesha Malik", at: iso(-1, 9, 45) },
      { id: "act-11", action: "Status changed to Completed", by: "Nurse Amna Riaz", at: iso(-1, 10, 30) },
    ],
  },
  {
    id: "sur-5", mrNumber: "MR-2026-000102", patientName: "Ahmed Raza", procedureName: "Upper GI Endoscopy",
    surgeonId: "doc-4", surgeonName: "Dr. Omar Farooq", otRoom: "OT-2", scheduledDate: isoDate(1), scheduledTime: "11:00", durationMinutes: 30,
    status: "Cancelled", notes: "Patient postponed due to fever.",
    preOpChecklist: mkChecklist(STANDARD_CHECKLIST, 0),
    activityLog: [
      { id: "act-12", action: "Surgery scheduled", by: "Dr. Omar Farooq", at: iso(-1, 9, 0) },
      { id: "act-13", action: "Status changed to Cancelled", by: "Dr. Omar Farooq", at: iso(0, 9, 0) },
    ],
  },
]

/* ------------------------------- Audit Logs ------------------------------- */

export const AUDIT_LOGS: AuditLogEntry[] = [
  { id: "aud-1", actionType: "Created", action: "Admitted patient", entity: "Admission", entityId: "adm-1", by: "Sara Ahmed", role: "Receptionist", date: iso(-3, 10, 15), details: "Zainab Bibi admitted to G-101 (General Ward)" },
  { id: "aud-2", actionType: "Created", action: "Admitted patient", entity: "Admission", entityId: "adm-3", by: "Sara Ahmed", role: "Receptionist", date: iso(-2, 9, 0), details: "Usman Tariq admitted to G-107 (General Ward)" },
  { id: "aud-3", actionType: "Updated", action: "Transferred patient", entity: "Admission", entityId: "adm-3", by: "Nurse Amna Riaz", role: "Nurse", date: iso(-1, 14, 0), details: "Usman Tariq moved from G-107 to P-201" },
  { id: "aud-4", actionType: "Created", action: "Admitted patient", entity: "Admission", entityId: "adm-2", by: "Sara Ahmed", role: "Receptionist", date: iso(-1, 16, 30), details: "Imran Khalid admitted to G-105 (General Ward)" },
  { id: "aud-5", actionType: "Created", action: "Admitted patient", entity: "Admission", entityId: "adm-4", by: "Sara Ahmed", role: "Receptionist", date: iso(0, 6, 40), details: "Fatima Zahra admitted to ICU-01 (ICU)" },
  { id: "aud-6", actionType: "Voided", action: "Voided invoice", entity: "Invoice", entityId: "INV-3002", by: "Front Desk Manager", role: "Admin", date: iso(-4, 12, 0), details: "Duplicate invoice raised in error" },
]

export function bedsSummary(beds: Bed[]) {
  const total = beds.length
  const byStatus = (s: Bed["status"]) => beds.filter((b) => b.status === s).length
  const occupied = byStatus("Occupied")
  return {
    total,
    occupied,
    available: byStatus("Available"),
    reserved: byStatus("Reserved"),
    cleaning: byStatus("Cleaning"),
    maintenance: byStatus("Maintenance"),
    occupancyPct: total ? Math.round((occupied / total) * 100) : 0,
  }
}

export const WARD_TYPES: WardType[] = ["General Ward", "Private Room", "ICU"]
