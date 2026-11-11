import * as React from "react"
import { createPortal } from "react-dom"
import { apiAssetUrl, loadAuthenticatedImage, type ApiHospitalProfile, type ApiUltrasoundOrder, type ApiUltrasoundTemplate } from "@/lib/api"
import { DEFAULT_HOSPITAL_PROFILE } from "@/lib/hospitalProfile"
import { formatDateTime } from "@/dashboard/lib/format"
import { fieldDisplayValue, getTemplateFields, templateForOrder } from "./ultrasoundReporting"

interface PrintableReportProps {
  order: ApiUltrasoundOrder
  profile: ApiHospitalProfile
  templates: ApiUltrasoundTemplate[]
  printRequested: boolean
  onPrintComplete: (error?: string) => void
}

function present(value?: string | number | null) {
  return value === null || value === undefined || String(value).trim() === "" ? "Not recorded" : String(value)
}

export function PrintableReport({ order, profile, templates, printRequested, onPrintComplete }: PrintableReportProps) {
  const [images, setImages] = React.useState<Array<{ url: string; index: number }>>([])
  const [signatureImage, setSignatureImage] = React.useState("")
  const hospitalName = profile.name?.trim() || DEFAULT_HOSPITAL_PROFILE.name
  const hospitalAddress = profile.address?.trim() || DEFAULT_HOSPITAL_PROFILE.address
  const hospitalPhone = profile.phone?.trim() || DEFAULT_HOSPITAL_PROFILE.phone
  const radiologist = order.verifiedByName || order.verifiedBy?.name || "Awaiting verification"
  const signatureUrl = order.verifiedBy?.doctorProfile?.signatureUrl || order.doctor?.signatureUrl
  const patientName = `${order.patient?.firstName ?? ""} ${order.patient?.lastName ?? ""}`.trim()
  const scanDate = order.performedAt ?? order.completedAt ?? order.createdAt
  const template = templateForOrder(templates, order)
  const structuredFields = getTemplateFields(template).filter((field) =>
    (!field.patientGender || field.patientGender === order.patient?.gender) && order.structuredData?.[field.key] !== undefined,
  )

  React.useEffect(() => {
    if (!printRequested) return

    let active = true
    let resolvedImageUrls: string[] = []
    let resolvedSignatureUrl = ""
    let afterPrintHandler: (() => void) | undefined

    const cleanup = () => {
      if (afterPrintHandler) window.removeEventListener("afterprint", afterPrintHandler)
      resolvedImageUrls.forEach((url) => URL.revokeObjectURL(url))
      if (resolvedSignatureUrl) URL.revokeObjectURL(resolvedSignatureUrl)
      resolvedImageUrls = []
      resolvedSignatureUrl = ""
    }

    const print = async () => {
      try {
        const loadedImages = await Promise.all(order.imageUrls.map((url) => loadAuthenticatedImage(url)))
        if (!active) {
          loadedImages.forEach((url) => { if (url) URL.revokeObjectURL(url) })
          return
        }
        resolvedImageUrls = loadedImages.filter((url): url is string => Boolean(url))
        setImages(loadedImages.flatMap((url, index) => url ? [{ url, index }] : []))
        const signature = signatureUrl ? await loadAuthenticatedImage(signatureUrl) : null
        if (signature) {
          resolvedSignatureUrl = signature
          setSignatureImage(signature)
        }
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())))

        const report = document.getElementById("ultrasound-print-root")
        const images = Array.from(report?.querySelectorAll("img") ?? [])
        await Promise.all(images.map((image) => image.decode()))
        if (!active) return

        afterPrintHandler = () => {
          cleanup()
          setImages([])
          setSignatureImage("")
          onPrintComplete()
        }
        window.addEventListener("afterprint", afterPrintHandler, { once: true })
        window.print()
      } catch (cause) {
        cleanup()
        setImages([])
        setSignatureImage("")
        onPrintComplete(cause instanceof Error ? `Unable to prepare the ultrasound report for printing: ${cause.message}` : "Unable to prepare the ultrasound report for printing.")
      }
    }

    void print()
    return () => {
      active = false
      cleanup()
    }
  }, [onPrintComplete, order.imageUrls, printRequested, signatureUrl])

  return createPortal(
    <main id="ultrasound-print-root" className="ultrasound-print-document" aria-hidden="true">
      <header className="ultrasound-print-header">
        {profile.logoUrl && <img className="ultrasound-print-logo" src={apiAssetUrl(profile.logoUrl)} alt={`${hospitalName} logo`} />}
        {!profile.logoUrl && <span className="ultrasound-print-logo-fallback" aria-label="Hospital logo">{hospitalName.slice(0, 2).toUpperCase()}</span>}
        <div className="ultrasound-print-hospital">
          <h1>{hospitalName}</h1>
          <p>{hospitalAddress}</p>
          <p>{hospitalPhone}</p>
        </div>
        <div className="ultrasound-print-title">
          <span>Diagnostic Imaging</span>
          <h2>Ultrasound Report</h2>
        </div>
      </header>

      <section className="ultrasound-print-patient" aria-label="Patient and scan details">
        <div><span>Patient name</span><strong>{present(patientName)}</strong></div>
        <div><span>MR number</span><strong>{present(order.patient?.mrNumber)}</strong></div>
        <div><span>Age</span><strong>{present(order.patient?.age)}</strong></div>
        <div><span>Gender</span><strong>{present(order.patient?.gender)}</strong></div>
        <div><span>Referring doctor</span><strong>{present(order.doctor?.user.name)}</strong></div>
        <div><span>Scan type</span><strong>{present(order.examType)}</strong></div>
        <div><span>Scan date</span><strong>{formatDateTime(scanDate)}</strong></div>
        <div><span>Report date</span><strong>{formatDateTime(new Date().toISOString())}</strong></div>
        <div><span>Technician</span><strong>{present(order.technician?.name)}</strong></div>
      </section>

      <section className="ultrasound-print-section">
        <h3>Findings</h3>
        <p>{present(order.findings)}</p>
      </section>
      <section className="ultrasound-print-section">
        <h3>Impression</h3>
        <p>{present(order.impression)}</p>
      </section>

      {structuredFields.length > 0 && <section className="ultrasound-print-structured">
        <h3>Structured observations</h3>
        <dl>{structuredFields.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{fieldDisplayValue(field, order.structuredData?.[field.key])}</dd></div>)}</dl>
      </section>}

      {images.length > 0 && <section className="ultrasound-print-images">
        <h3>Ultrasound Images</h3>
        <div className="ultrasound-print-image-grid">
          {images.map(({ url, index }) => (
            <figure key={url}>
              <img src={url} alt={`Ultrasound image ${index + 1}`} />
              <figcaption>{order.imageCaptions?.[index]?.trim() || `Image ${index + 1}`}</figcaption>
            </figure>
          ))}
        </div>
      </section>}

      <footer className="ultrasound-print-footer">
        <div className="ultrasound-print-signature">
          <span className="ultrasound-print-signature-line" />
          {signatureImage && <img className="ultrasound-print-signature-image" src={signatureImage} alt="Radiologist signature" />}
          <strong>{radiologist}</strong>
          <span>Radiologist</span>
        </div>
        <p>{profile.reportFooter?.trim() || "Computer generated report"}</p>
      </footer>
    </main>,
    document.body,
  )
}
