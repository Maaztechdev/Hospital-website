
if (typeof localStorage !== "undefined") {
  localStorage.removeItem("careplus.accessToken")
  localStorage.removeItem("careplus.refreshToken")
}
import type { Patient, Gender, BloodGroup, Appointment, Doctor, LabOrder, LabInterpretation, Priority, Invoice, Bed, Admission, WardType, AdmissionType, Surgery, OTStatus, PrescriptionItem, AppointmentStatus } from "@/dashboard/types"
import { formatBloodGroup, getHospitalDateKeyForTimestamp, normalizePakistaniPhone } from "@/dashboard/lib/format"

export const API_BASE_URL = (import.meta.env.VITE_API_URL?.trim() || "/api/v1").replace(/\/$/, "")
export const apiAssetUrl = (url?: string | null) => url ? (url.startsWith("http") ? url : `${API_BASE_URL.replace(/\/api\/v1$/, "")}${url}`) : ""

interface ApiEnvelope<T> {
  success: boolean
  data: T | null
  message: string | null
  errors: unknown
  pagination?: { page: number; limit: number; pageSize?: number; total: number }
}

export interface ApiRefundInput {
  paymentMethod: ApiPayment["paymentMethod"]
  amount: number
  reason: string
  referenceNumber?: string
  notes?: string
}

export interface ApiPaginatedResult<T> {
  data: T
  pagination: { page: number; limit: number; pageSize?: number; total: number }
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
let inMemoryAccessToken: string | null = null
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
  if (typeof sessionStorage !== "undefined") {
    const fromSession = sessionStorage.getItem(ACCESS_TOKEN_KEY)
    if (fromSession) {
      inMemoryAccessToken = fromSession
      return fromSession
    }
    inMemoryAccessToken = null
    return null
  }
  return inMemoryAccessToken
}

export function getAccessTokenExpiration(): number | null {
  const token = getAccessToken()
  if (!token) return null
  try {
    const encodedPayload = token.split(".")[1]
    if (!encodedPayload) return null
    const normalizedPayload = encodedPayload.replace(/-/g, "+").replace(/_/g, "/")
    const payload = JSON.parse(atob(normalizedPayload)) as { exp?: number }
    return typeof payload.exp === "number" ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

export function getSessionVersion() {
  return sessionVersion
}

function getRefreshToken() {
  return typeof sessionStorage !== "undefined" ? sessionStorage.getItem(REFRESH_TOKEN_KEY) : null
}

export function setSession(tokens: TokenResponse) {
  sessionVersion += 1
  refreshRequest = null
  inMemoryAccessToken = tokens.accessToken
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken)
    if (tokens.refreshToken) sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken)
  }
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(ACCESS_TOKEN_KEY)
    localStorage.removeItem(REFRESH_TOKEN_KEY)
  }
  notifySessionListeners()
}

export function clearSession() {
  sessionVersion += 1
  refreshRequest = null
  inMemoryAccessToken = null
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY)
    sessionStorage.removeItem(REFRESH_TOKEN_KEY)
  }
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(ACCESS_TOKEN_KEY)
    localStorage.removeItem(REFRESH_TOKEN_KEY)
  }
  notifySessionListeners()
}

function storeRefreshedSession(tokens: TokenResponse) {
  inMemoryAccessToken = tokens.accessToken
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken)
    if (tokens.refreshToken) sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken)
  }
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(ACCESS_TOKEN_KEY)
    localStorage.removeItem(REFRESH_TOKEN_KEY)
  }
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

export function describeApiError(error: unknown): string {
  if (!(error instanceof Error)) return "Request failed. Please try again."
  const details = (error as ApiError).details
  if (details && typeof details === "object") {
    const messages = Object.entries(details as Record<string, unknown>).flatMap(([field, value]) => {
      const items = Array.isArray(value) ? value : [value]
      return items.filter((item): item is string => typeof item === "string").map((message) => `${field}: ${message}`)
    })
    if (messages.length > 0) return messages.join("; ")
  }
  return error.message
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken()
  const refreshVersion = sessionVersion

  if (!refreshRequest) {
    refreshRequest = fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(refreshToken ? { refreshToken } : {}),
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

export function apiRequest<T>(path: string, init?: Parameters<typeof fetch>[1], retry?: boolean, transientAttempt?: number): Promise<T>
export function apiRequest<T>(path: string, init: Parameters<typeof fetch>[1], retry: boolean, transientAttempt: number, includeMetadata: true): Promise<ApiPaginatedResult<T>>
export function apiRequest<T>(path: string, init: Parameters<typeof fetch>[1], retry: boolean, transientAttempt: number, includeMetadata: boolean): Promise<T | ApiPaginatedResult<T>>
export async function apiRequest<T>(path: string, init: Parameters<typeof fetch>[1] = {}, retry = true, transientAttempt = 0, includeMetadata = false): Promise<T | ApiPaginatedResult<T>> {
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
      return apiRequest<T>(path, init, retry, transientAttempt + 1, includeMetadata)
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
    if (token) return apiRequest<T>(path, init, false, 0, includeMetadata)
    clearSession()
  }
  if (!response.ok || !body.success) {
    const error = createApiError(response, body)
    window.dispatchEvent(new CustomEvent("careplus:api-error", { detail: { message: error.message } }))
    throw error
  }
  const method = (init.method ?? "GET").toUpperCase()
  if (method !== "GET" && typeof window !== "undefined") {
    notifyDataInvalidated({ path, method })
  }
  if (includeMetadata) {
    if (!body.pagination) throw new Error(`Missing pagination metadata from ${path}`)
    return { data: body.data as T, pagination: body.pagination }
  }
  return body.data as T
}

// Real-time synchronization bus across tabs, windows, and panels
const SYNC_CHANNEL_NAME = "careplus-sync-channel"
let syncChannel: BroadcastChannel | null = null
if (typeof window !== "undefined" && "BroadcastChannel" in window) {
  try {
    syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME)
    syncChannel.onmessage = (event) => {
      if (event?.data?.type === "DATA_INVALIDATED" && event.data.detail) {
        window.dispatchEvent(new CustomEvent("careplus:data-invalidated", { detail: event.data.detail, bubbles: true }))
      }
    }
  } catch {
    syncChannel = null
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === "careplus:sync-pulse" && event.newValue) {
      try {
        const payload = JSON.parse(event.newValue)
        window.dispatchEvent(new CustomEvent("careplus:data-invalidated", { detail: payload, bubbles: true }))
      } catch { }
    }
  })
}

export function notifyDataInvalidated(detail: { path: string; method: string; timestamp?: number }) {
  if (typeof window === "undefined") return
  const payload = { ...detail, timestamp: detail.timestamp ?? Date.now() }
  window.dispatchEvent(new CustomEvent("careplus:data-invalidated", { detail: payload, bubbles: true }))
  try {
    syncChannel?.postMessage({ type: "DATA_INVALIDATED", detail: payload })
  } catch { }
  try {
    localStorage.setItem("careplus:sync-pulse", JSON.stringify(payload))
  } catch { }
}

export async function loadAuthenticatedImage(path?: string | null): Promise<string | null> {
  if (!path) return null
  const url = apiAssetUrl(path)
  const imageUrl = new URL(url, window.location.origin)
  const apiOrigin = new URL(API_BASE_URL, window.location.origin).origin
  if (imageUrl.origin !== apiOrigin) return url

  let accessToken = getAccessToken()
  if (accessToken && tokenNeedsRefresh(accessToken)) accessToken = await refreshAccessToken()
  const headers = new Headers()
  if (accessToken) headers.set("Authorization", "Bearer " + accessToken)
  const response = await fetch(url, { headers })
  if (response.status === 401 && accessToken) {
    const refreshedToken = await refreshAccessToken()
    if (refreshedToken) {
      headers.set("Authorization", "Bearer " + refreshedToken)
      const retryResponse = await fetch(url, { headers })
      if (!retryResponse.ok) throw new Error(`Unable to load report image (status ${retryResponse.status})`)
      return URL.createObjectURL(await retryResponse.blob())
    }
  }
  if (!response.ok) throw new Error(`Unable to load report image (status ${response.status})`)
  return URL.createObjectURL(await response.blob())
}

export function openAuthenticatedPrintWindow(path: string): boolean {
  const printWindow = window.open(path, "_blank")
  if (!printWindow) return false
  printWindow.opener = null
  return true
}

export interface ApiListAppointmentsParams {
  page?: number
  limit?: number
  date?: string
  doctorId?: string
  departmentId?: string
  status?: string
  sort?: "date" | "recentlyCreated"
}

