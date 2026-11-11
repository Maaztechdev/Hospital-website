import * as React from "react"
import { apiAssetUrl, useHospitalProfile } from "@/lib/hospitalProfile"
import { formatCurrency, formatDate, formatDateTime } from "@/dashboard/lib/format"
import type { ApiPharmacySale, ApiPharmacySettings, ApiPrescription } from "@/lib/api"

export type PrintLayout = "a4" | "receipt"

function describeFrequency(code: string): string {
  switch (code.toUpperCase()) {
    case "OD": return "Once daily"
    case "BD": return "Twice daily"
    case "TDS": return "Three times daily"
    case "QID": return "Four times daily"
    case "SOS": return "As needed"
    case "PRN": return "When required"
    case "STAT": return "Immediately"
    default: return code
  }
}

function PrintHeader({ title }: { title: string }) {
  const profile = useHospitalProfile()
  return (
    <header className="pharmacy-print-header">
      {profile.logoUrl && <img src={apiAssetUrl(profile.logoUrl)} alt="" className="pharmacy-print-logo" />}
      <div>
        <h1>{profile.name}</h1>
        <p>{profile.address ?? ""}</p>
        <p>{[profile.phone, profile.email].filter(Boolean).join(" · ")}</p>
      </div>
      <strong>{title}</strong>
    </header>
  )
}

function PrintField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="pharmacy-print-field">
      <span>{label}</span>
      <strong>{value || "—"}</strong>
    </div>
  )
}

