import * as React from "react"
import type {
  Role, Patient, Appointment, AppointmentStatus, LabOrder, LabOrderStatus, Doctor,
  Medicine, StockMovement, Invoice, Payment, Consultation, TimelineEvent, AppNotification,
  Bed, BedStatus, Admission, TransferRecord, Surgery, OTStatus, AuditLogEntry, AuditActionType,
} from "@/dashboard/types"
import { generateId } from "@/dashboard/lib/format"
import { api, getAccessToken, getSessionVersion, subscribeToSession, toAppointment, toBed, toDoctor, toAdmission, toInvoice, toLabOrder, toPatient, toSurgery, type ApiMedicine, type ApiStockMovement } from "@/lib/api"
import { DashboardContext } from "./dashboard-context"
import { can } from "@/dashboard/permissions"

export interface CurrentUser {
  id: string
  name: string
  email: string
  role: Role
}

interface DashboardState {
  currentUser: CurrentUser | null
  sidebarCollapsed: boolean
  tableDensity: "compact" | "comfortable"
  patients: Patient[]
  doctors: Doctor[]
  appointments: Appointment[]
  labOrders: LabOrder[]
  medicines: Medicine[]
  stockMovements: StockMovement[]
  invoices: Invoice[]
  consultations: Consultation[]
  timeline: TimelineEvent[]
  notifications: AppNotification[]
  beds: Bed[]
  admissions: Admission[]
  transfers: TransferRecord[]
  surgeries: Surgery[]
  auditLogs: AuditLogEntry[]
}

type Action =
  | { type: "LOGIN"; user: CurrentUser }
  | { type: "LOGOUT" }
  | { type: "SWITCH_ROLE"; user: CurrentUser }
  | { type: "TOGGLE_SIDEBAR" }
  | { type: "SET_DENSITY"; density: "compact" | "comfortable" }
  | { type: "ADD_PATIENT"; patient: Patient }
  | { type: "SET_PATIENTS"; patients: Patient[] }
  | { type: "SET_DOCTORS"; doctors: Doctor[] }
  | { type: "SET_APPOINTMENTS"; appointments: Appointment[] }
  | { type: "SET_LAB_ORDERS"; labOrders: LabOrder[] }
  | { type: "SET_MEDICINES"; medicines: Medicine[] }
  | { type: "SET_STOCK_MOVEMENTS"; stockMovements: StockMovement[] }
  | { type: "SET_INVOICES"; invoices: Invoice[] }
  | { type: "SET_BEDS"; beds: Bed[] }
  | { type: "SET_ADMISSIONS"; admissions: Admission[] }
  | { type: "SET_SURGERIES"; surgeries: Surgery[] }
  | { type: "UPSERT_INVOICE"; invoice: Invoice }
  | { type: "SET_AUDIT_LOGS"; auditLogs: AuditLogEntry[] }
  | { type: "UPDATE_APPOINTMENT_STATUS"; id: string; status: AppointmentStatus; rejectionReason?: string }
  | { type: "ADD_APPOINTMENT"; appointment: Appointment }
  | { type: "ADD_TIMELINE_EVENT"; event: TimelineEvent }
  | { type: "UPDATE_LAB_ORDER"; id: string; patch: Partial<LabOrder> }
  | { type: "DISPENSE_MEDICINE"; medicineId: string; qty: number; staff: string }
  | { type: "STOCK_IN"; medicineId: string; qty: number; staff: string }
  | { type: "STOCK_ADJUST"; medicineId: string; qty: number; reason: string; staff: string }
  | { type: "ADD_MEDICINE"; medicine: Medicine }
  | { type: "ADD_INVOICE"; invoice: Invoice }
  | { type: "RECEIVE_PAYMENT"; invoiceId: string; payment: Payment }
  | { type: "VOID_INVOICE"; invoiceId: string; reason: string; by: string }
  | { type: "SAVE_CONSULTATION"; consultation: Consultation }
  | { type: "MARK_NOTIFICATIONS_READ" }
  | {
      type: "ADMIT_PATIENT"
      bedId: string
      mrNumber: string
      patientName: string
      doctorId: string
      doctorName: string
      admissionType: Admission["admissionType"]
      reason: string
      depositAmount: number
      notes?: string
      by: string
    }
  | { type: "TRANSFER_PATIENT"; admissionId: string; toBedId: string; reason: string; by: string }
  | { type: "DISCHARGE_PATIENT"; admissionId: string; dischargeSummary: string; settleBalance: boolean; by: string }
  | { type: "SET_BED_STATUS"; bedId: string; status: BedStatus; by: string }
  | {
      type: "SCHEDULE_SURGERY"
      mrNumber: string
      patientName: string
      procedureName: string
      surgeonId: string
      surgeonName: string
      otRoom: string
      scheduledDate: string
      scheduledTime: string
      durationMinutes: number
      notes?: string
      by: string
    }
  | { type: "UPDATE_SURGERY_STATUS"; surgeryId: string; status: OTStatus; by: string }
  | { type: "TOGGLE_CHECKLIST_ITEM"; surgeryId: string; itemId: string }
  | { type: "ADD_AUDIT_LOG"; entry: Omit<AuditLogEntry, "id" | "date"> }

