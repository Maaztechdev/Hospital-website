import type {
  Patient,
  Doctor,
  Appointment,
  LabOrder,
  Medicine,
  StockMovement,
  Invoice,
  TimelineEvent,
  AppNotification,
  Consultation,
} from "@/dashboard/types"

const today = new Date()
const iso = (daysOffset = 0, h = 9, m = 0) => {
  const d = new Date(today)
  d.setDate(d.getDate() + daysOffset)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}
const isoDate = (daysOffset = 0) => iso(daysOffset).slice(0, 10)

export const DOCTORS: Doctor[] = [
  { id: "doc-1", name: "Dr. Ayesha Malik", department: "Cardiology", designation: "Consultant Cardiologist", slotsPerDay: ["09:00", "09:20", "09:40", "10:00", "10:20", "10:40", "11:00"] },
  { id: "doc-2", name: "Dr. Bilal Hassan", department: "Orthopedics", designation: "Senior Orthopedic Surgeon", slotsPerDay: ["10:00", "10:20", "10:40", "11:00", "11:20", "11:40"] },
  { id: "doc-3", name: "Dr. Sana Riaz", department: "Pediatrics", designation: "Consultant Pediatrician", slotsPerDay: ["09:00", "09:15", "09:30", "09:45", "10:00", "10:15", "10:30"] },
  { id: "doc-4", name: "Dr. Omar Farooq", department: "General Medicine", designation: "Physician", slotsPerDay: ["08:30", "08:50", "09:10", "09:30", "09:50", "10:10"] },
  { id: "doc-5", name: "Dr. Hina Sheikh", department: "Gynecology", designation: "Consultant Gynecologist", slotsPerDay: ["11:00", "11:20", "11:40", "12:00", "12:20"] },
]

export const PATIENTS: Patient[] = [
]

let apptId = 0
const mkAppt = (partial: Omit<Appointment, "id" | "token" | "createdAt">): Appointment => {
  apptId += 1
  return { ...partial, id: `apt-${apptId}`, token: apptId, createdAt: iso(-1) }
}

export const APPOINTMENTS: Appointment[] = [
  mkAppt({ mrNumber: "MR-2026-000101", patientName: "Fatima Zahra", doctorId: "doc-1", doctorName: "Dr. Ayesha Malik", department: "Cardiology", date: isoDate(0), time: "09:00", type: "Follow-up", status: "WAITING", priority: "Routine", waitingSince: iso(0, 8, 40) }),
  mkAppt({ mrNumber: "MR-2026-000104", patientName: "Hassan Ali", doctorId: "doc-3", doctorName: "Dr. Sana Riaz", department: "Pediatrics", date: isoDate(0), time: "09:15", type: "New Visit", status: "IN_CONSULTATION", priority: "Urgent" }),
  mkAppt({ mrNumber: "MR-2026-000105", patientName: "Mariam Yousaf", doctorId: "doc-5", doctorName: "Dr. Hina Sheikh", department: "Gynecology", date: isoDate(0), time: "11:00", type: "New Visit", status: "CONFIRMED", priority: "Routine" }),
  mkAppt({ mrNumber: "MR-2026-000102", patientName: "Ahmed Raza", doctorId: "doc-4", doctorName: "Dr. Omar Farooq", department: "General Medicine", date: isoDate(0), time: "08:30", type: "Follow-up", status: "COMPLETED", priority: "Routine" }),
  mkAppt({ mrNumber: "MR-2026-000106", patientName: "Usman Tariq", doctorId: "doc-2", doctorName: "Dr. Bilal Hassan", department: "Orthopedics", date: isoDate(0), time: "10:20", type: "Consultation", priority: "Urgent", status: "WAITING", waitingSince: iso(0, 9, 5) }),
  mkAppt({ mrNumber: "MR-2026-000103", patientName: "Zainab Bibi", doctorId: "doc-1", doctorName: "Dr. Ayesha Malik", department: "Cardiology", date: isoDate(0), time: "09:20", type: "Follow-up", priority: "Emergency", status: "WAITING", waitingSince: iso(0, 8, 20) }),
  mkAppt({ mrNumber: "MR-2026-000107", patientName: "Ayesha Siddiqui", doctorId: "doc-4", doctorName: "Dr. Omar Farooq", department: "General Medicine", date: isoDate(1), time: "09:10", type: "New Visit", status: "PENDING_APPROVAL", priority: "Routine", reason: "Fever and body ache for 3 days" }),
  mkAppt({ mrNumber: "MR-2026-000108", patientName: "Imran Khalid", doctorId: "doc-2", doctorName: "Dr. Bilal Hassan", department: "Orthopedics", date: isoDate(1), time: "11:20", type: "Follow-up", status: "PENDING_APPROVAL", priority: "Routine", reason: "Knee pain follow-up" }),
  mkAppt({ mrNumber: "MR-2026-000102", patientName: "Ahmed Raza", doctorId: "doc-4", doctorName: "Dr. Omar Farooq", department: "General Medicine", date: isoDate(-1), time: "09:50", type: "Follow-up", status: "NO_SHOW", priority: "Routine" }),
  mkAppt({ mrNumber: "MR-2026-000101", patientName: "Fatima Zahra", doctorId: "doc-1", doctorName: "Dr. Ayesha Malik", department: "Cardiology", date: isoDate(-2), time: "09:00", type: "New Visit", status: "CANCELLED", priority: "Routine", rejectionReason: "Patient requested reschedule" }),
]