export const api = {
  login: (email: string, password: string) =>
    apiRequest<{ accessToken: string; refreshToken: string; user: ApiUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => apiRequest<ApiUser>("/auth/me"),
  logout: () => apiRequest<null>("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken: getRefreshToken() }) }),
  changePassword: (payload: { currentPassword: string; newPassword: string }) =>
    apiRequest<{ message: string }>("/auth/change-password", { method: "POST", body: JSON.stringify(payload) }),
  forgotPassword: (email: string) =>
    apiRequest<{ message: string; devResetToken?: string }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  verifyResetToken: (token: string) =>
    apiRequest<{ valid: boolean; email: string }>("/auth/verify-reset-token", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  resetPassword: (payload: { token: string; newPassword: string }) =>
    apiRequest<{ message: string }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listNotifications: (unreadOnly = false) => apiRequest<ApiNotification[]>(`/notifications?limit=100${unreadOnly ? "&unreadOnly=true" : ""}`),
  getUnreadNotificationCount: () => apiRequest<{ count: number }>("/notifications/unread-count"),
  markNotificationRead: (id: string) => apiRequest<ApiNotification>(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }),
  markAllNotificationsRead: () => apiRequest<{ message: string }>("/notifications/mark-all-read", { method: "POST" }),
  searchPatients: (search: string, limit = 10) => {
    const params = new URLSearchParams({ search, limit: String(Math.min(Math.max(limit, 1), 10)) })
    return apiRequest<ApiPatient[]>(`/patients?${params.toString()}`)
  },
  listPatients: (search = "") => apiRequest<ApiPatient[]>(`/patients?limit=100${search ? `&search=${encodeURIComponent(search)}` : ""}`),
  getPatient: (idOrMr: string) => apiRequest<ApiPatient>(`/patients/${encodeURIComponent(idOrMr)}`),
  getPatientProfile: (id: string) => apiRequest<ApiPatientProfileData>(`/patients/${encodeURIComponent(id)}/profile`),
  getPatientClinicalSummary: (id: string) => apiRequest<ApiPatientClinicalSummary>(`/patients/${encodeURIComponent(id)}/clinical-summary`),
  updatePatientClinicalHistory: (id: string, payload: Pick<ApiPatientClinicalSummary, "allergies" | "chronicConditions">) => apiRequest<Pick<ApiPatientClinicalSummary, "allergies" | "allergiesReviewed" | "chronicConditions" | "chronicConditionsReviewed">>(`/patients/${encodeURIComponent(id)}/clinical-summary`, {
    method: "PATCH",
    body: JSON.stringify({ ...payload, allergiesReviewed: true, chronicConditionsReviewed: true }),
  }),
  getPatientPrintSummary: (id: string) => apiRequest<ApiPatientPrintSummary>(`/patients/${encodeURIComponent(id)}/print-summary`),
  listDoctors: () => apiRequest<ApiDoctor[]>("/appointments/doctors"),
  listPublicDepartments: () => apiRequest<ApiPublicDepartment[]>("/appointments/public/departments"),
  listPublicDoctors: () => apiRequest<ApiDoctor[]>("/appointments/public/doctors"),
  createPublicAppointment: (payload: Record<string, unknown>) => apiRequest<ApiAppointment>("/appointments/public", { method: "POST", body: JSON.stringify(payload) }),
  getPublicAvailableSlots: (doctorId: string, date: string) =>
    apiRequest<{ slotsPerDay: string[]; bookedSlots: string[]; availableSlots: string[] }>(`/appointments/public/doctors/${encodeURIComponent(doctorId)}/slots?date=${encodeURIComponent(date)}`),
  listWards: (includeInactive = false) => apiRequest<ApiWard[]>(`/wards${includeInactive ? "?includeInactive=true" : ""}`),
  createWard: (payload: ApiWardInput) => apiRequest<ApiWard>("/wards", { method: "POST", body: JSON.stringify(payload) }),
  updateWard: (id: string, payload: ApiWardInput) => apiRequest<ApiWard>(`/wards/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteWard: (id: string) => apiRequest<ApiWard>(`/wards/${encodeURIComponent(id)}`, { method: "DELETE" }),
  bulkUpdateRoomBeds: (payload: ApiRoomBedBatchInput) => apiRequest<ApiWard[]>("/wards/rooms-beds/batch", { method: "POST", body: JSON.stringify(payload) }),
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
  getIpdRunningBill: (id: string) => apiRequest<ApiIpdRunningBill>(`/wards/admissions/${encodeURIComponent(id)}/running-bill`),
  listIpdServiceCharges: () => apiRequest<ApiIpdServiceCharge[]>("/wards/service-charges"),
  addIpdServiceLine: (admissionId: string, payload: { serviceChargeId: string; amount?: number; quantity?: number }) => apiRequest<ApiInvoiceItem>(`/wards/admissions/${encodeURIComponent(admissionId)}/service-lines`, { method: "POST", body: JSON.stringify(payload) }),
  reverseIpdInvoiceItem: (admissionId: string, itemId: string, reason: string) => apiRequest<ApiInvoiceItem>(`/wards/admissions/${encodeURIComponent(admissionId)}/invoice-items/${encodeURIComponent(itemId)}/reversals`, { method: "POST", body: JSON.stringify({ reason }) }),
  recordIpdPayment: (admissionId: string, payload: { amount: number; paymentMethod: ApiPayment["paymentMethod"]; purpose: "DEPOSIT" | "PAYMENT"; notes?: string; referenceNumber?: string }) => apiRequest<ApiPayment>(`/wards/admissions/${encodeURIComponent(admissionId)}/payments`, { method: "POST", body: JSON.stringify(payload) }),
  refundIpdPayment: (admissionId: string, payload: { amount: number; paymentMethod: ApiPayment["paymentMethod"]; reason: string }) => apiRequest<ApiPayment>(`/wards/admissions/${encodeURIComponent(admissionId)}/refunds`, { method: "POST", body: JSON.stringify(payload) }),
  settleIpdInvoice: (admissionId: string, payload: { paymentMethod: ApiPayment["paymentMethod"]; refundReason?: string }) => apiRequest<{ invoiceId: string; settled: boolean; payment: ApiPayment | null; refund: ApiPayment | null }>(`/wards/admissions/${encodeURIComponent(admissionId)}/settle`, { method: "POST", body: JSON.stringify(payload) }),
  listWardAdmissions: () => apiRequest<ApiIpdWardAdmission[]>("/wards/medicine-orders/admissions"),
  listWardMedicineOrders: (admissionId: string) => apiRequest<ApiWardMedicineOrder[]>(`/wards/admissions/${encodeURIComponent(admissionId)}/medicine-orders`),
  createWardMedicineOrder: (admissionId: string, payload: { orderNote: string; items: Array<{ medicineId: string; quantity: number }> }) => apiRequest<ApiWardMedicineOrder>(`/wards/admissions/${encodeURIComponent(admissionId)}/medicine-orders`, { method: "POST", body: JSON.stringify(payload) }),
  issueWardMedicineOrder: (admissionId: string, orderId: string) => apiRequest<{ orderId: string; invoiceId: string; issuedLines: Array<{ orderItemId: string; invoiceItemId: string }> }>(`/wards/admissions/${encodeURIComponent(admissionId)}/medicine-orders/${encodeURIComponent(orderId)}/issue`, { method: "POST" }),
  returnWardMedicine: (admissionId: string, orderItemId: string, payload: { quantity: number; reason: string }) => apiRequest<ApiInvoiceItem>(`/wards/admissions/${encodeURIComponent(admissionId)}/medicine-order-items/${encodeURIComponent(orderItemId)}/returns`, { method: "POST", body: JSON.stringify(payload) }),
  listWardRounds: (admissionId: string) => apiRequest<ApiWardRound[]>(`/wards/admissions/${encodeURIComponent(admissionId)}/rounds`),
  createWardRound: (admissionId: string, payload: ApiCreateWardRoundInput) => apiRequest<ApiWardRound>(`/wards/admissions/${encodeURIComponent(admissionId)}/rounds`, { method: "POST", body: JSON.stringify(payload) }),
  getMyWardRoundsToday: () => apiRequest<ApiDoctorWardRoundToday[]>("/doctors/me/ward-rounds/today"),
  setAdmissionReadyForDischarge: (admissionId: string, ready: boolean) => apiRequest<ApiAdmission>(`/wards/admissions/${encodeURIComponent(admissionId)}/ready-for-discharge`, { method: "PATCH", body: JSON.stringify({ ready }) }),
  recordAdmissionDeposit: (id: string, payload: ApiRecordAdmissionDepositInput) => apiRequest<{ id: string; depositAmount: number | string; depositStatus: "PENDING" | "PAID" }>(`/wards/admissions/${encodeURIComponent(id)}/deposits`, { method: "POST", body: JSON.stringify(payload) }),
  getDischargePrintData: (id: string) => apiRequest<ApiDischargePrintData>(`/wards/admissions/${encodeURIComponent(id)}/print`),
  getAdmissionSlipPrintData: (id: string) => apiRequest<ApiAdmissionSlipPrintData>(`/wards/admissions/${encodeURIComponent(id)}/slip`),
  createNurseAssignment: (payload: ApiNurseAssignmentInput) => apiRequest<ApiNurseAssignment>("/nursing/assignments", { method: "POST", body: JSON.stringify(payload) }),
  listNurseAssignments: (wardId?: string, shiftDate?: string) => apiRequest<ApiNurseAssignment[]>(`/nursing/assignments${wardId || shiftDate ? `?${new URLSearchParams({ ...(wardId ? { wardId } : {}), ...(shiftDate ? { shiftDate } : {}) }).toString()}` : ""}`),
  recordVitals: (payload: ApiRecordVitalsInput) => apiRequest<ApiPatientVitals>("/nursing/vitals", { method: "POST", body: JSON.stringify(payload) }),
  listVitalsHistory: (admissionId: string) => apiRequest<ApiPatientVitals[]>(`/nursing/vitals/${encodeURIComponent(admissionId)}`),
  createNursingTask: (payload: ApiNursingTaskInput) => apiRequest<ApiNursingTask>("/nursing/tasks", { method: "POST", body: JSON.stringify(payload) }),
  completeNursingTask: (id: string) => apiRequest<ApiNursingTask>(`/nursing/tasks/${encodeURIComponent(id)}/complete`, { method: "POST" }),
  listNursingTasks: (admissionId: string) => apiRequest<ApiNursingTask[]>(`/nursing/tasks/${encodeURIComponent(admissionId)}`),
  getAvailableSlots: (doctorId: string, date: string) =>
    apiRequest<{ slotsPerDay: string[]; bookedSlots: string[]; availableSlots: string[] }>(`/appointments/doctors/${encodeURIComponent(doctorId)}/slots?date=${encodeURIComponent(date)}`),
  listAppointments: (params: ApiListAppointmentsParams = {}) => {
    const qs = new URLSearchParams()
    if (params.page) qs.set("page", String(params.page))
    if (params.limit) qs.set("limit", String(params.limit))
    if (params.date) qs.set("date", params.date)
    if (params.doctorId) qs.set("doctorId", params.doctorId)
    if (params.departmentId) qs.set("departmentId", params.departmentId)
    if (params.status) qs.set("status", params.status)
    if (params.sort) qs.set("sort", params.sort)
    const query = qs.toString()
    return apiRequest<ApiAppointment[]>(`/appointments${query ? `?${query}` : ""}`)
  },
  getAppointment: (id: string) => apiRequest<ApiAppointment>(`/appointments/${encodeURIComponent(id)}`),
  listLabTests: (includeInactive = false) => apiRequest<ApiLabTest[]>(`/lab/tests${includeInactive ? "?includeInactive=true" : ""}`),
  getLabInventory: (search?: string, sort?: "name" | "low_stock" | "expiry") => apiRequest<ApiLabInventoryOverview>(`/lab/inventory?${new URLSearchParams({ ...(search ? { search } : {}), ...(sort ? { sort } : {}) }).toString()}`),
  createLabInventoryItem: (input: ApiLabInventoryItemInput) => apiRequest<ApiLabInventoryItem>("/lab/inventory/items", { method: "POST", body: JSON.stringify(input) }),
  updateLabInventoryItem: (id: string, input: ApiLabInventoryItemInput) => apiRequest<ApiLabInventoryItem>(`/lab/inventory/items/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
  addLabInventoryBatch: (input: ApiLabInventoryBatchInput) => apiRequest<ApiLabInventoryBatch>("/lab/inventory/batches", { method: "POST", body: JSON.stringify(input) }),
  saveLabInventoryMapping: (input: ApiLabInventoryMappingInput) => apiRequest<ApiLabInventoryMapping>("/lab/inventory/mappings", { method: "POST", body: JSON.stringify(input) }),
  deleteLabInventoryMapping: (id: string) => apiRequest<ApiLabInventoryMapping>(`/lab/inventory/mappings/${encodeURIComponent(id)}`, { method: "DELETE" }),
  adjustLabInventory: (input: ApiLabInventoryAdjustmentInput) => apiRequest<ApiLabInventoryBatch>("/lab/inventory/adjustments", { method: "POST", body: JSON.stringify(input) }),
  listLabInventoryMovements: () => apiRequest<ApiLabInventoryMovement[]>("/lab/inventory/movements"),
  createLabTest: (payload: ApiCreateLabTestInput) => apiRequest<ApiLabTest>("/lab/tests", { method: "POST", body: JSON.stringify(payload) }),
  updateLabTest: (id: string, payload: ApiCreateLabTestInput) => apiRequest<ApiLabTest>(`/lab/tests/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteLabTest: (id: string) => apiRequest<ApiLabTest>(`/lab/tests/${encodeURIComponent(id)}`, { method: "DELETE" }),
  listLabPackages: (includeInactive = false) => apiRequest<ApiLabPackage[]>(`/lab/packages${includeInactive ? "?includeInactive=true" : ""}`),
  createLabPackage: (payload: ApiLabPackageInput) => apiRequest<ApiLabPackage>("/lab/packages", { method: "POST", body: JSON.stringify(payload) }),
  updateLabPackage: (id: string, payload: ApiLabPackageInput) => apiRequest<ApiLabPackage>(`/lab/packages/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteLabPackage: (id: string) => apiRequest<ApiLabPackage>(`/lab/packages/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getLabVerificationSetting: () => apiRequest<{ allowSameUserEnterVerify: boolean }>("/lab/settings/verification"),
  setLabVerificationSetting: (allowSameUserEnterVerify: boolean) => apiRequest<{ allowSameUserEnterVerify: boolean }>("/lab/settings/verification", { method: "PUT", body: JSON.stringify({ allowSameUserEnterVerify }) }),
  getLabSettings: () => apiRequest<ApiLabSettings>("/lab/settings"),
  updateLabSettings: (settings: ApiLabSettingsInput) => apiRequest<ApiLabSettings>("/lab/settings", { method: "PUT", body: JSON.stringify(settings) }),
  getLabOrderPolicy: () => apiRequest<ApiLabOrderPolicy>("/lab/settings/order-policy"),
  uploadLabSettingsAsset: (assetType: ApiLabSettingsAssetType, file: File) => {
    const body = new FormData()
    body.append("file", file)
    return apiRequest<{ url: string; assetType: ApiLabSettingsAssetType }>(`/lab/settings/assets/${assetType}`, { method: "POST", body })
  },
  getLabReportSettings: () => apiRequest<ApiLabReportSettings>("/lab/settings/report"),
  setLabReportSettings: (settings: ApiLabReportSettings) => apiRequest<ApiLabReportSettings>("/lab/settings/report", { method: "PUT", body: JSON.stringify(settings) }),
  getLabOverview: () => apiRequest<ApiLabOverview>("/lab/overview"),
  getLabReports: (from?: string, to?: string) => {
    const params = new URLSearchParams()
    if (from) params.set("from", from)
    if (to) params.set("to", to)
    const query = params.toString()
    return apiRequest<ApiLabReports>(`/lab/reports${query ? `?${query}` : ""}`)
  },
  listLabLedgerAccounts: (filters: { search?: string; type?: "RECEIVABLE" | "PAYABLE"; limit?: number } = {}) => {
    const params = new URLSearchParams()
    if (filters.search) params.set("search", filters.search)
    if (filters.type) params.set("type", filters.type)
    if (filters.limit) params.set("limit", String(filters.limit))
    return apiRequest<ApiLabLedgerAccounts>(`/lab/ledger/accounts?${params.toString()}`)
  },
  createLabLedgerAccount: (input: ApiCreateLabLedgerAccountInput) => apiRequest<ApiLabLedgerAccount>("/lab/ledger/accounts", { method: "POST", body: JSON.stringify(input) }),
  getLabLedger: (accountId: string) => apiRequest<ApiLabLedger>(`/lab/ledger/accounts/${encodeURIComponent(accountId)}?limit=100`),
  recordLabLedgerPayment: (accountId: string, input: { amount: number; paymentMethod: "CASH" | "CARD" | "BANK_TRANSFER" | "MOBILE_WALLET"; notes?: string }) =>
    apiRequest<{ entry: ApiLabLedgerEntry; balance: number }>(`/lab/ledger/accounts/${encodeURIComponent(accountId)}/payments`, { method: "POST", body: JSON.stringify(input) }),
  listLabReferringClinics: () => apiRequest<Array<{ id: string; partyName: string }>>("/lab/ledger/referring-clinics"),
  listLabReferenceLabs: () => apiRequest<Array<{ id: string; name: string; phone?: string | null }>>("/lab/ledger/reference-labs"),
  verifyPublicLabReport: (orderNumber: string) => apiRequest<ApiPublicLabReportVerification>(`/lab/public/reports/${encodeURIComponent(orderNumber)}/verify`),
  listLabOrders: () => apiRequest<ApiLabOrder[]>("/lab/orders?limit=100"),
  listUltrasoundOrders: (params: Record<string, string> = {}) => apiRequest<ApiUltrasoundOrder[]>(`/ultrasound?${new URLSearchParams({ limit: "100", ...params }).toString()}`),
  getUltrasoundScanCatalog: () => apiRequest<ApiUltrasoundScanType[]>("/ultrasound/settings/scan-catalog"),
  updateUltrasoundScanCatalog: (catalog: ApiUltrasoundScanType[]) => apiRequest<ApiUltrasoundScanType[]>("/ultrasound/settings/scan-catalog", { method: "PUT", body: JSON.stringify(catalog) }),
  listUltrasoundDoctors: () => apiRequest<ApiUltrasoundDoctorSignature[]>("/settings/ultrasound-doctors"),
  uploadUltrasoundDoctorSignature: (doctorId: string, file: File) => { const body = new FormData(); body.append("file", file); return apiRequest<ApiUltrasoundDoctorSignature>(`/settings/ultrasound-doctors/${encodeURIComponent(doctorId)}/signature`, { method: "POST", body }) },
  getUltrasoundOverview: () => apiRequest<ApiUltrasoundOverview>("/ultrasound/analytics/overview"),
  getUltrasoundAnalyticsReport: (from?: string, to?: string) => apiRequest<ApiUltrasoundAnalyticsReport>(`/ultrasound/analytics/reports?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString()}`),
  getUltrasoundAuditTrail: (filters: ApiUltrasoundAuditFilters = {}) => apiRequest<ApiUltrasoundAuditPage>(`/ultrasound/audit-trail?${new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== "")) as Record<string, string>).toString()}`),
  listUltrasoundAuditUsers: () => apiRequest<ApiUltrasoundAuditUser[]>("/ultrasound/audit-trail/users"),
  getUltrasoundOrder: (id: string) => apiRequest<ApiUltrasoundOrder>(`/ultrasound/${encodeURIComponent(id)}`),
  getUltrasoundOrderAudit: (id: string) => apiRequest<ApiUltrasoundAuditEntry[]>(`/ultrasound/${encodeURIComponent(id)}/audit-trail`),
  logUltrasoundReportPrint: (id: string) => apiRequest<{ printNumber: number }>(`/ultrasound/${encodeURIComponent(id)}/print`, { method: "POST" }),
  updateUltrasoundPricing: (id: string, payload: { feeAmount: number; discountAmount: number; reason?: string }) => apiRequest<ApiUltrasoundOrder>(`/ultrasound/${encodeURIComponent(id)}/pricing`, { method: "PATCH", body: JSON.stringify(payload) }),
  listPatientUltrasounds: (patientId: string) => apiRequest<ApiUltrasoundOrder[]>(`/ultrasound/patient/${encodeURIComponent(patientId)}`),
  createUltrasoundOrder: (payload: ApiCreateUltrasoundOrderInput) => apiRequest<ApiUltrasoundOrder>("/ultrasound", { method: "POST", body: JSON.stringify(payload) }),
  scheduleUltrasound: (id: string, payload: ApiScheduleUltrasoundInput) => apiRequest<ApiUltrasoundOrder>(`/ultrasound/${encodeURIComponent(id)}/schedule`, { method: "PATCH", body: JSON.stringify(payload) }),
  startUltrasound: (id: string) => apiRequest<ApiUltrasoundOrder>(`/ultrasound/${encodeURIComponent(id)}/start`, { method: "PATCH" }),
  completeUltrasound: (id: string, payload: ApiCompleteUltrasoundInput) => apiRequest<ApiUltrasoundOrder>(`/ultrasound/${encodeURIComponent(id)}/complete`, { method: "PATCH", body: JSON.stringify(payload) }),
  reviewUltrasound: (id: string, payload: ApiUltrasoundReviewInput) => apiRequest<ApiUltrasoundOrder>(`/ultrasound/${encodeURIComponent(id)}/review`, { method: "PATCH", body: JSON.stringify(payload) }),
  verifyUltrasound: (id: string) => apiRequest<ApiUltrasoundOrder>(`/ultrasound/${encodeURIComponent(id)}/verify`, { method: "PATCH" }),
  deliverUltrasound: (id: string) => apiRequest<ApiUltrasoundOrder>(`/ultrasound/${encodeURIComponent(id)}/deliver`, { method: "PATCH" }),
  cancelUltrasound: (id: string) => apiRequest<ApiUltrasoundOrder>(`/ultrasound/${encodeURIComponent(id)}/cancel`, { method: "PATCH" }),
  uploadUltrasoundImages: (id: string, files: File[]) => { const body = new FormData(); files.forEach((file) => body.append("files", file)); return apiRequest<ApiUltrasoundOrder>(`/ultrasound/${encodeURIComponent(id)}/images`, { method: "POST", body }) },
  listUltrasoundTemplates: () => apiRequest<ApiUltrasoundTemplate[]>("/ultrasound/templates"),
  listManageableUltrasoundTemplates: () => apiRequest<ApiUltrasoundTemplate[]>("/ultrasound/templates/manage"),
  updateUltrasoundTemplate: (id: string, sections: ApiUltrasoundTemplateField[]) => apiRequest<ApiUltrasoundTemplate>(`/ultrasound/templates/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ sections }) }),
  getLabOrder: (id: string) => apiRequest<ApiLabOrder>(`/lab/orders/${encodeURIComponent(id)}`),
  generateLabOrderInvoice: (orderId: string, payload?: { discountPercent?: number; discountReason?: string }) =>
    apiRequest<ApiInvoice>(`/lab/orders/${encodeURIComponent(orderId)}/invoice`, {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    }),
  createLabOrder: (payload: ApiCreateLabOrderInput, approval?: { token?: string; pin?: string }) => apiRequest<ApiLabOrder>("/lab/orders", {
    method: "POST",
    headers: {
      ...(approval?.token ? { "X-Discount-Approval-Token": approval.token } : {}),
      ...(approval?.pin ? { "X-Discount-Approval-Pin": approval.pin } : {}),
    },
    body: JSON.stringify(payload),
  }),
  createLabPackageOrder: (payload: ApiCreateLabPackageOrderInput, approval?: { token?: string; pin?: string }) => apiRequest<ApiLabPackageOrderResult>("/lab/orders/packages", {
    method: "POST",
    headers: {
      ...(approval?.token ? { "X-Discount-Approval-Token": approval.token } : {}),
      ...(approval?.pin ? { "X-Discount-Approval-Pin": approval.pin } : {}),
    },
    body: JSON.stringify(payload),
  }),
  getLabBillingSettings: () => apiRequest<ApiLabBillingSettings>("/lab/settings/billing"),
  updateLabBillingSettings: (payload: ApiLabBillingSettings) => apiRequest<ApiLabBillingSettings>("/lab/settings/billing", { method: "PUT", body: JSON.stringify(payload) }),
  updateLabSampleStatus: (id: string, status: ApiLabSampleStatus) => apiRequest<ApiLabOrder>(`/lab/orders/${encodeURIComponent(id)}/sample-status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  enterLabResult: (id: string, payload: ApiLabResultInput) => apiRequest<ApiLabResult>(`/lab/orders/${encodeURIComponent(id)}/results`, { method: "POST", body: JSON.stringify(payload) }),
  amendLabResult: (id: string, payload: ApiLabResultInput & { reason: string }) => apiRequest<ApiLabResult>(`/lab/orders/${encodeURIComponent(id)}/results/amend`, { method: "POST", body: JSON.stringify(payload) }),
  verifyLabOrder: (id: string, expectedUpdatedAt?: string) => apiRequest<ApiLabOrder>(`/lab/orders/${encodeURIComponent(id)}/verify`, { method: "POST", body: expectedUpdatedAt ? JSON.stringify({ expectedUpdatedAt }) : undefined }),
  rejectLabSample: (id: string, reason: ApiLabSampleRejectionReason, otherReason?: string) => apiRequest<ApiLabSampleRejection>(`/lab/orders/${encodeURIComponent(id)}/reject-sample`, { method: "POST", body: JSON.stringify({ reason, otherReason }) }),
  recollectLabSample: (id: string, rejectionId: string) => apiRequest<ApiLabOrder>(`/lab/orders/${encodeURIComponent(id)}/sample-rejections/${encodeURIComponent(rejectionId)}/recollect`, { method: "POST" }),
  recordLabPrint: (id: string) => apiRequest<{ printedAt: string }>(`/lab/orders/${encodeURIComponent(id)}/printed`, { method: "POST" }),
  uploadLabReport: (id: string, file: File) => { const body = new FormData(); body.append("file", file); return apiRequest<ApiLabAttachment>(`/lab/orders/${encodeURIComponent(id)}/attachments`, { method: "POST", body }) },
  listConsultations: (appointmentId?: string, patientId?: string) => apiRequest<ApiConsultation[]>(`/consultations?limit=100${appointmentId ? `&appointmentId=${encodeURIComponent(appointmentId)}` : ""}${patientId ? `&patientId=${encodeURIComponent(patientId)}` : ""}`),
  startPatientConsultation: (patientId: string) => apiRequest<ApiConsultation>("/consultations/start", { method: "POST", body: JSON.stringify({ patientId }) }),
  listInvoices: (filters: {
    search?: string;
    status?: string;
    itemType?: ApiInvoiceItem["itemType"];
    department?: ApiInvoiceDepartment;
    departments?: ApiInvoiceDepartment[];
    dateFrom?: string;
    dateTo?: string;
    patientId?: string;
    createdBy?: string;
  } = {}) => {
    const params = new URLSearchParams({ limit: "100" })
    if (filters.search) params.set("search", filters.search)
    if (filters.status) params.set("status", filters.status)
    if (filters.itemType) params.set("itemType", filters.itemType)
    if (filters.department) params.set("department", filters.department)
    if (filters.departments?.length) params.set("departments", filters.departments.join(","))
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom)
    if (filters.dateTo) params.set("dateTo", filters.dateTo)
    if (filters.patientId) params.set("patientId", filters.patientId)
    if (filters.createdBy) params.set("createdBy", filters.createdBy)
    return apiRequest<ApiInvoice[]>(`/billing/invoices?${params.toString()}`)
  },
  listInvoicesPage: (filters: {
    search?: string;
    status?: string;
    itemType?: ApiInvoiceItem["itemType"];
    department?: ApiInvoiceDepartment;
    departments?: ApiInvoiceDepartment[];
    dateFrom?: string;
    dateTo?: string;
    patientId?: string;
    createdBy?: string;
    page: number;
    pageSize: number;
  }) => {
    const params = new URLSearchParams({ page: String(filters.page), limit: String(filters.pageSize) })
    if (filters.search) params.set("search", filters.search)
    if (filters.status) params.set("status", filters.status)
    if (filters.itemType) params.set("itemType", filters.itemType)
    if (filters.department) params.set("department", filters.department)
    if (filters.departments?.length) params.set("departments", filters.departments.join(","))
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom)
    if (filters.dateTo) params.set("dateTo", filters.dateTo)
    if (filters.patientId) params.set("patientId", filters.patientId)
    if (filters.createdBy) params.set("createdBy", filters.createdBy)
    return apiRequest<ApiInvoice[]>(`/billing/invoices?${params.toString()}`, undefined, true, 0, true)
  },
  listBillingStaff: (department?: ApiInvoiceDepartment) => apiRequest<ApiBillingStaff[]>(`/billing/staff${department ? `?department=${encodeURIComponent(department)}` : ""}`),
  getBillingSummary: (dateFrom?: string, dateTo?: string) => {
    const params = new URLSearchParams()
    if (dateFrom) params.set("dateFrom", dateFrom)
    if (dateTo) params.set("dateTo", dateTo)
    return apiRequest<ApiBillingSummary>(`/billing/summary${params.size ? `?${params.toString()}` : ""}`)
  },
  getInvoice: (id: string) => apiRequest<ApiInvoice>(`/billing/invoices/${encodeURIComponent(id)}`),
  createInvoice: (payload: ApiCreateInvoiceInput) => apiRequest<ApiInvoice>("/billing/invoices", { method: "POST", body: JSON.stringify(payload) }),
  recordPayment: (id: string, payload: ApiRecordPaymentInput) => apiRequest<ApiInvoice>(`/billing/invoices/${encodeURIComponent(id)}/payments`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(payload) }),
  refundInvoice: (id: string, payload: ApiRefundInput) => apiRequest<ApiInvoice>(`/billing/invoices/${encodeURIComponent(id)}/refunds`, { method: "POST", body: JSON.stringify(payload) }),
  voidInvoice: (id: string, reason: string) => apiRequest<ApiInvoice>(`/billing/invoices/${encodeURIComponent(id)}/void`, { method: "POST", body: JSON.stringify({ reason }) }),
  listMedicines: (search = "", categoryId = "") => apiRequest<ApiMedicine[]>(`/pharmacy/medicines?limit=100${search ? `&search=${encodeURIComponent(search)}` : ""}${categoryId ? `&categoryId=${encodeURIComponent(categoryId)}` : ""}`),
  listPharmacyCategories: () => apiRequest<ApiMedicineCategory[]>('/pharmacy/categories'),
  createMedicine: (payload: ApiCreateMedicineInput) => apiRequest<ApiMedicine>("/pharmacy/medicines", { method: "POST", body: JSON.stringify(payload) }),
  updateMedicine: (id: string, payload: ApiCreateMedicineInput) => apiRequest<ApiMedicine>(`/pharmacy/medicines/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  archiveMedicine: (id: string) => apiRequest<null>(`/pharmacy/medicines/${encodeURIComponent(id)}`, { method: "DELETE" }),
  addMedicineBatch: (payload: ApiAddBatchInput) => apiRequest<ApiMedicineBatch>("/pharmacy/batches", { method: "POST", body: JSON.stringify(payload) }),
  stockIn: (payload: ApiStockInInput) => apiRequest<ApiMedicineBatch>("/pharmacy/stock-in", { method: "POST", body: JSON.stringify(payload) }),
  dispense: (payload: ApiDispenseInput) => apiRequest<ApiPrescriptionItem>("/pharmacy/dispense", { method: "POST", body: JSON.stringify(payload) }),
  dispensePrescription: (prescriptionId: string, payload: { items: Array<{ prescriptionItemId: string; quantity: number }> }) =>
    apiRequest<{ prescription: { id: string; status: "DISPENSED" | "PARTIALLY_DISPENSED" }; sale: ApiPharmacySale }>(`/pharmacy/prescriptions/${encodeURIComponent(prescriptionId)}/dispense`, { method: "POST", body: JSON.stringify(payload) }),
  createPharmacySale: (payload: ApiCreatePharmacySaleInput, approvalToken?: string, adminPin?: string) => {
    const headers: Record<string, string> = { "Idempotency-Key": crypto.randomUUID() }
    if (approvalToken) headers["X-Discount-Approval-Token"] = approvalToken
    if (adminPin) headers["X-Discount-Approval-Pin"] = adminPin
    return apiRequest<ApiPharmacySale>("/pharmacy/sales", { method: "POST", headers, body: JSON.stringify(payload) })
  },
  getPharmacySaleInvoice: (id: string) => apiRequest<ApiInvoice>(`/pharmacy/sales/${encodeURIComponent(id)}/invoice`),
  returnStock: (payload: ApiReturnStockInput) => apiRequest<ApiMedicineBatch>("/pharmacy/return", { method: "POST", body: JSON.stringify(payload) }),
  adjustStock: (payload: ApiAdjustStockInput) => apiRequest<ApiMedicineBatch>("/pharmacy/adjust", { method: "POST", body: JSON.stringify(payload) }),
  writeOffStock: (payload: ApiWriteOffInput) => apiRequest<ApiMedicineBatch>("/pharmacy/write-off", { method: "POST", body: JSON.stringify(payload) }),
  listStockMovements: (medicineId?: string) => apiRequest<ApiStockMovement[]>(`/pharmacy/stock-movements?limit=200${medicineId ? `&medicineId=${encodeURIComponent(medicineId)}` : ""}`),
  getPharmacyOverview: () => apiRequest<ApiPharmacyOverview>("/pharmacy/overview"),
  getPharmacyReports: (params: ApiPharmacyReportParams = {}) => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") query.set(key, String(value))
    }
    return apiRequest<ApiPharmacyReports>(`/pharmacy/reports${query.size ? `?${query.toString()}` : ""}`)
  },
  getPharmacySettings: () => apiRequest<ApiPharmacySettings>("/pharmacy/settings"),
  updatePharmacySettings: (payload: ApiPharmacySettingsInput) => apiRequest<ApiPharmacySettings>("/pharmacy/settings", { method: "PUT", body: JSON.stringify(payload) }),
  updatePharmacyAdminPin: (payload: { newPin: string; currentPin?: string } | string) => {
    const body = typeof payload === "string" ? { newPin: payload } : payload
    return apiRequest<{ message: string }>("/pharmacy/settings/admin-pin", { method: "PUT", body: JSON.stringify(body) })
  },
  uploadPharmacyLogo: (file: File) => {
    const body = new FormData()
    body.append("file", file)
    return apiRequest<{ logoUrl: string }>("/pharmacy/settings/logo", { method: "POST", body })
  },
  listPharmacyInvoices: (params: { search?: string; from?: string; to?: string; page?: number; limit?: number } = {}) => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value))
    return apiRequest<{ items: ApiPharmacySale[]; pagination: { page: number; limit: number; total: number } }>(`/pharmacy/invoices${query.size ? `?${query.toString()}` : ""}`)
  },
  getPharmacyInvoice: (id: string) => apiRequest<ApiPharmacyInvoice>(`/pharmacy/invoices/${encodeURIComponent(id)}`),
  voidPharmacySale: (id: string, reason: string, adminPin?: string) =>
    apiRequest<{ adjustment: ApiPharmacySaleAdjustment }>(`/pharmacy/invoices/${encodeURIComponent(id)}/void`, {
      method: "POST",
      body: JSON.stringify({ reason, adminPin }),
    }),
  returnPharmacySale: (id: string, payload: ApiPharmacySaleReturnInput, adminPin?: string) =>
    apiRequest<{ adjustment: ApiPharmacySaleAdjustment }>(`/pharmacy/invoices/${encodeURIComponent(id)}/returns`, {
      method: "POST",
      body: JSON.stringify({ ...payload, adminPin }),
    }),
  listPharmacySaleAdjustments: (params: { from?: string; to?: string; type?: "VOID" | "RETURN"; page?: number; limit?: number } = {}) => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value))
    return apiRequest<{ items: ApiPharmacySaleAdjustment[]; pagination: { page: number; limit: number; total: number } }>(`/pharmacy/sale-adjustments${query.size ? `?${query.toString()}` : ""}`)
  },
  listPharmacyDiscountAudits: (params: { from?: string; to?: string; cashier?: string; page?: number; limit?: number } = {}) => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value))
    return apiRequest<{
      items: ApiPharmacyDiscountAudit[]
      totalDiscountAmount: number
      pagination: { page: number; limit: number; total: number }
    }>(`/pharmacy/discount-audits${query.size ? `?${query.toString()}` : ""}`)
  },
  listPharmacyLedgerAccounts: (params: { search?: string; type?: "RECEIVABLE" | "PAYABLE"; patientId?: string; page?: number; limit?: number } = {}) => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value))
    return apiRequest<ApiPharmacyLedgerAccountList>(`/pharmacy/khata/accounts${query.size ? `?${query.toString()}` : ""}`)
  },
  createPharmacyLedgerAccount: (payload: ApiCreatePharmacyLedgerAccountInput) => apiRequest<ApiPharmacyLedgerAccount>("/pharmacy/khata/accounts", { method: "POST", body: JSON.stringify(payload) }),
  getPharmacyLedger: (accountId: string, page = 1, limit = 50) => apiRequest<ApiPharmacyLedger>(`/pharmacy/khata/accounts/${encodeURIComponent(accountId)}?page=${page}&limit=${limit}`),
  recordPharmacyLedgerPayment: (accountId: string, payload: ApiPharmacyLedgerPaymentInput) => apiRequest<{ entry: ApiPharmacyLedgerEntry; balance: number }>(`/pharmacy/khata/accounts/${encodeURIComponent(accountId)}/payments`, { method: "POST", body: JSON.stringify(payload) }),
  adjustPharmacyLedger: (accountId: string, payload: ApiPharmacyLedgerAdjustmentInput) => apiRequest<{ entry: ApiPharmacyLedgerEntry; balance: number }>(`/pharmacy/khata/accounts/${encodeURIComponent(accountId)}/adjustments`, { method: "POST", body: JSON.stringify(payload) }),
  listPrescriptions: (status?: ApiPrescription["status"]) => apiRequest<ApiPrescription[]>(`/prescriptions?limit=100${status ? `&status=${status}` : ""}`),
  getPrescription: (id: string) => apiRequest<ApiPrescription>(`/prescriptions/${encodeURIComponent(id)}`),
  createPrescription: (payload: ApiCreatePrescriptionInput) => apiRequest<ApiPrescription>("/prescriptions", { method: "POST", body: JSON.stringify(payload) }),
  signPrescription: (id: string, expectedUpdatedAt?: string) => apiRequest<ApiPrescription>(`/prescriptions/${encodeURIComponent(id)}/sign`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: expectedUpdatedAt ? JSON.stringify({ expectedUpdatedAt }) : undefined }),
  voidPrescription: (id: string, reason: string) => apiRequest<ApiPrescription>(`/prescriptions/${encodeURIComponent(id)}/void`, { method: "POST", body: JSON.stringify({ reason }) }),
  printPrescription: (id: string) => apiRequest<ApiPrescription>(`/prescriptions/${encodeURIComponent(id)}/print`),
  getConsultationPrescriptionPrintData: (id: string) => apiRequest<ApiConsultationPrescriptionPrintData>(`/prescriptions/consultations/${encodeURIComponent(id)}/print`),
  listPrescriptionTemplates: () => apiRequest<ApiPrescriptionTemplate[]>("/prescriptions/templates"),
  createPrescriptionTemplate: (payload: ApiPrescriptionTemplateInput) => apiRequest<ApiPrescriptionTemplate>("/prescriptions/templates", { method: "POST", body: JSON.stringify(payload) }),
  updatePrescriptionTemplate: (id: string, payload: ApiPrescriptionTemplateInput) => apiRequest<ApiPrescriptionTemplate>(`/prescriptions/templates/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) }),
  deletePrescriptionTemplate: (id: string) => apiRequest<null>(`/prescriptions/templates/${encodeURIComponent(id)}`, { method: "DELETE" }),
  createPrescriptionShare: (id: string) => apiRequest<ApiPrescriptionShare>(`/prescriptions/${encodeURIComponent(id)}/share`, { method: "POST" }),
  uploadPrescriptionSharePdf: (id: string, shareId: string, pdf: Blob) => {
    const body = new FormData()
    body.set("file", pdf, "prescription.pdf")
    return apiRequest<{ id: string; expiresAt: string }>(`/prescriptions/${encodeURIComponent(id)}/share/${encodeURIComponent(shareId)}/pdf`, { method: "POST", body })
  },
  getConsultation: (id: string) => apiRequest<ApiConsultation>(`/consultations/${encodeURIComponent(id)}`),
  createConsultation: (payload: ApiCreateConsultationInput | Record<string, unknown>) => apiRequest<ApiConsultation>("/consultations", { method: "POST", body: JSON.stringify(payload) }),
  updateConsultation: (id: string, payload: ApiUpdateConsultationInput | Record<string, unknown>) => apiRequest<ApiConsultation>(`/consultations/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  signConsultation: (id: string) => apiRequest<ApiConsultation>(`/consultations/${id}/sign`, { method: "POST" }),
  completeConsultation: (id: string) => apiRequest<ApiConsultation>(`/consultations/${id}/complete`, { method: "POST" }),
  addConsultationAddendum: (id: string, note: string) => apiRequest<ApiConsultationAddendum>(`/consultations/${encodeURIComponent(id)}/addenda`, { method: "POST", body: JSON.stringify({ note }) }),
  searchIcd10: (query: string) => apiRequest<Array<{ code: string; description: string }>>(`/consultations/icd10?q=${encodeURIComponent(query)}`),
  listAuditLogs: () => apiRequest<ApiAuditLog[]>("/audit-logs?limit=200"),
  listUsers: (search = "") => apiRequest<ApiUser[]>(`/users?limit=100${search ? `&search=${encodeURIComponent(search)}` : ""}`),
  listUltrasoundStaff: () => apiRequest<ApiUser[]>("/users/ultrasound-staff"),
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
  getStaffProfile: (id: string) => apiRequest<{ user: ApiUser; profile: ApiStaffProfile | null }>(`/users/${encodeURIComponent(id)}/profile`),
  updateStaffProfile: (id: string, body: FormData) => apiRequest<{ user: ApiUser; profile: ApiStaffProfile }>(`/users/${encodeURIComponent(id)}/profile`, { method: "PATCH", body }),
  getMyStaffProfile: () => apiRequest<{ user: ApiUser; profile: ApiStaffProfile | null }>("/users/me/profile"),
  updateMyStaffProfile: (body: FormData) => apiRequest<{ user: ApiUser; profile: ApiStaffProfile }>("/users/me/profile", { method: "PATCH", body }),
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
  listOPDQueue: (date?: string) => apiRequest<ApiAppointment[]>(`/opd-queue${date ? `?date=${encodeURIComponent(date)}` : ""}`),
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
  listNotificationTemplates: () => apiRequest<ApiNotificationTemplate[]>("/settings/notification-templates"),
  createNotificationTemplate: (payload: ApiNotificationTemplateInput) => apiRequest<ApiNotificationTemplate>("/settings/notification-templates", { method: "POST", body: JSON.stringify(payload) }),
  updateNotificationTemplate: (id: string, payload: ApiNotificationTemplateInput) => apiRequest<ApiNotificationTemplate>(`/settings/notification-templates/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteNotificationTemplate: (id: string) => apiRequest<null>(`/settings/notification-templates/${encodeURIComponent(id)}`, { method: "DELETE" }),
  listMedicineCategories: () => apiRequest<ApiMedicineCategory[]>("/settings/medicine-categories"),
  createMedicineCategory: (payload: ApiMedicineCategoryInput) => apiRequest<ApiMedicineCategory>("/settings/medicine-categories", { method: "POST", body: JSON.stringify(payload) }),
  updateMedicineCategory: (id: string, payload: ApiMedicineCategoryInput) => apiRequest<ApiMedicineCategory>(`/settings/medicine-categories/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteMedicineCategory: (id: string) => apiRequest<null>(`/settings/medicine-categories/${encodeURIComponent(id)}`, { method: "DELETE" }),
  listRolePermissions: () => apiRequest<ApiRolePermission[]>("/settings/role-permissions"),
  updateRolePermission: (payload: ApiRolePermissionInput) => apiRequest<ApiRolePermission>("/settings/role-permissions", { method: "PUT", body: JSON.stringify(payload) }),
  listDepartments: (status: "ACTIVE" | "INACTIVE" | "ALL" = "ALL") => apiRequest<ApiDepartment[]>(`/settings/departments?status=${status}`),
  listAvailableHods: () => apiRequest<ApiDepartmentHod[]>("/settings/departments/available-hods"),
  createDepartment: (payload: ApiDepartmentInput) => apiRequest<ApiDepartment>("/settings/departments", { method: "POST", body: JSON.stringify(payload) }),
  updateDepartment: (id: string, payload: Partial<ApiDepartmentInput>) => apiRequest<ApiDepartment>(`/settings/departments/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) }),
  updateDepartmentStatus: (id: string, status: "ACTIVE" | "INACTIVE") => apiRequest<ApiDepartment>(`/settings/departments/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  listDoctorSchedules: () => apiRequest<ApiDoctorSchedule[]>('/settings/doctor-schedules'),
  updateDoctorSchedule: (doctorId: string, schedule: ApiDoctorScheduleInput) => apiRequest<{ id: string; scheduleJson: ApiDoctorScheduleInput }>(`/settings/doctor-schedules/${encodeURIComponent(doctorId)}`, { method: "PUT", body: JSON.stringify(schedule) }),
  deleteDepartment: (id: string) => apiRequest<null>(`/settings/departments/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getReportsRevenueSummary: (from?: string, to?: string) => {
    const qs = new URLSearchParams()
    if (from) qs.set("from", from)
    if (to) qs.set("to", to)
    return apiRequest<{
      invoiceCount: number
      totalBilled: number
      totalInvoiced: number
      totalCollected: number
      grossCollected?: number
      refundsTotal?: number
      totalOutstanding: number
      discountsGiven: number
      allTime: { paidInvoices: number; partialInvoices: number; unpaidInvoices: number; wardCharges: number; labRevenue: number; pharmacyRevenue: number }
    }>(`/reports/revenue-summary${qs.toString() ? `?${qs.toString()}` : ""}`)
  },
  getReportsRevenueTrend: (from?: string, to?: string) => {
    const qs = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString()
    return apiRequest<Array<{ label: string; collected: number; invoiced: number }>>(`/reports/revenue-trend${qs ? `?${qs}` : ""}`)
  },
  getReportsBedOccupancy: (wardType?: ApiWardType) => apiRequest<{ totalBeds: number; occupiedBeds: number; occupancyRate: number }>(`/reports/bed-occupancy${wardType ? `?wardType=${wardType}` : ""}`),
  getReportsSurgeryStats: (date?: string, departmentId?: string) => apiRequest<Array<{ status: string; count: number }>>(`/reports/surgery-stats?${new URLSearchParams({ ...(date ? { date } : {}), ...(departmentId ? { departmentId } : {}) }).toString()}`),
  listSurgeries: (date?: string, { page = 1, limit = 100 }: { page?: number; limit?: number } = {}) => {
    const qs = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (date) qs.set("date", date)
    return apiRequest<ApiSurgery[]>(`/ot/surgeries?${qs.toString()}`)
  },
  getOTSummary: () => apiRequest<ApiOTSummary>("/ot/surgeries/summary"),
  getSurgery: (id: string, _options?: unknown) => apiRequest<ApiSurgery>(`/ot/surgeries/${encodeURIComponent(id)}`),
  listOTRooms: (includeInactive = false) => apiRequest<ApiOTRoom[]>(`/ot/rooms${includeInactive ? "?includeInactive=true" : ""}`),
  createOTRoom: (payload: ApiOTRoomInput) => apiRequest<ApiOTRoom>("/ot/rooms", { method: "POST", body: JSON.stringify(payload) }),
  updateOTRoom: (id: string, payload: ApiOTRoomInput) => apiRequest<ApiOTRoom>(`/ot/rooms/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteOTRoom: (id: string) => apiRequest<ApiOTRoom>(`/ot/rooms/${encodeURIComponent(id)}`, { method: "DELETE" }),
  checkSurgeryAvailability: (payload: ApiScheduleSurgeryInput) => {
    const query = new URLSearchParams({
      patientId: payload.patientId,
      otRoomId: payload.otRoomId,
      surgeonId: payload.surgeonId,
      scheduledStart: payload.scheduledStart,
      scheduledEnd: payload.scheduledEnd,
      priority: payload.priority ?? "ELECTIVE",
    })
    return apiRequest<{ available: boolean; message?: string; surgeryType?: string; scheduledStart?: string }>(`/ot/surgeries/availability?${query.toString()}`)
  },
  scheduleSurgery: (payload: ApiScheduleSurgeryInput) => apiRequest<ApiSurgery>("/ot/surgeries", { method: "POST", body: JSON.stringify(payload) }),
  markSurgeryPreOp: (id: string) => apiRequest<ApiSurgery>(`/ot/surgeries/${encodeURIComponent(id)}/pre-op`, { method: "POST" }),
  updateSurgeryChecklist: (id: string, patch: Record<string, boolean>) => apiRequest<ApiSurgery>(`/ot/surgeries/${encodeURIComponent(id)}/checklist`, { method: "PATCH", body: JSON.stringify(patch) }),
  startSurgery: (id: string, payload?: { emergencyOverrideReason?: string }) => apiRequest<ApiSurgery>(`/ot/surgeries/${encodeURIComponent(id)}/start`, { method: "POST", body: payload ? JSON.stringify(payload) : undefined }),
  moveSurgeryToRecovery: (id: string, payload?: { intraoperativeNotes?: string; outcomeNotes?: string }) => apiRequest<ApiSurgery>(`/ot/surgeries/${encodeURIComponent(id)}/recovery`, { method: "POST", body: payload ? JSON.stringify(payload) : undefined }),
  completeSurgery: (id: string, payload: { postOpNotes?: string; complications?: string; chargeAmount?: number } = {}) => apiRequest<ApiSurgery>(`/ot/surgeries/${encodeURIComponent(id)}/complete`, { method: "POST", body: JSON.stringify(payload) }),
  postponeSurgery: (id: string, payload: { reason: string; scheduledStart: string; scheduledEnd: string }) => apiRequest<ApiSurgery>(`/ot/surgeries/${encodeURIComponent(id)}/postpone`, { method: "POST", body: JSON.stringify(payload) }),
  cancelSurgery: (id: string, reason: string) => apiRequest<ApiSurgery>(`/ot/surgeries/${encodeURIComponent(id)}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }),
  getReportsAppointmentStats: (from?: string, to?: string, departmentId?: string) => {
    const qs = new URLSearchParams()
    if (from) qs.set("from", from)
    if (to) qs.set("to", to)
    if (departmentId) qs.set("departmentId", departmentId)
    return apiRequest<Array<{ status: string; count: number }>>(`/reports/appointment-stats${qs.toString() ? `?${qs.toString()}` : ""}`)
  },
  getReportsDepartmentDistribution: (departmentId?: string) => apiRequest<Array<{ label: string; value: number }>>(`/reports/department-distribution${departmentId ? `?departmentId=${encodeURIComponent(departmentId)}` : ""}`),
  getReportsLowStock: () => apiRequest<ApiLowStockReport[]>("/reports/low-stock-medicines"),
  getReportsNearExpiry: () => apiRequest<ApiNearExpiryReport[]>("/reports/near-expiry-medicines"),
  getReportsLabTurnaround: (from?: string, to?: string) => apiRequest<{ averageTurnaroundHours: number; sampleSize: number }>(`/reports/lab-turnaround${from || to ? `?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString()}` : ""}`),
  getReportsDoctorProductivity: (from?: string, to?: string, departmentId?: string) => apiRequest<ApiDoctorProductivityReport[]>(`/reports/doctor-productivity?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), ...(departmentId ? { departmentId } : {}) }).toString()}`),
}

export interface ApiUser {
  id: string
  name: string
  email: string
  role: "ADMIN" | "RECEPTIONIST" | "DOCTOR" | "LAB_TECHNICIAN" | "PATHOLOGIST" | "ULTRASOUND_TECH" | "ULTRASOUND_TECHNICIAN" | "RADIOLOGIST" | "PHARMACIST" | "NURSE"
  profilePictureUrl?: string | null
  phone?: string | null
  departmentId?: string | null
  isActive: boolean
  createdAt?: string
}

export interface ApiStaffProfile {
  id: string
  userId: string
  qualification?: string | null
  specialization?: string | null
  registrationNumber?: string | null
  pmdcRegistrationNo?: string | null
  phcRegistrationNo?: string | null
  signatureUrl?: string | null
  stampUrl?: string | null
  consultationFee?: number | string | null
}

export interface ApiDepartmentHod { id: string; name: string; specialization?: string | null }
export interface ApiDepartmentInput { name: string; hodId?: string | null; icon?: string | null; status: "ACTIVE" | "INACTIVE" }
export interface ApiDepartment extends ApiDepartmentInput { id: string; createdAt?: string; updatedAt?: string; hod?: { id: string; user: { name: string }; specialization?: string | null } | null; _count?: { doctors: number; users: number; appointments: number } }

export interface ApiBackupManifest {
  version: string
  app: string
  schemaVersion: string
  createdAt: string
  environment: string
  databaseChecksumSha256: string
  tableCounts: Record<string, number>
  uploadedFilesCount: number
}

export interface ApiBackup {
  id: string
  filename: string
  sizeBytes: number
  createdAt: string
  status: "SUCCESS" | "FAILED"
  manifest?: ApiBackupManifest | null
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
export type ApiAdmissionType = "EMERGENCY" | "PLANNED" | "REFERRAL" | "TRANSFER" | "DAY_CARE"
export type ApiShiftType = "MORNING" | "EVENING" | "NIGHT"
export type ApiWardType = "GENERAL" | "PRIVATE" | "ICU"
export interface ApiWardInput { wardName: string; wardType?: ApiWardType; dailyRate: number; capacity: number; amenities: string[]; isActive: boolean }
export interface ApiWard { id: string; wardName: string; wardType: ApiWardType; dailyRate: number | string; capacity: number; amenities: string[]; isActive: boolean; rooms: ApiRoom[] }
export interface ApiRoom { id: string; wardId: string; roomNumber: string; beds: ApiBed[] }
export interface ApiBed { id: string; roomId: string; bedNumber: string; bedLabel?: string | null; dailyRate: number | string; status: ApiBedStatus | "OCCUPIED" }
export interface ApiRoomBedBatchInput {
  roomUpdates: Array<{ id: string; wardId: string; roomNumber: string }>
  bedUpdates: Array<{ id: string; roomId?: string; wardId?: string; bedNumber: string; bedLabel?: string | null }>
  deleteBedIds: string[]
  addBeds: Array<{ wardId: string; roomNumber: string; bedNumbers: string[] }>
}
export interface ApiBedAvailability extends ApiBed { room: { roomNumber: string; ward: { wardName: string; wardType: ApiWardType } }; admissions: Array<{ id: string; patient: { id: string; mrNumber: string; firstName: string; lastName: string }; attendingDoctor?: { user: { name: string } } | null; admissionDate: string; depositStatus?: "PENDING" | "PAID"; roundDoneToday?: boolean }> }
export interface ApiDischargeDetails {
  diagnosis: string
  courseInHospital: string
  procedures?: string[]
  medications: string[]
  conditionAtDischarge: string
  followUpDate: string | null
  referral: string
  instructions: string
}

export interface ApiAdmission {
  id: string
  patientId: string
  bedId: string
  attendingDoctorId: string
  admissionType: ApiAdmissionType
  admissionDate: string
  admissionReason: string
  admissionNotes?: string | null
  depositAmount: number | string
  depositStatus?: "PENDING" | "PAID"
  readyForDischarge?: boolean
  readyForDischargeAt?: string | null
  dailyRate?: number | string | null
  status: ApiAdmissionStatus
  dischargeDate?: string | null
  dischargeSummary?: string | null
  dischargeNotes?: string | null
  dischargeDetails?: ApiDischargeDetails | null
  outstandingBalance?: number | string
  patient: { id: string; mrNumber: string; firstName: string; lastName: string; age?: number | null; allergies?: string[] }
  bed: { id: string; bedNumber: string; dailyRate: number | string; room: { roomNumber: string; ward: { wardName: string; wardType: ApiWardType } } }
  attendingDoctor?: { user: { id: string; name: string } } | null
  transfers?: ApiTransferRecord[]
}
export interface ApiWardMedicineOrder {
  id: string
  admissionId: string
  orderNote: string
  createdAt: string
  issuedAt: string | null
  returnedAt: string | null
  items: Array<{
    id: string
    medicineId: string
    quantity: number
    issuedQuantity: number
    returnedQuantity: number
    unitPrice: number | string | null
    invoiceItemId: string | null
    fefoBatches?: Array<{ batchNumber: string; expiryDate: string; quantity: number }>
    medicine: { id: string; name: string; strength?: string | null; form?: string | null }
  }>
}
export interface ApiIpdWardAdmission {
  id: string
  admissionDate: string
  patient: { id: string; mrNumber: string; firstName: string; lastName: string }
  bed: { bedNumber: string; room: { roomNumber: string; ward: { wardName: string } } }
}
export interface ApiIpdServiceCharge {
  id: string
  name: string
  category: string
  defaultPrice: number | string
  isActive: boolean
}
export interface ApiIpdRunningBill {
  admissionId: string
  invoice: ApiInvoice
  categories: {
    bed: ApiInvoiceItem[]
    medicines: ApiInvoiceItem[]
    services: ApiInvoiceItem[]
    tests: ApiInvoiceItem[]
  }
  totals: { charged: number | string; paid: number | string; balance: number | string }
}
export interface ApiTransferRecord { id: string; admissionId: string; fromBedId: string; toBedId: string; transferDate: string; reason: string; createdBy?: string; fromBed?: { bedNumber: string; room: { roomNumber: string; ward: { wardName: string; wardType: ApiWardType } } }; toBed?: { bedNumber: string; room: { roomNumber: string; ward: { wardName: string; wardType: ApiWardType } } } }
export interface ApiAdmitPatientInput { patientId: string; bedId: string; attendingDoctorId: string; admissionType?: ApiAdmissionType; admissionReason: string; depositAmount?: number; expectedStayDays?: number; dailyRate?: number; admissionNotes?: string }
export interface ApiTransferInput { toBedId: string; reason: string }
export interface ApiDischargeInput {
  diagnosis?: string
  courseInHospital?: string
  medications?: string[]
  conditionAtDischarge?: string
  followUpDate?: string
  referral?: string
  instructions?: string
  confirmUnpaidBalance?: boolean
  dischargeSummary?: string
  dischargeNotes?: string
  overrideReason?: string
}
export interface ApiCreateWardRoundInput { subjective?: string; findings?: string; assessment?: string; plan?: string }
export interface ApiWardRound extends ApiCreateWardRoundInput { id: string; admissionId: string; doctorId: string; roundAt: string; createdAt: string; signedAt?: string | null; vitalsSnapshot?: Record<string, unknown> | null; doctor?: { id: string; name: string } }
export interface ApiDoctorWardRoundToday {
  id: string
  admissionDate: string
  daysAdmitted: number
  readyForDischarge: boolean
  roundDoneToday: boolean
  lastRoundAt: string | null
  patient: { id: string; mrNumber: string; firstName: string; lastName: string; age: number | null; allergies: string[] }
  bed: { id: string; bedNumber: string; room: string; ward: string }
  latestVitals: (ApiPatientVitals & { isCritical: boolean }) | null
  pendingLabResults: Array<{ id: string; test: string; status: string; orderedAt: string; latestResult?: { resultValue: string; unit?: string | null; interpretation?: string | null } | null }>
  pendingUltrasoundResults: Array<{ id: string; examType: string; status: string; createdAt: string }>
  activeMedicationOrders: Array<{ prescriptionId: string; name: string; dose: string; frequency: string; durationDays: number }>
}
export interface ApiRecordAdmissionDepositInput { amount: number; paymentMethod: "CASH" | "CARD" | "BANK_TRANSFER" | "MOBILE_WALLET"; notes?: string }
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
export interface ApiMedicineCategory { id: string; name: string; description?: string | null; isActive: boolean; _count?: { medicines: number } }
export interface ApiMedicineCategoryInput { name: string; description?: string; isActive?: boolean }
export type ApiPermissionAction = "view" | "create" | "edit" | "delete" | "export"
export interface ApiRolePermission { id: string; role: string; module: string; allowedActions: ApiPermissionAction[] }
export interface ApiRolePermissionInput { role: string; module: string; allowedActions: ApiPermissionAction[] }

export interface ApiHospitalProfile {
  id: string; name: string; registrationNo?: string | null; address?: string | null; phone?: string | null; email?: string | null;
  logoUrl?: string | null; faviconUrl?: string | null; emergencyContact?: string | null; taxId?: string | null; pmdcRegistrationNo?: string | null; phcRegistrationNo?: string | null; phcRlNo?: string | null; clinicDaysTimings?: string | null; refillText?: string | null; dispensingStampText?: string | null; reportFooter?: string | null; currency: string; timezone: string;
}

export interface ApiPatient {
  id: string
  mrNumber: string
  firstName: string
  lastName: string
  age?: number | null
  dateOfBirth?: string | null
  dob?: string | null
  gender: "MALE" | "FEMALE" | "OTHER"
  phone: string
  email?: string | null
  address?: string | null
  cnic?: string | null
  bloodGroup?: string | null
  allergies: string[]
  allergiesReviewed?: boolean
  chronicConditions?: string[]
  chronicConditionsReviewed?: boolean
  emergencyContactName?: string | null
  emergencyContactPhone?: string | null
  notes?: string | null
  createdAt: string
  lastVisit?: string | null
  balance?: number | string | null
}

export interface ApiDoctor {
  id: string
  userId?: string
  consultationFee?: number | string | null
  user: { id?: string; name: string; profilePictureUrl?: string | null }
  department: { id: string; name: string } | null
  specialization?: string | null
  scheduleJson?: unknown
}
export interface ApiDoctorScheduleDay { enabled: boolean; start: string; end: string }
export interface ApiDoctorScheduleInput { slotDuration: number; weekly: Record<ApiScheduleDay, ApiDoctorScheduleDay> }
export type ApiScheduleDay = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday"
export interface ApiDoctorSchedule { id: string; qualification?: string | null; specialization?: string | null; isAvailable: boolean; scheduleJson?: ApiDoctorScheduleInput | null; user: { name: string; email: string }; department: { name: string } | null }
export type ApiNotificationType = "APPOINTMENT_PENDING" | "APPOINTMENT_CONFIRMED" | "LAB_RESULT_READY" | "CRITICAL_LAB_RESULT" | "LOW_STOCK_MEDICINE" | "NEAR_EXPIRY_MEDICINE" | "BED_AVAILABLE" | "PAYMENT_PENDING" | "DISCHARGE_REMINDER" | "SURGERY_STARTING_SOON" | "OT_CHECKLIST_INCOMPLETE"
export interface ApiNotificationTemplateInput { notificationType: ApiNotificationType; name: string; titleTemplate: string; messageTemplate: string; availablePlaceholders: string[]; isActive: boolean }
export interface ApiNotificationTemplate extends ApiNotificationTemplateInput { id: string; createdAt: string; updatedAt: string }
export interface ApiPublicDepartment { id: string; name: string; icon?: string | null; _count: { doctors: number } }

export interface ApiAppointment {
  id: string
  tokenNumber: number
  gender?: string | null
  patient: {
    mrNumber: string
    firstName: string
    lastName: string
    gender?: string | null
    phone?: string | null
    age?: number | null
    dateOfBirth?: string | null
  }
  doctor: {
    id: string
    consultationFee?: number | string | null
    user: { name: string }
    department: { name: string } | null
  }
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

export interface ApiCreateLabTestInput {
  testName: string
  testCode: string
  category?: string | null
  sampleType?: string | null
  price: number
  unit?: string | null
  referenceRangeMin?: number | null
  referenceRangeMax?: number | null
  turnaroundTimeHours?: number | null
  isActive?: boolean
  isSendOut?: boolean
  referenceLabSupplierId?: string | null
  sendOutCost?: number | null
  parameters?: ApiLabTestParameterInput[]
}

export type ApiLabInventoryCategory = "REAGENT" | "TUBE" | "STRIP" | "KIT" | "OTHER"
export interface ApiLabInventoryItemInput {
  name: string
  category: ApiLabInventoryCategory
  unit: string
  reorderLevel: number
  supplierId?: string | null
}
export interface ApiLabInventoryBatchInput {
  itemId: string
  batchNumber: string
  expiryDate: string
  quantity: number
  purchasePrice: number
  supplierId?: string | null
}
export interface ApiLabInventoryMappingInput { testId: string; itemId: string; quantityPerTestRun: number }
export interface ApiLabInventoryAdjustmentInput { batchId: string; quantity: number; reason: string }
export interface ApiLabInventoryBatch extends ApiLabInventoryBatchInput {
  id: string
  createdAt: string
  updatedAt: string
  item?: { name: string; unit: string }
}
export interface ApiLabInventoryMapping extends ApiLabInventoryMappingInput {
  id: string
  test?: { id: string; testName: string; testCode: string }
}
export interface ApiLabInventoryItem extends ApiLabInventoryItemInput {
  id: string
  isActive: boolean
  totalQuantity: number
  lowStock: boolean
  supplier?: { id: string; name: string } | null
  batches: ApiLabInventoryBatch[]
  mappings: ApiLabInventoryMapping[]
}
export interface ApiLabInventoryMovement {
  id: string
  movementType: "IN" | "OUT" | "ADJUSTMENT"
  quantity: number | string
  reason?: string | null
  referenceType?: string | null
  createdAt: string
  batch: ApiLabInventoryBatch & { item: { name: string; unit: string } }
  creator: { id: string; name: string }
}
export interface ApiLabInventoryOverview {
  items: ApiLabInventoryItem[]
  suppliers: Array<{ id: string; name: string }>
  counts: { lowStock: number; expiringWithin30Days: number; expiredBatches: number }
}

export interface ApiLabTest extends ApiCreateLabTestInput {
  id: string
  isActive: boolean
  parameters?: ApiLabTestParameter[]
  createdAt?: string
  updatedAt?: string
  referenceLabSupplier?: { id: string; name: string; phone?: string | null } | null
}
export interface ApiLabLedgerEntry {
  id: string
  type: "INVOICE_CHARGE" | "PAYMENT_RECEIVED" | "SEND_OUT_CHARGE" | "PAYMENT_MADE" | "ADJUSTMENT"
  amount: number | string
  balanceAfter: number | string
  invoiceId?: string | null
  labOrderId?: string | null
  paymentMethod?: "CASH" | "CARD" | "BANK_TRANSFER" | "MOBILE_WALLET" | "ONLINE" | null
  notes?: string | null
  createdBy: string
  createdAt: string
  creator?: { id: string; name: string }
  invoice?: { id: string; invoiceNumber: string } | null
  labOrder?: { id: string; orderNumber: string } | null
}
export interface ApiLabLedgerAccount {
  id: string
  type: "RECEIVABLE" | "PAYABLE"
  partyType: "PATIENT" | "CLINIC" | "REFERENCE_LAB"
  patientId?: string | null
  supplierId?: string | null
  partyName: string
  partyPhone?: string | null
  patient?: { id: string; mrNumber: string; firstName: string; lastName: string; phone: string } | null
  supplier?: { id: string; name: string; phone?: string | null } | null
  balance: number
  lastActivity?: ApiLabLedgerEntry | null
}
export interface ApiLabLedgerAccounts {
  items: ApiLabLedgerAccount[]
  pagination: { page: number; limit: number; total: number; pages: number }
  summary: { receivable: number; payable: number }
}
export interface ApiLabLedger {
  account: ApiLabLedgerAccount
  balance: number
  entries: ApiLabLedgerEntry[]
  pagination: { page: number; limit: number; total: number; pages: number }
}
export interface ApiCreateLabLedgerAccountInput {
  partyType: "CLINIC" | "REFERENCE_LAB"
  partyName: string
  partyPhone?: string
}
export interface ApiLabReferenceRange {
  id: string
  gender: "MALE" | "FEMALE" | "ANY"
  ageMinDays?: number | null
  ageMaxDays?: number | null
  low?: number | string | null
  high?: number | string | null
  criticalLow?: number | string | null
  criticalHigh?: number | string | null
  notes?: string | null
}
export interface ApiLabReferenceRangeInput extends Omit<ApiLabReferenceRange, "id"> { id?: string }
export interface ApiLabTestParameter {
  id: string
  name: string
  unit?: string | null
  displayOrder: number
  resultType: "NUMERIC" | "TEXT" | "CHOICE"
  decimalPlaces: number
  ranges: ApiLabReferenceRange[]
}
export interface ApiLabTestParameterInput extends Omit<ApiLabTestParameter, "id" | "ranges"> {
  id?: string
  ranges: ApiLabReferenceRangeInput[]
}
export interface ApiLabPackageInput { name: string; price: number; testIds: string[]; isActive?: boolean }
export interface ApiLabPackage extends Omit<ApiLabPackageInput, "testIds"> {
  id: string
  tests: Array<{ id: string; testId: string; displayOrder: number; test: ApiLabTest }>
}
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
  amendedAt?: string | null
  amendmentReason?: string | null
  reportRemarks?: string | null
  createdBy?: string | null
  parameters?: ApiLabResultParameter[]
}
export type ApiLabParameterInterpretation = "LOW" | "NORMAL" | "HIGH" | "CRITICAL_LOW" | "CRITICAL_HIGH"
export interface ApiLabResultParameter {
  id: string
  parameterId?: string | null
  parameterName: string
  value: string
  unit?: string | null
  referenceRange?: string | null
  computedInterpretation?: ApiLabParameterInterpretation | null
  overriddenInterpretation?: ApiLabParameterInterpretation | null
  overrideReason?: string | null
}
export interface ApiLabAttachment { id: string; fileUrl: string; originalFilename?: string | null; fileType: string; uploadedAt?: string }
export interface ApiLabReportSettings {
  logoUrl?: string
  labName: string
  address?: string
  phone?: string
  accreditationLine?: string
  headerText?: string
  footerText?: string
  pathologistName?: string
  pathologistSignatureUrl?: string
  technicianName?: string
  technicianSignatureUrl?: string
  reportsRetentionNote?: string
  criticalThresholdDefaults?: Record<string, ApiLabCriticalThresholdDefault>
}
export interface ApiLabCriticalThresholdDefault { criticalLow?: number | null; criticalHigh?: number | null }
export type ApiLabSettingsAssetType = "logo" | "pathologist-signature" | "technician-signature"
export interface ApiLabSettingsInput extends ApiLabReportSettings {
  allowSameUserEnterVerify: boolean
  requirePaymentBeforeCollection: boolean
  defaultTurnaroundHours: number
  maxDiscountPercent: number
  criticalThresholdDefaults: Record<string, ApiLabCriticalThresholdDefault>
}
export interface ApiLabSettings extends ApiLabSettingsInput { lastBackupAt: string | null }
export interface ApiLabOrderPolicy { maxDiscountPercent: number; defaultTurnaroundHours: number }
export interface ApiPublicLabReportVerification {
  isAuthentic: boolean
  reportNumber: string
  amended: boolean
}
export interface ApiLabOrder {
  id: string
  patientId: string
  doctorId?: string | null
  testId: string
  status: "ORDERED" | "SAMPLE_COLLECTED" | "PROCESSING" | "COMPLETED" | "VERIFIED" | "CANCELLED"
  priority: "ROUTINE" | "URGENT" | "EMERGENCY"
  orderedAt: string
  orderNumber?: string
  invoiceId?: string | null
  invoice?: {
    id: string
    invoiceNumber: string
    status: string
    grandTotal?: number | string
    subtotal?: number | string
    discountAmount?: number | string
    discountType?: string | null
    discountReason?: string | null
    taxAmount?: number | string
    paidAmount?: number | string
    balanceAmount?: number | string
    items?: ApiInvoiceItem[]
    payments?: ApiPayment[]
  } | null
  criticalResult?: boolean
  sampleType?: string | null
  sampleCollectedAt?: string | null
  completedAt?: string | null
  verifiedAt?: string | null
  verifiedBy?: string | null
  patientName?: string
  patient?: { id?: string; mrNumber: string; firstName: string; lastName: string; age?: number | null; gender?: string | null; dateOfBirth?: string | null }
  doctor?: { user: { name: string } } | null
  consultation?: { doctor: { user: { name: string } } } | null
  verifier?: { id: string; name: string; role: string; staffProfile?: { qualification?: string | null; specialization?: string | null } | null } | null
  technician?: { name: string; designation?: string | null } | null
  test?: ApiLabTest & { parameters?: ApiLabTestParameter[] }
  consultationId?: string | null
  createdBy?: string
  results?: ApiLabResult[]
  attachments?: ApiLabAttachment[]
  history?: ApiLabOrderEvent[]
  sampleRejections?: ApiLabSampleRejection[]
}
export interface ApiLabOverviewOrder {
  id: string
  orderNumber: string
  patientName: string
  mrNumber: string
  testName: string
  doctorName: string
  orderedAt: string
  priority: "ROUTINE" | "URGENT" | "EMERGENCY"
  status: ApiLabOrder["status"]
  overdue: boolean
  turnaroundHours: number
  criticalResult: boolean
}
export interface ApiLabOverview {
  counts: { ordersToday: number; samplesPending: number; inProcess: number; criticalResults: number; expiringReagents: number }
  overdueCount: number
  orders: ApiLabOverviewOrder[]
  recentEvents: Array<{ id: string; eventType: string; createdAt: string; actorName: string; orderNumber: string; testName: string; patientName: string }>
}
export interface ApiLabReports {
  from: string | null
  to: string | null
  revenue: { billed: number; collected: number; outstanding: number } | null
  orderCount: number
  testsByCategory: Array<{ category: string; count: number }>
  doctorReferrals: Array<{ doctorName: string; count: number }>
  averageTurnaroundHours: number
  turnaroundSampleSize: number
  abnormalCount: number
  criticalCount: number
  technicianCounts: Array<{ technicianName: string; count: number }>
  rejectedSampleCount: number
  rejectedSamples: Array<{ reason: string; rejectedAt: string; orderNumber: string; testName: string; patientName: string }>
}
export interface ApiLabOrderEvent {
  id: string
  eventType: string
  createdAt: string
  oldValues?: unknown
  newValues?: unknown
  actor?: { id: string; name: string; role: string } | null
}
export type ApiLabSampleRejectionReason = "HAEMOLYSED" | "INSUFFICIENT_QUANTITY" | "WRONG_TUBE" | "OTHER"
export interface ApiLabSampleRejection {
  id: string
  reason: ApiLabSampleRejectionReason
  otherReason?: string | null
  rejectedAt: string
  recollectedAt?: string | null
  rejector?: { name: string } | null
  recollector?: { name: string } | null
}
export type ApiUltrasoundStatus = "ORDERED" | "SCHEDULED" | "IN_PROGRESS" | "REPORTED" | "VERIFIED" | "DELIVERED" | "CANCELLED"
export interface ApiUltrasoundOrder {
  id: string; patientId: string; doctorId: string; technicianId?: string | null; consultationId?: string | null; examType: string; status: ApiUltrasoundStatus; priority: "ROUTINE" | "URGENT" | "STAT" | "EMERGENCY"; feeAmount: number | string; discountAmount: number | string; scheduledAt?: string | null; performedAt?: string | null; completedAt?: string | null; findings?: string | null; impression?: string | null; structuredData?: Record<string, ApiUltrasoundStructuredValue> | null; imageUrls: string[]; imageCaptions?: string[]; verifiedById?: string | null; verifiedByName?: string | null; verifiedAt?: string | null; amendments?: Array<{ id: string; reason: string; oldValues: Record<string, unknown>; newValues: Record<string, unknown>; createdAt: string; author: { id: string; name: string } }>; notes?: string | null; createdAt: string; updatedAt?: string
  patient?: { id: string; mrNumber: string; firstName: string; lastName: string; age?: number | null; gender?: string }; doctor?: { signatureUrl?: string | null; user: { name: string } } | null; technician?: { id: string; name: string } | null; verifiedBy?: { id: string; name: string; doctorProfile?: { signatureUrl?: string | null } | null } | null; invoice?: { id: string; invoiceNumber: string; status: string; grandTotal: number | string; paidAmount: number | string; balanceAmount: number | string } | null
}
export interface ApiUltrasoundScanType { name: "Obstetric" | "Abdomen" | "KUB" | "Renal" | "Pelvis" | "Thyroid" | "Breast" | "Doppler" | "Other"; fee: number; enabled: boolean }
export interface ApiUltrasoundDoctorSignature { id: string; signatureUrl?: string | null; user: { name: string; role: string } }
export type ApiUltrasoundStructuredValue = string | number | boolean | { status: "NORMAL" | "ABNORMAL"; notes: string } | null
export type ApiUltrasoundTemplateFieldType = "organ" | "text" | "number" | "date" | "select" | "estimatedDueDate" | "gestationalAge"
export interface ApiUltrasoundTemplateField { key: string; label: string; type: ApiUltrasoundTemplateFieldType; unit?: string; options?: string[]; calculatedFrom?: string; patientGender?: "MALE" | "FEMALE" | "OTHER" }
export interface ApiUltrasoundTemplate { id: string; examinationType: string; sections: unknown[]; isActive: boolean }
export interface ApiCreateUltrasoundOrderInput { patientId: string; examType: string; priority?: "ROUTINE" | "URGENT" | "STAT"; feeAmount?: number; discountAmount?: number; discountType?: "AMOUNT" | "PERCENTAGE"; discountReason?: string; notes?: string; consultationId?: string; admissionId?: string }
export interface ApiScheduleUltrasoundInput { scheduledAt: string; technicianId: string }
export interface ApiCompleteUltrasoundInput { findings: string; impression?: string; structuredData?: Record<string, ApiUltrasoundStructuredValue>; imageUrls?: string[]; imageCaptions?: string[] }
export interface ApiUltrasoundReviewInput { findings?: string; impression?: string; structuredData?: Record<string, ApiUltrasoundStructuredValue>; amendmentReason?: string; expectedUpdatedAt?: string }
export interface ApiUltrasoundOverview {
  stats: { todayScans: number; pending: number; inProgress: number; awaitingVerification: number; urgent: number; todayCollected: number }
  recentActivity: Array<{ id: string; examType: string; status: ApiUltrasoundStatus; priority: string; createdAt: string; updatedAt: string; patient: { firstName: string; lastName: string; mrNumber: string } }>
  scansPerDay: Array<{ day: string; count: number }>
}
export interface ApiUltrasoundAnalyticsReport {
  totalScans: number
  totalRevenue: number
  discountsGiven: number
  averageTurnaroundHours: number
  turnaroundSampleSize: number
  byScanType: Array<{ examType: string; count: number; revenue: number }>
  byTechnician: Array<{ technicianId: string; technicianName: string; count: number; revenue: number }>
  byDoctor: Array<{ doctorId: string; doctorName: string; count: number; revenue: number }>
}
export type ApiUltrasoundAuditAction =
  | "ULTRASOUND_ORDER_CREATED"
  | "ULTRASOUND_ORDER_SCHEDULED"
  | "ULTRASOUND_ORDER_ASSIGNED"
  | "ULTRASOUND_STATUS_CHANGED"
  | "ULTRASOUND_FINDINGS_EDITED"
  | "ULTRASOUND_REPORT_VERIFIED"
  | "ULTRASOUND_REPORT_AMENDED"
  | "ULTRASOUND_REPORT_PRINTED"
  | "ULTRASOUND_IMAGES_ADDED"
  | "ULTRASOUND_IMAGES_REMOVED"
  | "ULTRASOUND_ORDER_CANCELLED"
  | "ULTRASOUND_PRICE_DISCOUNT_CHANGED"
  | "CREATE"
  | "UPDATE"
  | "STATUS_CHANGE"
export interface ApiUltrasoundAuditUser { id: string; name: string; role: string }
export interface ApiUltrasoundAuditEntry {
  id: string
  createdAt: string
  action: ApiUltrasoundAuditAction
  userRole: string | null
  reason: string | null
  oldValuesJson: unknown
  newValuesJson: unknown
  user: { id: string; name: string; role?: string } | null
  entityId?: string | null
  order?: { id: string; examType: string; patient: { firstName: string; lastName: string; mrNumber: string } } | null
}
export interface ApiUltrasoundAuditFilters { page?: number; limit?: number; from?: string; to?: string; userId?: string; action?: ApiUltrasoundAuditAction; search?: string }
export interface ApiUltrasoundAuditPage { items: ApiUltrasoundAuditEntry[]; total: number; page: number; limit: number }
export interface ApiCreateLabOrderInput { patientId: string; doctorId?: string; testId: string; priority?: "ROUTINE" | "URGENT" | "EMERGENCY"; sampleType?: string; clinicalNotes?: string; consultationId?: string; admissionId?: string; discountPercent?: number; discountReason?: string; referringClinicAccountId?: string }
export interface ApiCreateLabPackageOrderInput { patientId: string; doctorId?: string; packageId: string; priority?: "ROUTINE" | "URGENT" | "EMERGENCY"; sampleType?: string; clinicalNotes?: string; consultationId?: string; discountPercent?: number; discountReason?: string; referringClinicAccountId?: string }
export interface ApiLabPackageOrderResult { orders: ApiLabOrder[]; invoice: ApiInvoice }
export interface ApiLabBillingSettings { requirePaymentBeforeCollection: boolean }
export type ApiLabSampleStatus = "SAMPLE_COLLECTED" | "PROCESSING" | "CANCELLED"
export interface ApiLabResultInput {
  parameters?: Array<{ parameterId: string; value: string; overriddenInterpretation?: ApiLabParameterInterpretation; overrideReason?: string }>
  resultValue?: string
  unit?: string
  referenceRange?: string
  interpretation?: "NORMAL" | "HIGH" | "LOW" | "CRITICAL"
  technicianNotes?: string
  reportRemarks?: string
  inventoryOverrideReason?: string
  expectedUpdatedAt?: string
}

export function getPrescriptionShareUrl(token: string, resource: "verify" | "pdf") {
  return `${API_BASE_URL}/prescriptions/shared/${encodeURIComponent(token)}/${resource}`
}

export interface ApiPrescriptionShare {
  id: string
  token: string
  expiresAt: string
}

export interface ApiPrescriptionTemplate {
  id: string
  name: string
  items: PrescriptionItem[]
  updatedAt: string
}

export interface ApiPrescriptionTemplateInput {
  name: string
  items: Array<{
    medicine: string
    medicineId?: string
    doseAmount: string
    doseUnit: string
    route: string
    frequencyCode: string
    durationValue: string
    durationUnit: string
    instructions?: string
  }>
}

export interface ApiConsultationAddendum {
  id: string
  consultationId: string
  authorId: string
  note: string
  createdAt: string
  author: { name: string }
}

export interface ApiConsultationVitalsInput {
  bp_systolic?: number
  bp_diastolic?: number
  temperature?: number
  temperature_unit?: "F" | "C"
  pulse?: number
  weight?: number
  oxygen_saturation?: number
  respiratory_rate?: number
  height_cm?: number
  critical_confirmed?: boolean
}

export interface ApiCreateConsultationInput {
  appointmentId: string
  chiefComplaint?: string
  vitals?: ApiConsultationVitalsInput
  diagnosis?: string
  diagnosisCode?: string
  findings?: string
  clinicalNotes?: string
  followUpDate?: string
  followUpInstructions?: string
  referral?: string
}

export type ApiUpdateConsultationInput = Partial<Omit<ApiCreateConsultationInput, "appointmentId">> & {
  appointmentId?: string
}

export interface ApiConsultation {
  id: string
  appointmentId: string
  chiefComplaint?: string | null
  bpSystolic?: number | null
  bpDiastolic?: number | null
  temperature?: number | null
  temperatureUnit?: "F" | "C" | null
  pulse?: number | null
  weight?: number | null
  oxygenSaturation?: number | null
  respiratoryRate?: number | null
  heightCm?: number | null
  isCritical?: boolean
  criticalConfirmed?: boolean
  vitalsEstimated?: boolean
  vitalsJson?: Record<string, number> | null
  diagnosis?: string | null
  diagnosisCode?: string | null
  findings?: string | null
  clinicalNotes?: string | null
  followUpDate?: string | null
  followUpInstructions?: string | null
  referral?: string | null
  prescriptionStatus: "DRAFT" | "SIGNED" | "COMPLETED"
  signedAt?: string | null
  patientId?: string
  doctorId?: string
  patient?: { id: string; mrNumber: string; firstName: string; lastName: string; age?: number | null; gender?: string | null }
  updatedAt?: string
  addenda?: ApiConsultationAddendum[]
  appointment?: { id?: string; tokenNumber: number; appointmentDate: string; timeSlot?: string; status: AppointmentStatus }
  doctor?: { id?: string; user: { id?: string; name: string; role?: string }; department: { name: string } | null }
  prescriptions?: Array<{
    id: string
    status: "DRAFT" | "SIGNED" | "COMPLETED"
    signedAt?: string | null
    items: Array<{
      id: string
      medicineName: string
      dosage?: string
      doseAmount?: number | null
      doseUnit?: string | null
      route?: string
      frequency?: string
      durationDays?: number
      durationValue?: number | null
      durationUnit?: string | null
      instructions?: string | null
      medicine?: { name: string; strength?: string | null; form?: string | null } | null
    }>
  }>
  labOrders?: Array<{ id: string; status: string; orderedAt: string; test: { testName: string; testCode: string } }>
  ultrasoundOrders?: Array<{ id: string; status: string; createdAt: string; examType: string; findings?: string | null; impression?: string | null }>
}

export interface ApiInvoiceItem {
  id: string
  itemType: "CONSULTATION" | "LAB" | "MEDICINE" | "WARD" | "OT" | "OTHER"
  description: string
  quantity: number
  unitPrice: number | string
  discount: number | string
  subtotal?: number | string
  sourceType?: string | null
  sourceId?: string | null
  sourceDepartment?: ApiInvoiceDepartment | null
  admissionId?: string | null
  bedId?: string | null
  dayIndex?: number | null
  serviceCategory?: string | null
  serviceDate?: string | null
  reversedAt?: string | null
  reversalReason?: string | null
  reversedBy?: string | null
  createdAt?: string
}

export interface ApiPayment {
  id: string
  type?: "PAYMENT" | "REFUND"
  purpose?: "DEPOSIT" | "PAYMENT"
  paymentMethod: "CASH" | "CARD" | "BANK_TRANSFER" | "MOBILE_WALLET" | "ONLINE"
  amount: number | string
  referenceNumber?: string | null
  notes?: string | null
  reason?: string | null
  paymentDate?: string
  createdAt: string
  receivedBy?: string
  reversed?: boolean
}

export interface ApiInvoice {
  id: string
  invoiceNumber: string
  department?: ApiInvoiceDepartment | null
  appointmentId?: string | null
  admissionId?: string | null
  patientId: string
  patient?: { id: string; mrNumber: string; firstName: string; lastName: string } | null
  status: "DRAFT" | "FINALIZED" | "PAID" | "PARTIAL" | "REFUNDED" | "PARTIALLY_REFUNDED" | "UNPAID" | "VOID"
  grandTotal: number | string
  subtotal?: number | string
  discountAmount?: number | string
  taxAmount?: number | string
  paidAmount: number | string
  balanceAmount: number | string
  voidReason?: string | null
  voidedAt?: string | null
  voidedBy?: string | null
  voidedByName?: string | null
  labPackageId?: string | null
  createdAt: string
  createdBy?: string
  items: ApiInvoiceItem[]
  payments: ApiPayment[]
}

export interface ApiBillingStaff {
  id: string
  name: string
}

export interface ApiBillingSummary {
  departments: Array<{
    department: ApiInvoiceDepartment
    invoiced: number | string
    collected: number | string
    refunded: number | string
    netCollected?: number | string
    outstanding: number | string
  }>
  billedViaIpd: Array<{
    sourceDepartment: ApiInvoiceDepartment | null
    amount: number | string
  }>
}

export interface ApiCreateInvoiceInput {
  patientId: string
  department: ApiInvoiceDepartment
  appointmentId?: string
  admissionId?: string
  items: Array<{ itemType: ApiInvoiceItem["itemType"]; description: string; quantity: number; unitPrice: number; discount: number; discountType?: "FLAT" | "PERCENTAGE" }>
}

export type ApiInvoiceDepartment = "RECEPTION" | "LAB" | "PHARMACY" | "ULTRASOUND" | "IPD"

export interface ApiRecordPaymentInput {
  paymentMethod: ApiPayment["paymentMethod"]
  amount: number
  referenceNumber?: string
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
  supplierId?: string | null
  supplier?: { id: string; name: string; phone?: string | null; email?: string | null } | null
}

export interface ApiMedicine {
  id: string
  name: string
  genericName?: string | null
  strength?: string | null
  form?: string | null
  barcode?: string | null
  unitType?: "TABLET" | "CAPSULE" | "SYRUP" | "INJECTION" | "STRIP" | string
  manufacturer?: string | null
  categoryId?: string | null
  category?: ApiMedicineCategory | null
  isActive?: boolean
  batches: ApiMedicineBatch[]
}

export interface ApiCreateMedicineInput {
  name: string
  genericName?: string
  barcode?: string | null
  strength?: string
  form?: string
  unitType?: "TABLET" | "CAPSULE" | "SYRUP" | "INJECTION" | "STRIP" | string
  manufacturer?: string
  categoryId?: string
  initialBatch?: {
    batchNumber: string
    expiryDate: string
    purchasePrice: number
    sellingPrice: number
    stockQuantity?: number
    reorderLevel?: number
  }
}
export interface ApiAddBatchInput {
  medicineId: string
  batchNumber: string
  expiryDate: string
  purchasePrice: number
  sellingPrice: number
  stockQuantity: number
  reorderLevel?: number
}
export interface ApiStockInInput {
  batchId?: string
  medicineId?: string
  batchNumber?: string
  expiryDate?: string
  quantity: number
  purchasePrice?: number
  sellingPrice?: number
  reorderLevel?: number
  supplierName?: string
  invoiceReference?: string
  reason?: string
}
export interface ApiDispenseInput { prescriptionItemId: string; quantity: number }
export interface ApiCreatePharmacySaleInput {
  items: Array<{ medicineId: string; quantity: number; unitPrice?: number; discount: number }>
  tax: number
  paymentMethod: ApiPayment["paymentMethod"] | "CREDIT"
  paidNow?: number
  paidNowMethod?: "CASH" | "CARD" | "BANK_TRANSFER" | "MOBILE_WALLET"
  patientId?: string
  customerName?: string
  customerPhone?: string
  discountReason?: string
}
export interface ApiPharmacySaleItem { id: string; medicineId: string; batchId: string; quantity: number; unitPrice: number | string; discount: number | string; subtotal: number | string; medicine: { name: string }; batch: ApiMedicineBatch }
export interface ApiPharmacySale { id: string; cashierId?: string; cashier: { id: string; name: string }; totalAmount: number | string; subtotal?: number | string; discountAmount?: number | string; taxAmount?: number | string; paymentMethod: ApiPayment["paymentMethod"] | "CREDIT"; customerName?: string | null; customerPhone?: string | null; items: ApiPharmacySaleItem[]; invoice: ApiInvoice }

export interface ApiPharmacySettingsInput {
  name: string
  address: string
  phone: string
  currency: "PKR"
  defaultReceiptFormat: "a4" | "receipt"
  cashierMaxDiscountPercent: number
  lossAlertThreshold: number
  defaultLowStockLevel: number
}

export interface ApiPharmacySettings extends ApiPharmacySettingsInput {
  logoUrl: string | null
  adminPinConfigured: boolean
  lastBackupAt: string | null
}

export interface ApiPharmacySaleAdjustmentItem {
  id: string
  saleItemId: string
  batchId: string
  quantity: number
  returnedToStock: boolean
  saleItem?: { medicine: { name: string } }
}

export interface ApiPharmacySaleAdjustment {
  id: string
  saleId: string
  invoiceId: string
  type: "VOID" | "RETURN"
  reason: string
  refundAmount: number | string
  createdAt: string
  invoice: { id: string; invoiceNumber: string }
  sale?: { customerName?: string | null; customerPhone?: string | null }
  actor: { id: string; name: string }
  items: ApiPharmacySaleAdjustmentItem[]
}

export interface ApiPharmacyInvoice extends ApiInvoice {
  pharmacySale: ApiPharmacySale & {
    dispensedBy: Array<{ id: string; name: string }>
    adjustments: ApiPharmacySaleAdjustment[]
  }
}

export interface ApiPharmacySaleReturnInput {
  reason: string
  items: Array<{ saleItemId: string; quantity: number; returnToStock: boolean }>
}

export interface ApiCreatePharmacyLedgerAccountInput {
  type: "RECEIVABLE" | "PAYABLE"
  patientId?: string
  customerName?: string
  customerPhone?: string
}

export interface ApiPharmacyLedgerAccount {
  id: string
  type: "RECEIVABLE" | "PAYABLE"
  patientId: string | null
  customerName: string
  customerPhone: string | null
  createdAt: string
  patient: Pick<ApiPatient, "id" | "mrNumber" | "firstName" | "lastName" | "phone"> | null
  balance: number | string
  lastActivity: ApiPharmacyLedgerEntry | null
}

export interface ApiPharmacyLedgerEntry {
  id: string
  accountId: string
  invoiceId: string | null
  type: "SALE_ON_CREDIT" | "PAYMENT_RECEIVED" | "PAYMENT_MADE" | "ADJUSTMENT"
  amount: number | string
  balanceAfter: number | string
  paymentMethod: ApiPayment["paymentMethod"] | null
  notes: string | null
  createdBy: string
  createdAt: string
  creator?: { id: string; name: string }
  invoice?: { id: string; invoiceNumber: string } | null
}

export interface ApiPharmacyLedgerAccountList {
  items: ApiPharmacyLedgerAccount[]
  pagination: ApiReportPagination
  summary: { receivable: number; payable: number }
}

export interface ApiPharmacyLedger {
  account: Omit<ApiPharmacyLedgerAccount, "balance" | "lastActivity">
  balance: number
  entries: ApiPharmacyLedgerEntry[]
  pagination: ApiReportPagination
}

export interface ApiPharmacyLedgerPaymentInput {
  amount: number
  paymentMethod: ApiPayment["paymentMethod"]
  notes?: string
}

export interface ApiPharmacyLedgerAdjustmentInput {
  amount: number
  notes: string
}

export interface ApiReportPagination {
  page: number
  limit: number
  total: number
  pages: number
}

export interface ApiPharmacyReportBatch {
  medicineName: string
  genericName: string | null
  batchNumber: string
  stockQuantity: number
  reorderLevel: number
  expiryDate: string
}

export interface ApiPharmacyReportParams {
  period?: "today" | "yesterday" | "week" | "month" | "all" | "custom"
  from?: string
  to?: string
  expiryDays?: number
  limit?: number
  categoriesPage?: number
  topMedicinesPage?: number
  lowStockPage?: number
  expiringPage?: number
  expiredPage?: number
  cashiersPage?: number
  paymentMethodsPage?: number
}

export interface ApiPharmacyReports {
  period: NonNullable<ApiPharmacyReportParams["period"]>
  dateRange: { from?: string; to?: string }
  summary: {
    totalSalesRevenue: number
    transactions: number
    discountsGiven: number
    taxesCollected: number
    returns: number
    netRevenue: number
    grossProfit: number
  }
  categories: { items: Array<{ name: string; quantity: number; revenue: number }>; pagination: ApiReportPagination }
  topMedicines: { items: Array<{ id: string; name: string; genericName: string | null; quantity: number; revenue: number }>; pagination: ApiReportPagination }
  lowStock: { items: ApiPharmacyReportBatch[]; pagination: ApiReportPagination }
  expiringSoon: { items: ApiPharmacyReportBatch[]; pagination: ApiReportPagination; days: number }
  expiredStock: { items: ApiPharmacyReportBatch[]; pagination: ApiReportPagination }
  salesByCashier: { items: Array<{ id: string; name: string; transactions: number; revenue: number }>; pagination: ApiReportPagination }
  salesByPaymentMethod: { items: Array<{ paymentMethod: string; transactions: number; revenue: number }>; pagination: ApiReportPagination }
}

export interface ApiPharmacyOverview {
  today: { date: string; sales: number; transactions: number }
  lowStock: {
    count: number
    items: Array<{ medicineId: string; medicineName: string; genericName: string | null; batchNumber: string; stockQuantity: number; reorderLevel: number }>
  }
  expiring: { count: number }
  expired: { count: number }
  inventoryValue: { cost: number; selling: number; units: number }
  recentSales: Array<{ id: string; invoiceId: string; invoiceNumber: string; createdAt: string; itemCount: number; paymentMethod: string; amount: number }>
}

export interface ApiPharmacyDiscountAudit {
  id: string
  invoiceId: string
  discountPercent: number | string
  discountAmount: number | string
  reason?: string | null
  createdAt: string
  invoice: { invoiceNumber: string }
  cashier: { id: string; name: string }
  approvingAdmin: { id: string; name: string } | null
}
export interface ApiCreatePrescriptionInput {
  consultationId?: string
  patientId?: string
  doctorId?: string
  status?: "DRAFT" | "SIGNED"
  padData?: {
    visitNumber?: string
    visitDate?: string
    visitTime?: string
    relationship?: string
    patientAddress?: string
    patientContact?: string
    patientAge?: number
    patientGender?: "MALE" | "FEMALE" | "OTHER"
    patientWeight?: string
    vitals?: Record<string, unknown>
    allergies?: string
    presentingComplaints?: string
    history?: string
    findings?: string
    investigations?: string
    refillNumber?: number
  }
  items: Array<{
    medicineId?: string
    isCatalogItem?: boolean
    medicineName: string
    dosage?: string
    doseAmount?: number
    doseUnit?: string
    route: string
    frequency?: string
    frequencyCode?: string
    durationDays?: number
    durationValue?: number
    durationUnit?: string
    instructions?: string
  }>
  allergyOverrides?: string[]
}
export interface ApiReturnStockInput { batchId: string; quantity: number; reason: string }
export interface ApiAdjustStockInput { batchId: string; quantity: number; reason: string }
export interface ApiWriteOffInput { batchId: string; quantity: number; type: "DAMAGED" | "EXPIRED"; reason: string }

export interface ApiStockMovement {
  id: string
  movementType: "IN" | "OUT" | "ADJUSTMENT" | "RETURN" | "EXPIRED" | "DAMAGED" | "VOID"
  quantity: number
  reason?: string | null
  createdAt: string
  invoiceReference?: string | null
  batch: { id?: string; medicineId: string; batchNumber?: string; medicine: { id?: string; name: string } }
  createdByUser?: { id?: string; name: string } | null
  invoice?: { invoiceNumber: string } | null
  patient?: { name: string; mrNumber: string } | null
}

export interface ApiPrescriptionItem {
  id: string
  medicineId?: string | null
  medicine?: { genericName?: string | null } | null
  isCatalogItem?: boolean
  requiresPharmacistReview?: boolean
  medicineName: string
  dosage?: string
  doseAmount?: number | null
  doseUnit?: string | null
  route?: string
  frequency?: string
  frequencyCode?: string | null
  durationDays?: number
  durationValue?: number | null
  durationUnit?: string | null
  instructions?: string | null
  quantityDispensed: number
}
export interface ApiPrescription {
  id: string
  consultationId?: string | null
  patientId: string
  doctorId: string
  status: "DRAFT" | "SIGNED" | "COMPLETED" | "VOID" | "DISPENSED" | "PARTIALLY_DISPENSED"
  createdAt: string
  updatedAt?: string
  signedAt?: string | null
  items: ApiPrescriptionItem[]
  refillNumber?: number
  allergies?: string | null
  presentingComplaints?: string | null
  history?: string | null
  findings?: string | null
  investigations?: string | null
  vitalsJson?: Record<string, unknown> | null
  patientAddress?: string | null
  patientContact?: string | null
  patientAge?: number | null
  patientGender?: "MALE" | "FEMALE" | "OTHER" | null
  patientWeight?: string | null
  configurationSnapshot?: Record<string, unknown> | null
  patient?: { firstName: string; lastName: string; mrNumber?: string; phone?: string | null }
  doctor?: { user: { name: string } }
  consultation?: {
    id: string
    followUpDate?: string | null
    followUpInstructions?: string | null
    appointment?: {
      tokenNumber?: number | null
      appointmentDate?: string | null
    } | null
    doctor?: {
      user: {
        name: string
      }
    } | null
  } | null
}

export interface ApiAuditLog {
  id: string
  module: string
  entityType: string
  entityId: string
  action: string
  details?: unknown
  createdAt: string
  user: { name: string; role: string } | null
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
  assistantSurgeon?: { user: { name: string } } | null
  otRoom: { name: string }
  status: string
  priority?: "ELECTIVE" | "URGENT" | "EMERGENCY"
  anesthesiaType?: string | null
  notes?: string | null
  preOpChecklistJson?: Record<string, boolean>
  actualStart?: string | null
  actualEnd?: string | null
  admissionId?: string | null
  otCharge?: number | null
}
export interface ApiOTSummary { todaysSurgeries: number; inProgress: number; completedToday: number; conflicts: number }
export interface ApiOTRoom { id: string; name: string; isActive: boolean }
export interface ApiOTRoomInput { name: string; isActive: boolean }
export interface ApiScheduleSurgeryInput {
  patientId: string
  otRoomId: string
  surgeryType: string
  surgeonId: string
  scheduledStart: string
  scheduledEnd: string
  admissionId?: string
  anesthetistId?: string
  assistantSurgeonId?: string
  priority?: "ELECTIVE" | "URGENT" | "EMERGENCY"
  anesthesiaType?: string
  notes?: string
  preOpChecklist?: Record<string, boolean>
}
export interface ApiLowStockReport { medicineName: string; batchNumber: string; stockQuantity: number; reorderLevel: number }
export interface ApiNearExpiryReport { medicineName: string; batchNumber: string; expiryDate: string; stockQuantity: number }
export interface ApiPatientProfileData {
  patient: ApiPatient
  activeAdmission: ApiAdmission | null
  startableAppointments: ApiAppointment[]
  lastVitals: {
    recordedAt: string
    systolic: number | null
    diastolic: number | null
    pulse: number | null
    temperature: number | string | null
    temperatureUnit: string | null
    respiratoryRate: number | null
    weight: number | string | null
    oxygenSaturation: number | null
    heightCm: number | null
    estimated: boolean
  } | null
  consultations: ApiPatientProfileConsultation[]
  labOrders: Array<ApiLabOrder & { test: ApiLabTest; doctor?: { user: { name: string } } | null }>
  ultrasoundOrders: ApiUltrasoundOrder[]
  invoices: Array<ApiInvoice & {
    pharmacySale?: {
      createdAt: string
      totalAmount: number | string
      items: Array<{ id: string; quantity: number; medicine: { name: string } }>
    } | null
  }>
  admissions: ApiAdmission[]
  ledgerEntries: ApiPatientLedgerEntry[]
  surgeries: ApiSurgery[]
  prescriptions?: ApiPrescription[]
}

export type ApiPatientProfileConsultation = Omit<ApiConsultation, "appointment" | "doctor" | "prescriptions" | "labOrders" | "ultrasoundOrders"> & {
  appointment: { appointmentDate: string; tokenNumber: number; status: AppointmentStatus }
  doctor: { id: string; specialization?: string | null; user: { name: string }; department: { name: string } | null }
  prescriptions: ApiPrescription[]
  labOrders: Array<{ id: string; testId: string; test: { testName: string } }>
  ultrasoundOrders: Array<{ id: string; examType: string }>
}

export interface ApiPatientClinicalSummary {
  allergies: string[]
  allergiesReviewed: boolean
  chronicConditions: string[]
  chronicConditionsReviewed: boolean
  medicalHistory: string | null
  visits: Array<{ date: string; doctor: string; diagnosis: string | null; appointmentId: string }>
  lastPrescription: null | {
    date: string
    signed: boolean
    medicines: ApiPatientClinicalMedicine[]
  }
  previouslyPrescribedMedicines: ApiPatientClinicalMedicine[]
  vitals: Array<{
    date: string
    systolic: number | null
    diastolic: number | null
    pulse: number | null
    temperature: number | null
    temperatureUnit: string | null
    respiratoryRate: number | null
    weight: number | null
    oxygenSaturation: number | null
    heightCm: number | null
    estimated: boolean
    isCritical: boolean
  }>
  labResults: Array<{ test: string; status: string; result: string | null; flag: string | null; date: string }>
  ultrasounds: Array<{ id: string; type: string; status: string; date: string; result: string | null }>
  currentAdmission: null | { ward: string; bed: string; since: string }
  outstandingBalance: number
  hasCriticalVitals: boolean
  hasAbnormalLab: boolean
}

export interface ApiPatientClinicalMedicine {
  medicineId: string | null
  name: string
  dose: string
  doseAmount: number | null
  doseUnit: string
  route: string
  frequency: string
  frequencyCode: string
  duration: string
  durationValue: number
  durationUnit: string
  date: string
  signed: boolean
}

export interface ApiPatientLedgerEntry {
  id: string
  type: "ADVANCE_DEPOSIT"
  admissionId: string
  invoiceId?: string | null
  paymentId?: string | null
  amount: number | string
  paymentMethod: ApiPayment["paymentMethod"]
  notes?: string | null
  createdAt: string
}

export interface ApiPatientPrintSummary {
  patient: ApiPatient
  chronicConditions: string[]
  medicines: Array<{ medicineName: string; dosage: string; frequency: string; durationDays: number; prescribedAt: string }>
  recentVisits: Array<{ id: string; visitDate: string; diagnosis?: string | null; chiefComplaint?: string | null; doctorSpecialty?: string | null; completedAt?: string | null }>
  labResults: Array<{ id: string; testName: string; resultValue: string; unit?: string | null; referenceRange?: string | null; interpretation?: string | null; createdAt: string }>
  ultrasoundResults: Array<{ id: string; examinationType: string; conclusion?: string | null; completedAt?: string | null }>
  lastVitals: {
    recordedAt: string
    systolic?: number | null
    diastolic?: number | null
    pulse?: number | null
    temperature?: number | string | null
    temperatureUnit?: string | null
    respiratoryRate?: number | null
    weight?: number | string | null
    oxygenSaturation?: number | null
    heightCm?: number | null
    estimated: boolean
    critical: boolean
  } | null
  admissions: Array<{ id: string; admissionDate: string; dischargeDate?: string | null; status: string; admissionReason: string; bed: { bedNumber: string; room: { roomNumber: string; ward: { wardName: string } } } }>
  surgeries: Array<{ id: string; surgeryType: string; scheduledStart: string; status: string }>
  balance: number
}

export interface ApiDischargePrintData {
  admission: ApiAdmission & {
    admissionDate: string
    dischargeDate?: string | null
    dischargeDetails?: ApiDischargeDetails | null
    dischargeSummary?: string | null
    patient: ApiPatient
    attendingDoctor: { specialization?: string | null; user: { id: string; name: string; staffProfile?: { signatureUrl?: string | null; stampUrl?: string | null } | null } }
  }
  procedures: Array<{ id: string; surgeryType: string; scheduledStart: string; status: string; surgeon: { specialization?: string | null; user: { name: string } } }>
  labResults: Array<{ id: string; testName: string; resultValue: string; unit?: string | null; referenceRange?: string | null; createdAt: string; orderedAt: string }>
  ultrasoundResults: Array<{ id: string; examinationType: string; conclusion?: string | null; completedAt?: string | null }>
  outstandingBalance: number
}

export interface ApiAdmissionSlipPrintData {
  id: string
  admissionDate: string
  admissionType: string
  admissionReason: string
  admissionNotes?: string | null
  depositAmount: number | string
  depositStatus: string
  dailyRate: number | string
  status: string
  patient: ApiPatient
  bed: {
    id: string
    bedNumber: string
    bedLabel?: string | null
    dailyRate: number | string
    room: {
      roomNumber: string
      ward: {
        id: string
        wardName: string
        wardType: ApiWardType
      }
    }
  }
  attendingDoctor: {
    id: string
    specialization?: string | null
    qualification?: string | null
    user: {
      id: string
      name: string
      staffProfile?: {
        signatureUrl?: string | null
        stampUrl?: string | null
      } | null
    }
  }
}

export interface ApiConsultationPrescriptionPrintData {
  id: string
  diagnosis?: string | null
  chiefComplaint?: string | null
  findings?: string | null
  clinicalNotes?: string | null
  bpSystolic?: number | null
  bpDiastolic?: number | null
  pulse?: number | null
  temperature?: number | null
  temperatureUnit?: string | null
  respiratoryRate?: number | null
  weight?: number | null
  oxygenSaturation?: number | null
  heightCm?: number | null
  vitalsEstimated: boolean
  followUpDate?: string | null
  followUpInstructions?: string | null
  patient: ApiPatient
  appointment: { appointmentDate: string; timeSlot: string; tokenNumber: number; gender?: string | null }
  doctor: { id: string; qualification?: string | null; specialization?: string | null; user: { id: string; name: string; staffProfile?: { qualification?: string | null; signatureUrl?: string | null; stampUrl?: string | null } | null }; prescriptionPadConfig?: unknown }
  prescription: ApiPrescription
}

export interface ApiDoctorProductivityReport { doctorId: string; doctorName: string; consultationCount: number }

const otStatusMap: Record<string, OTStatus> = { SCHEDULED: "Scheduled", PRE_OP: "Pre-op", IN_PROGRESS: "In Progress", RECOVERY: "Recovery", COMPLETED: "Completed", CANCELLED: "Cancelled" }
const checklistLabels: Record<string, string> = {
  consent_form_confirmed: "Consent signed", fasting_confirmed: "NPO confirmed",
  blood_arranged: "Blood arranged", identity_verified: "Site marking verified",
  allergies_checked: "Allergies checked", pre_op_vitals_recorded: "Pre-op vitals recorded",
  required_reports_reviewed: "Labs done",
}

export function toSurgery(surgery: ApiSurgery): Surgery {
  const start = new Date(surgery.scheduledStart)
  const end = new Date(surgery.scheduledEnd)
  const checklist = surgery.preOpChecklistJson ?? {}
  const patient = surgery.patient ?? { firstName: "Unknown", lastName: "Patient", mrNumber: "" }
  const patientName = `${patient.firstName ?? "Unknown"} ${patient.lastName ?? "Patient"}`.trim() || "Unknown Patient"
  return {
    id: surgery.id,
    mrNumber: patient.mrNumber ?? "",
    patientName,
    procedureName: surgery.surgeryType,
    surgeonId: surgery.surgeonId,
    surgeonName: surgery.surgeon?.user?.name ?? "Assigned surgeon",
    assistantSurgeonName: surgery.assistantSurgeon?.user?.name,
    priority: surgery.priority === "EMERGENCY" ? "Emergency" : surgery.priority === "URGENT" ? "Urgent" : "Elective",
    anesthesiaType: surgery.anesthesiaType ?? undefined,
    notes: surgery.notes ?? undefined,
    otRoom: surgery.otRoom?.name ?? "OT Room",
    scheduledDate: getHospitalDateKeyForTimestamp(surgery.scheduledStart),
    scheduledTime: new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Karachi",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(start),
    durationMinutes: Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000)),
    status: otStatusMap[surgery.status] ?? "Scheduled",
    preOpChecklist: Object.keys(checklistLabels).map((key) => ({ id: key, label: checklistLabels[key], done: Boolean(checklist[key]) })),
    activityLog: [],
    admissionId: surgery.admissionId ?? null,
    otCharge: surgery.otCharge ?? null,
  }
}

export async function keepSessionSignedIn(): Promise<boolean> {
  return (await refreshAccessToken()) !== null
}

export async function logoutAndClearSession(): Promise<void> {
  try {
    await api.logout()
  } finally {
    clearSession()
  }
}

const wardTypeMap: Record<ApiWardType, WardType> = { GENERAL: "General Ward", PRIVATE: "Private Room", ICU: "ICU" }
const admissionTypeMap: Record<ApiAdmissionType, AdmissionType> = { EMERGENCY: "Emergency", PLANNED: "Planned", REFERRAL: "Referral", TRANSFER: "Transfer", DAY_CARE: "Day care" }

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
    depositPending: activeAdmission?.depositStatus === "PENDING",
    roundDoneToday: activeAdmission?.roundDoneToday ?? false,
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
    outstandingBalance: Number(admission.outstandingBalance ?? 0),
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

export type ApiPatientInputLike = {
  id?: string
  mrNumber: string
  firstName: string
  lastName: string
  gender?: string | null
  phone?: string | null
  age?: number | null
  dateOfBirth?: string | null
  bloodGroup?: string | null
  address?: string | null
  email?: string | null
  cnic?: string | null
  allergies?: string[]
  emergencyContactPhone?: string | null
  emergencyContactName?: string | null
  notes?: string | null
  createdAt?: string
  lastVisit?: string | null
  balance?: number | string | null
}

export function toPatient(patient: ApiPatient | ApiPatientInputLike): Patient {
  const rawGender = patient.gender ? String(patient.gender).toUpperCase() : ""
  const gender: Gender = rawGender === "MALE" ? "Male" : rawGender === "FEMALE" ? "Female" : "Other"
  const formattedBloodGroup = formatBloodGroup(patient.bloodGroup as any)
  const bloodGroup: BloodGroup = formattedBloodGroup === "—" ? "O+" : formattedBloodGroup
  const address = patient.address?.trim()
  return {
    id: ("id" in patient && patient.id) ? patient.id : patient.mrNumber,
    mrNumber: patient.mrNumber,
    name: `${patient.firstName} ${patient.lastName}`.trim(),
    age: Math.max(0, Number(patient.age ?? 0)),
    gender,
    phone: normalizePakistaniPhone(patient.phone ?? ""),
    email: patient.email ?? undefined,
    address: !address || address.toLowerCase() === "none" ? undefined : address,
    cnic: patient.cnic ?? undefined,
    bloodGroup,
    allergies: patient.allergies ?? [],
    emergencyContact: patient.emergencyContactPhone ?? patient.emergencyContactName ?? "",
    notes: patient.notes ?? undefined,
    registeredAt: patient.createdAt ?? new Date().toISOString(),
    lastVisit: patient.lastVisit ?? undefined,
    balance: Number(patient.balance ?? 0),
    status: "Active" as const,
  }
}

export function toDoctor(doctor: ApiDoctor): Doctor {
  const schedule = typeof doctor.scheduleJson === "object" && doctor.scheduleJson !== null ? (doctor.scheduleJson as any).slotsPerDay || [] : []
  return {
    id: doctor.id,
    userId: doctor.user?.id ?? (doctor as any).userId,
    name: doctor.user?.name ?? "",
    department: doctor.department?.name ?? "General Medicine",
    designation: doctor.specialization ?? "Consultant",
    slotsPerDay: schedule,
  }
}

export function toAppointment(appointment: ApiAppointment): Appointment {
  const statusMap: Record<string, Appointment["status"]> = {
    PENDING_APPROVAL: "Pending Approval", CONFIRMED: "Confirmed", WAITING: "Waiting",
    IN_CONSULTATION: "In Consultation", DONE: "Done", COMPLETED: "Done", CANCELLED: "Cancelled", EXPIRED: "Expired", NO_SHOW: "No-show",
  }
  const typeMap: Record<string, Appointment["type"]> = { NEW: "New Visit", FOLLOW_UP: "Follow-up", CONSULTATION: "Consultation" }
  const rawGender = appointment.gender || appointment.patient.gender
  const genderMap: Record<string, "Male" | "Female" | "Other"> = {
    MALE: "Male",
    FEMALE: "Female",
    OTHER: "Other",
    Male: "Male",
    Female: "Female",
    Other: "Other",
  }
  const gender = rawGender ? genderMap[rawGender] : undefined
  const age = appointment.patient.age != null
    ? appointment.patient.age
    : appointment.patient.dateOfBirth
      ? Math.max(0, new Date().getFullYear() - new Date(appointment.patient.dateOfBirth).getFullYear())
      : undefined

  return {
    id: appointment.id,
    token: appointment.tokenNumber,
    mrNumber: appointment.patient.mrNumber,
    patientName: `${appointment.patient.firstName} ${appointment.patient.lastName}`.trim(),
    age,
    gender,
    doctorId: appointment.doctor.id,
    doctorName: appointment.doctor.user.name,
    department: appointment.doctor.department?.name ?? "General Medicine",
    date: appointment.appointmentDate ? appointment.appointmentDate.slice(0, 10) : "",
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
    ORDERED: "Ordered", SAMPLE_COLLECTED: "Sample Collected", PROCESSING: "Processing", COMPLETED: "Completed", VERIFIED: "Verified", CANCELLED: "Cancelled",
  }
  const priorityMap: Record<ApiLabOrder["priority"], Priority> = { ROUTINE: "Routine", URGENT: "Urgent", EMERGENCY: "Emergency" }
  const interpretationMap: Record<string, LabInterpretation> = { NORMAL: "Normal", HIGH: "High", LOW: "Low", CRITICAL: "Critical" }
  return {
    ...fallback,
    id: order.id,
    mrNumber: order.patient?.mrNumber ?? fallback?.mrNumber ?? "",
    patientName: order.patientName ?? (order.patient ? `${order.patient.firstName} ${order.patient.lastName}`.trim() : fallback?.patientName ?? ""),
    doctorName: order.doctor?.user.name ?? order.consultation?.doctor.user.name ?? fallback?.doctorName ?? "Unassigned",
    testName: order.test?.testName ?? fallback?.testName ?? "",
    orderDate: order.orderedAt,
    orderNumber: order.orderNumber ?? fallback?.orderNumber,
    priority: priorityMap[order.priority],
    status: statusMap[order.status],
    sampleCollectedAt: order.sampleCollectedAt ?? fallback?.sampleCollectedAt,
    criticalResult: order.criticalResult ?? fallback?.criticalResult,
    resultValue: result?.resultValue ?? fallback?.resultValue,
    resultUnit: result?.unit ?? fallback?.resultUnit,
    referenceRange: result?.referenceRange ?? fallback?.referenceRange,
    interpretation: result?.interpretation ? interpretationMap[result.interpretation] : fallback?.interpretation,
    technicianNotes: result?.technicianNotes ?? fallback?.technicianNotes,
    reportFileName: order.attachments?.at(-1)?.originalFilename ?? order.attachments?.at(-1)?.fileUrl.split("/").pop() ?? fallback?.reportFileName,
    verifiedBy: order.verifier?.name ?? fallback?.verifiedBy,
    verifiedDesignation: order.verifier?.staffProfile?.specialization ?? order.verifier?.staffProfile?.qualification ?? fallback?.verifiedDesignation,
    verifiedAt: order.verifiedAt ?? result?.verifiedAt ?? fallback?.verifiedAt,
  }
}

const invoiceCategoryMap: Record<ApiInvoiceItem["itemType"], Invoice["lineItems"][number]["category"]> = {
  CONSULTATION: "Consultation", LAB: "Lab", MEDICINE: "Medicine", WARD: "Ward", OT: "OT", OTHER: "Other",
}
const paymentMethodMap: Record<ApiPayment["paymentMethod"], Invoice["payments"][number]["method"]> = {
  CASH: "Cash", CARD: "Card", BANK_TRANSFER: "Bank Transfer", MOBILE_WALLET: "Mobile Wallet", ONLINE: "Online",
}

export function toInvoice(invoice: ApiInvoice, patient?: Patient): Invoice {
  const joinedPatient = invoice.patient
    ? { name: `${invoice.patient.firstName} ${invoice.patient.lastName}`.trim(), mrNumber: invoice.patient.mrNumber }
    : patient
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    department: invoice.department ?? "RECEPTION",
    grandTotal: Number(invoice.grandTotal),
    paidAmount: Number(invoice.paidAmount),
    balanceAmount: Number(invoice.balanceAmount),
    mrNumber: joinedPatient?.mrNumber ?? "",
    patientName: joinedPatient?.name ?? (invoice.patientId ? "Deleted patient" : "Walk-in customer"),
    date: invoice.createdAt,
    lineItems: invoice.items.map((item) => ({ id: item.id, category: invoiceCategoryMap[item.itemType], description: item.description, qty: item.quantity, unitPrice: Number(item.unitPrice), discount: Number(item.discount) })),
    payments: invoice.payments.map((payment) => ({ id: payment.id, type: payment.type ?? "PAYMENT", amount: Number(payment.amount), method: paymentMethodMap[payment.paymentMethod], date: payment.paymentDate ?? payment.createdAt, receivedBy: payment.receivedBy, referenceNumber: payment.referenceNumber ?? undefined, notes: payment.notes ?? undefined, reason: payment.reason ?? undefined, reversed: payment.reversed })),
    status: invoice.status === "PAID" ? "Paid"
      : invoice.status === "PARTIAL" ? "Partial"
        : invoice.status === "REFUNDED" ? "Refunded"
          : invoice.status === "PARTIALLY_REFUNDED" ? "Partially Refunded"
            : invoice.status === "VOID" ? "Void" : "Unpaid",
    voidReason: invoice.voidReason ?? undefined,
    voidedAt: invoice.voidedAt ?? undefined,
    voidedBy: invoice.voidedByName ?? invoice.voidedBy ?? undefined,
    auditTrail: [],
  }
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __careplusApi?: unknown }).__careplusApi = { apiRequest, api }
}