function medicineStatus(stock: number, reorder: number, expiryDate: string): Medicine["status"] {
  const daysToExpiry = (new Date(expiryDate).getTime() - Date.now()) / 86400000
  if (stock <= 0) return "Out of Stock"
  if (daysToExpiry <= 30) return "Near Expiry"
  if (stock <= reorder) return "Low Stock"
  return "In Stock"
}

function toMedicine(medicine: ApiMedicine): Medicine {
  const currentStock = medicine.batches.reduce((sum, batch) => sum + batch.stockQuantity, 0)
  const earliestBatch = medicine.batches[0]
  const reorderLevel = medicine.batches.reduce((sum, batch) => sum + batch.reorderLevel, 0)
  const expiryDate = earliestBatch?.expiryDate ?? new Date(0).toISOString()
  return {
    id: medicine.id,
    name: medicine.name,
    genericName: medicine.genericName ?? "",
    strength: medicine.strength ?? "",
    batchNumber: earliestBatch?.batchNumber ?? "—",
    expiryDate,
    currentStock,
    reorderLevel,
    sellingPrice: Number(earliestBatch?.sellingPrice ?? 0),
    status: medicineStatus(currentStock, reorderLevel, expiryDate),
  }
}

function toStockMovement(movement: ApiStockMovement): StockMovement {
  const type = movement.movementType === "IN" ? "Stock In" : movement.movementType === "OUT" ? "Dispense" : movement.movementType === "RETURN" ? "Return" : "Adjustment"
  return {
    id: movement.id,
    medicineId: movement.batch.medicineId,
    medicineName: movement.batch.medicine.name,
    type,
    quantity: type === "Dispense" ? -movement.quantity : movement.quantity,
    reason: movement.reason ?? undefined,
    date: movement.createdAt,
    staff: movement.createdByUser?.name ?? "Pharmacy",
  }
}