export function InvoicePrintDocument({
  sale,
  layout,
  pharmacySettings,
}: {
  sale: ApiPharmacySale
  layout: PrintLayout
  pharmacySettings?: ApiPharmacySettings | null
}) {
  const profile = useHospitalProfile()
  const name = pharmacySettings?.name || profile.name || "Khalida Medicare Hospital"
  const address = pharmacySettings?.address || profile.address || ""
  const phone = pharmacySettings?.phone || profile.phone || ""
  const logoUrl = pharmacySettings?.logoUrl || profile.logoUrl

  // Exact calculations from saved transaction (no hardcoded values)
  const invoice = sale.invoice
  const subtotal = Number(invoice?.subtotal ?? sale.subtotal ?? 0)
  const discountAmount = Number(invoice?.discountAmount ?? sale.discountAmount ?? 0)
  const taxAmount = Number(invoice?.taxAmount ?? sale.taxAmount ?? 0)
  const payable = Number(invoice?.grandTotal ?? sale.totalAmount ?? (subtotal - discountAmount + taxAmount))
  const paid = Number(invoice?.paidAmount ?? (sale.paymentMethod === "CREDIT" ? 0 : payable))
  const balance = Number(invoice?.balanceAmount ?? Math.max(0, payable - paid))

  // Determine status
  const status = (invoice?.status || (balance <= 0 ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID")).toUpperCase()

  // Determine patient details
  const patient = invoice?.patient
  const patientDisplay = patient
    ? `${patient.firstName} ${patient.lastName} (MR: ${patient.mrNumber})`
    : sale.customerName
      ? `${sale.customerName} ${sale.customerPhone ? `(${sale.customerPhone})` : ""}`
      : "Walk-in Customer"

  // Determine prescription reference
  const anySale = sale as unknown as { prescription?: { id: string }; prescriptionId?: string }
  const prescriptionRef = anySale.prescription?.id
    || anySale.prescriptionId
    || invoice?.payments?.find((p) => p.notes && p.notes.toLowerCase().includes("prescription"))?.notes
    || "Direct Pharmacy Sale"

  const paymentMethodLabel = (sale.paymentMethod || "CASH").replace(/_/g, " ")

  return (
    <article id="pharmacy-print-root" className={`pharmacy-print-document pharmacy-print-${layout}`}>
      <header className="pharmacy-print-header">
        {logoUrl && <img src={apiAssetUrl(logoUrl)} alt="" className="pharmacy-print-logo" />}
        <div>
          <h1>{name}</h1>
          {address && <p>{address}</p>}
          {[phone, profile.email].filter(Boolean).length > 0 && (
            <p>{[phone, profile.email].filter(Boolean).join(" · ")}</p>
          )}
        </div>
        <div style={{ textAlign: "right", marginLeft: "auto" }}>
          <strong style={{ fontSize: "14px", textTransform: "uppercase" }}>Pharmacy Invoice</strong>
          <div style={{ fontSize: "11px", fontWeight: "bold", marginTop: "4px" }}>
            Status: <span style={{ color: status === "PAID" ? "#047857" : status === "PARTIAL" ? "#b45309" : "#b91c1c" }}>{status}</span>
          </div>
        </div>
      </header>

      <section className="pharmacy-print-meta">
        <PrintField label="Invoice Number" value={invoice?.invoiceNumber ?? "—"} />
        <PrintField label="Date & Time" value={formatDateTime(invoice?.createdAt ?? (sale as unknown as { createdAt?: string }).createdAt ?? new Date().toISOString())} />
        <PrintField label="Patient / Customer" value={patientDisplay} />
        <PrintField label="Prescription Ref" value={prescriptionRef} />
        <PrintField label="Payment Method" value={paymentMethodLabel} />
        <PrintField label="Cashier / Dispenser" value={sale.cashier?.name ?? "Pharmacist"} />
      </section>

      <table className="pharmacy-print-table">
        <thead>
          <tr>
            <th style={{ width: "4%" }}>#</th>
            <th style={{ width: "36%" }}>Medicine / Batch</th>
            <th style={{ width: "16%" }}>Expiry</th>
            <th className="number" style={{ width: "8%" }}>Qty</th>
            <th className="number" style={{ width: "12%" }}>Unit Price</th>
            <th className="number" style={{ width: "10%" }}>Discount</th>
            <th className="number" style={{ width: "14%" }}>Line Total</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((item, index) => {
            const unitPrice = Number(item.unitPrice)
            const itemDiscount = Number(item.discount || 0)
            const itemSubtotal = Number(item.subtotal)
            return (
              <tr key={item.id || index}>
                <td>{index + 1}</td>
                <td>
                  <strong>{item.medicine?.name || "Medicine"}</strong>
                  {(item.medicine as { name: string; genericName?: string })?.genericName && <small>{(item.medicine as { name: string; genericName?: string }).genericName}</small>}
                  <small>Batch: {item.batch?.batchNumber || "—"}</small>
                </td>
                <td>{item.batch?.expiryDate ? formatDate(item.batch.expiryDate) : "—"}</td>
                <td className="number">{item.quantity}</td>
                <td className="number">{formatCurrency(unitPrice)}</td>
                <td className="number">{itemDiscount > 0 ? `-${formatCurrency(itemDiscount)}` : "—"}</td>
                <td className="number font-semibold">{formatCurrency(itemSubtotal)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <section className="pharmacy-print-totals" style={{ pageBreakInside: "avoid", breakInside: "avoid" }}>
        <div>
          <span>Subtotal</span>
          <strong>{formatCurrency(subtotal)}</strong>
        </div>
        {discountAmount > 0 && (
          <div>
            <span>Discount {(invoice as { discountReason?: string })?.discountReason ? `(${(invoice as { discountReason?: string }).discountReason})` : ""}</span>
            <strong style={{ color: "#047857" }}>−{formatCurrency(discountAmount)}</strong>
          </div>
        )}
        {taxAmount > 0 && (
          <div>
            <span>Tax</span>
            <strong>{formatCurrency(taxAmount)}</strong>
          </div>
        )}
        <div className="grand">
          <span>Net Payable Total</span>
          <strong>{formatCurrency(payable)}</strong>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", paddingTop: "4px" }}>
          <span>Amount Paid:</span>
          <strong>{formatCurrency(paid)}</strong>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", paddingTop: "2px" }}>
          <span>Outstanding Balance:</span>
          <strong style={{ color: balance > 0 ? "#b91c1c" : "#047857" }}>{formatCurrency(balance)}</strong>
        </div>
      </section>

      <footer className="pharmacy-print-footer">
        <p>Thank you for choosing {name}. Computer-generated invoice. No physical signature required.</p>
        <p style={{ fontSize: "9px", color: "#666", marginTop: "2px" }}>Keep this receipt for medicine returns or exchanges within 3 days in original packaging.</p>
      </footer>
    </article>
  )
}

export function PrescriptionPrintDocument({ prescription, layout }: { prescription: ApiPrescription; layout: PrintLayout }) {
  const profile = useHospitalProfile()
  const patientName = prescription.patient ? `${prescription.patient.firstName} ${prescription.patient.lastName}`.trim() : prescription.patientId
  const doctorName = prescription.doctor?.user.name ?? prescription.doctorId
  return (
    <article id="pharmacy-print-root" className={`pharmacy-print-document pharmacy-print-${layout}`}>
      <PrintHeader title="Prescription" />
      <section className="pharmacy-print-meta">
        <PrintField label="Prescription ID" value={prescription.id} />
        <PrintField label="Date" value={formatDate(prescription.signedAt ?? prescription.createdAt)} />
        <PrintField label="Patient" value={patientName} />
        <PrintField label="Doctor" value={doctorName} />
      </section>
      <table className="pharmacy-print-table">
        <thead>
          <tr>
            <th>Medicine</th>
            <th>Dose</th>
            <th>Route</th>
            <th>Frequency</th>
            <th>Duration</th>
            <th>Instructions</th>
          </tr>
        </thead>
        <tbody>
          {prescription.items.map((item) => (
            <tr key={item.id}>
              <td>{item.medicineName}</td>
              <td>{item.doseAmount != null && item.doseUnit ? `${item.doseAmount} ${item.doseUnit}` : item.dosage || "—"}</td>
              <td>{item.route || "—"}</td>
              <td>{item.frequencyCode ? `${item.frequencyCode} — ${describeFrequency(item.frequencyCode)}` : item.frequency || "—"}</td>
              <td>{item.durationValue != null && item.durationUnit ? `${item.durationValue} ${item.durationUnit}` : item.durationDays ? `${item.durationDays} days` : "—"}</td>
              <td>{item.instructions || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="pharmacy-print-signature">
        <PrintField label="Signed by" value={doctorName} />
        <PrintField label="Status" value={prescription.status} />
      </section>
      <footer className="pharmacy-print-footer">{profile.name} · Keep this prescription for your records.</footer>
    </article>
  )
}