export const CONSULTATIONS: Consultation[] = []

let labId = 0
const mkLab = (partial: Omit<LabOrder, "id">): LabOrder => {
  labId += 1
  return {
    ...partial,
    orderNumber: partial.orderNumber ?? `LAB-${today.getFullYear()}-${String(labId).padStart(6, "0")}`,
    sampleCollectedAt: partial.sampleCollectedAt ?? (partial.status === "Ordered" || partial.status === "Cancelled" ? null : partial.orderDate),
    id: `LAB-${1000 + labId}`,
  }
}

export const LAB_ORDERS: LabOrder[] = [
  mkLab({ mrNumber: "MR-2026-000101", patientName: "Fatima Zahra", doctorName: "Dr. Ayesha Malik", testName: "Lipid Profile", orderDate: iso(0), priority: "Routine", status: "Ordered" }),
  mkLab({ mrNumber: "MR-2026-000103", patientName: "Zainab Bibi", doctorName: "Dr. Ayesha Malik", testName: "Troponin-I", orderDate: iso(0), priority: "Emergency", status: "Processing" }),
  mkLab({ mrNumber: "MR-2026-000106", patientName: "Usman Tariq", doctorName: "Dr. Bilal Hassan", testName: "CBC (Complete Blood Count)", orderDate: iso(-1), priority: "Routine", status: "Completed", resultValue: "11.2", resultUnit: "g/dL", referenceRange: "13.0 - 17.0 g/dL", interpretation: "Low", technicianNotes: "Mild anemia noted." }),
  mkLab({ mrNumber: "MR-2026-000102", patientName: "Ahmed Raza", doctorName: "Dr. Omar Farooq", testName: "Fasting Blood Sugar", orderDate: iso(-1), priority: "Routine", status: "Verified", resultValue: "94", resultUnit: "mg/dL", referenceRange: "70 - 100 mg/dL", interpretation: "Normal", verifiedBy: "Rida Farooq", verifiedAt: iso(-1) }),
  mkLab({ mrNumber: "MR-2026-000108", patientName: "Imran Khalid", doctorName: "Dr. Bilal Hassan", testName: "Serum Creatinine", orderDate: iso(-3), priority: "Urgent", status: "Completed", resultValue: "2.1", resultUnit: "mg/dL", referenceRange: "0.6 - 1.3 mg/dL", interpretation: "Critical", technicianNotes: "Recommend urgent nephrology review." }),
  mkLab({ mrNumber: "MR-2026-000104", patientName: "Hassan Ali", doctorName: "Dr. Sana Riaz", testName: "Urine Routine Examination", orderDate: iso(0), priority: "Routine", status: "Sample Collected" }),
  mkLab({ mrNumber: "MR-2026-000105", patientName: "Mariam Yousaf", doctorName: "Dr. Hina Sheikh", testName: "Beta-hCG", orderDate: iso(0), priority: "Routine", status: "Ordered" }),
  mkLab({ mrNumber: "MR-2026-000107", patientName: "Ayesha Siddiqui", doctorName: "Dr. Omar Farooq", testName: "Dengue NS1 Antigen", orderDate: iso(-1), priority: "Urgent", status: "Verified", resultValue: "Negative", referenceRange: "Negative", interpretation: "Normal", verifiedBy: "Rida Farooq", verifiedAt: iso(-1) }),
]

export const MEDICINE_FORMULARY = [
  "Paracetamol 500mg", "Amoxicillin 500mg", "Ibuprofen 400mg", "Omeprazole 20mg",
  "Metformin 500mg", "Atorvastatin 20mg", "Losartan 50mg", "Cetirizine 10mg",
  "Azithromycin 250mg", "Amlodipine 5mg", "Ciprofloxacin 500mg", "Domperidone 10mg",
]

