import * as React from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { ScanLine, Plus, RefreshCw, Printer, User, Save, CheckCircle } from "lucide-react"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { StatusBadge } from "@/dashboard/components/StatusBadge"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { api, describeApiError, loadAuthenticatedImage, type ApiUltrasoundAuditEntry, type ApiUltrasoundOrder, type ApiUltrasoundScanType, type ApiUltrasoundStructuredValue, type ApiUltrasoundTemplate, type ApiUltrasoundTemplateField, type ApiUser } from "@/lib/api"
import { formatDateTime } from "@/dashboard/lib/format"
import { useHospitalProfile } from "@/lib/hospitalProfile"
import { PrintableReport } from "./PrintableReport"
import { calculatedValue, generateFindings, getTemplateFields, initialStructuredData, structuredDataForSave, templateForOrder, ULTRASOUND_SCAN_TYPES, validateStructuredData } from "./ultrasoundReporting"

const inputClass = "w-full rounded-lg border border-[var(--cp-border)] bg-white px-3 py-2 text-sm text-[var(--cp-ink)]"

function UploadedImageCard({ url, caption, onCaptionChange, onRemove }: { url: string; caption: string; onCaptionChange: (caption: string) => void; onRemove: () => void }) {
  const [preview, setPreview] = React.useState<string | null>(null)
  const [previewError, setPreviewError] = React.useState("")
  React.useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    loadAuthenticatedImage(url).then((loaded) => {
      objectUrl = loaded
      if (active) setPreview(loaded)
      else if (loaded) URL.revokeObjectURL(loaded)
    }).catch((cause) => { if (active) setPreviewError(cause instanceof Error ? cause.message : "Unable to load image preview.") })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])
  return <div className="overflow-hidden rounded-lg border border-[var(--cp-border)] bg-white">
    {preview ? <img src={preview} alt={caption || "Previously uploaded ultrasound image"} className="h-36 w-full bg-[var(--cp-bg)] object-contain" /> : <div className="flex h-36 items-center justify-center bg-[var(--cp-bg)] px-3 text-center text-xs text-[var(--cp-ink-soft)]">{previewError || "Loading image preview…"}</div>}
    <div className="flex items-center gap-2 p-2"><input className={inputClass} aria-label="Image caption" maxLength={200} value={caption} onChange={(event) => onCaptionChange(event.target.value)} /><Button type="button" size="sm" variant="outline" onClick={onRemove}>Remove</Button></div>
  </div>
}