function reducer(state: DashboardState, action: Action): DashboardState {
  switch (action.type) {
    case "LOGIN":
      return { ...state, currentUser: action.user }
    case "LOGOUT":
      return { ...initialState, sidebarCollapsed: state.sidebarCollapsed, tableDensity: state.tableDensity }
    case "SWITCH_ROLE":
      return { ...state, currentUser: action.user }
    case "TOGGLE_SIDEBAR":
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed }
    case "SET_DENSITY":
      return { ...state, tableDensity: action.density }
    case "ADD_PATIENT":
      return { ...state, patients: [action.patient, ...state.patients] }
    case "SET_PATIENTS":
      return { ...state, patients: action.patients }
    case "SET_DOCTORS":
      return { ...state, doctors: action.doctors }
    case "SET_APPOINTMENTS":
      return { ...state, appointments: action.appointments }
    case "SET_LAB_ORDERS":
      return { ...state, labOrders: action.labOrders }
    case "SET_MEDICINES":
      return { ...state, medicines: action.medicines }
    case "SET_STOCK_MOVEMENTS":
      return { ...state, stockMovements: action.stockMovements }
    case "SET_INVOICES":
      return { ...state, invoices: action.invoices }
    case "SET_BEDS":
      return { ...state, beds: action.beds }
    case "SET_ADMISSIONS":
      return { ...state, admissions: action.admissions }
    case "SET_SURGERIES":
      return { ...state, surgeries: action.surgeries }
    case "UPSERT_INVOICE": {
      const exists = state.invoices.some((invoice) => invoice.id === action.invoice.id)
      return { ...state, invoices: exists ? state.invoices.map((invoice) => invoice.id === action.invoice.id ? action.invoice : invoice) : [action.invoice, ...state.invoices] }
    }
    case "SET_AUDIT_LOGS":
      return { ...state, auditLogs: action.auditLogs }
    case "ADD_APPOINTMENT":
      return { ...state, appointments: [action.appointment, ...state.appointments] }
    case "UPDATE_APPOINTMENT_STATUS":
      const updatedAppointment = state.appointments.find((appointment) => appointment.id === action.id)
      const patients = action.status === "Done" && updatedAppointment
        ? state.patients.map((patient) => patient.mrNumber === updatedAppointment.mrNumber ? { ...patient, lastVisit: updatedAppointment.date } : patient)
        : state.patients
      return {
        ...state,
        patients,
        appointments: state.appointments.map((a) =>
          a.id === action.id
            ? {
                ...a,
                status: action.status,
                rejectionReason: action.rejectionReason ?? a.rejectionReason,
                waitingSince: action.status === "Waiting" ? new Date().toISOString() : a.waitingSince,
              }
            : a
        ),
      }
    case "ADD_TIMELINE_EVENT":
      return { ...state, timeline: [action.event, ...state.timeline] }
    case "UPDATE_LAB_ORDER":
      return {
        ...state,
        labOrders: state.labOrders.map((o) => (o.id === action.id ? { ...o, ...action.patch } : o)),
      }
    case "DISPENSE_MEDICINE": {
      const medicines = state.medicines.map((m) => {
        if (m.id !== action.medicineId) return m
        const newStock = Math.max(0, m.currentStock - action.qty)
        return { ...m, currentStock: newStock, status: medicineStatus(newStock, m.reorderLevel, m.expiryDate) }
      })
      const med = state.medicines.find((m) => m.id === action.medicineId)
      const movement: StockMovement = {
        id: generateId("sm"), medicineId: action.medicineId, medicineName: med?.name ?? "",
        type: "Dispense", quantity: -action.qty, date: new Date().toISOString(), staff: action.staff,
      }
      return { ...state, medicines, stockMovements: [movement, ...state.stockMovements] }
    }
    case "STOCK_IN": {
      const medicines = state.medicines.map((m) => {
        if (m.id !== action.medicineId) return m
        const newStock = m.currentStock + action.qty
        return { ...m, currentStock: newStock, status: medicineStatus(newStock, m.reorderLevel, m.expiryDate) }
      })
      const med = state.medicines.find((m) => m.id === action.medicineId)
      const movement: StockMovement = {
        id: generateId("sm"), medicineId: action.medicineId, medicineName: med?.name ?? "",
        type: "Stock In", quantity: action.qty, date: new Date().toISOString(), staff: action.staff,
      }
      return { ...state, medicines, stockMovements: [movement, ...state.stockMovements] }
    }
    case "STOCK_ADJUST": {
      const medicines = state.medicines.map((m) => {
        if (m.id !== action.medicineId) return m
        const newStock = Math.max(0, m.currentStock + action.qty)
        return { ...m, currentStock: newStock, status: medicineStatus(newStock, m.reorderLevel, m.expiryDate) }
      })
      const med = state.medicines.find((m) => m.id === action.medicineId)
      const movement: StockMovement = {
        id: generateId("sm"), medicineId: action.medicineId, medicineName: med?.name ?? "",
        type: action.qty >= 0 ? "Return" : "Adjustment", quantity: action.qty, reason: action.reason,
        date: new Date().toISOString(), staff: action.staff,
      }
      return { ...state, medicines, stockMovements: [movement, ...state.stockMovements] }
    }
    case "ADD_MEDICINE":
      return { ...state, medicines: [action.medicine, ...state.medicines] }
    case "ADD_INVOICE":
      return { ...state, invoices: [action.invoice, ...state.invoices] }
    case "RECEIVE_PAYMENT": {
      return {
        ...state,
        invoices: state.invoices.map((inv) => {
          if (inv.id !== action.invoiceId) return inv
          const payments = [...inv.payments, action.payment]
          const total = inv.lineItems.reduce((s, li) => s + li.qty * li.unitPrice - li.discount, 0)
          const paid = payments.reduce((s, p) => s + p.amount, 0)
          const status: Invoice["status"] = paid >= total ? "Paid" : paid > 0 ? "Partial" : "Unpaid"
          return {
            ...inv, payments, status,
            auditTrail: [...inv.auditTrail, { action: "Payment Received", date: new Date().toISOString(), by: "Front Desk", note: `Rs. ${action.payment.amount} via ${action.payment.method}` }],
          }
        }),
      }
    }
    case "VOID_INVOICE":
      return {
        ...state,
        invoices: state.invoices.map((inv) =>
          inv.id === action.invoiceId
            ? {
                ...inv, status: "Void", voidReason: action.reason,
                auditTrail: [...inv.auditTrail, { action: "Invoice Voided", date: new Date().toISOString(), by: action.by, note: action.reason }],
              }
            : inv
        ),
      }
    case "SAVE_CONSULTATION": {
      const exists = state.consultations.some((c) => c.id === action.consultation.id)
      return {
        ...state,
        consultations: exists
          ? state.consultations.map((c) => (c.id === action.consultation.id ? action.consultation : c))
          : [action.consultation, ...state.consultations],
      }
    }
    case "MARK_NOTIFICATIONS_READ":
      return { ...state, notifications: state.notifications.map((n) => ({ ...n, read: true })) }

    case "ADMIT_PATIENT": {
      const admissionId = generateId("adm")
      const bed = state.beds.find((b) => b.id === action.bedId)
      if (!bed) return state
      const admission: Admission = {
        id: admissionId, mrNumber: action.mrNumber, patientName: action.patientName,
        bedId: bed.id, bedNumber: bed.bedNumber, ward: bed.ward,
        doctorId: action.doctorId, doctorName: action.doctorName,
        admissionType: action.admissionType, admissionDate: new Date().toISOString(),
        reason: action.reason, depositAmount: action.depositAmount, notes: action.notes,
        status: "Admitted", outstandingBalance: 0,
      }
      const beds = state.beds.map((b) =>
        b.id === bed.id
          ? { ...b, status: "Occupied" as BedStatus, admissionId, mrNumber: action.mrNumber, patientName: action.patientName, doctorName: action.doctorName, admittedAt: admission.admissionDate }
          : b
      )
      const event: TimelineEvent = {
        id: generateId("tl"), mrNumber: action.mrNumber, stage: "Ward Admission", datetime: admission.admissionDate,
        department: bed.ward, staff: action.by, status: "Admitted", details: `Admitted to ${bed.bedNumber} (${bed.ward}) under ${action.doctorName}. Reason: ${action.reason}`,
      }
      const audit: AuditLogEntry = {
        id: generateId("aud"), actionType: "Created", action: "Admitted patient", entity: "Admission", entityId: admissionId,
        by: action.by, role: "Staff", date: admission.admissionDate, details: `${action.patientName} admitted to ${bed.bedNumber} (${bed.ward})`,
      }
      return {
        ...state, beds, admissions: [admission, ...state.admissions],
        timeline: [event, ...state.timeline], auditLogs: [audit, ...state.auditLogs],
      }
    }

    case "TRANSFER_PATIENT": {
      const admission = state.admissions.find((a) => a.id === action.admissionId)
      const toBed = state.beds.find((b) => b.id === action.toBedId)
      if (!admission || !toBed) return state
      const fromBed = state.beds.find((b) => b.id === admission.bedId)
      const now = new Date().toISOString()
      const beds = state.beds.map((b) => {
        if (b.id === admission.bedId) return { ...b, status: "Cleaning" as BedStatus, admissionId: undefined, mrNumber: undefined, patientName: undefined, doctorName: undefined, admittedAt: undefined }
        if (b.id === toBed.id) return { ...b, status: "Occupied" as BedStatus, admissionId: admission.id, mrNumber: admission.mrNumber, patientName: admission.patientName, doctorName: admission.doctorName, admittedAt: now }
        return b
      })
      const admissions = state.admissions.map((a) =>
        a.id === admission.id ? { ...a, bedId: toBed.id, bedNumber: toBed.bedNumber, ward: toBed.ward } : a
      )
      const transfer: TransferRecord = {
        id: generateId("trf"), admissionId: admission.id, mrNumber: admission.mrNumber, patientName: admission.patientName,
        fromBedId: fromBed?.id ?? "", fromBedNumber: fromBed?.bedNumber ?? "", fromWard: fromBed?.ward ?? admission.ward,
        toBedId: toBed.id, toBedNumber: toBed.bedNumber, toWard: toBed.ward, reason: action.reason, date: now, by: action.by,
      }
      const event: TimelineEvent = {
        id: generateId("tl"), mrNumber: admission.mrNumber, stage: "Ward Admission", datetime: now,
        department: toBed.ward, staff: action.by, status: "Transferred", details: `Transferred from ${fromBed?.bedNumber ?? "—"} to ${toBed.bedNumber} (${toBed.ward}). Reason: ${action.reason}`,
      }
      const audit: AuditLogEntry = {
        id: generateId("aud"), actionType: "Updated", action: "Transferred patient", entity: "Admission", entityId: admission.id,
        by: action.by, role: "Staff", date: now, details: `${admission.patientName} moved from ${fromBed?.bedNumber ?? "—"} to ${toBed.bedNumber}`,
      }
      return {
        ...state, beds, admissions, transfers: [transfer, ...state.transfers],
        timeline: [event, ...state.timeline], auditLogs: [audit, ...state.auditLogs],
      }
    }

    case "DISCHARGE_PATIENT": {
      const admission = state.admissions.find((a) => a.id === action.admissionId)
      if (!admission) return state
      const now = new Date().toISOString()
      const beds = state.beds.map((b) =>
        b.id === admission.bedId
          ? { ...b, status: "Cleaning" as BedStatus, admissionId: undefined, mrNumber: undefined, patientName: undefined, doctorName: undefined, admittedAt: undefined }
          : b
      )
      const admissions = state.admissions.map((a) =>
        a.id === admission.id
          ? { ...a, status: "Discharged" as const, dischargeDate: now, dischargeSummary: action.dischargeSummary, outstandingBalance: action.settleBalance ? 0 : a.outstandingBalance }
          : a
      )
      const event: TimelineEvent = {
        id: generateId("tl"), mrNumber: admission.mrNumber, stage: "Discharge", datetime: now,
        department: admission.ward, staff: action.by, status: "Discharged", details: action.dischargeSummary,
      }
      const audit: AuditLogEntry = {
        id: generateId("aud"), actionType: "Updated", action: "Discharged patient", entity: "Admission", entityId: admission.id,
        by: action.by, role: "Staff", date: now, details: `${admission.patientName} discharged from ${admission.bedNumber}`,
      }
      return {
        ...state, beds, admissions, timeline: [event, ...state.timeline], auditLogs: [audit, ...state.auditLogs],
      }
    }

    case "SET_BED_STATUS": {
      const bed = state.beds.find((b) => b.id === action.bedId)
      if (!bed) return state
      const beds = state.beds.map((b) => (b.id === action.bedId ? { ...b, status: action.status } : b))
      const audit: AuditLogEntry = {
        id: generateId("aud"), actionType: "Updated", action: "Bed status changed", entity: "Bed", entityId: bed.id,
        by: action.by, role: "Staff", date: new Date().toISOString(), details: `${bed.bedNumber} set to ${action.status}`,
      }
      return { ...state, beds, auditLogs: [audit, ...state.auditLogs] }
    }

    case "SCHEDULE_SURGERY": {
      const id = generateId("sur")
      const now = new Date().toISOString()
      const surgery: Surgery = {
        id, mrNumber: action.mrNumber, patientName: action.patientName, procedureName: action.procedureName,
        surgeonId: action.surgeonId, surgeonName: action.surgeonName, otRoom: action.otRoom,
        scheduledDate: action.scheduledDate, scheduledTime: action.scheduledTime, durationMinutes: action.durationMinutes,
        status: "Scheduled", notes: action.notes,
        preOpChecklist: [
          "Consent form signed", "Fasting confirmed (NPO 8 hrs)", "Pre-anesthesia assessment complete",
          "Site marked & verified", "Blood products available/cross-matched", "Implants/equipment confirmed",
          "Antibiotic prophylaxis given",
        ].map((label, i) => ({ id: `chk-${id}-${i}`, label, done: false })),
        activityLog: [{ id: generateId("act"), action: "Surgery scheduled", by: action.by, at: now }],
      }
      const event: TimelineEvent = {
        id: generateId("tl"), mrNumber: action.mrNumber, stage: "OT Surgery", datetime: now,
        department: action.otRoom, staff: action.by, status: "Scheduled", details: `${action.procedureName} scheduled with ${action.surgeonName} on ${action.scheduledDate} at ${action.scheduledTime}.`,
      }
      const audit: AuditLogEntry = {
        id: generateId("aud"), actionType: "Created", action: "Scheduled surgery", entity: "Surgery", entityId: id,
        by: action.by, role: "Staff", date: now, details: `${action.procedureName} for ${action.patientName} in ${action.otRoom}`,
      }
      return {
        ...state, surgeries: [surgery, ...state.surgeries], timeline: [event, ...state.timeline], auditLogs: [audit, ...state.auditLogs],
      }
    }

    case "UPDATE_SURGERY_STATUS": {
      const surgery = state.surgeries.find((s) => s.id === action.surgeryId)
      if (!surgery) return state
      const now = new Date().toISOString()
      const surgeries = state.surgeries.map((s) =>
        s.id === surgery.id
          ? { ...s, status: action.status, activityLog: [...s.activityLog, { id: generateId("act"), action: `Status changed to ${action.status}`, by: action.by, at: now }] }
          : s
      )
      const event: TimelineEvent = {
        id: generateId("tl"), mrNumber: surgery.mrNumber, stage: "OT Surgery", datetime: now,
        department: surgery.otRoom, staff: action.by, status: action.status, details: `${surgery.procedureName} — status updated to ${action.status}.`,
      }
      const audit: AuditLogEntry = {
        id: generateId("aud"), actionType: "Updated", action: "Surgery status updated", entity: "Surgery", entityId: surgery.id,
        by: action.by, role: "Staff", date: now, details: `${surgery.procedureName} → ${action.status}`,
      }
      return { ...state, surgeries, timeline: [event, ...state.timeline], auditLogs: [audit, ...state.auditLogs] }
    }

    case "TOGGLE_CHECKLIST_ITEM": {
      const surgeries = state.surgeries.map((s) =>
        s.id === action.surgeryId
          ? { ...s, preOpChecklist: s.preOpChecklist.map((c) => (c.id === action.itemId ? { ...c, done: !c.done } : c)) }
          : s
      )
      return { ...state, surgeries }
    }

    case "ADD_AUDIT_LOG":
      return { ...state, auditLogs: [{ ...action.entry, id: generateId("aud"), date: new Date().toISOString() }, ...state.auditLogs] }

    default:
      return state
  }
}

