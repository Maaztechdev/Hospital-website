import * as React from "react"
import { useParams } from "react-router-dom"
import { Check, AlertOctagon, Download, Printer, Upload, ShieldCheck } from "lucide-react"
import QRCode from "qrcode"
import { DashboardPageHeader, NotPermitted } from "@/dashboard/components/Layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/dashboard/components/StatusBadge"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import type { LabInterpretation, LabOrderStatus } from "@/dashboard/types"
import type { ApiLabSampleRejectionReason } from "@/lib/api"
import { formatDate, formatDateTime } from "@/dashboard/lib/format"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { api, apiAssetUrl, describeApiError, getAccessToken, toLabOrder, type ApiLabOrder, type ApiLabParameterInterpretation, type ApiLabReferenceRange, type ApiLabReportSettings, type ApiLabResultInput, type ApiLabTestParameter } from "@/lib/api"

const STEPS: LabOrderStatus[] = ["Ordered", "Sample Collected", "Processing", "Completed", "Verified"]
type ParameterDraft = { parameterId: string; value: string; overriddenInterpretation: ApiLabParameterInterpretation | ""; overrideReason: string; valueError?: string; overrideError?: string }

function ageInDays(patient?: ApiLabOrder["patient"]) {
  if (patient?.dateOfBirth) return Math.floor((Date.now() - new Date(patient.dateOfBirth).getTime()) / 86_400_000)
  return patient?.age == null ? null : Math.floor(patient.age * 365.2425)
}

function resolvedRange(parameter: ApiLabTestParameter, detail?: ApiLabOrder | null, defaults?: ApiLabReportSettings["criticalThresholdDefaults"]) {
  const patient = detail?.patient
  const gender = patient?.gender === "MALE" || patient?.gender === "FEMALE" ? patient.gender : null
  const age = ageInDays(patient)
  const groups: ApiLabReferenceRange[][] = gender
    ? [parameter.ranges.filter((range) => range.gender === gender), parameter.ranges.filter((range) => range.gender === "ANY")]
    : [parameter.ranges.filter((range) => range.gender === "ANY")]
  for (const group of groups) {
    const matches = group.filter((range) => age == null
      ? range.ageMinDays == null && range.ageMaxDays == null
      : (range.ageMinDays == null || age >= range.ageMinDays) && (range.ageMaxDays == null || age <= range.ageMaxDays))
    matches.sort((left, right) => {
      const leftSpan = (left.ageMaxDays ?? Number.MAX_SAFE_INTEGER) - (left.ageMinDays ?? 0)
      const rightSpan = (right.ageMaxDays ?? Number.MAX_SAFE_INTEGER) - (right.ageMinDays ?? 0)
      return leftSpan - rightSpan
    })
    if (matches[0]) {
      const fallback = defaults?.[parameter.id]
      return {
        ...matches[0],
        criticalLow: matches[0].criticalLow ?? fallback?.criticalLow ?? null,
        criticalHigh: matches[0].criticalHigh ?? fallback?.criticalHigh ?? null,
      }
    }
  }
  return null
}

function numericRangeValue(value?: number | string | null) {
  return value == null ? null : Number(value)
}

function computedInterpretation(value: string, range: ApiLabReferenceRange | null): ApiLabParameterInterpretation | null {
  const numericValue = Number(value)
  if (!range || !value.trim() || !Number.isFinite(numericValue)) return null
  const criticalLow = numericRangeValue(range.criticalLow)
  const criticalHigh = numericRangeValue(range.criticalHigh)
  const low = numericRangeValue(range.low)
  const high = numericRangeValue(range.high)
  if (criticalLow != null && numericValue <= criticalLow) return "CRITICAL_LOW"
  if (criticalHigh != null && numericValue >= criticalHigh) return "CRITICAL_HIGH"
  if (low != null && numericValue < low) return "LOW"
  if (high != null && numericValue > high) return "HIGH"
  return "NORMAL"
}

function formatRange(range: ApiLabReferenceRange | null) {
  if (!range) return "No matching reference range"
  const low = numericRangeValue(range.low)
  const high = numericRangeValue(range.high)
  const normalRange = low == null && high == null ? "—" : `${low == null ? "—" : low} – ${high == null ? "—" : high}`
  const criticalLow = numericRangeValue(range.criticalLow)
  const criticalHigh = numericRangeValue(range.criticalHigh)
  if (criticalLow == null && criticalHigh == null) return normalRange
  return `${normalRange} (critical: ${criticalLow == null ? "—" : `≤ ${criticalLow}`} / ${criticalHigh == null ? "—" : `≥ ${criticalHigh}`})`
}

function interpretationLabel(value?: ApiLabParameterInterpretation | null) {
  if (!value) return "No range"
  return value === "CRITICAL_LOW" ? "Critical Low"
    : value === "CRITICAL_HIGH" ? "Critical High"
      : value[0] + value.slice(1).toLowerCase()
}

function interpretationFlag(value?: ApiLabParameterInterpretation | null) {
  if (value === "LOW") return { flag: "L", className: "text-amber-700" }
  if (value === "HIGH") return { flag: "H", className: "text-amber-700" }
  if (value === "CRITICAL_LOW" || value === "CRITICAL_HIGH") return { flag: "C", className: "text-[var(--cp-critical)]" }
  return null
}

function legacyInterpretation(value?: LabInterpretation): ApiLabParameterInterpretation | null {
  if (value === "Low") return "LOW"
  if (value === "High") return "HIGH"
  if (value === "Critical") return "CRITICAL_HIGH"
  if (value === "Normal") return "NORMAL"
  return null
}

function abnormalFlag(computed?: ApiLabParameterInterpretation | null, effective?: ApiLabParameterInterpretation | null) {
  const critical = new Set<ApiLabParameterInterpretation>(["CRITICAL_LOW", "CRITICAL_HIGH"])
  if ((computed && critical.has(computed)) || (effective && critical.has(effective))) return { flag: "C", className: "text-[var(--cp-critical)]" }
  return interpretationFlag(effective) ?? interpretationFlag(computed)
}

async function loadReportImageData(url?: string | null) {
  if (!url) return null
  const assetUrl = new URL(apiAssetUrl(url), window.location.origin)
  const apiOrigin = new URL(import.meta.env.VITE_API_URL ?? "http://localhost:4000/api/v1", window.location.origin).origin
  const token = getAccessToken()
  const headers = token && assetUrl.origin === apiOrigin ? { Authorization: `Bearer ${token}` } : undefined
  const response = await fetch(assetUrl, { headers })
  if (!response.ok) throw new Error(`Unable to load report image (${response.status})`)
  const bitmap = await createImageBitmap(await response.blob())
  const canvas = document.createElement("canvas")
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext("2d")
  if (!context) {
    bitmap.close()
    throw new Error("Unable to prepare report image")
  }
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas.toDataURL("image/png")
}