export const MEDICINES: Medicine[] = [
  { id: "med-1", name: "Panadol", genericName: "Paracetamol", strength: "500mg", batchNumber: "PB-2291", expiryDate: isoDate(300), currentStock: 420, reorderLevel: 100, sellingPrice: 5, status: "In Stock" },
  { id: "med-2", name: "Augmentin", genericName: "Amoxicillin + Clavulanate", strength: "625mg", batchNumber: "AG-1187", expiryDate: isoDate(20), currentStock: 60, reorderLevel: 50, sellingPrice: 45, status: "Near Expiry" },
  { id: "med-3", name: "Brufen", genericName: "Ibuprofen", strength: "400mg", batchNumber: "BR-3345", expiryDate: isoDate(400), currentStock: 18, reorderLevel: 60, sellingPrice: 8, status: "Low Stock" },
  { id: "med-4", name: "Risek", genericName: "Omeprazole", strength: "20mg", batchNumber: "RK-2210", expiryDate: isoDate(500), currentStock: 200, reorderLevel: 80, sellingPrice: 12, status: "In Stock" },
  { id: "med-5", name: "Glucophage", genericName: "Metformin", strength: "500mg", batchNumber: "GP-4471", expiryDate: isoDate(250), currentStock: 0, reorderLevel: 100, sellingPrice: 9, status: "Out of Stock" },
  { id: "med-6", name: "Lipitor", genericName: "Atorvastatin", strength: "20mg", batchNumber: "LP-1023", expiryDate: isoDate(600), currentStock: 150, reorderLevel: 60, sellingPrice: 22, status: "In Stock" },
  { id: "med-7", name: "Zestoretic", genericName: "Losartan", strength: "50mg", batchNumber: "ZR-5567", expiryDate: isoDate(15), currentStock: 40, reorderLevel: 50, sellingPrice: 18, status: "Near Expiry" },
  { id: "med-8", name: "Zyrtec", genericName: "Cetirizine", strength: "10mg", batchNumber: "ZY-6621", expiryDate: isoDate(700), currentStock: 300, reorderLevel: 100, sellingPrice: 6, status: "In Stock" },
]

export const STOCK_MOVEMENTS: StockMovement[] = [
  { id: "sm-1", medicineId: "med-1", medicineName: "Panadol 500mg", type: "Stock In", quantity: 500, date: iso(-10), staff: "Bilal (Pharmacist)" },
  { id: "sm-2", medicineId: "med-3", medicineName: "Brufen 400mg", type: "Dispense", quantity: -12, date: iso(-1), staff: "Bilal (Pharmacist)" },
  { id: "sm-3", medicineId: "med-5", medicineName: "Glucophage 500mg", type: "Dispense", quantity: -20, date: iso(-2), staff: "Bilal (Pharmacist)" },
  { id: "sm-4", medicineId: "med-2", medicineName: "Augmentin 625mg", type: "Return", quantity: 5, reason: "Patient did not collect", date: iso(-1), staff: "Bilal (Pharmacist)" },
]

export const INVOICES: Invoice[] = [
  {
    id: "INV-3001", mrNumber: "MR-2026-000101", patientName: "Fatima Zahra", date: iso(0),
    lineItems: [
      { id: "li-1", category: "Consultation", description: "Cardiology Consultation", qty: 1, unitPrice: 3000, discount: 0 },
      { id: "li-2", category: "Lab", description: "Lipid Profile", qty: 1, unitPrice: 1800, discount: 0 },
    ],
    payments: [{ id: "pay-1", amount: 1000, method: "Cash", date: iso(0) }],
    status: "Partial",
    auditTrail: [{ action: "Invoice Created", date: iso(0), by: "Front Desk" }],
  },
  {
    id: "INV-3000", mrNumber: "MR-2026-000102", patientName: "Ahmed Raza", date: iso(-1),
    lineItems: [{ id: "li-3", category: "Consultation", description: "General Medicine Consultation", qty: 1, unitPrice: 2000, discount: 200 }],
    payments: [{ id: "pay-2", amount: 1800, method: "Card", date: iso(-1) }],
    status: "Paid",
    auditTrail: [{ action: "Invoice Created", date: iso(-1), by: "Front Desk" }, { action: "Payment Received", date: iso(-1), by: "Front Desk" }],
  },
  {
    id: "INV-2998", mrNumber: "MR-2026-000103", patientName: "Zainab Bibi", date: iso(-5),
    lineItems: [
      { id: "li-4", category: "Ward", description: "General Ward — 2 nights", qty: 2, unitPrice: 5000, discount: 0 },
      { id: "li-5", category: "Medicine", description: "Pharmacy Charges", qty: 1, unitPrice: 2000, discount: 0 },
    ],
    payments: [],
    status: "Unpaid",
    auditTrail: [{ action: "Invoice Created", date: iso(-5), by: "Front Desk" }],
  },
  {
    id: "INV-2990", mrNumber: "MR-2026-000108", patientName: "Imran Khalid", date: iso(-9),
    lineItems: [{ id: "li-6", category: "Lab", description: "Serum Creatinine", qty: 1, unitPrice: 1200, discount: 0 }],
    payments: [{ id: "pay-3", amount: 1200, method: "Cash", date: iso(-9) }],
    status: "Void",
    voidReason: "Duplicate invoice raised in error",
    auditTrail: [
      { action: "Invoice Created", date: iso(-9), by: "Front Desk" },
      { action: "Payment Received", date: iso(-9), by: "Front Desk" },
      { action: "Invoice Voided", date: iso(-8), by: "Admin", note: "Duplicate invoice raised in error" },
    ],
  },
]