export default function UltrasoundDashboard() {
  const navigate = useNavigate()
  const { patients, currentUser } = useDashboard()
  const [params, setParams] = useSearchParams()
  const profile = useHospitalProfile()
  const initialPatientId = params.get("patientId") ?? ""
  const [draftSavedMessage, setDraftSavedMessage] = React.useState("")
  const [orders, setOrders] = React.useState<ApiUltrasoundOrder[]>([])
  const [staff, setStaff] = React.useState<ApiUser[]>([])
  const [selected, setSelected] = React.useState<ApiUltrasoundOrder | null>(null)
  const [auditHistory, setAuditHistory] = React.useState<ApiUltrasoundAuditEntry[]>([])
  const [auditHistoryError, setAuditHistoryError] = React.useState("")
  const [priceForm, setPriceForm] = React.useState({ feeAmount: "", discountAmount: "", reason: "" })
  const query = params.get("q") ?? ""
  const status = params.get("status") ?? ""
  const examTypeFilter = params.get("examType") ?? ""
  const priorityFilter = params.get("priority") ?? ""
  const technicianFilter = params.get("technicianId") ?? ""
  const fromDate = params.get("from") ?? ""
  const toDate = params.get("to") ?? ""
  const sortBy = params.get("sort") ?? "priority"
  const [showForm, setShowForm] = React.useState(Boolean(initialPatientId || params.get("new") === "1"))
  const [form, setForm] = React.useState({ patientId: initialPatientId, examType: "Abdomen", priority: "ROUTINE" as const, feeAmount: 0, discountAmount: 0, discountType: "AMOUNT" as "AMOUNT" | "PERCENTAGE", discountReason: "", notes: "" })
  const [scanCatalog, setScanCatalog] = React.useState<ApiUltrasoundScanType[]>([])
  const [comparisonOrderId, setComparisonOrderId] = React.useState("")
  const [previousScans, setPreviousScans] = React.useState<ApiUltrasoundOrder[]>([])
  const [previousScansLoading, setPreviousScansLoading] = React.useState(false)
  const [previousScansError, setPreviousScansError] = React.useState("")
  const [completeForm, setCompleteForm] = React.useState({ findings: "", impression: "" })
  const [structuredData, setStructuredData] = React.useState<Record<string, ApiUltrasoundStructuredValue>>({})
  const [findingsEdited, setFindingsEdited] = React.useState(false)
  const [templates, setTemplates] = React.useState<ApiUltrasoundTemplate[]>([])
  const [templatesLoading, setTemplatesLoading] = React.useState(true)
  const [templatesError, setTemplatesError] = React.useState("")
  const [imageFiles, setImageFiles] = React.useState<Array<{ file: File; preview: string; caption: string }>>([])
  const [existingImageCaptions, setExistingImageCaptions] = React.useState<string[]>([])
  const [removedExistingImages, setRemovedExistingImages] = React.useState<string[]>([])
  const previewUrls = React.useRef(new Set<string>())
  const [scheduleForm, setScheduleForm] = React.useState({ scheduledAt: "", technicianId: "" })
  const [reviewEditing, setReviewEditing] = React.useState(false)
  const [amendmentReason, setAmendmentReason] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [printRequested, setPrintRequested] = React.useState(false)
  const onPrintComplete = React.useCallback((printError?: string) => {
    setPrintRequested(false)
    if (printError) setError(printError)
  }, [])

  const load = React.useCallback(async () => {
    setError("")
    setLoading(true)
    const [ordersResult, usersResult] = await Promise.allSettled([
      api.listUltrasoundOrders(sortBy ? { sort: sortBy } : {}),
      api.listUltrasoundStaff(),
    ])
    if (ordersResult.status === "fulfilled") setOrders(ordersResult.value)
    else setError(ordersResult.reason instanceof Error ? ordersResult.reason.message : "Unable to load ultrasound orders")
    if (usersResult.status === "fulfilled") {
      setStaff(usersResult.value.filter((user) => user.role === "ULTRASOUND_TECH" || user.role === "ULTRASOUND_TECHNICIAN"))
    } else {
      setStaff([])
      setError(usersResult.reason instanceof Error ? usersResult.reason.message : "Unable to load ultrasound technicians")
    }
    setLoading(false)
  }, [sortBy])

  React.useEffect(() => { void load() }, [load])

  React.useEffect(() => {
    const handleInvalidation = () => { void load() }
    window.addEventListener("careplus:data-invalidated", handleInvalidation)
    return () => window.removeEventListener("careplus:data-invalidated", handleInvalidation)
  }, [load])

  React.useEffect(() => {
    let active = true
    api.getUltrasoundScanCatalog().then((items) => {
      if (!active) return
      setScanCatalog(items)
      setForm((current) => current.feeAmount === 0 ? { ...current, feeAmount: items.find((item) => item.name === current.examType)?.fee ?? 0 } : current)
    }).catch(() => { if (active) setScanCatalog([]) })
    return () => { active = false }
  }, [])

  React.useEffect(() => {
    const orderId = params.get("orderId")
    const order = orderId ? orders.find((item) => item.id === orderId) : undefined
    if (order) setSelected(order)
  }, [orders, params])

  React.useEffect(() => {
    setComparisonOrderId("")
    if (!selected) {
      setAuditHistory([])
      return
    }
    let active = true
    setAuditHistoryError("")
    api.getUltrasoundOrderAudit(selected.id)
      .then((items) => { if (active) setAuditHistory(items) })
      .catch((cause) => { if (active) setAuditHistoryError(describeApiError(cause)) })
    return () => { active = false }
  }, [selected])

  React.useEffect(() => {
    if (!selected?.patientId) {
      setPreviousScans([])
      setPreviousScansError("")
      return
    }
    let active = true
    setPreviousScansLoading(true)
    setPreviousScansError("")
    api.listPatientUltrasounds(selected.patientId)
      .then((items) => { if (active) setPreviousScans(items.filter((item) => item.id !== selected.id)) })
      .catch((cause) => { if (active) setPreviousScansError(describeApiError(cause)) })
      .finally(() => { if (active) setPreviousScansLoading(false) })
    return () => { active = false }
  }, [selected?.id, selected?.patientId])

  React.useEffect(() => {
    setPriceForm({
      feeAmount: selected ? String(selected.feeAmount) : "",
      discountAmount: selected ? String(selected.discountAmount) : "",
      reason: "",
    })
  }, [selected])

  React.useEffect(() => {
    let active = true
    setTemplatesLoading(true)
    api.listUltrasoundTemplates()
      .then((items) => { if (active) { setTemplates(items); setTemplatesError("") } })
      .catch((cause) => { if (active) setTemplatesError(describeApiError(cause)) })
      .finally(() => { if (active) setTemplatesLoading(false) })
    return () => { active = false }
  }, [])

  React.useEffect(() => () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url))
    previewUrls.current.clear()
  }, [])

  const selectedTemplate = templateForOrder(templates, selected)
  const templateFields = getTemplateFields(selectedTemplate)
  const visibleTemplateFields = templateFields.filter((field) => !field.patientGender || field.patientGender === selected?.patient?.gender)

  React.useEffect(() => {
    if (!selected || !["IN_PROGRESS", "REPORTED", "VERIFIED"].includes(selected.status) || !selectedTemplate) return
    const fields = getTemplateFields(selectedTemplate)
    const initialData = initialStructuredData(fields, selected.structuredData)
    setStructuredData(initialData)
    setCompleteForm({
      findings: selected.findings || generateFindings(fields, initialData, selected.patient?.gender),
      impression: selected.impression ?? "",
    })
    setFindingsEdited(Boolean(selected.findings))
  }, [selected, selectedTemplate])

  React.useEffect(() => {
    setReviewEditing(false)
    setAmendmentReason("")
    setExistingImageCaptions(selected?.imageUrls.map((_, index) => selected.imageCaptions?.[index] ?? "") ?? [])
    setRemovedExistingImages([])
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url))
    previewUrls.current.clear()
    setImageFiles([])
  }, [selected?.id, selected?.imageCaptions, selected?.imageUrls])

  const updateStructuredValue = (key: string, value: ApiUltrasoundStructuredValue) => {
    setStructuredData((current) => {
      const next = { ...current, [key]: value }
      if (!findingsEdited) setCompleteForm((formValue) => ({ ...formValue, findings: generateFindings(visibleTemplateFields, next, selected?.patient?.gender) }))
      return next
    })
  }

  const addImages = (files: FileList | null) => {
    if (!files?.length) return
    const selectedFiles = Array.from(files)
    if (selectedFiles.length + imageFiles.length + (selected?.imageUrls.length ?? 0) - removedExistingImages.length > 30) {
      setError("A report can contain no more than 30 images.")
      return
    }
    if (selectedFiles.length + imageFiles.length > 20) {
      setError("Choose no more than 20 new images at a time.")
      return
    }
    if (selectedFiles.some((file) => file.size > 25 * 1024 * 1024)) {
      setError("Each ultrasound image must be 25 MB or smaller.")
      return
    }
    if (selectedFiles.some((file) => !["image/jpeg", "image/jfif", "image/png", "application/dicom", "application/octet-stream"].includes(file.type))) {
      setError("Choose JPEG, PNG, or DICOM ultrasound images.")
      return
    }
    setError("")
    const additions = selectedFiles.map((file) => {
      const preview = file.type === "application/dicom" || file.type === "application/octet-stream" ? "" : URL.createObjectURL(file)
      if (preview) previewUrls.current.add(preview)
      return { file, preview, caption: file.name.replace(/\.[^.]+$/, "") }
    })
    setImageFiles((current) => [...current, ...additions])
  }

  const removeImage = (index: number) => {
    const image = imageFiles[index]
    if (image?.preview) {
      URL.revokeObjectURL(image.preview)
      previewUrls.current.delete(image.preview)
    }
    setImageFiles((current) => current.filter((_, imageIndex) => imageIndex !== index))
  }

  const completeScan = async () => {
    if (!selected || !selectedTemplate) return
    const validationError = validateStructuredData(visibleTemplateFields, structuredData)
    if (validationError) { setError(validationError); return }
    if (!completeForm.findings.trim()) { setError("Enter the report findings."); return }
    setBusy(true)
    setError("")
    let uploadedOrder: ApiUltrasoundOrder | null = null
    try {
      const retainedImageIndexes = selected.imageUrls.flatMap((url, index) => removedExistingImages.includes(url) ? [] : [index])
      const uploaded = imageFiles.length
        ? await api.uploadUltrasoundImages(selected.id, imageFiles.map(({ file }) => file))
        : selected
      uploadedOrder = imageFiles.length ? uploaded : null
      const newUrls = uploaded.imageUrls.slice(selected.imageUrls.length)
      const finalImageUrls = [...retainedImageIndexes.map((index) => selected.imageUrls[index]), ...newUrls]
      const captions = [...retainedImageIndexes.map((index) => existingImageCaptions[index] ?? ""), ...imageFiles.map(({ caption }) => caption.trim())]
      const updated = await api.completeUltrasound(uploaded.id, {
        findings: completeForm.findings.trim(),
        ...(completeForm.impression.trim() ? { impression: completeForm.impression.trim() } : {}),
        structuredData: structuredDataForSave(visibleTemplateFields, structuredData),
        imageUrls: finalImageUrls,
        imageCaptions: captions,
      })
      const completeOrder = await api.getUltrasoundOrder(updated.id)
      setSelected(completeOrder)
      imageFiles.forEach(({ preview }) => {
        if (preview) {
          URL.revokeObjectURL(preview)
          previewUrls.current.delete(preview)
        }
      })
      setImageFiles([])
      await load()
    } catch (cause) {
      if (uploadedOrder) {
        setSelected({ ...selected, imageUrls: uploadedOrder.imageUrls })
        setExistingImageCaptions((current) => [...current, ...imageFiles.map(({ caption }) => caption.trim())])
        imageFiles.forEach(({ preview }) => {
          if (preview) {
            URL.revokeObjectURL(preview)
            previewUrls.current.delete(preview)
          }
        })
        setImageFiles([])
      }
      setError(describeApiError(cause))
    } finally {
      setBusy(false)
    }
  }

  const run = async (action: () => Promise<ApiUltrasoundOrder>) => {
    setBusy(true); setError("")
    try { const updated = await action(); setSelected(updated); await load() } catch (cause) { setError(describeApiError(cause)) } finally { setBusy(false) }
  }

  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("")
    if ((form.discountType === "PERCENTAGE" && form.discountAmount > 100) || (form.discountType === "AMOUNT" && form.discountAmount > form.feeAmount)) { setError("Enter a valid discount."); setBusy(false); return }
    if (form.discountAmount > 0 && !form.discountReason.trim()) { setError("A reason is required for a discount."); setBusy(false); return }
    try { await api.createUltrasoundOrder(form); setShowForm(false); setForm({ patientId: initialPatientId, examType: "Abdomen", priority: "ROUTINE", feeAmount: 0, discountAmount: 0, discountType: "AMOUNT", discountReason: "", notes: "" }); await load() } catch (cause) { setError(describeApiError(cause)) } finally { setBusy(false) }
  }

  const updateFilter = (key: string, value: string) => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    }, { replace: true })
  }
  const statusValues = ["ORDERED", "SCHEDULED", "IN_PROGRESS", "REPORTED", "VERIFIED", "DELIVERED", "CANCELLED"] as const
  const priorityValues = ["ROUTINE", "URGENT", "STAT"] as const
  const visibleOrders = orders.filter((order) => {
    const text = `${order.patient?.firstName ?? ""} ${order.patient?.lastName ?? ""} ${order.patient?.mrNumber ?? ""} ${order.examType} ${order.technician?.name ?? ""}`.toLowerCase()
    const orderDay = order.createdAt.slice(0, 10)
    return text.includes(query.toLowerCase())
      && (!status || order.status === status)
      && (!examTypeFilter || order.examType === examTypeFilter)
      && (!priorityFilter || order.priority === priorityFilter || (priorityFilter === "STAT" && order.priority === "EMERGENCY"))
      && (!technicianFilter || order.technicianId === technicianFilter)
      && (!fromDate || orderDay >= fromDate)
      && (!toDate || orderDay <= toDate)
  }).sort((left, right) => {
    if (sortBy === "priority") {
      const rank = (priority: ApiUltrasoundOrder["priority"]) => priority === "STAT" || priority === "EMERGENCY" ? 0 : priority === "URGENT" ? 1 : 2
      const byPriority = rank(left.priority) - rank(right.priority)
      if (byPriority) return byPriority
    }
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  })
  const canCreate = currentUser?.role === "doctor" || currentUser?.role === "radiologist" || currentUser?.role === "admin"
  const isAdmin = currentUser?.role === "admin"
  const isTechnician = currentUser?.role === "ultrasound_tech" || currentUser?.role === "ultrasound_technician"
  const isReviewer = currentUser?.role === "doctor" || currentUser?.role === "radiologist" || currentUser?.role === "admin"
  const canPerformScan = isReviewer || isTechnician
  const canDeliverOrCancel = currentUser?.role === "admin" || currentUser?.role === "receptionist"
  const statusLabel = (value: string) => ({
    ORDERED: "Ordered", SCHEDULED: "Scheduled", IN_PROGRESS: "In Progress",
    REPORTED: "Reported", VERIFIED: "Verified", DELIVERED: "Delivered", CANCELLED: "Cancelled",
  }[value] ?? value)
  const priorityLabel = (value: string) => value === "STAT" || value === "EMERGENCY" ? "STAT" : value === "URGENT" ? "Urgent" : "Routine"

  const recordAndPrint = async () => {
    if (!selected) return
    setBusy(true)
    setError("")
    try {
      await api.logUltrasoundReportPrint(selected.id)
      setPrintRequested(true)
    } catch (cause) {
      setError(describeApiError(cause))
    } finally {
      setBusy(false)
    }
  }

  const savePricing = async () => {
    if (!selected) return
    const feeAmount = Number(priceForm.feeAmount)
    const discountAmount = Number(priceForm.discountAmount)
    if (!Number.isFinite(feeAmount) || !Number.isFinite(discountAmount) || feeAmount < 0 || discountAmount < 0 || discountAmount > feeAmount || (discountAmount > 0 && !priceForm.reason.trim())) {
      setError("Enter valid pricing; discount cannot exceed the fee.")
      return
    }
    setBusy(true)
    setError("")
    try {
      const updated = await api.updateUltrasoundPricing(selected.id, { feeAmount, discountAmount, ...(priceForm.reason.trim() ? { reason: priceForm.reason.trim() } : {}) })
      setSelected(updated)
      setPriceForm({ feeAmount: String(updated.feeAmount), discountAmount: String(updated.discountAmount), reason: "" })
      await load()
    } catch (cause) {
      setError(describeApiError(cause))
    } finally {
      setBusy(false)
    }
  }

  const saveReview = async () => {
    if (!selected) return
    if (selected.status === "VERIFIED" && !amendmentReason.trim()) {
      setError("Enter a reason before amending a verified report.")
      return
    }
    setBusy(true)
    setError("")
    try {
      const updated = await api.reviewUltrasound(selected.id, {
        findings: completeForm.findings.trim(),
        ...(completeForm.impression.trim() ? { impression: completeForm.impression.trim() } : {}),
        ...(selected.status === "VERIFIED" ? { amendmentReason: amendmentReason.trim() } : {}),
        expectedUpdatedAt: selected.updatedAt,
      })
      setSelected(updated)
      setReviewEditing(false)
      setAmendmentReason("")
      await load()
    } catch (cause) {
      setError(describeApiError(cause))
    } finally {
      setBusy(false)
    }
  }

  const saveDraft = async () => {
    if (!selected) return
    setBusy(true)
    setError("")
    setDraftSavedMessage("")
    try {
      const updated = await api.reviewUltrasound(selected.id, {
        findings: completeForm.findings.trim(),
        ...(completeForm.impression.trim() ? { impression: completeForm.impression.trim() } : {}),
        structuredData: structuredDataForSave(visibleTemplateFields, structuredData),
      })
      setSelected(updated)
      setDraftSavedMessage("Report draft saved.")
      setTimeout(() => setDraftSavedMessage(""), 4000)
      await load()
    } catch (cause) {
      setError(describeApiError(cause))
    } finally {
      setBusy(false)
    }
  }

  const renderTemplateField = (field: ApiUltrasoundTemplateField) => {
    const value = structuredData[field.key]
    if (field.type === "organ") {
      const organ = value && typeof value === "object" ? value : { status: "NORMAL" as const, notes: "" }
      return <div key={field.key} className="rounded-lg border border-[var(--cp-border)] p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">{field.label}</span>
          <div className="flex gap-1">
            <Button type="button" size="sm" variant={organ.status === "NORMAL" ? "primary" : "outline"} onClick={() => updateStructuredValue(field.key, { ...organ, status: "NORMAL" })}>Normal</Button>
            <Button type="button" size="sm" variant={organ.status === "ABNORMAL" ? "primary" : "outline"} onClick={() => updateStructuredValue(field.key, { ...organ, status: "ABNORMAL" })}>Abnormal</Button>
          </div>
        </div>
        <textarea className={inputClass} rows={2} aria-label={`${field.label} notes`} placeholder={`${field.label} notes`} value={organ.notes} onChange={(event) => updateStructuredValue(field.key, { ...organ, notes: event.target.value })} />
      </div>
    }
    if (field.type === "estimatedDueDate" || field.type === "gestationalAge") {
      return <label key={field.key} className="text-sm font-medium">{field.label}<input readOnly className={`${inputClass} bg-[var(--cp-bg)]`} value={calculatedValue(field, structuredData)} placeholder={field.type === "estimatedDueDate" ? "Calculated from LMP" : "Calculated from LMP"} /></label>
    }
    if (field.type === "select") {
      return <label key={field.key} className="text-sm font-medium">{field.label}<select className={inputClass} value={typeof value === "string" ? value : ""} onChange={(event) => updateStructuredValue(field.key, event.target.value)}><option value="">Select…</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select></label>
    }
    return <label key={field.key} className="text-sm font-medium">{field.label}<input className={inputClass} type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} min={field.type === "number" ? "0" : undefined} value={typeof value === "string" || typeof value === "number" ? value : ""} onChange={(event) => updateStructuredValue(field.key, event.target.value)} /></label>
  }

  return <>
    <div className="flex flex-col gap-4 print:hidden">
      <DashboardPageHeader title="Ultrasound & Imaging" action={<div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4" /> Refresh</Button>{canCreate && <Button size="sm" onClick={() => setShowForm(true)}><Plus className="h-4 w-4" /> New order</Button>}</div>} />
      {error && <p role="alert" className="rounded-lg border border-[var(--cp-critical)] bg-[var(--cp-critical-light)] p-3 text-sm text-[var(--cp-critical)]">{error}</p>}
      {showForm && <Card><CardContent className="p-5"><form className="grid gap-3 sm:grid-cols-2" onSubmit={create}>
        <label className="text-sm font-medium">Patient<select required className={inputClass} value={form.patientId} onChange={(e) => setForm({ ...form, patientId: e.target.value })}><option value="">Select patient</option>{patients.map((patient) => <option key={patient.id ?? patient.mrNumber} value={patient.id}>{patient.name} ({patient.mrNumber})</option>)}</select></label>
        <label className="text-sm font-medium">Exam type<select required className={inputClass} value={form.examType} onChange={(e) => { const selectedType = e.target.value; setForm({ ...form, examType: selectedType, feeAmount: scanCatalog.find((item) => item.name === selectedType)?.fee ?? 0 }) }}>{ULTRASOUND_SCAN_TYPES.filter((type) => scanCatalog.find((item) => item.name === type)?.enabled !== false).map((type) => <option key={type}>{type}</option>)}</select></label>
        <label className="text-sm font-medium">Priority<select className={inputClass} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as typeof form.priority })}><option value="ROUTINE">Routine</option><option value="URGENT">Urgent</option><option value="STAT">STAT</option></select></label>
        <label className="text-sm font-medium">Ultrasound fee<input required min="0" step="0.01" type="number" className={inputClass} value={form.feeAmount} onChange={(e) => setForm({ ...form, feeAmount: Number(e.target.value) })} /></label>
        <label className="text-sm font-medium">Discount type<select className={inputClass} value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value as typeof form.discountType })}><option value="AMOUNT">Amount</option><option value="PERCENTAGE">Percentage</option></select></label>
        <label className="text-sm font-medium">Discount<input required min="0" max={form.discountType === "PERCENTAGE" ? 100 : form.feeAmount} step="0.01" type="number" className={inputClass} value={form.discountAmount} onChange={(e) => setForm({ ...form, discountAmount: Number(e.target.value) })} /></label>
        {form.discountAmount > 0 && <label className="text-sm font-medium sm:col-span-2">Discount reason<input required className={inputClass} maxLength={1000} value={form.discountReason} onChange={(e) => setForm({ ...form, discountReason: e.target.value })} /></label>}
        <label className="text-sm font-medium sm:col-span-2">Clinical notes<textarea className={inputClass} rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        <div className="flex gap-2 sm:col-span-2"><Button type="submit" disabled={busy}>Create order</Button><Button type="button" variant="outline" onClick={() => setShowForm(false)}>Close</Button></div>
      </form></CardContent></Card>}

      <Card><CardContent className="flex flex-col gap-4 p-4">
        <input className={inputClass} placeholder="Search patient, MR number, exam, technician" value={query} onChange={(event) => updateFilter("q", event.target.value)} />
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--cp-ink-soft)]">Status</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => updateFilter("status", "")} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${status ? "border-[var(--cp-border)] text-[var(--cp-ink-soft)]" : "border-[var(--cp-primary)] bg-[var(--cp-primary-light)] text-[var(--cp-primary)]"}`}>All</button>
            {statusValues.map((value) => <button key={value} type="button" onClick={() => updateFilter("status", status === value ? "" : value)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${status === value ? "border-[var(--cp-primary)] bg-[var(--cp-primary-light)] text-[var(--cp-primary)]" : "border-[var(--cp-border)] text-[var(--cp-ink-soft)]"}`}>{statusLabel(value)}</button>)}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--cp-ink-soft)]">Priority</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => updateFilter("priority", "")} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${priorityFilter ? "border-[var(--cp-border)] text-[var(--cp-ink-soft)]" : "border-[var(--cp-primary)] bg-[var(--cp-primary-light)] text-[var(--cp-primary)]"}`}>Any</button>
            {priorityValues.map((value) => <button key={value} type="button" onClick={() => updateFilter("priority", priorityFilter === value ? "" : value)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${priorityFilter === value ? "border-[var(--cp-critical)] bg-[var(--cp-critical-light)] text-[var(--cp-critical)]" : "border-[var(--cp-border)] text-[var(--cp-ink-soft)]"}`}>{priorityLabel(value)}</button>)}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs font-semibold text-[var(--cp-ink-soft)]">Scan type<select className={inputClass} value={examTypeFilter} onChange={(event) => updateFilter("examType", event.target.value)}><option value="">All scan types</option>{ULTRASOUND_SCAN_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
          <label className="text-xs font-semibold text-[var(--cp-ink-soft)]">Technician<select className={inputClass} value={technicianFilter} onChange={(event) => updateFilter("technicianId", event.target.value)}><option value="">All technicians</option>{staff.map((technician) => <option key={technician.id} value={technician.id}>{technician.name}</option>)}</select></label>
          <label className="text-xs font-semibold text-[var(--cp-ink-soft)]">From date<input className={inputClass} type="date" value={fromDate} onChange={(event) => updateFilter("from", event.target.value)} /></label>
          <label className="text-xs font-semibold text-[var(--cp-ink-soft)]">To date<input className={inputClass} type="date" value={toDate} onChange={(event) => updateFilter("to", event.target.value)} /></label>
          <label className="text-xs font-semibold text-[var(--cp-ink-soft)]">Sort by<select className={inputClass} value={sortBy} onChange={(event) => updateFilter("sort", event.target.value)}><option value="priority">Priority then newest</option><option value="time">Newest first</option></select></label>
        </div>
      </CardContent></Card>

      <Card><CardContent className="overflow-x-auto p-0"><table className="w-full text-left text-sm"><thead><tr className="border-b border-[var(--cp-border)] text-xs text-[var(--cp-ink-soft)]"><th className="p-4">Patient</th><th className="p-4">Exam</th><th className="p-4">Priority</th><th className="p-4">Scheduled</th><th className="p-4">Technician</th><th className="p-4">Status</th></tr></thead><tbody>{visibleOrders.map((order) => <tr key={order.id} className="cursor-pointer border-b border-[var(--cp-border)] hover:bg-[var(--cp-bg)]" onClick={() => setSelected(order)}><td className="p-4 font-medium">{order.patient?.firstName} {order.patient?.lastName}<span className="block text-xs text-[var(--cp-ink-soft)]">{order.patient?.mrNumber}</span></td><td className="p-4">{order.examType}</td><td className="p-4"><StatusBadge status={priorityLabel(order.priority)} tone={order.priority === "ROUTINE" ? "info" : "critical"} /></td><td className="p-4">{order.scheduledAt ? formatDateTime(order.scheduledAt) : "Not scheduled"}</td><td className="p-4">{order.technician?.name ?? "Unassigned"}</td><td className="p-4"><StatusBadge status={statusLabel(order.status)} /></td></tr>)}</tbody></table>{loading ? <div className="p-8 text-center text-sm text-[var(--cp-ink-soft)]">Loading ultrasound orders...</div> : visibleOrders.length === 0 && <div className="p-8 text-center text-sm text-[var(--cp-ink-soft)]"><ScanLine className="mx-auto mb-2 h-7 w-7" />No ultrasound orders found.</div>}</CardContent></Card>

      {selected && <Card><CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{selected.examType}</h2>
            <div className="flex flex-wrap items-center gap-2 mt-0.5">
              <p className="text-sm text-[var(--cp-ink-soft)]">{selected.patient?.firstName} {selected.patient?.lastName} · {selected.patient?.mrNumber}</p>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => navigate(`/dashboard/patients/${encodeURIComponent(selected.patient?.mrNumber || selected.patientId)}`)}>
                <User className="h-3.5 w-3.5 mr-1" /> Open Patient Record
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2"><StatusBadge status={statusLabel(selected.status)} />{selected.invoice && <a className="rounded-lg border border-[var(--cp-border)] px-3 py-2 text-sm font-medium text-[var(--cp-primary)]" href={`/dashboard/billing/${encodeURIComponent(selected.invoice.id)}`}>Invoice {selected.invoice.invoiceNumber} · {selected.invoice.status}</a>}{["REPORTED", "VERIFIED", "DELIVERED"].includes(selected.status) && <><Button size="sm" variant="outline" disabled={busy || printRequested} onClick={() => void recordAndPrint()}><Printer className="h-4 w-4" /> Print Report</Button><Button size="sm" variant="outline" disabled={busy || printRequested} onClick={() => void recordAndPrint()}>Save as PDF</Button><Button size="sm" variant="outline" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent("Your ultrasound report is ready. Please contact the hospital to obtain a copy.")}`, "_blank", "noopener,noreferrer")}>Share via WhatsApp</Button></>}</div>
        </div>
        <p className="text-sm">{selected.notes || "No clinical notes recorded."}</p>
        {selected.invoice && <p className="text-xs text-[var(--cp-ink-soft)]">Invoice balance: {selected.invoice.balanceAmount} · paid: {selected.invoice.paidAmount}. Use the shared invoice page for payment and receipt printing.</p>}

        <section className="rounded-lg border border-[var(--cp-border)] p-3">
          <h3 className="mb-2 font-semibold">Previous scans</h3>
          {previousScansLoading ? <p role="status" className="text-xs text-[var(--cp-ink-soft)]">Loading previous scans…</p> : previousScansError ? <p role="alert" className="text-xs text-[var(--cp-critical)]">{previousScansError}</p> : previousScans.length === 0 ? <p className="text-xs text-[var(--cp-ink-soft)]">No previous scans for this patient.</p> : <select className={inputClass} value={comparisonOrderId} onChange={(event) => setComparisonOrderId(event.target.value)}><option value="">Select a previous report to compare</option>{previousScans.filter((item) => item.findings).map((item) => <option key={item.id} value={item.id}>{item.examType} · {formatDateTime(item.createdAt)}</option>)}</select>}
          {comparisonOrderId && (() => { const previous = previousScans.find((item) => item.id === comparisonOrderId); if (!previous) return null; return <div className="mt-3 grid gap-3 md:grid-cols-2">{[selected, previous].map((report, index) => <article key={report.id} className="rounded-lg bg-[var(--cp-bg)] p-3"><h4 className="font-semibold">{index === 0 ? "Current report" : `Previous · ${report.examType}`}</h4><p className="text-xs text-[var(--cp-ink-soft)]">{formatDateTime(report.createdAt)}</p><p className="mt-2 whitespace-pre-wrap text-sm"><strong>Findings:</strong> {report.findings || "Not recorded"}</p><p className="mt-2 whitespace-pre-wrap text-sm"><strong>Impression:</strong> {report.impression || "Not recorded"}</p></article>)}</div> }
          )()}
        </section>

        {isAdmin && <section className="rounded-lg border border-[var(--cp-border)] p-3"><h3 className="mb-2 font-semibold">Order pricing</h3><div className="grid gap-2 sm:grid-cols-4">
          <label className="text-xs font-semibold text-[var(--cp-ink-soft)]">Fee<input type="number" min="0" step="0.01" className={inputClass} value={priceForm.feeAmount} onChange={(event) => setPriceForm((current) => ({ ...current, feeAmount: event.target.value }))} /></label>
          <label className="text-xs font-semibold text-[var(--cp-ink-soft)]">Discount<input type="number" min="0" step="0.01" className={inputClass} value={priceForm.discountAmount} onChange={(event) => setPriceForm((current) => ({ ...current, discountAmount: event.target.value }))} /></label>
          <label className="text-xs font-semibold text-[var(--cp-ink-soft)]">Discount reason{Number(priceForm.discountAmount) > 0 ? " (required)" : ""}<input required={Number(priceForm.discountAmount) > 0} className={inputClass} maxLength={1000} value={priceForm.reason} onChange={(event) => setPriceForm((current) => ({ ...current, reason: event.target.value }))} /></label>
          <Button className="self-end" disabled={busy} onClick={() => void savePricing()}>Save pricing</Button>
        </div></section>}

        <section className="rounded-lg border border-[var(--cp-border)] p-3"><h3 className="mb-2 font-semibold">History</h3>
          {auditHistoryError && <p role="alert" className="mb-2 text-xs text-[var(--cp-critical)]">{auditHistoryError}</p>}
          {auditHistory.length === 0 && !auditHistoryError ? <p className="text-xs text-[var(--cp-ink-soft)]">No history recorded yet.</p> : <ol className="flex flex-col gap-2">{auditHistory.map((entry) => {
            const oldValues = entry.oldValuesJson && typeof entry.oldValuesJson === "object" ? entry.oldValuesJson as Record<string, unknown> : null
            const newValues = entry.newValuesJson && typeof entry.newValuesJson === "object" ? entry.newValuesJson as Record<string, unknown> : null
            const detail = typeof oldValues?.status === "string" && typeof newValues?.status === "string"
              ? `${statusLabel(oldValues.status)} → ${statusLabel(newValues.status)}`
              : entry.reason || Object.keys(newValues ?? {}).join(", ")
            return <li key={entry.id} className="border-l-2 border-[var(--cp-primary-light)] pl-3 text-xs">
              <p className="font-semibold">{entry.action.replace("ULTRASOUND_", "").replaceAll("_", " ")}</p>
              <p className="text-[var(--cp-ink-soft)]">{entry.user?.name ?? "Former user"}{(entry.userRole ?? entry.user?.role) ? ` · ${(entry.userRole ?? entry.user?.role)?.replaceAll("_", " ")}` : ""} · {formatDateTime(entry.createdAt)}</p>
              {detail && <p className="mt-0.5 text-[var(--cp-ink-soft)]">{detail}</p>}
              {entry.reason && entry.reason !== detail && <p className="mt-0.5">Reason: {entry.reason}</p>}
            </li>
          })}</ol>}
        </section>

        {canPerformScan && selected.status === "ORDERED" && (
          <div className="flex flex-col gap-3 rounded-lg border border-[var(--cp-border)] p-4 bg-[var(--cp-surface-warm)]/40">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-sm">Perform Ultrasound Scan</h3>
                <p className="text-xs text-[var(--cp-ink-soft)]">Start the scan immediately or schedule for a specific technician and time.</p>
              </div>
              <Button disabled={busy} onClick={() => void run(() => api.startUltrasound(selected.id))}>
                Start scan now
              </Button>
            </div>
            <div className="border-t border-[var(--cp-border)] pt-3">
              <p className="mb-2 text-xs font-semibold uppercase text-[var(--cp-ink-soft)]">Or schedule scan</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <input type="datetime-local" className={inputClass} value={scheduleForm.scheduledAt} onChange={(event) => setScheduleForm({ ...scheduleForm, scheduledAt: event.target.value })} />
                <select className={inputClass} value={scheduleForm.technicianId} onChange={(event) => setScheduleForm({ ...scheduleForm, technicianId: event.target.value })}>
                  <option value="">Assign technician (optional)</option>
                  {staff.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                </select>
                <Button variant="outline" disabled={busy} onClick={() => {
                  if (!scheduleForm.scheduledAt) { setError("Select a scheduled date and time."); return }
                  void run(() => api.scheduleUltrasound(selected.id, scheduleForm))
                }}>Schedule</Button>
              </div>
            </div>
          </div>
        )}

        {canPerformScan && selected.status === "SCHEDULED" && (
          <div className="flex items-center gap-3">
            <Button disabled={busy} onClick={() => void run(() => api.startUltrasound(selected.id))}>
              Start scan
            </Button>
            {selected.technician && <span className="text-xs text-[var(--cp-ink-soft)]">Scheduled technician: {selected.technician.name}</span>}
          </div>
        )}

        {canPerformScan && selected.status === "IN_PROGRESS" && (
          <div className="flex flex-col gap-4">
            {templatesLoading ? <p role="status" className="text-sm text-[var(--cp-ink-soft)]">Loading reporting templates…</p> : templatesError ? <p role="alert" className="text-sm text-[var(--cp-critical)]">Unable to load reporting templates: {templatesError}</p> : !selectedTemplate ? <p role="alert" className="text-sm text-[var(--cp-critical)]">No reporting template is available for this scan.</p> : <>
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{selectedTemplate.examinationType} report fields</h3>{visibleTemplateFields.some((field) => field.type === "organ") && <Button type="button" size="sm" variant="outline" onClick={() => {
                const next = { ...structuredData }
                visibleTemplateFields.filter((field) => field.type === "organ").forEach((field) => { next[field.key] = { status: "NORMAL", notes: "" } })
                setStructuredData(next)
                if (!findingsEdited) setCompleteForm((current) => ({ ...current, findings: generateFindings(visibleTemplateFields, next, selected.patient?.gender) }))
              }}>Mark all normal</Button>}</div>
              <div className="grid gap-3 sm:grid-cols-2">{visibleTemplateFields.map(renderTemplateField)}</div>
            </>}
            <label className="text-sm font-medium">Findings<textarea required className={inputClass} rows={5} placeholder="Generated from the structured fields; edit as needed" value={completeForm.findings} onChange={(event) => { setFindingsEdited(true); setCompleteForm({ ...completeForm, findings: event.target.value }) }} /></label>
            {findingsEdited && <Button type="button" variant="link" className="w-fit" onClick={() => { setFindingsEdited(false); setCompleteForm((current) => ({ ...current, findings: generateFindings(visibleTemplateFields, structuredData, selected.patient?.gender) })) }}>Regenerate findings from structured fields</Button>}
            <label className="text-sm font-medium">Impression (diagnostic conclusion)<textarea className={inputClass} rows={3} value={completeForm.impression} onChange={(event) => setCompleteForm({ ...completeForm, impression: event.target.value })} /></label>
            <div className="flex flex-col gap-3">
              <label className="text-sm font-medium">Ultrasound images<input className={inputClass} type="file" accept="image/jpeg,image/jfif,image/png,application/dicom" multiple disabled={imageFiles.length >= 20} onChange={(event) => { addImages(event.target.files); event.target.value = "" }} /></label>
              {(imageFiles.length > 0 || selected.imageUrls.some((url) => !removedExistingImages.includes(url))) && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {selected.imageUrls.map((url, index) => removedExistingImages.includes(url) ? null : <UploadedImageCard key={url} url={url} caption={existingImageCaptions[index] ?? ""} onCaptionChange={(caption) => setExistingImageCaptions((current) => current.map((value, captionIndex) => captionIndex === index ? caption : value))} onRemove={() => setRemovedExistingImages((current) => [...current, url])} />)}
                {imageFiles.map(({ file, preview, caption }, index) => <div key={`${file.name}-${file.lastModified}-${index}`} className="overflow-hidden rounded-lg border border-[var(--cp-border)] bg-white">
                  {preview ? <img src={preview} alt={`Preview of ${file.name}`} className="h-36 w-full bg-[var(--cp-bg)] object-contain" /> : <div className="flex h-36 items-center justify-center bg-[var(--cp-bg)] px-3 text-center text-sm text-[var(--cp-ink-soft)]">DICOM image preview unavailable</div>}
                  <div className="flex items-center gap-2 p-2"><input className={inputClass} aria-label={`Caption for ${file.name}`} maxLength={200} value={caption} onChange={(event) => setImageFiles((current) => current.map((image, imageIndex) => imageIndex === index ? { ...image, caption: event.target.value } : image))} /><Button type="button" size="sm" variant="outline" onClick={() => removeImage(index)} aria-label={`Remove ${file.name}`}>Remove</Button></div>
                </div>)}
              </div>}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" disabled={busy} onClick={() => void saveDraft()}>
                <Save className="h-4 w-4" /> Save Draft
              </Button>
              <Button className="w-fit" disabled={busy || templatesLoading || Boolean(templatesError) || !selectedTemplate || !completeForm.findings.trim()} onClick={() => void completeScan()}>
                <CheckCircle className="h-4 w-4" /> {busy ? "Saving report…" : "Mark Reported"}
              </Button>
              {draftSavedMessage && <span className="text-xs text-[var(--cp-success)] font-medium">{draftSavedMessage}</span>}
            </div>
          </div>
        )}

        {selected.status !== "IN_PROGRESS" && selected.findings && <div className="grid gap-3 sm:grid-cols-2">
          <div><h3 className="font-semibold">Findings</h3>{isReviewer && reviewEditing ? <textarea className={inputClass} rows={5} value={completeForm.findings} onChange={(event) => setCompleteForm({ ...completeForm, findings: event.target.value })} /> : <p className="whitespace-pre-wrap text-sm">{selected.findings}</p>}</div>
          <div><h3 className="font-semibold">Impression</h3>{isReviewer && reviewEditing ? <textarea className={inputClass} rows={5} value={completeForm.impression} onChange={(event) => setCompleteForm({ ...completeForm, impression: event.target.value })} /> : <p className="whitespace-pre-wrap text-sm">{selected.impression || "Awaiting radiologist review."}</p>}</div>
        </div>}
        {isReviewer && selected.status === "REPORTED" && <div className="flex flex-wrap gap-2">
          {!reviewEditing && <Button variant="outline" disabled={busy} onClick={() => setReviewEditing(true)}>Review report</Button>}
          {reviewEditing && <Button disabled={busy || !completeForm.impression.trim()} onClick={() => void saveReview()}>{busy ? "Saving…" : "Save review"}</Button>}
          <Button variant="outline" disabled={busy || !selected.impression?.trim()} onClick={() => void run(() => api.verifyUltrasound(selected.id))}>Verify report</Button>
        </div>}
        {selected.status === "VERIFIED" && <div className="rounded-lg border border-[var(--cp-success-light)] bg-[var(--cp-success-light)] p-3 text-sm"><p className="font-semibold text-[var(--cp-success)]">Verified by {selected.verifiedByName || selected.verifiedBy?.name || "Doctor"}{selected.verifiedAt ? ` · ${formatDateTime(selected.verifiedAt)}` : ""}</p><p className="mt-1 text-[var(--cp-ink-soft)]">This report is locked. Any further change must be recorded as an amendment.</p></div>}
        {isReviewer && selected.status === "VERIFIED" && !reviewEditing && <Button className="w-fit" variant="outline" onClick={() => setReviewEditing(true)}>Amend verified report</Button>}
        {isReviewer && selected.status === "VERIFIED" && reviewEditing && <div className="flex flex-col gap-3">
          <label className="text-sm font-medium">Amendment reason<textarea required minLength={1} maxLength={1000} className={inputClass} rows={2} value={amendmentReason} onChange={(event) => setAmendmentReason(event.target.value)} /></label>
          <div className="flex gap-2"><Button disabled={busy || !amendmentReason.trim()} onClick={() => void saveReview()}>{busy ? "Saving…" : "Save amendment"}</Button><Button variant="outline" onClick={() => setReviewEditing(false)}>Discard</Button></div>
        </div>}
        {selected.verifiedByName && <p className="text-sm text-[var(--cp-ink-soft)]">Signature: {selected.verifiedByName}{selected.verifiedAt ? ` · ${formatDateTime(selected.verifiedAt)}` : ""}</p>}
        {selected.amendments?.length ? <section className="rounded-lg border border-[var(--cp-border)] p-3"><h3 className="mb-2 font-semibold">Amendment history</h3><div className="flex flex-col gap-2">{selected.amendments.map((amendment) => <article key={amendment.id} className="border-t border-[var(--cp-border)] pt-2 text-sm"><p className="font-medium">{amendment.author.name} · {formatDateTime(amendment.createdAt)}</p><p>Reason: {amendment.reason}</p></article>)}</div></section> : null}
        {selected.imageUrls.map((url, index) => <a className="block text-sm text-[var(--cp-primary)] underline" href={url} target="_blank" rel="noreferrer" key={url}>{selected.imageCaptions?.[index] || `Ultrasound image ${index + 1}`}</a>)}

        {selected.status === "VERIFIED" && canDeliverOrCancel && <Button className="w-fit" disabled={busy} onClick={() => void run(() => api.deliverUltrasound(selected.id))}>Mark Delivered</Button>}
        {canDeliverOrCancel && selected.status !== "CANCELLED" && selected.status !== "DELIVERED" && <Button variant="outline" className="w-fit" disabled={busy} onClick={() => void run(() => api.cancelUltrasound(selected.id))}>Cancel order</Button>}
      </CardContent></Card>}
    </div>
    {selected && ["REPORTED", "VERIFIED", "DELIVERED"].includes(selected.status) && <PrintableReport order={selected} profile={profile} templates={templates} printRequested={printRequested} onPrintComplete={onPrintComplete} />}
  </>
}
