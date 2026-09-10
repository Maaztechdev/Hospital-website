import type { Patient, Gender, BloodGroup, Appointment, Doctor, LabOrder, LabInterpretation, Priority, Invoice, Bed, Admission, WardType, AdmissionType, Surgery, OTStatus } from "@/dashboard/types"

const API_BASE_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:4000/api/v1").replace(/\/$/, "")
export const apiAssetUrl = (url?: string | null) => url ? (url.startsWith("http") ? url : `${API_BASE_URL.replace(/\/api\/v1$/, "")}${url}`) : ""

interface ApiEnvelope<T> {
  success: boolean
  data: T | null
  message: string | null
  errors: unknown
}

export interface ApiError extends Error {
  status: number
  details: unknown
}

interface TokenResponse {
  accessToken: string
  refreshToken: string
}

const ACCESS_TOKEN_KEY = "careplus.accessToken"
const REFRESH_TOKEN_KEY = "careplus.refreshToken"
let refreshRequest: Promise<string | null> | null = null
let sessionVersion = 0
const sessionListeners = new Set<() => void>()
const TRANSIENT_RETRY_DELAYS = [250, 750]

export function subscribeToSession(listener: () => void) {
  sessionListeners.add(listener)
  return () => { sessionListeners.delete(listener) }
}

function notifySessionListeners() {
  sessionListeners.forEach((listener) => listener())
}

export function getAccessToken() {
  return sessionStorage.getItem(ACCESS_TOKEN_KEY)
}

export function getSessionVersion() {
  return sessionVersion
}

function getRefreshToken() {
  return sessionStorage.getItem(REFRESH_TOKEN_KEY)
}

export function setSession(tokens: TokenResponse) {
  sessionVersion += 1
  refreshRequest = null
  sessionStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken)
  sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken)
  notifySessionListeners()
}

export function clearSession() {
  sessionVersion += 1
  refreshRequest = null
  sessionStorage.removeItem(ACCESS_TOKEN_KEY)
  sessionStorage.removeItem(REFRESH_TOKEN_KEY)
  notifySessionListeners()
}

function storeRefreshedSession(tokens: TokenResponse) {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken)
  sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken)
}

function tokenNeedsRefresh(token: string) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number }
    return typeof payload.exp === "number" && payload.exp * 1000 <= Date.now() + 30_000
  } catch {
    return false
  }
}

function createApiError(response: Response, body: Partial<ApiEnvelope<unknown>>): ApiError {
  const error = new Error(body.message || `Request failed with status ${response.status}`) as ApiError
  error.status = response.status
  error.details = body.errors
  return error
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return null
  const refreshVersion = sessionVersion

  if (!refreshRequest) {
    refreshRequest = fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    })
      .then(async (response) => {
        const body = (await response.json()) as ApiEnvelope<TokenResponse>
        if (!response.ok || !body.success || !body.data) {
          clearSession()
          return null
        }
        if (refreshVersion !== sessionVersion || getRefreshToken() !== refreshToken) return null
        storeRefreshedSession(body.data)
        return body.data.accessToken
      })
      .catch(() => {
        clearSession()
        return null
      })
      .finally(() => {
        refreshRequest = null
      })
  }

  return refreshRequest
}