export const TIMELINE_EVENTS: TimelineEvent[] = [
  { id: "tl-1", mrNumber: "MR-2026-000101", stage: "Registration", datetime: iso(-40), department: "Front Desk", staff: "Sara Ahmed", status: "Completed" },
  { id: "tl-2", mrNumber: "MR-2026-000101", stage: "Appointment", datetime: iso(-2, 8, 45), department: "Cardiology", staff: "Sara Ahmed", status: "Confirmed" },
  { id: "tl-3", mrNumber: "MR-2026-000101", stage: "OPD Consultation", datetime: iso(-2, 9, 10), department: "Cardiology", staff: "Dr. Ayesha Malik", status: "Completed", details: "Diagnosed with mild hypertension. Prescribed Amlodipine 5mg." },
  { id: "tl-4", mrNumber: "MR-2026-000101", stage: "Lab Order", datetime: iso(-2, 9, 20), department: "Laboratory", staff: "Dr. Ayesha Malik", status: "Ordered", details: "Lipid Profile ordered." },
  { id: "tl-5", mrNumber: "MR-2026-000101", stage: "Lab Result", datetime: iso(-1, 14, 0), department: "Laboratory", staff: "Rida Farooq", status: "Verified", details: "Results within acceptable range, mild elevation in LDL." },
  { id: "tl-6", mrNumber: "MR-2026-000101", stage: "Pharmacy Dispense", datetime: iso(-2, 9, 40), department: "Pharmacy", staff: "Bilal (Pharmacist)", status: "Dispensed", details: "Amlodipine 5mg x30 dispensed." },
  { id: "tl-7", mrNumber: "MR-2026-000101", stage: "Final Billing", datetime: iso(0, 9, 0), department: "Billing", staff: "Front Desk", status: "Partial", details: "Invoice INV-3001 raised, partially paid." },
]

export const NOTIFICATIONS: AppNotification[] = [
  { id: "n1", title: "Critical lab result", description: "Serum Creatinine for Imran Khalid flagged Critical.", time: iso(-3, 11, 0), read: false, urgency: "Critical", whatsappEligible: true, patientName: "Imran Khalid", patientPhone: "0334-2233445" },
  { id: "n5", title: "OT checklist incomplete", description: "Pre-op checklist for Fatima Zahra's angiography is only 2/7 complete, 90 minutes to start.", time: iso(0, 15, 0), read: false, urgency: "Critical" },
  { id: "n2", title: "Low stock alert", description: "Brufen 400mg is below reorder level (18 left).", time: iso(0, 7, 30), read: false, urgency: "Actionable" },
  { id: "n3", title: "New appointment request", description: "Ayesha Siddiqui requested an appointment with Dr. Omar Farooq.", time: iso(0, 8, 0), read: false, urgency: "Actionable" },
  { id: "n6", title: "Payment pending", description: "Outstanding balance of Rs. 22,000 on Fatima Zahra's ICU admission.", time: iso(0, 9, 30), read: false, urgency: "Actionable", whatsappEligible: true, patientName: "Fatima Zahra", patientPhone: "0301-2345678" },
  { id: "n4", title: "Near-expiry medicines", description: "2 medicines will expire within 30 days.", time: iso(-1, 9, 0), read: true, urgency: "Informational" },
  { id: "n7", title: "Bed available", description: "G-104 (General Ward) is now available after cleaning.", time: iso(0, 6, 0), read: true, urgency: "Informational" },
]