export default function LabOrderDetail() {
  const { orderId } = useParams()
  const { toast } = useToast()
  const { labOrders, patients, dispatch, currentUser } = useDashboard()
  const order = labOrders.find((l) => l.id === orderId)
  const orderRef = React.useRef(order)
  orderRef.current = order

  const [orderDetail, setOrderDetail] = React.useState<ApiLabOrder | null>(null)
  const [reportSettings, setReportSettings] = React.useState<ApiLabReportSettings | null>(null)
  const [verificationQr, setVerificationQr] = React.useState("")
  const [reportImages, setReportImages] = React.useState<{ logo: string | null; pathologistSignature: string | null; technicianSignature: string | null }>({ logo: null, pathologistSignature: null, technicianSignature: null })
  const [parameterDrafts, setParameterDrafts] = React.useState<ParameterDraft[]>([])
  const [resultValue, setResultValue] = React.useState(order?.resultValue ?? "")
  const [legacyError, setLegacyError] = React.useState("")
  const [unit, setUnit] = React.useState(order?.resultUnit ?? "")
  const [range, setRange] = React.useState(order?.referenceRange ?? "")
  const [interpretation, setInterpretation] = React.useState<LabInterpretation>(order?.interpretation ?? "Normal")
  const [notes, setNotes] = React.useState(order?.technicianNotes ?? "")
  const [reportRemarks, setReportRemarks] = React.useState("")
  const [fileName, setFileName] = React.useState(order?.reportFileName ?? "")
  const [savingResult, setSavingResult] = React.useState(false)
  const [activeTab, setActiveTab] = React.useState<"order" | "history">("order")
  const [amending, setAmending] = React.useState(false)
  const [amendReason, setAmendReason] = React.useState("")
  const [showRejectForm, setShowRejectForm] = React.useState(false)
  const [rejectionReason, setRejectionReason] = React.useState<ApiLabSampleRejectionReason>("HAEMOLYSED")
  const [otherRejectionReason, setOtherRejectionReason] = React.useState("")
  const [workingAction, setWorkingAction] = React.useState(false)
  const reportReady = Boolean(order?.resultValue || order?.status === "Completed" || order?.status === "Verified")

  React.useEffect(() => {
    if (!orderId) return
    api.getLabOrder(orderId).then((serverOrder) => {
      setOrderDetail(serverOrder)
      dispatch({ type: "UPDATE_LAB_ORDER", id: orderId, patch: toLabOrder(serverOrder, orderRef.current) })
      const latest = serverOrder.results?.filter((item) => !item.supersededById).sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))[0]
      setParameterDrafts((serverOrder.test?.parameters ?? []).map((parameter) => {
        const saved = latest?.parameters?.find((item) => item.parameterId === parameter.id)
        return { parameterId: parameter.id, value: saved?.value ?? "", overriddenInterpretation: saved?.overriddenInterpretation ?? "", overrideReason: saved?.overrideReason ?? "" }
      }))
      if (latest) {
        setResultValue(latest.resultValue)
        setUnit(latest.unit ?? "")
        setRange(latest.referenceRange ?? "")
        setNotes(latest.technicianNotes ?? "")
        setReportRemarks(latest.reportRemarks ?? "")
      }
    }).catch((cause) => toast({ title: "Unable to refresh lab order", description: describeApiError(cause), variant: "error" }))
  }, [orderId, dispatch, toast])

  React.useEffect(() => {
    api.getLabReportSettings()
      .then(setReportSettings)
      .catch((cause) => toast({ title: "Unable to load lab report settings", description: describeApiError(cause), variant: "error" }))
  }, [toast])

  React.useEffect(() => {
    let active = true
    Promise.all([
      loadReportImageData(reportSettings?.logoUrl),
      loadReportImageData(reportSettings?.pathologistSignatureUrl),
      loadReportImageData(reportSettings?.technicianSignatureUrl),
    ]).then(([logo, pathologistSignature, technicianSignature]) => {
      if (active) setReportImages({ logo, pathologistSignature, technicianSignature })
    }).catch((cause) => {
      if (active) toast({ title: "Unable to load a lab report image", description: describeApiError(cause), variant: "error" })
    })
    return () => { active = false }
  }, [reportSettings?.logoUrl, reportSettings?.pathologistSignatureUrl, reportSettings?.technicianSignatureUrl, toast])

  React.useEffect(() => {
    if (!order?.orderNumber) return
    const verificationUrl = new URL(`/lab-report-verification/${encodeURIComponent(order.orderNumber)}`, window.location.origin).toString()
    QRCode.toDataURL(verificationUrl, { margin: 1, width: 180 })
      .then(setVerificationQr)
      .catch((cause) => toast({ title: "Unable to create report verification QR code", description: describeApiError(cause), variant: "error" }))
  }, [order?.orderNumber, toast])

  if (!order) return <NotPermitted />
  const patient = patients.find((p) => p.mrNumber === order.mrNumber) ?? (orderDetail?.patient
    ? { name: `${orderDetail.patient.firstName} ${orderDetail.patient.lastName}`.trim(), age: orderDetail.patient.age, gender: orderDetail.patient.gender }
    : undefined)
  const stepIdx = STEPS.indexOf(order.status)
  const detailParameters = orderDetail?.test?.parameters ?? []
  const latestResult = orderDetail?.results?.filter((item) => !item.supersededById).sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))[0]
  const savedParameterRows = latestResult?.parameters ?? []
  const canVerify = currentUser?.role === "admin" || currentUser?.role === "pathologist"
  const canAmend = canVerify
  const canProcessSamples = currentUser?.role === "admin" || currentUser?.role === "lab_technician"
  const openRejection = orderDetail?.sampleRejections?.filter((rejection) => !rejection.recollectedAt).at(-1)
  const ageGenderNote = [
    !orderDetail?.patient?.gender || orderDetail.patient.gender === "OTHER"
      ? "Patient gender is other or missing; using the catalog's Any-gender reference range."
      : "",
    orderDetail?.patient?.age == null && !orderDetail?.patient?.dateOfBirth
      ? "Patient age is unavailable; only age-independent reference ranges can be resolved."
      : "",
  ].filter(Boolean).join(" ")

  async function refreshOrder() {
    const serverOrder = await api.getLabOrder(order!.id)
    setOrderDetail(serverOrder)
    dispatch({ type: "UPDATE_LAB_ORDER", id: order!.id, patch: toLabOrder(serverOrder, order) })
  }

  async function advanceTo(status: LabOrderStatus) {
    setWorkingAction(true)
    try {
      await api.updateLabSampleStatus(order!.id, status === "Sample Collected" ? "SAMPLE_COLLECTED" : "PROCESSING")
      await refreshOrder()
      toast({ title: `Order marked ${status}`, description: `${order!.testName} moved to ${status}.`, variant: "info" })
    } catch (cause) {
      toast({ title: "Unable to update lab order", description: describeApiError(cause), variant: "error" })
    } finally {
      setWorkingAction(false)
    }
  }

  async function cancelOrder() {
    if (!window.confirm(`Cancel lab order ${order!.orderNumber}?`)) return
    setWorkingAction(true)
    try {
      await api.updateLabSampleStatus(order!.id, "CANCELLED")
      await refreshOrder()
      toast({ title: "Lab order cancelled", variant: "info" })
    } catch (cause) {
      toast({ title: "Unable to cancel lab order", description: describeApiError(cause), variant: "error" })
    } finally {
      setWorkingAction(false)
    }
  }

  async function saveResult() {
    if (!reportSettings) {
      toast({ title: "Lab settings are not loaded", description: "Reload the order before saving or printing its report.", variant: "error" })
      return
    }
    if (order!.status === "Verified" && !amendReason.trim()) {
      toast({ title: "Amendment reason required", description: "Provide a reason before saving the amended report.", variant: "error" })
      return
    }
    const parameters = orderDetail?.test?.parameters ?? []
    if (parameters.length) {
      const nextDrafts = parameterDrafts.map((draft) => {
        const parameter = parameters.find((item) => item.id === draft.parameterId)
        const value = draft.value.trim()
        const numeric = parameter?.resultType === "NUMERIC"
        const valueError = !value ? "This parameter is required."
          : numeric && (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) ? "Enter a valid number."
            : undefined
        const overrideError = draft.overriddenInterpretation && !draft.overrideReason.trim() ? "Enter a reason for this interpretation override." : undefined
        return { ...draft, valueError, overrideError }
      })
      setParameterDrafts(nextDrafts)
      if (nextDrafts.some((draft) => draft.valueError || draft.overrideError)) return
    } else if (!resultValue.trim()) {
      setLegacyError("A result value is required.")
      return
    }
    setSavingResult(true)
    try {
      let payload: ApiLabResultInput = parameters.length
        ? { parameters: parameterDrafts.map(({ parameterId, value, overriddenInterpretation, overrideReason }) => ({
          parameterId, value,
          ...(overriddenInterpretation ? { overriddenInterpretation, overrideReason: overrideReason.trim() } : {}),
        })), technicianNotes: notes, reportRemarks }
        : { resultValue, unit, referenceRange: range, interpretation: interpretation.toUpperCase() as "NORMAL" | "HIGH" | "LOW" | "CRITICAL", technicianNotes: notes, reportRemarks }
      if (order!.status === "Verified") await api.amendLabResult(order!.id, { ...payload, reason: amendReason.trim() })
      else {
        try {
          await api.enterLabResult(order!.id, payload)
        } catch (cause) {
          if (!describeApiError(cause).includes("Lab inventory needs attention")) throw cause
          const overrideReason = window.prompt("Inventory warning: stock is insufficient or expired. Enter a reason to continue; available stock will be deducted FEFO.")
          if (!overrideReason?.trim()) throw cause
          payload = { ...payload, inventoryOverrideReason: overrideReason.trim() }
          await api.enterLabResult(order!.id, payload)
        }
      }
      await refreshOrder()
      setAmending(false)
      setAmendReason("")
      toast({ title: order!.status === "Verified" ? "Report amended" : "Result version saved", description: "Previous saved result versions remain in the order history.", variant: "success" })
    } catch (cause) {
      toast({ title: "Unable to save result", description: describeApiError(cause), variant: "error" })
    } finally {
      setSavingResult(false)
    }
  }

  async function verify() {
    setSavingResult(true)
    try {
      await api.verifyLabOrder(order!.id)
      await refreshOrder()
      toast({ title: "Result verified", description: "Report is now finalized and locked.", variant: "success" })
    } catch (cause) {
      toast({ title: "Unable to verify result", description: describeApiError(cause), variant: "error" })
    } finally {
      setSavingResult(false)
    }
  }

  async function rejectSample() {
    if (rejectionReason === "OTHER" && !otherRejectionReason.trim()) {
      toast({ title: "Rejection reason required", description: "Describe the reason for rejecting this sample.", variant: "error" })
      return
    }
    setWorkingAction(true)
    try {
      await api.rejectLabSample(order!.id, rejectionReason, otherRejectionReason.trim() || undefined)
      setShowRejectForm(false)
      setOtherRejectionReason("")
      await refreshOrder()
      toast({ title: "Sample rejected", description: "The order is ready for sample recollection.", variant: "info" })
    } catch (cause) {
      toast({ title: "Unable to reject sample", description: describeApiError(cause), variant: "error" })
    } finally {
      setWorkingAction(false)
    }
  }

  async function recollectSample() {
    if (!openRejection) return
    setWorkingAction(true)
    try {
      await api.recollectLabSample(order!.id, openRejection.id)
      await refreshOrder()
      toast({ title: "Replacement sample collected", variant: "success" })
    } catch (cause) {
      toast({ title: "Unable to recollect sample", description: describeApiError(cause), variant: "error" })
    } finally {
      setWorkingAction(false)
    }
  }

  async function printReport() {
    if (!reportReady) return
    if (!reportSettings?.labName.trim()) {
      toast({ title: "Lab identity is not configured", description: "Ask an Admin to complete Lab Settings before printing.", variant: "error" })
      return
    }
    try {
      await api.recordLabPrint(order!.id)
      await refreshOrder()
      setActiveTab("order")
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      window.print()
    } catch (cause) {
      toast({ title: "Unable to record report print", description: describeApiError(cause), variant: "error" })
    }
  }

  async function downloadReportPdf() {
    if (!reportReady) return
    if (!reportSettings?.labName.trim()) {
      toast({ title: "Lab identity is not configured", description: "Ask an Admin to complete Lab Settings before downloading.", variant: "error" })
      return
    }
    try {
      const { jsPDF } = await import("jspdf")
      const pdf = new jsPDF({ orientation: "portrait", format: "a4", unit: "mm" })
      await api.recordLabPrint(order!.id)
      const labName = reportSettings?.labName?.trim() ?? ""
      const labAddress = reportSettings?.address?.trim() ?? ""
      const labPhone = reportSettings?.phone?.trim() ?? ""
      const headerText = reportSettings?.headerText?.trim() ?? ""
      const footerText = [reportSettings?.footerText?.trim(), reportSettings?.reportsRetentionNote?.trim()].filter(Boolean).join("\n")
      const [logoData, pathologistSignatureData, technicianSignatureData] = await Promise.all([
        loadReportImageData(reportSettings?.logoUrl),
        loadReportImageData(reportSettings?.pathologistSignatureUrl),
        loadReportImageData(reportSettings?.technicianSignatureUrl),
      ])
      const orderNumber = order!.orderNumber ?? order!.id
      const verifyUrl = new URL(`/lab-report-verification/${encodeURIComponent(orderNumber)}`, window.location.origin).toString()
      const qrData = await QRCode.toDataURL(verifyUrl, { margin: 0, width: 160 })
      const pageWidth = pdf.internal.pageSize.getWidth()
      const margin = 14
      const contentBottom = 252
      const currentParameters = latestResult?.parameters ?? []
      const resultRows = currentParameters.length
        ? currentParameters.map((item) => {
          const effective = item.overriddenInterpretation ?? item.computedInterpretation
          const flag = abnormalFlag(item.computedInterpretation, effective)
          return { name: item.parameterName, value: item.value, unit: item.unit ?? "—", range: item.referenceRange ?? "—", flag: flag?.flag ?? "", abnormal: Boolean(flag), critical: flag?.flag === "C" }
        })
        : [{
          name: order!.testName,
          value: order!.resultValue ?? "",
          unit: order!.resultUnit ?? "—",
          range: order!.referenceRange ?? "—",
          flag: abnormalFlag(legacyInterpretation(order!.interpretation), legacyInterpretation(order!.interpretation))?.flag ?? "",
          abnormal: order!.interpretation !== "Normal",
          critical: order!.interpretation === "Critical",
        }]
      const patientName = orderDetail?.patient
        ? `${orderDetail.patient.firstName} ${orderDetail.patient.lastName}`.trim()
        : order!.patientName ?? "—"
      const patientAge = orderDetail?.patient?.dateOfBirth
        ? `${Math.floor((Date.now() - new Date(orderDetail.patient.dateOfBirth).getTime()) / 31_557_600_000)} years`
        : orderDetail?.patient?.age == null ? "—" : `${orderDetail.patient.age} years`
      const genderLabel = orderDetail?.patient?.gender?.toLocaleLowerCase() ?? "—"
      const technicianName = orderDetail?.technician?.name || reportSettings?.technicianName || "—"
      const pathologistName = orderDetail?.verifier?.name || reportSettings?.pathologistName || "—"
      const pathologistDesignation = orderDetail?.verifier?.staffProfile?.specialization ?? orderDetail?.verifier?.staffProfile?.qualification
      const reportedAt = latestResult?.createdAt ?? orderDetail?.completedAt ?? null

      const addRunningHeader = () => {
        pdf.setFont("helvetica", "bold")
        pdf.setFontSize(9)
        pdf.setTextColor(20, 70, 65)
        pdf.text(labName, margin, 10)
        pdf.setFont("helvetica", "normal")
        pdf.setTextColor(70, 80, 78)
        pdf.text(orderNumber, pageWidth - margin, 10, { align: "right" })
        if (headerText) pdf.text(pdf.splitTextToSize(headerText, pageWidth - margin * 2).slice(0, 1), margin, 16)
        pdf.setDrawColor(180, 195, 190)
        pdf.line(margin, 19, pageWidth - margin, 19)
      }
      const addPage = () => {
        pdf.addPage()
        addRunningHeader()
        y = 25
      }
      let y = 18
      if (logoData) pdf.addImage(logoData, "PNG", margin, y, 22, 22, undefined, "FAST")
      const headingX = logoData ? margin + 28 : margin
      pdf.setFont("helvetica", "bold")
      pdf.setFontSize(17)
      pdf.setTextColor(14, 92, 86)
      pdf.text(labName, headingX, y + 7)
      pdf.setFont("helvetica", "normal")
      pdf.setFontSize(9)
      pdf.setTextColor(40, 50, 48)
      if (labAddress) pdf.text(labAddress, headingX, y + 13)
      if (labPhone) pdf.text(labPhone, headingX, y + 18)
      let brandBottom = y + (logoData ? 25 : 20)
      if (reportSettings?.accreditationLine?.trim()) {
        pdf.setFontSize(8)
        pdf.text(reportSettings.accreditationLine.trim(), headingX, brandBottom)
        brandBottom += 5
      }
      if (headerText) {
        pdf.setFontSize(8)
        const headerLines = pdf.splitTextToSize(headerText, pageWidth - margin * 2) as string[]
        pdf.text(headerLines, margin, brandBottom)
        brandBottom += headerLines.length * 4
      }
      y = Math.max(y + (logoData ? 31 : 27), brandBottom + 3)
      pdf.setDrawColor(14, 92, 86)
      pdf.setLineWidth(0.6)
      pdf.line(margin, y, pageWidth - margin, y)
      y += 8
      pdf.setFont("helvetica", "bold")
      pdf.setFontSize(13)
      pdf.setTextColor(20, 30, 28)
      pdf.text("Laboratory Report", margin, y)
      if (order!.status !== "Verified") {
        pdf.setTextColor(170, 30, 30)
        pdf.text("PRELIMINARY", pageWidth - margin, y, { align: "right" })
      } else if (latestResult?.amendedAt) {
        pdf.setTextColor(170, 90, 0)
        pdf.text(`AMENDED · ${formatDateTime(latestResult.amendedAt)}`, pageWidth - margin, y, { align: "right" })
      }
      y += 8

      const metadata = [
        ["Patient", patientName], ["MR Number", orderDetail?.patient?.mrNumber ?? order!.mrNumber ?? "—"],
        ["Age / Gender", `${patientAge} / ${genderLabel}`], ["Referring Doctor", orderDetail?.doctor?.user.name ?? order!.doctorName ?? "—"],
        ["Sample ID / Barcode", orderNumber], ["Sample Type", orderDetail?.sampleType ?? orderDetail?.test?.sampleType ?? "—"],
        ["Collected At", orderDetail?.sampleCollectedAt ? formatDateTime(orderDetail.sampleCollectedAt) : "—"],
        ["Reported At", reportedAt ? formatDateTime(reportedAt) : "—"],
        ["Verified At", orderDetail?.verifiedAt ? formatDateTime(orderDetail.verifiedAt) : "Not verified"],
      ]
      pdf.setFontSize(8)
      for (let index = 0; index < metadata.length; index += 2) {
        const [leftLabel, leftValue] = metadata[index]
        const [rightLabel, rightValue] = metadata[index + 1] ?? ["", ""]
        pdf.setFont("helvetica", "bold")
        pdf.text(`${leftLabel}:`, margin, y)
        pdf.setFont("helvetica", "normal")
        pdf.text(pdf.splitTextToSize(leftValue, 62), margin + 25, y)
        if (rightLabel) {
          pdf.setFont("helvetica", "bold")
          pdf.text(`${rightLabel}:`, 108, y)
          pdf.setFont("helvetica", "normal")
          pdf.text(pdf.splitTextToSize(rightValue, 67), 136, y)
        }
        y += 7
      }
      if (orderDetail?.verifiedAt) {
        pdf.setFont("helvetica", "bold")
        pdf.setFontSize(8)
        pdf.text(`Verified by ${pathologistName}${pathologistDesignation ? `, ${pathologistDesignation}` : ""} on ${formatDateTime(orderDetail.verifiedAt)}`, margin, y)
        y += 6
      }
      y += 2

      const addTableHeader = (testName: string) => {
        pdf.setFont("helvetica", "bold")
        pdf.setFontSize(10)
        pdf.setTextColor(20, 30, 28)
        pdf.text(testName, margin, y)
        y += 5
        pdf.setFillColor(232, 242, 239)
        pdf.rect(margin, y - 4, pageWidth - margin * 2, 8, "F")
        pdf.setFontSize(7.5)
        pdf.text("Parameter", margin + 1, y + 1)
        pdf.text("Result", 69, y + 1)
        pdf.text("Unit", 102, y + 1)
        pdf.text("Reference Range", 121, y + 1)
        pdf.text("Flag", pageWidth - margin - 7, y + 1)
        y += 8
      }
      addTableHeader(orderDetail?.test?.testName ?? order!.testName)
      for (const row of resultRows) {
        const parameterLines = pdf.splitTextToSize(row.name, 51) as string[]
        const resultLines = pdf.splitTextToSize(row.value, 30) as string[]
        const unitLines = pdf.splitTextToSize(row.unit, 17) as string[]
        const rangeLines = pdf.splitTextToSize(row.range, 55) as string[]
        const lineCount = Math.max(parameterLines.length, resultLines.length, unitLines.length, rangeLines.length)
        const rowHeight = Math.max(8, lineCount * 4 + 3)
        if (y + rowHeight > contentBottom) {
          addPage()
          addTableHeader(`${orderDetail?.test?.testName ?? order!.testName} (continued)`)
        }
        pdf.setDrawColor(205, 215, 212)
        pdf.line(margin, y + rowHeight - 1, pageWidth - margin, y + rowHeight - 1)
        pdf.setFont("helvetica", row.abnormal ? "bold" : "normal")
        pdf.setFontSize(8)
        pdf.setTextColor(row.critical ? 170 : row.abnormal ? 150 : 25, row.critical ? 20 : row.abnormal ? 82 : 35, row.critical ? 20 : 20)
        pdf.text(parameterLines, margin + 1, y + 3)
        pdf.text(resultLines, 69, y + 3)
        pdf.setTextColor(30, 40, 38)
        pdf.setFont("helvetica", "normal")
        pdf.text(unitLines, 102, y + 3)
        pdf.text(rangeLines, 121, y + 3)
        if (row.flag) {
          pdf.setFont("helvetica", "bold")
          pdf.setTextColor(row.critical ? 170 : 150, row.critical ? 20 : 82, 20)
          pdf.text(row.flag, pageWidth - margin - 5, y + 3)
        }
        y += rowHeight
      }
      if (latestResult?.reportRemarks) {
        y += 5
        if (y > contentBottom) addPage()
        pdf.setFont("helvetica", "bold")
        pdf.setFontSize(8)
        pdf.setTextColor(30, 40, 38)
        pdf.text("Report remarks", margin, y)
        y += 4
        pdf.setFont("helvetica", "normal")
        const remarks = pdf.splitTextToSize(latestResult.reportRemarks, pageWidth - margin * 2) as string[]
        if (y + remarks.length * 4 > contentBottom) addPage()
        pdf.text(remarks, margin, y)
        y += remarks.length * 4
      }
      if (footerText) {
        const footerLines = pdf.splitTextToSize(footerText, pageWidth - margin * 2) as string[]
        if (y + footerLines.length * 3.5 + 5 > contentBottom) addPage()
        y += 4
        pdf.setFont("helvetica", "normal")
        pdf.setFontSize(7.5)
        pdf.setTextColor(70, 80, 78)
        pdf.text(footerLines, margin, y)
      }
      if (order!.status !== "Verified") {
        const pageCountBeforeWatermark = pdf.getNumberOfPages()
        for (let page = 1; page <= pageCountBeforeWatermark; page += 1) {
          pdf.setPage(page)
          pdf.setFont("helvetica", "bold")
          pdf.setFontSize(38)
          pdf.setTextColor(235, 235, 235)
          pdf.text("PRELIMINARY", pageWidth / 2, 155, { align: "center", angle: 35 })
        }
      }
      const pageCount = pdf.getNumberOfPages()
      for (let page = 1; page <= pageCount; page += 1) {
        pdf.setPage(page)
        pdf.setFont("helvetica", "normal")
        pdf.setFontSize(8)
        pdf.setTextColor(70, 80, 78)
        pdf.line(margin, 260, pageWidth - margin, 260)
        pdf.text(`Technician: ${technicianName}`, margin, 266)
        pdf.text(`Pathologist: ${pathologistName}`, 77, 266)
        if (page === pageCount) {
          if (pathologistSignatureData) pdf.addImage(pathologistSignatureData, "PNG", 79, 269, 34, 12, undefined, "FAST")
          if (technicianSignatureData) pdf.addImage(technicianSignatureData, "PNG", margin, 269, 34, 12, undefined, "FAST")
          pdf.addImage(qrData, "PNG", pageWidth - margin - 22, 263, 22, 22, undefined, "FAST")
          pdf.setFontSize(6.5)
          pdf.text("Verify report", pageWidth - margin - 11, 289, { align: "center" })
        }
        pdf.text(`Page ${page} of ${pageCount}`, pageWidth / 2, 289, { align: "center" })
      }
      pdf.save(`${orderNumber}-lab-report.pdf`)
    } catch (cause) {
      toast({ title: "Unable to download report PDF", description: describeApiError(cause), variant: "error" })
    }
  }

  async function downloadCollectionSlip() {
    if (!reportSettings?.labName.trim()) {
      toast({ title: "Lab identity is not configured", description: "Ask an Admin to complete Lab Settings before downloading.", variant: "error" })
      return
    }
    try {
      const { jsPDF } = await import("jspdf")
      const pdf = new jsPDF({ orientation: "portrait", format: "a5", unit: "mm" })
      const name = orderDetail?.patient
        ? `${orderDetail.patient.firstName} ${orderDetail.patient.lastName}`.trim()
        : order!.patientName ?? "—"
      const orderNumber = order!.orderNumber ?? order!.id
      pdf.setFont("helvetica", "bold")
      pdf.setFontSize(16)
      const logoData = await loadReportImageData(reportSettings?.logoUrl)
      const slipLabName = reportSettings?.labName?.trim() ?? ""
      if (logoData) pdf.addImage(logoData, "PNG", 15, 8, 16, 16, undefined, "FAST")
      pdf.setFontSize(13)
      pdf.text(slipLabName, logoData ? 35 : 15, 18)
      pdf.setFont("helvetica", "normal")
      pdf.setFontSize(8)
      if (reportSettings?.address?.trim()) pdf.text(reportSettings.address.trim(), logoData ? 35 : 15, 24)
      if (reportSettings?.phone?.trim()) pdf.text(reportSettings.phone.trim(), logoData ? 35 : 15, 29)
      if (reportSettings?.headerText?.trim()) {
        const headerLines = pdf.splitTextToSize(reportSettings.headerText.trim(), 118) as string[]
        pdf.text(headerLines, 15, 35)
      }
      pdf.setFont("helvetica", "bold")
      pdf.setFontSize(13)
      pdf.text("Report Collection Slip", 15, 49)
      pdf.setDrawColor(14, 92, 86)
      pdf.line(15, 54, 133, 54)
      pdf.setFontSize(10)
      pdf.text("Patient", 15, 67)
      pdf.setFont("helvetica", "normal")
      pdf.text(name, 46, 67)
      pdf.setFont("helvetica", "bold")
      pdf.text("MR Number", 15, 77)
      pdf.setFont("helvetica", "normal")
      pdf.text(orderDetail?.patient?.mrNumber ?? order!.mrNumber ?? "—", 46, 77)
      pdf.setFont("helvetica", "bold")
      pdf.text("Order Number", 15, 87)
      pdf.setFont("courier", "bold")
      pdf.text(orderNumber, 46, 87)
      pdf.setFont("helvetica", "bold")
      pdf.text("Test", 15, 97)
      pdf.setFont("helvetica", "normal")
      pdf.text(pdf.splitTextToSize(orderDetail?.test?.testName ?? order!.testName, 86), 46, 97)
      pdf.setFont("helvetica", "bold")
      pdf.text("Sample Type", 15, 114)
      pdf.setFont("helvetica", "normal")
      pdf.text(orderDetail?.sampleType ?? orderDetail?.test?.sampleType ?? "—", 46, 114)
      pdf.setDrawColor(160, 170, 168)
      pdf.line(15, 135, 133, 135)
      pdf.setFont("helvetica", "normal")
      pdf.setFontSize(8)
      pdf.text(`Issued ${formatDateTime(new Date().toISOString())}`, 15, 142)
      if (reportSettings?.footerText?.trim()) pdf.text(pdf.splitTextToSize(reportSettings.footerText.trim(), 118), 15, 149)
      pdf.save(`${orderNumber}-collection-slip.pdf`)
    } catch (cause) {
      toast({ title: "Unable to download collection slip", description: describeApiError(cause), variant: "error" })
    }
  }

  async function uploadReport(file: File) {
    if (file.type !== "application/pdf" || file.size > 10 * 1024 * 1024) {
      toast({ title: "Unsupported report file", description: "Use a PDF up to 10 MB.", variant: "error" })
      return
    }
    try {
      await api.uploadLabReport(order!.id, file)
      setFileName(file.name)
      await refreshOrder()
      toast({ title: "Report uploaded", description: `${file.name} is attached to this order.`, variant: "success" })
    } catch (cause) {
      toast({ title: "Unable to upload report", description: describeApiError(cause), variant: "error" })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader
        title={`Lab Order${order.orderNumber ? ` ${order.orderNumber}` : ""}`}
        action={<div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={!reportReady || !reportSettings?.labName.trim()} onClick={() => void printReport()}><Printer className="h-4 w-4" /> Print Report</Button>
          <Button variant="outline" size="sm" disabled={!reportReady || !reportSettings?.labName.trim()} onClick={() => void downloadReportPdf()}><Download className="h-4 w-4" /> Download PDF</Button>
          <Button variant="outline" size="sm" disabled={!reportSettings?.labName.trim()} onClick={() => void downloadCollectionSlip()}><Download className="h-4 w-4" /> Collection Slip</Button>
        </div>}
      />

      <div role="tablist" aria-label="Lab order sections" className="flex w-fit gap-1 rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-1 print:hidden">
        <button type="button" role="tab" aria-selected={activeTab === "order"} onClick={() => setActiveTab("order")} className={cn("rounded-lg px-4 py-2 text-sm font-medium", activeTab === "order" ? "bg-[var(--cp-primary)] text-white" : "text-[var(--cp-ink-soft)]")}>Order</button>
        <button type="button" role="tab" aria-selected={activeTab === "history"} onClick={() => setActiveTab("history")} className={cn("rounded-lg px-4 py-2 text-sm font-medium", activeTab === "history" ? "bg-[var(--cp-primary)] text-white" : "text-[var(--cp-ink-soft)]")}>History</button>
      </div>
      {reportReady && reportSettings && !reportSettings.labName.trim() && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Lab identity is not configured. Ask an Admin to enter the Lab name in Lab Settings before printing this report.</p>}

      {activeTab === "history" ? <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Order audit history</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {(orderDetail?.history ?? []).length === 0 && <p className="text-sm text-[var(--cp-ink-soft)]">No order history is available yet.</p>}
            {[...(orderDetail?.history ?? [])].reverse().map((event) => (
              <section key={event.id} className="rounded-xl border border-[var(--cp-border)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{event.eventType.replaceAll("_", " ").toLocaleLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toLocaleUpperCase())}</p>
                  <time className="text-xs text-[var(--cp-ink-soft)]">{formatDateTime(event.createdAt)}</time>
                </div>
                <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">{event.actor?.name ?? "Unknown user"}{event.actor?.role ? ` · ${event.actor.role.replaceAll("_", " ")}` : ""}</p>
                {(event.oldValues != null || event.newValues != null) && <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {event.oldValues != null && <pre className="overflow-x-auto rounded bg-[var(--cp-neutral-light)] p-2 text-[11px]">Old: {JSON.stringify(event.oldValues, null, 2)}</pre>}
                  {event.newValues != null && <pre className="overflow-x-auto rounded bg-[var(--cp-neutral-light)] p-2 text-[11px]">New: {JSON.stringify(event.newValues, null, 2)}</pre>}
                </div>}
              </section>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Rejected samples</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {(orderDetail?.sampleRejections ?? []).length === 0 && <p className="text-sm text-[var(--cp-ink-soft)]">No rejected samples for this order.</p>}
            {(orderDetail?.sampleRejections ?? []).map((rejection) => (
              <section key={rejection.id} className="rounded-xl border border-[var(--cp-border)] p-3">
                <p className="text-sm font-semibold">{rejection.reason.replaceAll("_", " ").toLocaleLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toLocaleUpperCase())}{rejection.otherReason ? `: ${rejection.otherReason}` : ""}</p>
                <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Rejected by {rejection.rejector?.name ?? "Unknown user"} on {formatDateTime(rejection.rejectedAt)}</p>
                {rejection.recollectedAt
                  ? <p className="mt-1 text-xs text-[var(--cp-success)]">Re-collected by {rejection.recollector?.name ?? "Unknown user"} on {formatDateTime(rejection.recollectedAt)}</p>
                  : <p className="mt-1 text-xs font-medium text-amber-700">Awaiting re-collection</p>}
              </section>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Saved result versions</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {[...(orderDetail?.results ?? [])].sort((left, right) => (left.createdAt ?? "").localeCompare(right.createdAt ?? "")).map((version, index) => (
              <section key={version.id} className="rounded-xl border border-[var(--cp-border)] p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Version {index + 1}{version.supersededById ? " · superseded" : " · current"}</p>
                  {version.createdAt && <time className="text-xs text-[var(--cp-ink-soft)]">{formatDateTime(version.createdAt)}</time>}
                </div>
                {version.parameters?.length ? <div className="space-y-1">
                  {version.parameters.map((item) => <p key={item.id} className="text-sm">
                    <span className="font-medium">{item.parameterName}:</span> <span className="cp-tabular">{item.value}</span> {item.unit ?? ""}
                    <span className="ml-2 text-xs text-[var(--cp-ink-soft)]">{interpretationLabel(item.overriddenInterpretation ?? item.computedInterpretation)}</span>
                    {item.overrideReason && <span className="ml-2 text-xs text-[var(--cp-ink-soft)]">Override reason: {item.overrideReason}</span>}
                  </p>)}
                </div> : <p className="text-sm">{version.resultValue} {version.unit ?? ""} · {version.interpretation ?? "Unclassified"}</p>}
                {version.reportRemarks && <p className="mt-2 whitespace-pre-wrap text-xs text-[var(--cp-ink-soft)]">Report remarks: {version.reportRemarks}</p>}
                {version.technicianNotes && <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--cp-ink-soft)]">Internal technician notes: {version.technicianNotes}</p>}
                {version.amendmentReason && <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Amendment reason: {version.amendmentReason}</p>}
                {version.amendedAt && <p className="mt-1 text-xs font-semibold text-amber-700">AMENDED on {formatDateTime(version.amendedAt)}</p>}
              </section>
            ))}
          </CardContent>
        </Card>
      </div> : <>
      {(order.criticalResult || order.interpretation === "Critical") && (
        <div className="flex items-center gap-3 rounded-xl border-2 border-[var(--cp-critical)] bg-[var(--cp-critical-light)] p-4">
          <AlertOctagon className="h-5 w-5 shrink-0 text-[var(--cp-critical)]" />
          <p className="text-sm font-bold text-[var(--cp-critical)]">Critical result — notify the ordering physician immediately.</p>
        </div>
      )}

      <Card>
        <CardContent className="p-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-[var(--cp-ink)]">{order.testName}</p>
              <p className="text-xs text-[var(--cp-ink-soft)]">{order.patientName} · {order.mrNumber} · Ordered by {order.doctorName} · {formatDate(order.orderDate)}</p>
            </div>
            <StatusBadge status={order.priority} />
          </div>

          {/* Status stepper */}
          <div className="flex items-center">
            {STEPS.map((s, i) => (
              <React.Fragment key={s}>
                <div className="flex flex-col items-center gap-1.5">
                  <span
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold",
                      i <= stepIdx ? "bg-[var(--cp-primary)] text-white" : "bg-[var(--cp-neutral-light)] text-[var(--cp-ink-faint)]"
                    )}
                  >
                    {i < stepIdx ? <Check className="h-4 w-4" /> : i + 1}
                  </span>
                  <span className={cn("hidden text-center text-[10px] font-medium sm:block", i <= stepIdx ? "text-[var(--cp-ink)]" : "text-[var(--cp-ink-faint)]")}>{s}</span>
                </div>
                {i < STEPS.length - 1 && <span className={cn("mx-1 h-0.5 flex-1", i < stepIdx ? "bg-[var(--cp-primary)]" : "bg-[var(--cp-border)]")} />}
              </React.Fragment>
            ))}
          </div>

          {canProcessSamples && <div className="mt-4 flex flex-wrap gap-2">
            {order.status === "Ordered" && (openRejection
              ? <Button size="sm" variant="outline" disabled={workingAction || !orderDetail} onClick={() => void recollectSample()}>Re-collect Sample</Button>
              : <Button size="sm" variant="outline" disabled={workingAction || !orderDetail} onClick={() => void advanceTo("Sample Collected")}>Mark Sample Collected</Button>)}
            {order.status === "Sample Collected" && <>
              <Button size="sm" variant="outline" disabled={workingAction} onClick={() => void advanceTo("Processing")}>Start Processing</Button>
              <Button size="sm" variant="outline" disabled={workingAction} onClick={() => setShowRejectForm((visible) => !visible)}>Reject Sample</Button>
            </>}
            {["Ordered", "Sample Collected", "Processing"].includes(order.status) && <Button size="sm" variant="outline" disabled={workingAction} onClick={() => void cancelOrder()}>Cancel order</Button>}
          </div>}
          {canProcessSamples && showRejectForm && order.status === "Sample Collected" && <div className="mt-4 grid gap-3 rounded-xl border border-amber-300 bg-amber-50/60 p-4 sm:grid-cols-[minmax(12rem,1fr)_minmax(14rem,2fr)_auto]">
            <div><Label htmlFor="sample-rejection-reason">Rejection reason</Label><Select id="sample-rejection-reason" value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value as ApiLabSampleRejectionReason)}>
              <option value="HAEMOLYSED">Haemolysed</option>
              <option value="INSUFFICIENT_QUANTITY">Insufficient quantity</option>
              <option value="WRONG_TUBE">Wrong tube</option>
              <option value="OTHER">Other</option>
            </Select></div>
            {rejectionReason === "OTHER" && <div><Label htmlFor="other-rejection-reason">Describe reason *</Label><Input id="other-rejection-reason" autoComplete="off" value={otherRejectionReason} onChange={(event) => setOtherRejectionReason(event.target.value)} /></div>}
            <div className="flex items-end gap-2"><Button size="sm" disabled={workingAction} onClick={() => void rejectSample()}>{workingAction ? "Saving…" : "Confirm Rejection"}</Button><Button size="sm" variant="outline" onClick={() => setShowRejectForm(false)}>Cancel</Button></div>
          </div>}
        </CardContent>
      </Card>

      {(canProcessSamples && (order.status === "Processing" || order.status === "Completed") || canAmend && order.status === "Verified" && amending) && (
        <Card>
          <CardHeader><CardTitle>{order.status === "Verified" ? "Amend report" : "Result Entry"}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!reportSettings && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Lab settings are not loaded. Result saving and report actions are unavailable until settings load.</p>}
            {order.status === "Verified" && <div><Label htmlFor="amendment-reason">Amendment reason *</Label><Textarea id="amendment-reason" value={amendReason} onChange={(event) => setAmendReason(event.target.value)} maxLength={500} aria-invalid={!amendReason.trim()} />{!amendReason.trim() && <p role="alert" className="mt-1 text-xs text-[var(--cp-critical)]">An amendment reason is required.</p>}<p className="mt-1 text-xs text-[var(--cp-ink-soft)]">The previous verified version remains preserved in History.</p></div>}
            {!orderDetail ? <p className="text-sm text-[var(--cp-ink-soft)]">Loading the ordered test's catalog parameters…</p> : detailParameters.length > 0 ? <div className="space-y-3">
              {detailParameters.map((parameter) => {
                const draft = parameterDrafts.find((item) => item.parameterId === parameter.id) ?? { parameterId: parameter.id, value: "", overriddenInterpretation: "", overrideReason: "" }
                const range = resolvedRange(parameter, orderDetail, reportSettings?.criticalThresholdDefaults)
                const computed = parameter.resultType === "NUMERIC" ? computedInterpretation(draft.value, range) : null
                const effective = draft.overriddenInterpretation || computed
                const flag = abnormalFlag(computed, effective)
                return <section key={parameter.id} className={cn("rounded-xl border p-4", flag?.flag === "C" ? "border-[var(--cp-critical)] bg-[var(--cp-critical-light)]/40" : flag ? "border-amber-300 bg-amber-50/60" : "border-[var(--cp-border)] bg-white")}>
                  <div className="grid gap-3 lg:grid-cols-[minmax(8rem,1fr)_minmax(10rem,1fr)_minmax(12rem,1.3fr)_minmax(8rem,.8fr)]">
                    <div><p className="text-sm font-semibold">{parameter.name}</p><p className="text-xs text-[var(--cp-ink-soft)]">{parameter.resultType.toLowerCase()}</p></div>
                    <div>
                      <Label htmlFor={`parameter-${parameter.id}`}>Value *</Label>
                      <Input id={`parameter-${parameter.id}`} autoComplete="off" type={parameter.resultType === "NUMERIC" ? "number" : "text"} step={parameter.resultType === "NUMERIC" ? "any" : undefined} className="cp-tabular" value={draft.value} aria-invalid={Boolean(draft.valueError)} onChange={(event) => setParameterDrafts((current) => current.map((item) => item.parameterId === parameter.id ? { ...item, value: event.target.value, valueError: undefined } : item))} />
                      {draft.valueError && <p role="alert" className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{draft.valueError}</p>}
                    </div>
                    <div><Label>Unit · Reference range</Label><p className="pt-2 text-sm"><span className="font-medium">{parameter.unit || "—"}</span><span className="mx-2 text-[var(--cp-ink-faint)]">·</span><span className="cp-tabular">{formatRange(range)}</span></p></div>
                    <div><Label>Computed interpretation</Label><div className="flex flex-wrap items-center gap-2 pt-2">{computed ? <StatusBadge status={interpretationLabel(computed)} tone={interpretationFlag(computed)?.flag === "C" ? "critical" : interpretationFlag(computed) ? "warning" : "success"} /> : <span className="text-sm text-[var(--cp-ink-soft)]">{draft.value ? "No matching range" : "Enter value to classify"}</span>}{draft.overriddenInterpretation && <StatusBadge status={`Override: ${interpretationLabel(draft.overriddenInterpretation)}`} tone={interpretationFlag(draft.overriddenInterpretation)?.flag === "C" ? "critical" : interpretationFlag(draft.overriddenInterpretation) ? "warning" : "success"} />}</div></div>
                  </div>
                  {ageGenderNote && <p className="mt-2 text-xs text-[var(--cp-ink-soft)]">{ageGenderNote}</p>}
                  {!range && <p className="mt-2 text-xs text-amber-800">No matching age/gender range is configured; this value will not be automatically classified.</p>}
                  <div className="mt-3 grid gap-3 border-t border-current/10 pt-3 sm:grid-cols-2">
                    <div><Label htmlFor={`override-${parameter.id}`}>Override interpretation (optional)</Label><Select id={`override-${parameter.id}`} value={draft.overriddenInterpretation} onChange={(event) => setParameterDrafts((current) => current.map((item) => item.parameterId === parameter.id ? { ...item, overriddenInterpretation: event.target.value as ApiLabParameterInterpretation | "", overrideError: undefined } : item))}><option value="">Use computed interpretation</option><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="CRITICAL_LOW">Critical Low</option><option value="CRITICAL_HIGH">Critical High</option></Select></div>
                    {draft.overriddenInterpretation && <div><Label htmlFor={`override-reason-${parameter.id}`}>Override reason *</Label><Input id={`override-reason-${parameter.id}`} autoComplete="off" value={draft.overrideReason} aria-invalid={Boolean(draft.overrideError)} onChange={(event) => setParameterDrafts((current) => current.map((item) => item.parameterId === parameter.id ? { ...item, overrideReason: event.target.value, overrideError: undefined } : item))} />{draft.overrideError && <p role="alert" className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{draft.overrideError}</p>}<p className="mt-1 text-xs text-[var(--cp-ink-soft)]">The reason is stored with this result version.</p></div>}
                  </div>
                </section>
              })}
            </div> : <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div><Label htmlFor="rv">Result Value *</Label><Input id="rv" autoComplete="off" className="cp-tabular" value={resultValue} aria-invalid={Boolean(legacyError)} onChange={(event) => { setResultValue(event.target.value); setLegacyError("") }} />{legacyError && <p role="alert" className="mt-1 text-xs text-[var(--cp-critical)]">{legacyError}</p>}</div>
              <div><Label htmlFor="ru">Unit</Label><Input id="ru" autoComplete="off" value={unit} readOnly /></div>
              <div><Label htmlFor="rr">Reference Range</Label><Input id="rr" autoComplete="off" className="cp-tabular" value={range} readOnly /></div>
              <div><Label htmlFor="ri">Interpretation (legacy test)</Label><Select id="ri" value={interpretation} onChange={(event) => setInterpretation(event.target.value as LabInterpretation)}><option>Normal</option><option>High</option><option>Low</option><option>Critical</option></Select></div>
            </div>}
            <div className="grid gap-4 border-t border-[var(--cp-border)] pt-4 sm:grid-cols-2">
              <div><Label htmlFor="tn">Technician notes (internal, not printed)</Label><Textarea id="tn" autoComplete="off" value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
              <div><Label htmlFor="report-remarks">Report remarks (printed)</Label><Textarea id="report-remarks" autoComplete="off" value={reportRemarks} onChange={(event) => setReportRemarks(event.target.value)} /></div>
            </div>
            <div>
              <Label htmlFor="upload">Optional PDF attachment (up to 10 MB)</Label>
              <label className="mt-1 flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[var(--cp-border-strong)] bg-[var(--cp-bg)] px-4 py-2 text-sm text-[var(--cp-ink-soft)] hover:border-[var(--cp-primary)]">
                <Upload className="h-4 w-4" /> {fileName || "Click to attach a PDF report"}
                <input id="upload" type="file" accept="application/pdf,.pdf" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadReport(file) }} />
              </label>
              {fileName && <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Attached file: {fileName}</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {(order.resultValue || order.status === "Completed" || order.status === "Verified") && (
        <section id="lab-report-print" className="lab-report-sheet">
          {order.status !== "Verified" && <div className="lab-report-watermark" aria-hidden="true">PRELIMINARY</div>}
          <header className="lab-report-header">
            {reportSettings?.logoUrl && <img src={reportImages.logo || apiAssetUrl(reportSettings.logoUrl)} alt="" className="lab-report-logo" />}
            <div className="lab-report-brand">
              {reportSettings?.labName?.trim() && <h1>{reportSettings.labName.trim()}</h1>}
              {reportSettings?.address?.trim() && <p>{reportSettings.address.trim()}</p>}
              {reportSettings?.phone?.trim() && <p>{reportSettings.phone.trim()}</p>}
              {reportSettings?.accreditationLine?.trim() && <p className="lab-report-accreditation">{reportSettings.accreditationLine}</p>}
              {reportSettings?.headerText?.trim() && <p className="lab-report-custom-header">{reportSettings.headerText}</p>}
            </div>
            <div className="lab-report-title">
              <h2>Laboratory Report</h2>
              {order.status !== "Verified"
                ? <strong className="lab-report-preliminary">PRELIMINARY</strong>
                : latestResult?.amendedAt && <strong className="lab-report-amended">AMENDED · {formatDateTime(latestResult.amendedAt)}</strong>}
            </div>
          </header>
          <div className="lab-report-patient">
            <div><span>Patient</span><strong>{orderDetail?.patient ? `${orderDetail.patient.firstName} ${orderDetail.patient.lastName}`.trim() : patient?.name ?? "—"}</strong></div>
            <div><span>MR Number</span><strong>{orderDetail?.patient?.mrNumber ?? order.mrNumber ?? "—"}</strong></div>
            <div><span>Age / Gender</span><strong>{patient?.age ?? "—"} / {patient?.gender ?? "—"}</strong></div>
            <div><span>Referring Doctor</span><strong>{orderDetail?.doctor?.user.name ?? order.doctorName ?? "—"}</strong></div>
            <div><span>Sample ID / Barcode</span><strong className="cp-tabular">{order.orderNumber ?? "—"}</strong></div>
            <div><span>Sample Type</span><strong>{orderDetail?.sampleType ?? orderDetail?.test?.sampleType ?? "—"}</strong></div>
            <div><span>Collected At</span><strong>{orderDetail?.sampleCollectedAt ? formatDateTime(orderDetail.sampleCollectedAt) : "—"}</strong></div>
            <div><span>Reported At</span><strong>{latestResult?.createdAt ? formatDateTime(latestResult.createdAt) : orderDetail?.completedAt ? formatDateTime(orderDetail.completedAt) : "—"}</strong></div>
            <div><span>Verified At</span><strong>{orderDetail?.verifiedAt ? formatDateTime(orderDetail.verifiedAt) : "Not verified"}</strong></div>
          </div>
          <div className="lab-report-results">
            <h3>{orderDetail?.test?.testName ?? order.testName}</h3>
            <table className="lab-report-table">
              <thead><tr><th>Parameter</th><th>Result</th><th>Unit</th><th>Reference Range</th><th>Flag</th></tr></thead>
              <tbody>
                {savedParameterRows.length ? savedParameterRows.map((item) => {
                  const effective = item.overriddenInterpretation ?? item.computedInterpretation
                  const flag = abnormalFlag(item.computedInterpretation, effective)
                  return <tr key={item.id} className={flag ? `is-abnormal ${flag.flag === "C" ? "is-critical" : ""}` : ""}>
                    <td>{item.parameterName}</td><td className="cp-tabular">{item.value}</td><td>{item.unit ?? "—"}</td><td className="cp-tabular">{item.referenceRange ?? "—"}</td><td className="lab-report-flag">{flag?.flag ?? ""}</td>
                  </tr>
                }) : <tr className={order.interpretation && order.interpretation !== "Normal" ? "is-abnormal" : ""}>
                  <td>{order.testName}</td><td className="cp-tabular">{order.resultValue ?? resultValue ?? "—"}</td><td>{order.resultUnit ?? unit ?? "—"}</td><td className="cp-tabular">{order.referenceRange ?? range ?? "—"}</td><td className="lab-report-flag">{abnormalFlag(legacyInterpretation(order.interpretation), legacyInterpretation(order.interpretation))?.flag ?? ""}</td>
                </tr>}
              </tbody>
            </table>
          </div>
          {(latestResult?.reportRemarks || reportRemarks) && <p className="lab-report-remarks"><strong>Report remarks:</strong> {latestResult?.reportRemarks ?? reportRemarks}</p>}
          <footer className="lab-report-footer">
            <div className="lab-report-signers">
              <div className="lab-report-technician">
                {reportSettings?.technicianSignatureUrl && <img src={reportImages.technicianSignature || apiAssetUrl(reportSettings.technicianSignatureUrl)} alt="Technician signature" />}
                <span>Technician</span>
                <strong>{orderDetail?.technician?.name ?? reportSettings?.technicianName ?? "—"}</strong>
                {orderDetail?.technician?.designation && <small>{orderDetail.technician.designation}</small>}
              </div>
              <div className="lab-report-pathologist">
                {reportSettings?.pathologistSignatureUrl && <img src={reportImages.pathologistSignature || apiAssetUrl(reportSettings.pathologistSignatureUrl)} alt="Pathologist signature" />}
                <span>Pathologist</span>
                <strong>{orderDetail?.verifier?.name ?? reportSettings?.pathologistName ?? "—"}</strong>
                {orderDetail?.verifier?.staffProfile?.qualification && <small>{orderDetail.verifier.staffProfile.qualification}</small>}
              </div>
            </div>
            {orderDetail?.verifiedAt && <p className="lab-report-verification-line">Verified by {orderDetail.verifier?.name ?? reportSettings?.pathologistName ?? "Unknown verifier"}{orderDetail.verifier?.staffProfile?.specialization || orderDetail.verifier?.staffProfile?.qualification ? `, ${orderDetail.verifier.staffProfile.specialization ?? orderDetail.verifier.staffProfile.qualification}` : ""} on {formatDateTime(orderDetail.verifiedAt)}</p>}
            {reportSettings?.footerText?.trim() && <p className="lab-report-custom-footer">{reportSettings.footerText}</p>}
            {reportSettings?.reportsRetentionNote?.trim() && <p className="mt-2 text-xs text-[var(--cp-ink-soft)]">{reportSettings.reportsRetentionNote}</p>}
            <div className="lab-report-qr">
              {verificationQr && <img src={verificationQr} alt="QR code to verify this report" />}
              <span>Scan to verify report</span>
            </div>
            <div className="lab-report-page-number">Page <span className="lab-report-page-counter" /></div>
          </footer>
        </section>
      )}

      {order.status === "Verified" && canAmend && !amending && <div className="flex justify-end print:hidden">
        <Button variant="outline" onClick={() => { setAmending(true); setActiveTab("order") }}>Amend report</Button>
      </div>}

      {(canProcessSamples && (order.status === "Processing" || order.status === "Completed") || canAmend && order.status === "Verified" && amending) && (
        <div className="sticky bottom-3 z-20 flex justify-end gap-2 rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-3 shadow-lg print:hidden">
          {order.status === "Verified" && <Button size="sm" variant="outline" onClick={() => { setAmending(false); setAmendReason("") }} disabled={savingResult}>Cancel amendment</Button>}
          <Button size="sm" onClick={() => void saveResult()} disabled={savingResult || !reportSettings}>{savingResult ? "Saving…" : order.status === "Verified" ? "Save amendment" : "Save Result"}</Button>
          {order.status === "Completed" && canVerify && <Button size="sm" onClick={() => void verify()} disabled={savingResult}><ShieldCheck className="h-4 w-4" /> Verify Result</Button>}
        </div>
      )}
      </>}
    </div>
  )
}