const initialState: DashboardState = {
  currentUser: null,
  sidebarCollapsed: false,
  tableDensity: "compact",
  patients: [],
  doctors: [],
  appointments: [],
  labOrders: [],
  medicines: [],
  stockMovements: [],
  invoices: [],
  consultations: [],
  timeline: [],
  notifications: [],
  beds: [],
  admissions: [],
  transfers: [],
  surgeries: [],
  auditLogs: [],
}

export interface DashboardContextValue extends DashboardState {
  dispatch: React.Dispatch<Action>
  authReady: boolean
  dataLoading: boolean
  hydratedUserId: string | null
  dataError: string | null
  clearDataError: () => void
  refreshAppointments: (sort?: "date" | "recentlyCreated") => Promise<void>
  refreshWardState: () => Promise<void>
}

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, initialState)
  const [authReady, setAuthReady] = React.useState(!getAccessToken())
  const [dataLoading, setDataLoading] = React.useState(Boolean(getAccessToken()))
  const [hydratedUserId, setHydratedUserId] = React.useState<string | null>(null)
  const [dataError, setDataError] = React.useState<string | null>(null)
  const clearDataError = React.useCallback(() => setDataError(null), [])
  const [authTick, setAuthTick] = React.useState(0)
  const loadedUserId = React.useRef<string | null>(null)
  const loadingToken = React.useRef<string | null>(null)
  const loadVersion = React.useRef(0)

  const refreshAppointments = React.useCallback(async (sort: "date" | "recentlyCreated" = "date") => {
    const response = await api.listAppointments({ sort })
    dispatch({ type: "SET_APPOINTMENTS", appointments: response.map(toAppointment) })
  }, [])

  React.useEffect(() => subscribeToSession(() => setAuthTick((tick) => tick + 1)), [])

  const refreshWardState = React.useCallback(async () => {
    const [bedResponse, admissionResponse] = await Promise.all([api.listBedAvailability(), api.listAdmissions()])
    dispatch({ type: "SET_BEDS", beds: bedResponse.map(toBed) })
    dispatch({ type: "SET_ADMISSIONS", admissions: admissionResponse.map(toAdmission) })
  }, [])

  React.useEffect(() => {
    const accessToken = getAccessToken()
    if (!accessToken) {
      loadedUserId.current = null
      loadingToken.current = null
      loadVersion.current += 1
      setDataLoading(false)
      setHydratedUserId(null)
      setAuthReady(true)
      return
    }
    if (state.currentUser?.id && loadedUserId.current === state.currentUser.id) return
    if (loadingToken.current === accessToken) return
    loadingToken.current = accessToken
    const currentLoad = ++loadVersion.current
    const currentSession = getSessionVersion()
    setDataLoading(true)
    setDataError(null)
    setHydratedUserId(null)
    api.me()
      .then(async (user) => {
        if (currentLoad !== loadVersion.current || getSessionVersion() !== currentSession || getAccessToken() !== accessToken) return
        if (loadedUserId.current === user.id) return
        loadedUserId.current = user.id
        dispatch({ type: "LOGIN", user: { id: user.id, name: user.name, email: user.email, role: user.role.toLowerCase() as Role } })
        const role = user.role.toLowerCase() as Role
        const canViewInvoices = can(role, "billing", "view")
        const canViewAppointments = can(role, "appointments", "view")
        const canViewLab = can(role, "lab", "view")
        const canViewPharmacy = can(role, "pharmacy", "view")
        const canViewStockMovements = ["ADMIN", "PHARMACIST"].includes(user.role)
        const canViewWard = can(role, "ward", "view")
        const results = await Promise.allSettled([
          can(role, "patients", "view") ? api.listPatients() : Promise.resolve([]),
          api.listDoctors(),
          canViewAppointments ? api.listAppointments() : Promise.resolve([]),
          canViewLab ? api.listLabOrders() : Promise.resolve([]),
          canViewPharmacy ? api.listMedicines() : Promise.resolve([]),
          canViewStockMovements ? api.listStockMovements() : Promise.resolve([]),
          canViewInvoices ? api.listInvoices() : Promise.resolve([]),
          user.role === "ADMIN" ? api.listAuditLogs() : Promise.resolve([]),
          canViewWard ? api.listBedAvailability() : Promise.resolve([]),
          canViewWard ? api.listAdmissions() : Promise.resolve([]),
          ["ADMIN", "DOCTOR", "NURSE"].includes(user.role) ? api.listSurgeries() : Promise.resolve([]),
        ])
        const valueOr = <T,>(result: PromiseSettledResult<T>, fallback: T) => result.status === "fulfilled" ? result.value : fallback
        const patients = valueOr(results[0], [])
        const doctors = valueOr(results[1], [])
        const appointments = valueOr(results[2], [])
        const labOrders = valueOr(results[3], [])
        const medicines = valueOr(results[4], [])
        const stockMovements = valueOr(results[5], [])
        const invoices = valueOr(results[6], [])
        const auditResponse = valueOr(results[7], [])
        const beds = valueOr(results[8], [])
        const admissions = valueOr(results[9], [])
        const surgeries = valueOr(results[10], [])
        const firstFailure = results.find((result) => result.status === "rejected")
        if (firstFailure?.status === "rejected") setDataError(firstFailure.reason instanceof Error ? firstFailure.reason.message : "Some dashboard data could not be loaded")
        if (currentLoad !== loadVersion.current || getSessionVersion() !== currentSession || getAccessToken() !== accessToken) return
        dispatch({ type: "SET_PATIENTS", patients: patients.map(toPatient) })
        dispatch({ type: "SET_DOCTORS", doctors: doctors.map((doctor) => toDoctor(doctor)) })
        dispatch({ type: "SET_APPOINTMENTS", appointments: appointments.map((appointment) => toAppointment(appointment)) })
        dispatch({ type: "SET_BEDS", beds: beds.map(toBed) })
        dispatch({ type: "SET_ADMISSIONS", admissions: admissions.map(toAdmission) })
        dispatch({ type: "SET_SURGERIES", surgeries: surgeries.map(toSurgery) })
        const dashboardPatients = patients.map(toPatient)
        const dashboardDoctors = doctors.map((doctor) => toDoctor(doctor))
        dispatch({ type: "SET_LAB_ORDERS", labOrders: labOrders.map((order) => toLabOrder(order, {
          mrNumber: dashboardPatients.find((patient) => patient.id === order.patientId)?.mrNumber,
          patientName: dashboardPatients.find((patient) => patient.id === order.patientId)?.name,
          doctorName: dashboardDoctors.find((doctor) => doctor.id === order.doctorId)?.name,
        })) })
        dispatch({ type: "SET_MEDICINES", medicines: medicines.map(toMedicine) })
        dispatch({ type: "SET_STOCK_MOVEMENTS", stockMovements: stockMovements.map(toStockMovement) })
        dispatch({ type: "SET_INVOICES", invoices: invoices.map((invoice) => toInvoice(invoice, dashboardPatients.find((patient) => patient.id === invoice.patientId))) })
              dispatch({ type: "SET_AUDIT_LOGS", auditLogs: auditResponse.map((entry) => ({
                id: entry.id,
                actionType: entry.action as AuditActionType,
                action: entry.action,
                entity: entry.entityType,
                entityId: entry.entityId,
                by: entry.user?.name ?? "System",
                role: entry.user?.role ?? "System",
                date: entry.createdAt,
                details: typeof entry.details === "string" ? entry.details : undefined,
              })) })
              setHydratedUserId(user.id)
      })
      .catch((error: Error) => {
        if (currentLoad !== loadVersion.current || getSessionVersion() !== currentSession || getAccessToken() !== accessToken) return
        setHydratedUserId(loadedUserId.current)
        setDataError(error.message || "Unable to load dashboard data")
      })
      .finally(() => {
        if (currentLoad === loadVersion.current) {
          loadingToken.current = null
          setDataLoading(false)
          setAuthReady(true)
        }
      })
  }, [state.currentUser?.id, refreshWardState, authTick])

  const value = React.useMemo(() => ({ ...state, dispatch, authReady, dataLoading, hydratedUserId, dataError, clearDataError, refreshAppointments, refreshWardState }), [state, authReady, dataLoading, hydratedUserId, dataError, clearDataError, refreshAppointments, refreshWardState])
  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
}

export { useDashboard } from "./useDashboard"