export async function apiRequest<T>(path: string, init: Parameters<typeof fetch>[1] = {}, retry = true, transientAttempt = 0): Promise<T> {
  const headers = new Headers(init.headers)
  if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json")
  let accessToken = getAccessToken()
  if (accessToken && retry && path !== "/auth/login" && path !== "/auth/refresh" && tokenNeedsRefresh(accessToken)) {
    accessToken = await refreshAccessToken()
  }
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`)

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers })
  } catch {
    const method = (init.method ?? "GET").toUpperCase()
    if (headers.has("Idempotency-Key") && method !== "GET" && transientAttempt < TRANSIENT_RETRY_DELAYS.length) {
      await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAYS[transientAttempt]))
      return apiRequest<T>(path, init, retry, transientAttempt + 1)
    }
    const error = new Error("Unable to reach the hospital server. Check that the backend is running.") as ApiError
    error.status = 0
    error.details = null
    window.dispatchEvent(new CustomEvent("careplus:api-error", { detail: { message: error.message } }))
    throw error
  }

  const body = (await response.json().catch(() => ({}))) as ApiEnvelope<T>
  if (response.status === 401 && retry && path !== "/auth/login" && path !== "/auth/refresh") {
    const token = await refreshAccessToken()
    if (token) return apiRequest<T>(path, init, false)
    clearSession()
  }
  if (!response.ok || !body.success) {
    const error = createApiError(response, body)
    window.dispatchEvent(new CustomEvent("careplus:api-error", { detail: { message: error.message } }))
    throw error
  }
  return body.data as T
}

export const api = {
  login: (email: string, password: string) =>
    apiRequest<{ accessToken: string; refreshToken: string; user: ApiUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => apiRequest<ApiUser>("/auth/me"),
  logout: () => apiRequest<null>("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken: getRefreshToken() }) }),
  listNotifications: (unreadOnly = false) => apiRequest<ApiNotification[]>(`/notifications?limit=100${unreadOnly ? "&unreadOnly=true" : ""}`),
  getUnreadNotificationCount: () => apiRequest<{ count: number }>("/notifications/unread-count"),
  markNotificationRead: (id: string) => apiRequest<ApiNotification>(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }),
  markAllNotificationsRead: () => apiRequest<{ message: string }>("/notifications/mark-all-read", { method: "POST" }),
  listPatients: (search = "") => apiRequest<ApiPatient[]>(`/patients?limit=100${search ? `&search=${encodeURIComponent(search)}` : ""}`),
  listDoctors: () => apiRequest<ApiDoctor[]>("/appointments/doctors"),
  listPublicDepartments: () => apiRequest<ApiPublicDepartment[]>("/appointments/public/departments"),
  listPublicDoctors: () => apiRequest<ApiDoctor[]>("/appointments/public/doctors"),
  createPublicAppointment: (payload: Record<string, unknown>) => apiRequest<ApiAppointment>("/appointments/public", { method: "POST", body: JSON.stringify(payload) }),
  listWards: () => apiRequest<ApiWard[]>("/wards"),
  listBedAvailability: () => apiRequest<ApiBedAvailability[]>("/wards/beds/availability"),
  setBedStatus: (id: string, status: ApiBedStatus) => apiRequest<ApiBed>(`/wards/beds/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  listAdmissions: (status?: ApiAdmissionStatus, patientId?: string) => {
    const qs = new URLSearchParams({ limit: "100" })
    if (status) qs.set("status", status)
    if (patientId) qs.set("patientId", patientId)
    return apiRequest<ApiAdmission[]>(`/wards/admissions?${qs.toString()}`)
  },
  getAdmission: (id: string) => apiRequest<ApiAdmission>(`/wards/admissions/${encodeURIComponent(id)}`),
  admitPatient: (payload: ApiAdmitPatientInput) => apiRequest<ApiAdmission>("/wards/admissions", { method: "POST", body: JSON.stringify(payload) }),
  transferAdmission: (id: string, payload: ApiTransferInput) => apiRequest<ApiAdmission>(`/wards/admissions/${encodeURIComponent(id)}/transfer`, { method: "POST", body: JSON.stringify(payload) }),
  dischargeAdmission: (id: string, payload: ApiDischargeInput) => apiRequest<ApiAdmission>(`/wards/admissions/${encodeURIComponent(id)}/discharge`, { method: "POST", body: JSON.stringify(payload) }),
  createNurseAssignment: (payload: ApiNurseAssignmentInput) => apiRequest<ApiNurseAssignment>("/nursing/assignments", { method: "POST", body: JSON.stringify(payload) }),
  listNurseAssignments: (wardId?: string, shiftDate?: string) => apiRequest<ApiNurseAssignment[]>(`/nursing/assignments${wardId || shiftDate ? `?${new URLSearchParams({ ...(wardId ? { wardId } : {}), ...(shiftDate ? { shiftDate } : {}) }).toString()}` : ""}`),
  recordVitals: (payload: ApiRecordVitalsInput) => apiRequest<ApiPatientVitals>("/nursing/vitals", { method: "POST", body: JSON.stringify(payload) }),
  listVitalsHistory: (admissionId: string) => apiRequest<ApiPatientVitals[]>(`/nursing/vitals/${encodeURIComponent(admissionId)}`),
  createNursingTask: (payload: ApiNursingTaskInput) => apiRequest<ApiNursingTask>("/nursing/tasks", { method: "POST", body: JSON.stringify(payload) }),
  completeNursingTask: (id: string) => apiRequest<ApiNursingTask>(`/nursing/tasks/${encodeURIComponent(id)}/complete`, { method: "POST" }),
  listNursingTasks: (admissionId: string) => apiRequest<ApiNursingTask[]>(`/nursing/tasks/${encodeURIComponent(admissionId)}`),
  getAvailableSlots: (doctorId: string, date: string) => 
    apiRequest<{ slotsPerDay: string[]; bookedSlots: string[]; availableSlots: string[] }>(`/appointments/doctors/${encodeURIComponent(doctorId)}/slots?date=${encodeURIComponent(date)}`),
  listAppointments: () => apiRequest<ApiAppointment[]>("/appointments?limit=100"),
  listLabTests: () => apiRequest<ApiLabTest[]>("/lab/tests"),
  listLabOrders: () => apiRequest<ApiLabOrder[]>("/lab/orders?limit=100"),
  listUltrasoundOrders: (params: Record<string, string> = {}) => apiRequest<ApiUltrasoundOrder[]>(`/ultrasound?${new URLSearchParams({ limit: "100", ...params }).toString()}`),
  getUltrasoundOrder: (id: string) => apiRequest<ApiUltrasoundOrder>(`/ultrasound/${encodeURIComponent(id)}`),
  listPatientUltrasounds: (patientId: string) => apiRequest<ApiUltrasoundOrder[]>(`/ultrasound/patient/${encodeURIComponent(patientId)}`),
  createUltrasoundOrder: (payload: ApiCreateUltrasoundOrderInput) => apiRequest<ApiUltrasoundOrder>("/ultrasound", { method: "POST", body: JSON.stringify(payload) }),
  scheduleUltrasound: (id: string, payload: ApiScheduleUltrasoundInput) => apiRequest<ApiUltrasoundOrder>(`/ultrasound/${encodeURIComponent(id)}/schedule`, { method: "PATCH", body: JSON.stringify(payload) }),
  startUltrasound: (id: string) => apiRequest<ApiUltrasoundOrder>(`/ultrasound/${encodeURIComponent(id)}/start`, { method: "PATCH" }),
  completeUltrasound: (id: string, payload: ApiCompleteUltrasoundInput) => apiRequest<ApiUltrasoundOrder>(`/ultrasound/${encodeURIComponent(id)}/complete`, { method: "PATCH", body: JSON.stringify(payload) }),
  uploadUltrasoundImages: (id: string, files: File[]) => { const body = new FormData(); files.forEach((file) => body.append("files", file)); return apiRequest<ApiUltrasoundOrder>(`/ultrasound/${encodeURIComponent(id)}/images`, { method: "POST", body }) },
  cancelUltrasound: (id: string) => apiRequest<ApiUltrasoundOrder>(`/ultrasound/${encodeURIComponent(id)}/cancel`, { method: "PATCH" }),
  getLabOrder: (id: string) => apiRequest<ApiLabOrder>(`/lab/orders/${encodeURIComponent(id)}`),
  createLabOrder: (payload: ApiCreateLabOrderInput) => apiRequest<ApiLabOrder>("/lab/orders", { method: "POST", body: JSON.stringify(payload) }),
  updateLabSampleStatus: (id: string, status: ApiLabSampleStatus) => apiRequest<ApiLabOrder>(`/lab/orders/${encodeURIComponent(id)}/sample-status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  enterLabResult: (id: string, payload: ApiLabResultInput) => apiRequest<ApiLabResult>(`/lab/orders/${encodeURIComponent(id)}/results`, { method: "POST", body: JSON.stringify(payload) }),
  amendLabResult: (id: string, payload: ApiLabResultInput & { reason: string }) => apiRequest<ApiLabResult>(`/lab/orders/${encodeURIComponent(id)}/results/amend`, { method: "POST", body: JSON.stringify(payload) }),
  verifyLabOrder: (id: string) => apiRequest<ApiLabOrder>(`/lab/orders/${encodeURIComponent(id)}/verify`, { method: "POST" }),
  uploadLabReport: (id: string, file: File) => { const body = new FormData(); body.append("file", file); return apiRequest<ApiLabAttachment>(`/lab/orders/${encodeURIComponent(id)}/attachments`, { method: "POST", body }) },
  listConsultations: (appointmentId?: string) => apiRequest<ApiConsultation[]>(`/consultations?limit=100${appointmentId ? `&appointmentId=${encodeURIComponent(appointmentId)}` : ""}`),
  listInvoices: () => apiRequest<ApiInvoice[]>("/billing/invoices?limit=100"),
  getInvoice: (id: string) => apiRequest<ApiInvoice>(`/billing/invoices/${encodeURIComponent(id)}`),
  createInvoice: (payload: ApiCreateInvoiceInput) => apiRequest<ApiInvoice>("/billing/invoices", { method: "POST", body: JSON.stringify(payload) }),
  recordPayment: (id: string, payload: ApiRecordPaymentInput) => apiRequest<ApiInvoice>(`/billing/invoices/${encodeURIComponent(id)}/payments`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(payload) }),
  voidInvoice: (id: string, reason: string) => apiRequest<ApiInvoice>(`/billing/invoices/${encodeURIComponent(id)}/void`, { method: "POST", body: JSON.stringify({ reason }) }),
  listMedicines: (search = "") => apiRequest<ApiMedicine[]>(`/pharmacy/medicines?limit=100${search ? `&search=${encodeURIComponent(search)}` : ""}`),
  createMedicine: (payload: ApiCreateMedicineInput) => apiRequest<ApiMedicine>("/pharmacy/medicines", { method: "POST", body: JSON.stringify(payload) }),
  addMedicineBatch: (payload: ApiAddBatchInput) => apiRequest<ApiMedicineBatch>("/pharmacy/batches", { method: "POST", body: JSON.stringify(payload) }),
  stockIn: (payload: ApiStockInInput) => apiRequest<ApiMedicineBatch>("/pharmacy/stock-in", { method: "POST", body: JSON.stringify(payload) }),
  dispense: (payload: ApiDispenseInput) => apiRequest<ApiPrescriptionItem>("/pharmacy/dispense", { method: "POST", body: JSON.stringify(payload) }),
  createPharmacySale: (payload: ApiCreatePharmacySaleInput) => apiRequest<ApiPharmacySale>("/pharmacy/sales", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(payload) }),
  getPharmacySaleInvoice: (id: string) => apiRequest<ApiInvoice>(`/pharmacy/sales/${encodeURIComponent(id)}/invoice`),
  returnStock: (payload: ApiReturnStockInput) => apiRequest<ApiMedicineBatch>("/pharmacy/return", { method: "POST", body: JSON.stringify(payload) }),
  adjustStock: (payload: ApiAdjustStockInput) => apiRequest<ApiMedicineBatch>("/pharmacy/adjust", { method: "POST", body: JSON.stringify(payload) }),
  writeOffStock: (payload: ApiWriteOffInput) => apiRequest<ApiMedicineBatch>("/pharmacy/write-off", { method: "POST", body: JSON.stringify(payload) }),
  listStockMovements: (medicineId?: string) => apiRequest<ApiStockMovement[]>(`/pharmacy/stock-movements?limit=200${medicineId ? `&medicineId=${encodeURIComponent(medicineId)}` : ""}`),
  listPrescriptions: (status?: "DRAFT" | "SIGNED" | "COMPLETED" | "VOID") => apiRequest<ApiPrescription[]>(`/prescriptions?limit=100${status ? `&status=${status}` : ""}`),
  getPrescription: (id: string) => apiRequest<ApiPrescription>(`/prescriptions/${encodeURIComponent(id)}`),
  createPrescription: (payload: ApiCreatePrescriptionInput) => apiRequest<ApiPrescription>("/prescriptions", { method: "POST", body: JSON.stringify(payload) }),
  signPrescription: (id: string) => apiRequest<ApiPrescription>(`/prescriptions/${encodeURIComponent(id)}/sign`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } }),
  voidPrescription: (id: string, reason: string) => apiRequest<ApiPrescription>(`/prescriptions/${encodeURIComponent(id)}/void`, { method: "POST", body: JSON.stringify({ reason }) }),
  printPrescription: (id: string) => apiRequest<ApiPrescription>(`/prescriptions/${encodeURIComponent(id)}/print`),
  createConsultation: (payload: Record<string, unknown>) => apiRequest<ApiConsultation>("/consultations", { method: "POST", body: JSON.stringify(payload) }),
  updateConsultation: (id: string, payload: Record<string, unknown>) => apiRequest<ApiConsultation>(`/consultations/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  signConsultation: (id: string) => apiRequest<ApiConsultation>(`/consultations/${id}/sign`, { method: "POST" }),
  listAuditLogs: () => apiRequest<ApiAuditLog[]>("/audit-logs?limit=200"),
  listUsers: (search = "") => apiRequest<ApiUser[]>(`/users?limit=100${search ? `&search=${encodeURIComponent(search)}` : ""}`),
  listBackups: () => apiRequest<ApiBackup[]>('/admin/backup'),
  createBackup: () => apiRequest<ApiBackup>('/admin/backup', { method: 'POST' }),
  downloadBackup: async (id: string) => {
    const response = await fetch(`${API_BASE_URL}/admin/backup/${encodeURIComponent(id)}/download`, {
      headers: getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {},
    })
    if (!response.ok) throw new Error("Unable to download backup")
    return response.blob()
  },
  deleteBackup: (id: string) => apiRequest<null>(`/admin/backup/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  restoreBackup: (id: string, password: string) => apiRequest<null>(`/admin/backup/${encodeURIComponent(id)}/restore`, { method: 'POST', body: JSON.stringify({ password }) }),
  createUser: (payload: Record<string, unknown>) => apiRequest<ApiUser>("/users", { method: "POST", body: JSON.stringify(payload) }),
  updateUser: (id: string, payload: Record<string, unknown>) => apiRequest<ApiUser>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deactivateUser: (id: string) => apiRequest<ApiUser>(`/users/${id}/deactivate`, { method: "POST" }),
  createAppointment: (payload: Record<string, unknown>) => apiRequest<ApiAppointment>("/appointments", { method: "POST", body: JSON.stringify(payload) }),
  approveAppointment: (id: string) => apiRequest<ApiAppointment>(`/appointments/${id}/approve`, { method: "POST" }),
  rejectAppointment: (id: string, rejectionReason: string) => apiRequest<ApiAppointment>(`/appointments/${id}/reject`, { method: "POST", body: JSON.stringify({ rejectionReason }) }),
  rescheduleAppointment: (id: string, appointmentDate: string, timeSlot: string) => apiRequest<ApiAppointment>(`/appointments/${id}/reschedule`, { method: "POST", body: JSON.stringify({ appointmentDate, timeSlot }) }),
  callNext: (doctorId: string) => apiRequest<ApiAppointment>(`/opd-queue/${doctorId}/call-next`, { method: "POST" }),
  startConsultation: (id: string) => apiRequest<ApiAppointment>(`/opd-queue/${id}/start-consultation`, { method: "POST" }),
  requeue: (id: string) => apiRequest<ApiAppointment>(`/opd-queue/${id}/requeue`, { method: "POST" }),
  markAppointmentDone: (id: string) => apiRequest<ApiAppointment>(`/appointments/${id}/mark-done`, { method: "POST" }),
  markAppointmentNoShow: (id: string) => apiRequest<ApiAppointment>(`/appointments/${id}/mark-no-show`, { method: "POST" }),
  cancelAppointment: (id: string, reason: string) => apiRequest<ApiAppointment>(`/appointments/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }),
  createPatient: (payload: Record<string, unknown>) => apiRequest<ApiPatient>("/patients", {
    method: "POST",
    body: JSON.stringify(payload),
  }),
  listSettings: () => apiRequest<ApiSetting[]>("/settings"),
  getHospitalProfile: () => apiRequest<ApiHospitalProfile | null>("/settings/hospital-profile"),
  updateHospitalProfile: (payload: Partial<ApiHospitalProfile>) => apiRequest<ApiHospitalProfile>("/settings/hospital-profile", { method: "PUT", body: JSON.stringify(payload) }),
  uploadHospitalAsset: (type: "logo" | "favicon", file: File) => { const body = new FormData(); body.append("file", file); return apiRequest<ApiHospitalProfile>(`/settings/hospital-profile/${type}`, { method: "POST", body }) },
  getSetting: (key: string) => apiRequest<ApiSetting | null>(`/settings/${encodeURIComponent(key)}`),
  updateSetting: (key: string, value: unknown) => apiRequest<ApiSetting>(`/settings/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  }),
  listDepartments: (status: "ACTIVE" | "INACTIVE" | "ALL" = "ALL") => apiRequest<ApiDepartment[]>(`/settings/departments?status=${status}`),
  listAvailableHods: () => apiRequest<ApiDepartmentHod[]>("/settings/departments/available-hods"),
  createDepartment: (payload: ApiDepartmentInput) => apiRequest<ApiDepartment>("/settings/departments", { method: "POST", body: JSON.stringify(payload) }),
  updateDepartment: (id: string, payload: Partial<ApiDepartmentInput>) => apiRequest<ApiDepartment>(`/settings/departments/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) }),
  updateDepartmentStatus: (id: string, status: "ACTIVE" | "INACTIVE") => apiRequest<ApiDepartment>(`/settings/departments/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  deleteDepartment: (id: string) => apiRequest<null>(`/settings/departments/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getReportsRevenueSummary: (from?: string, to?: string) => {
    const qs = new URLSearchParams()
    if (from) qs.set("from", from)
    if (to) qs.set("to", to)
    return apiRequest<{ invoiceCount: number; totalBilled: number; totalCollected: number; totalOutstanding: number }>(`/reports/revenue-summary${qs.toString() ? `?${qs.toString()}` : ""}`)
  },
  getReportsBedOccupancy: () => apiRequest<{ totalBeds: number; occupiedBeds: number; occupancyRate: number }>("/reports/bed-occupancy"),
  getReportsSurgeryStats: (date?: string) => apiRequest<Array<{ status: string; count: number }>>(`/reports/surgery-stats${date ? `?date=${encodeURIComponent(date)}` : ""}`),
  listSurgeries: (date?: string) => apiRequest<ApiSurgery[]>(`/ot/surgeries?limit=100${date ? `&date=${encodeURIComponent(date)}` : ""}`),
  getSurgery: (id: string) => apiRequest<ApiSurgery>(`/ot/surgeries/${encodeURIComponent(id)}`),
  listOTRooms: () => apiRequest<ApiOTRoom[]>("/ot/rooms"),
  scheduleSurgery: (payload: ApiScheduleSurgeryInput) => apiRequest<ApiSurgery>("/ot/surgeries", { method: "POST", body: JSON.stringify(payload) }),
  updateSurgeryChecklist: (id: string, patch: Record<string, boolean>) => apiRequest<ApiSurgery>(`/ot/surgeries/${encodeURIComponent(id)}/checklist`, { method: "PATCH", body: JSON.stringify(patch) }),
  startSurgery: (id: string) => apiRequest<ApiSurgery>(`/ot/surgeries/${encodeURIComponent(id)}/start`, { method: "POST" }),
  moveSurgeryToRecovery: (id: string) => apiRequest<ApiSurgery>(`/ot/surgeries/${encodeURIComponent(id)}/recovery`, { method: "POST" }),
  completeSurgery: (id: string, payload: { postOpNotes?: string; complications?: string } = {}) => apiRequest<ApiSurgery>(`/ot/surgeries/${encodeURIComponent(id)}/complete`, { method: "POST", body: JSON.stringify(payload) }),
  cancelSurgery: (id: string, reason: string) => apiRequest<ApiSurgery>(`/ot/surgeries/${encodeURIComponent(id)}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }),
  getReportsAppointmentStats: (from?: string, to?: string) => {
    const qs = new URLSearchParams()
    if (from) qs.set("from", from)
    if (to) qs.set("to", to)
    return apiRequest<Array<{ status: string; count: number }>>(`/reports/appointment-stats${qs.toString() ? `?${qs.toString()}` : ""}`)
  },
  getReportsLowStock: () => apiRequest<ApiLowStockReport[]>("/reports/low-stock-medicines"),
  getReportsNearExpiry: () => apiRequest<ApiNearExpiryReport[]>("/reports/near-expiry-medicines"),
  getReportsLabTurnaround: (from?: string, to?: string) => apiRequest<{ averageTurnaroundHours: number; sampleSize: number }>(`/reports/lab-turnaround${from || to ? `?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString()}` : ""}`),
  getReportsDoctorProductivity: (from?: string, to?: string) => apiRequest<ApiDoctorProductivityReport[]>(`/reports/doctor-productivity${from || to ? `?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString()}` : ""}`),
}

export interface ApiUser {
  id: string
  name: string
  email: string
  role: "ADMIN" | "RECEPTIONIST" | "DOCTOR" | "LAB_TECHNICIAN" | "ULTRASOUND_TECHNICIAN" | "RADIOLOGIST" | "PHARMACIST" | "NURSE"
  phone?: string | null
  departmentId?: string | null
  isActive: boolean
  createdAt?: string
}

export interface ApiDepartmentHod { id: string; name: string; specialization?: string | null }
export interface ApiDepartmentInput { name: string; hodId?: string | null; icon?: string | null; status: "ACTIVE" | "INACTIVE" }
export interface ApiDepartment extends ApiDepartmentInput { id: string; createdAt?: string; updatedAt?: string; hod?: { id: string; user: { name: string }; specialization?: string | null } | null; _count?: { doctors: number; users: number; appointments: number } }

export interface ApiBackup {
  id: string
  filename: string
  sizeBytes: number
  createdAt: string
}

export interface ApiNotification {
  id: string
  notificationType: string
  title: string
  message: string
  isRead: boolean
  relatedEntityType?: string | null
  relatedEntityId?: string | null
  createdAt: string
}

export type ApiBedStatus = "AVAILABLE" | "CLEANING" | "MAINTENANCE" | "RESERVED"
export type ApiAdmissionStatus = "ACTIVE" | "DISCHARGED" | "TRANSFERRED"
export type ApiAdmissionType = "EMERGENCY" | "PLANNED" | "REFERRAL"
export type ApiShiftType = "MORNING" | "EVENING" | "NIGHT"
export type ApiWardType = "GENERAL" | "PRIVATE" | "ICU"
export interface ApiWard { id: string; wardName: string; wardType: ApiWardType; rooms: ApiRoom[] }
export interface ApiRoom { id: string; wardId: string; roomNumber: string; beds: ApiBed[] }
export interface ApiBed { id: string; roomId: string; bedNumber: string; bedLabel?: string | null; dailyRate: number | string; status: ApiBedStatus | "OCCUPIED" }
export interface ApiBedAvailability extends ApiBed { room: { roomNumber: string; ward: { wardName: string; wardType: ApiWardType } }; admissions: Array<{ id: string; patient: { id: string; mrNumber: string; firstName: string; lastName: string }; attendingDoctor?: { user: { name: string } } | null; admissionDate: string }> }
export interface ApiAdmission { id: string; patientId: string; bedId: string; attendingDoctorId: string; admissionType: ApiAdmissionType; admissionDate: string; admissionReason: string; depositAmount: number | string; status: ApiAdmissionStatus; dischargeDate?: string | null; dischargeSummary?: string | null; dischargeNotes?: string | null; patient: { id: string; mrNumber: string; firstName: string; lastName: string }; bed: { id: string; bedNumber: string; dailyRate: number | string; room: { roomNumber: string; ward: { wardName: string; wardType: ApiWardType } } }; attendingDoctor?: { user: { name: string } } | null; transfers?: ApiTransferRecord[] }
export interface ApiTransferRecord { id: string; admissionId: string; fromBedId: string; toBedId: string; transferDate: string; reason: string; createdBy?: string; fromBed?: { bedNumber: string; room: { roomNumber: string; ward: { wardName: string; wardType: ApiWardType } } }; toBed?: { bedNumber: string; room: { roomNumber: string; ward: { wardName: string; wardType: ApiWardType } } } }
export interface ApiAdmitPatientInput { patientId: string; bedId: string; attendingDoctorId: string; admissionType?: ApiAdmissionType; admissionReason: string; depositAmount?: number }
export interface ApiTransferInput { toBedId: string; reason: string }
export interface ApiDischargeInput { dischargeSummary: string; dischargeNotes?: string }
export interface ApiNurseAssignmentInput { nurseUserId: string; wardId: string; shiftDate: string; shiftType: ApiShiftType }
export interface ApiNurseAssignment { id: string; nurseUserId: string; wardId: string; shiftDate: string; shiftType: ApiShiftType; isActive: boolean; nurse?: { id: string; name: string; email: string } }
export interface ApiRecordVitalsInput { admissionId: string; bpSystolic?: number; bpDiastolic?: number; temperature?: number; pulse?: number; respiratoryRate?: number; oxygenSaturation?: number; painScore?: number; notes?: string }
export interface ApiPatientVitals extends ApiRecordVitalsInput { id: string; patientId: string; recordedBy: string; recordedAt: string }
export interface ApiNursingTaskInput { admissionId: string; taskDescription: string; dueAt?: string }
export interface ApiNursingTask { id: string; admissionId: string; taskDescription: string; dueAt?: string | null; completedAt?: string | null; completedBy?: string | null; status: "PENDING" | "COMPLETED" | "OVERDUE"; createdAt: string }

export interface ApiSetting {
  id: string
  key: string
  value: unknown
  createdAt?: string
  updatedAt?: string
}

export interface ApiHospitalProfile {
  id: string; name: string; registrationNo?: string | null; address?: string | null; phone?: string | null; email?: string | null;
  logoUrl?: string | null; faviconUrl?: string | null; emergencyContact?: string | null; taxId?: string | null; currency: string; timezone: string;
}

export interface ApiPatient {
  id: string
  mrNumber: string
  firstName: string
  lastName: string
  dateOfBirth: string
  age: number
  gender: "MALE" | "FEMALE" | "OTHER"
  phone: string
  email?: string | null
  address?: string | null
  cnic?: string | null
  bloodGroup?: string | null
  allergies: string[]
  emergencyContactName?: string | null
  emergencyContactPhone?: string | null
  notes?: string | null
  createdAt: string
}

export interface ApiDoctor {
  id: string
  user: { name: string }
  department: { id: string; name: string } | null
  specialization?: string | null
  scheduleJson?: unknown
}
export interface ApiPublicDepartment { id: string; name: string; icon?: string | null; _count: { doctors: number } }

export interface ApiAppointment {
  id: string
  tokenNumber: number
  patient: { mrNumber: string; firstName: string; lastName: string }
  doctor: { id: string; user: { name: string }; department: { name: string } | null }
  appointmentDate: string
  timeSlot: string
  appointmentType: string
  status: string
  priority: string
  reason?: string | null
  rejectionReason?: string | null
  createdAt: string
  waitingSince?: string | null
}

export interface ApiLabTest { id: string; testName: string; testCode?: string; category?: string | null }
export interface ApiLabResult {
  id: string
  resultValue: string
  unit?: string | null
  referenceRange?: string | null
  interpretation?: "NORMAL" | "HIGH" | "LOW" | "CRITICAL" | null
  technicianNotes?: string | null
  verifiedBy?: string | null
  verifiedAt?: string | null
  createdAt?: string
  supersededById?: string | null
}
export interface ApiLabAttachment { id: string; fileUrl: string; fileType: string; uploadedAt?: string }
export interface ApiLabOrder {
  id: string
  patientId: string
  doctorId?: string | null
  testId: string
  status: "ORDERED" | "SAMPLE_COLLECTED" | "PROCESSING" | "COMPLETED" | "VERIFIED" | "CANCELLED"
  priority: "ROUTINE" | "URGENT" | "EMERGENCY"
  orderedAt: string
  patient?: { mrNumber: string; firstName: string; lastName: string }
  doctor?: { user: { name: string } } | null
  test?: ApiLabTest
  consultationId?: string | null
  results?: ApiLabResult[]
  attachments?: ApiLabAttachment[]
}
export type ApiUltrasoundStatus = "ORDERED" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"
export interface ApiUltrasoundOrder {
  id: string; patientId: string; doctorId: string; technicianId?: string | null; consultationId?: string | null; examType: string; status: ApiUltrasoundStatus; priority: "ROUTINE" | "URGENT" | "EMERGENCY"; scheduledAt?: string | null; performedAt?: string | null; completedAt?: string | null; findings?: string | null; impression?: string | null; imageUrls: string[]; notes?: string | null; createdAt: string
  patient?: { id: string; mrNumber: string; firstName: string; lastName: string }; doctor?: { user: { name: string } } | null; technician?: { id: string; name: string } | null
}
export interface ApiCreateUltrasoundOrderInput { patientId: string; examType: string; priority?: "ROUTINE" | "URGENT" | "EMERGENCY"; notes?: string; consultationId?: string }
export interface ApiScheduleUltrasoundInput { scheduledAt: string; technicianId?: string }
export interface ApiCompleteUltrasoundInput { findings: string; impression: string; imageUrls?: string[] }
export interface ApiCreateLabOrderInput { patientId: string; doctorId?: string; testId: string; priority?: Priority; sampleType?: string; clinicalNotes?: string; consultationId?: string }
export type ApiLabSampleStatus = "SAMPLE_COLLECTED" | "PROCESSING" | "CANCELLED"
export interface ApiLabResultInput { resultValue: string; unit?: string; referenceRange?: string; interpretation?: "NORMAL" | "HIGH" | "LOW" | "CRITICAL"; technicianNotes?: string }

export interface ApiConsultation {
  id: string
  appointmentId: string
  chiefComplaint?: string | null
  vitalsJson?: Record<string, number> | null
  diagnosis?: string | null
  clinicalNotes?: string | null
  followUpDate?: string | null
  referral?: string | null
  prescriptionStatus: "DRAFT" | "SIGNED" | "COMPLETED"
  signedAt?: string | null
  patientId?: string
  doctorId?: string
}

export interface ApiInvoiceItem {
  id: string
  itemType: "CONSULTATION" | "LAB" | "MEDICINE" | "WARD" | "OT" | "OTHER"
  description: string
  quantity: number
  unitPrice: number | string
  discount: number | string
  subtotal?: number | string
}

export interface ApiPayment {
  id: string
  paymentMethod: "CASH" | "CARD" | "BANK_TRANSFER" | "MOBILE_WALLET"
  amount: number | string
  notes?: string | null
  createdAt: string
}

export interface ApiInvoice {
  id: string
  invoiceNumber: string
  patientId: string
  status: "DRAFT" | "FINALIZED" | "PAID" | "PARTIAL" | "UNPAID" | "VOID"
  grandTotal: number | string
  paidAmount: number | string
  balanceAmount: number | string
  voidReason?: string | null
  createdAt: string
  items: ApiInvoiceItem[]
  payments: ApiPayment[]
}

export interface ApiCreateInvoiceInput {
  patientId: string
  items: Array<{ itemType: ApiInvoiceItem["itemType"]; description: string; quantity: number; unitPrice: number; discount: number }>
}

export interface ApiRecordPaymentInput {
  paymentMethod: ApiPayment["paymentMethod"]
  amount: number
  notes?: string
}

export interface ApiMedicineBatch {
  id: string
  medicineId: string
  batchNumber: string
  expiryDate: string
  purchasePrice: number | string
  sellingPrice: number | string
  stockQuantity: number
  reorderLevel: number
  isActive: boolean
}

export interface ApiMedicine {
  id: string
  name: string
  genericName?: string | null
  strength?: string | null
  batches: ApiMedicineBatch[]
}

export interface ApiCreateMedicineInput { name: string; genericName?: string; strength?: string; form?: string }
export interface ApiAddBatchInput {
  medicineId: string
  batchNumber: string
  expiryDate: string
  purchasePrice: number
  sellingPrice: number
  stockQuantity: number
  reorderLevel?: number
}
export interface ApiStockInInput { batchId: string; quantity: number; reason?: string }
export interface ApiDispenseInput { prescriptionItemId: string; quantity: number }
export interface ApiCreatePharmacySaleInput {
  items: Array<{ medicineId: string; quantity: number; unitPrice?: number; discount: number }>
  tax: number
  paymentMethod: ApiPayment["paymentMethod"]
  customerName?: string
  customerPhone?: string
}
export interface ApiPharmacySaleItem { id: string; medicineId: string; batchId: string; quantity: number; unitPrice: number | string; discount: number | string; subtotal: number | string; medicine: { name: string }; batch: ApiMedicineBatch }
export interface ApiPharmacySale { id: string; totalAmount: number | string; paymentMethod: ApiPayment["paymentMethod"]; customerName?: string | null; customerPhone?: string | null; items: ApiPharmacySaleItem[]; invoice: ApiInvoice }
export interface ApiCreatePrescriptionInput {
  consultationId: string
  items: Array<{
    medicineId?: string
    medicineName: string
    dosage: string
    route: string
    frequency: string
    durationDays: number
    instructions?: string
  }>
}
export interface ApiReturnStockInput { batchId: string; quantity: number; reason: string }
export interface ApiAdjustStockInput { batchId: string; quantity: number; reason: string }
export interface ApiWriteOffInput { batchId: string; quantity: number; type: "DAMAGED" | "EXPIRED"; reason: string }

export interface ApiStockMovement {
  id: string
  movementType: "IN" | "OUT" | "ADJUSTMENT" | "RETURN" | "EXPIRED" | "DAMAGED"
  quantity: number
  reason?: string | null
  createdAt: string
  batch: { medicineId: string; medicine: { name: string } }
  createdByUser?: { name: string } | null
}

export interface ApiPrescriptionItem {
  id: string
  medicineId?: string | null
  medicineName: string
  dosage?: string
  route?: string
  frequency?: string
  durationDays?: number
  instructions?: string | null
  quantityDispensed: number
}
export interface ApiPrescription {
  id: string
  consultationId: string
  patientId: string
  doctorId: string
  status: "DRAFT" | "SIGNED" | "COMPLETED" | "VOID"
  createdAt: string
  signedAt?: string | null
  items: ApiPrescriptionItem[]
}

export interface ApiAuditLog {
  id: string
  module: string
  entityType: string
  entityId: string
  action: string
  details?: unknown
  createdAt: string
  user: { name: string; role: string }
}

export interface ApiSurgery {
  id: string
  surgeryType: string
  scheduledStart: string
  scheduledEnd: string
  patient: { mrNumber?: string; firstName: string; lastName: string }
  otRoomId: string
  surgeonId: string
  surgeon: { user: { name: string } }
  otRoom: { name: string }
  status: string
  preOpChecklistJson?: Record<string, boolean>
  actualStart?: string | null
  actualEnd?: string | null
}
export interface ApiOTRoom { id: string; name: string; isActive: boolean }
export interface ApiScheduleSurgeryInput { patientId: string; otRoomId: string; surgeryType: string; surgeonId: string; scheduledStart: string; scheduledEnd: string; anesthetistId?: string }
export interface ApiLowStockReport { medicineName: string; batchNumber: string; stockQuantity: number; reorderLevel: number }
export interface ApiNearExpiryReport { medicineName: string; batchNumber: string; expiryDate: string; stockQuantity: number }
export interface ApiDoctorProductivityReport { doctorId: string; doctorName: string; consultationCount: number }

const otStatusMap: Record<string, OTStatus> = { SCHEDULED: "Scheduled", PRE_OP: "Pre-op", IN_PROGRESS: "In Progress", RECOVERY: "Recovery", COMPLETED: "Completed", CANCELLED: "Cancelled" }
const checklistLabels: Record<string, string> = {
  consent_form_confirmed: "Consent form signed", fasting_confirmed: "Fasting confirmed (NPO 8 hrs)",
  blood_arranged: "Blood products available/cross-matched", identity_verified: "Site marked & verified",
  allergies_checked: "Pre-anesthesia assessment complete", pre_op_vitals_recorded: "Antibiotic prophylaxis given",
  required_reports_reviewed: "Implants/equipment confirmed",
}

export function toSurgery(surgery: ApiSurgery): Surgery {
  const start = new Date(surgery.scheduledStart)
  const end = new Date(surgery.scheduledEnd)
  const checklist = surgery.preOpChecklistJson ?? {}
  return {
    id: surgery.id, mrNumber: surgery.patient.mrNumber ?? "", patientName: `${surgery.patient.firstName} ${surgery.patient.lastName}`.trim(),
    procedureName: surgery.surgeryType, surgeonId: surgery.surgeonId, surgeonName: surgery.surgeon.user.name,
    otRoom: surgery.otRoom.name, scheduledDate: start.toISOString().slice(0, 10),
    scheduledTime: start.toISOString().slice(11, 16), durationMinutes: Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000)),
    status: otStatusMap[surgery.status] ?? "Scheduled", preOpChecklist: Object.keys(checklistLabels).map((key) => ({ id: key, label: checklistLabels[key], done: Boolean(checklist[key]) })),
    activityLog: [],
  }
}

const wardTypeMap: Record<ApiWardType, WardType> = { GENERAL: "General Ward", PRIVATE: "Private Room", ICU: "ICU" }
const admissionTypeMap: Record<ApiAdmissionType, AdmissionType> = { EMERGENCY: "Emergency", PLANNED: "Planned", REFERRAL: "Referral" }

export function toBed(bed: ApiBedAvailability): Bed {
  const activeAdmission = bed.admissions[0]
  return {
    id: bed.id,
    bedNumber: bed.bedNumber,
    ward: wardTypeMap[bed.room.ward.wardType],
    room: bed.room.roomNumber,
    status: bed.status === "AVAILABLE" ? "Available" : bed.status === "OCCUPIED" ? "Occupied" : bed.status === "RESERVED" ? "Reserved" : bed.status === "CLEANING" ? "Cleaning" : "Maintenance",
    dailyRate: Number(bed.dailyRate),
    admissionId: activeAdmission?.id,
    mrNumber: activeAdmission?.patient.mrNumber,
    patientName: activeAdmission ? `${activeAdmission.patient.firstName} ${activeAdmission.patient.lastName}`.trim() : undefined,
    doctorName: activeAdmission?.attendingDoctor?.user.name,
    admittedAt: activeAdmission?.admissionDate,
  }
}

export function toAdmission(admission: ApiAdmission): Admission {
  return {
    id: admission.id,
    mrNumber: admission.patient.mrNumber,
    patientName: `${admission.patient.firstName} ${admission.patient.lastName}`.trim(),
    bedId: admission.bedId,
    bedNumber: admission.bed.bedNumber,
    ward: wardTypeMap[admission.bed.room.ward.wardType],
    doctorId: admission.attendingDoctorId,
    doctorName: admission.attendingDoctor?.user.name ?? "",
    admissionType: admissionTypeMap[admission.admissionType],
    admissionDate: admission.admissionDate,
    reason: admission.admissionReason,
    depositAmount: Number(admission.depositAmount),
    notes: admission.dischargeNotes ?? undefined,
    status: admission.status === "ACTIVE" ? "Admitted" : admission.status === "DISCHARGED" ? "Discharged" : "Transferred Out",
    dischargeDate: admission.dischargeDate ?? undefined,
    dischargeSummary: admission.dischargeSummary ?? undefined,
    outstandingBalance: 0,
  }
}

export function toTransfer(transfer: ApiTransferRecord, admission: ApiAdmission): import("@/dashboard/types").TransferRecord {
  return {
    id: transfer.id,
    admissionId: transfer.admissionId,
    mrNumber: admission.patient.mrNumber,
    patientName: `${admission.patient.firstName} ${admission.patient.lastName}`.trim(),
    fromBedId: transfer.fromBedId,
    fromBedNumber: transfer.fromBed?.bedNumber ?? "",
    fromWard: wardTypeMap[transfer.fromBed?.room.ward.wardType ?? "GENERAL"],
    toBedId: transfer.toBedId,
    toBedNumber: transfer.toBed?.bedNumber ?? "",
    toWard: wardTypeMap[transfer.toBed?.room.ward.wardType ?? "GENERAL"],
    date: transfer.transferDate,
    reason: transfer.reason,
    by: transfer.createdBy ?? "Staff",
  }
}

export function toPatient(patient: ApiPatient): Patient {
  const gender: Gender = patient.gender === "MALE" ? "Male" : patient.gender === "FEMALE" ? "Female" : "Other"
  const bloodGroup = (patient.bloodGroup ?? "O+") as BloodGroup
  return {
    id: patient.id,
    mrNumber: patient.mrNumber,
    name: `${patient.firstName} ${patient.lastName}`.trim(),
    dob: patient.dateOfBirth,
    age: patient.age,
    gender,
    phone: patient.phone,
    email: patient.email ?? undefined,
    address: patient.address ?? undefined,
    cnic: patient.cnic ?? undefined,
    bloodGroup,
    allergies: patient.allergies,
    emergencyContact: patient.emergencyContactPhone ?? patient.emergencyContactName ?? "",
    notes: patient.notes ?? undefined,
    registeredAt: patient.createdAt,
    balance: 0,
    status: "Active" as const,
  }
}

export function toDoctor(doctor: ApiDoctor): Doctor {
  const schedule = typeof doctor.scheduleJson === "object" && doctor.scheduleJson !== null ? (doctor.scheduleJson as any).slotsPerDay || [] : []
  return {
    id: doctor.id,
    name: doctor.user.name,
    department: doctor.department?.name ?? "General Medicine",
    designation: doctor.specialization ?? "Consultant",
    slotsPerDay: schedule,
  }
}

export function toAppointment(appointment: ApiAppointment): Appointment {
  const statusMap: Record<string, Appointment["status"]> = {
    PENDING_APPROVAL: "Pending Approval", CONFIRMED: "Confirmed", WAITING: "Waiting",
    IN_CONSULTATION: "In Consultation", DONE: "Done", CANCELLED: "Cancelled", NO_SHOW: "No-show",
  }
  const typeMap: Record<string, Appointment["type"]> = { NEW: "New Visit", FOLLOW_UP: "Follow-up", CONSULTATION: "Consultation" }
  return {
    id: appointment.id,
    token: appointment.tokenNumber,
    mrNumber: appointment.patient.mrNumber,
    patientName: `${appointment.patient.firstName} ${appointment.patient.lastName}`.trim(),
    doctorId: appointment.doctor.id,
    doctorName: appointment.doctor.user.name,
    department: appointment.doctor.department?.name ?? "General Medicine",
    date: appointment.appointmentDate.slice(0, 10),
    time: appointment.timeSlot,
    type: typeMap[appointment.appointmentType] ?? "Consultation",
    status: statusMap[appointment.status] ?? "Pending Approval",
    priority: appointment.priority === "URGENT" ? "Urgent" : appointment.priority === "EMERGENCY" ? "Emergency" : "Routine",
    reason: appointment.reason ?? undefined,
    rejectionReason: appointment.rejectionReason ?? undefined,
    createdAt: appointment.createdAt,
    waitingSince: appointment.waitingSince ?? undefined,
  }
}

export function toLabOrder(order: ApiLabOrder, fallback?: Partial<LabOrder>): LabOrder {
  const result = order.results?.filter((item) => !item.supersededById).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0] ?? order.results?.[order.results.length - 1]
  const statusMap: Record<ApiLabOrder["status"], LabOrder["status"]> = {
    ORDERED: "Ordered", SAMPLE_COLLECTED: "Sample Collected", PROCESSING: "Processing", COMPLETED: "Completed", VERIFIED: "Verified", CANCELLED: "Completed",
  }
  const priorityMap: Record<ApiLabOrder["priority"], Priority> = { ROUTINE: "Routine", URGENT: "Urgent", EMERGENCY: "Emergency" }
  const interpretationMap: Record<string, LabInterpretation> = { NORMAL: "Normal", HIGH: "High", LOW: "Low", CRITICAL: "Critical" }
  return {
    ...fallback,
    id: order.id,
    mrNumber: order.patient?.mrNumber ?? fallback?.mrNumber ?? "",
    patientName: order.patient ? `${order.patient.firstName} ${order.patient.lastName}`.trim() : fallback?.patientName ?? "",
    doctorName: order.doctor?.user.name ?? fallback?.doctorName ?? "Unassigned",
    testName: order.test?.testName ?? fallback?.testName ?? "",
    orderDate: order.orderedAt,
    priority: priorityMap[order.priority],
    status: statusMap[order.status],
    resultValue: result?.resultValue ?? fallback?.resultValue,
    resultUnit: result?.unit ?? fallback?.resultUnit,
    referenceRange: result?.referenceRange ?? fallback?.referenceRange,
    interpretation: result?.interpretation ? interpretationMap[result.interpretation] : fallback?.interpretation,
    technicianNotes: result?.technicianNotes ?? fallback?.technicianNotes,
    reportFileName: order.attachments?.at(-1)?.fileUrl.split("/").pop() ?? fallback?.reportFileName,
    verifiedAt: result?.verifiedAt ?? fallback?.verifiedAt,
  }
}

const invoiceCategoryMap: Record<ApiInvoiceItem["itemType"], Invoice["lineItems"][number]["category"]> = {
  CONSULTATION: "Consultation", LAB: "Lab", MEDICINE: "Medicine", WARD: "Ward", OT: "OT", OTHER: "Other",
}
const paymentMethodMap: Record<ApiPayment["paymentMethod"], Invoice["payments"][number]["method"]> = {
  CASH: "Cash", CARD: "Card", BANK_TRANSFER: "Bank Transfer", MOBILE_WALLET: "Mobile Wallet",
}

export function toInvoice(invoice: ApiInvoice, patient?: Patient): Invoice {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    grandTotal: Number(invoice.grandTotal),
    paidAmount: Number(invoice.paidAmount),
    balanceAmount: Number(invoice.balanceAmount),
    mrNumber: patient?.mrNumber ?? "",
    patientName: patient?.name ?? "Unknown patient",
    date: invoice.createdAt,
    lineItems: invoice.items.map((item) => ({ id: item.id, category: invoiceCategoryMap[item.itemType], description: item.description, qty: item.quantity, unitPrice: Number(item.unitPrice), discount: Number(item.discount) })),
    payments: invoice.payments.map((payment) => ({ id: payment.id, amount: Number(payment.amount), method: paymentMethodMap[payment.paymentMethod], date: payment.createdAt, notes: payment.notes ?? undefined })),
    status: invoice.status === "PAID" ? "Paid" : invoice.status === "PARTIAL" ? "Partial" : invoice.status === "VOID" ? "Void" : "Unpaid",
    voidReason: invoice.voidReason ?? undefined,
    auditTrail: [],
  }
}
