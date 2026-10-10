import * as React from "react"
import { apiAssetUrl, useHospitalProfile } from "@/lib/hospitalProfile"
import { formatCurrency, formatDate, formatDateTime } from "@/dashboard/lib/format"
import type { ApiPharmacySale, ApiPharmacySettings, ApiPrescription } from "@/lib/api"
import { describeFrequency } from "../../../../../careplus-backend/src/common/validation/prescription"

export type PrintLayout = "a4" | "receipt"

function PrintHeader({ title }: { title: string }) {
  const profile = useHospitalProfile()
  return <header className="pharmacy-print-header">
    {profile.logoUrl && <img src={apiAssetUrl(profile.logoUrl)} alt="" className="pharmacy-print-logo" />}
    <div><h1>{profile.name}</h1><p>{profile.address ?? ""}</p><p>{[profile.phone, profile.email].filter(Boolean).join(" · ")}</p></div>
    <strong>{title}</strong>
  </header>
}

function PrintField({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="pharmacy-print-field"><span>{label}</span><strong>{value || "—"}</strong></div>
}

export function InvoicePrintDocument({ sale, layout, pharmacySettings }: { sale: ApiPharmacySale; layout: PrintLayout; pharmacySettings?: ApiPharmacySettings | null }) {
  const profile = useHospitalProfile()
  const name = pharmacySettings ? pharmacySettings.name : profile.name
  const address = pharmacySettings ? pharmacySettings.address : profile.address
  const phone = pharmacySettings ? pharmacySettings.phone : profile.phone
  const logoUrl = pharmacySettings ? pharmacySettings.logoUrl : profile.logoUrl
  return <article id="pharmacy-print-root" className={`pharmacy-print-document pharmacy-print-${layout}`}>
    <header className="pharmacy-print-header">
      {logoUrl && <img src={apiAssetUrl(logoUrl)} alt="" className="pharmacy-print-logo" />}
      <div><h1>{name}</h1><p>{address ?? ""}</p><p>{phone ?? ""}</p></div>
      <strong>Pharmacy Invoice</strong>
    </header>
    <section className="pharmacy-print-meta">
      <PrintField label="Invoice number" value={sale.invoice.invoiceNumber} />
      <PrintField label="Date" value={formatDateTime(sale.invoice.createdAt ?? new Date().toISOString())} />
      <PrintField label="Customer / patient" value={sale.customerName ?? (sale.invoice.patient ? `${sale.invoice.patient.firstName} ${sale.invoice.patient.lastName}`.trim() : "Walk-in")} />
      <PrintField label="Payment method" value={sale.paymentMethod.replaceAll("_", " ")} />
      <PrintField label="Cashier" value={sale.cashier.name} />
    </section>
    <table className="pharmacy-print-table"><thead><tr><th>Item / batch</th><th className="number">Qty</th><th className="number">Unit price</th><th className="number">Amount</th></tr></thead><tbody>
      {sale.items.map((item) => <tr key={item.id}><td>{item.medicine.name}<small>Batch {item.batch.batchNumber} · Exp {formatDate(item.batch.expiryDate)}</small></td><td className="number">{item.quantity}</td><td className="number">{formatCurrency(Number(item.unitPrice))}</td><td className="number">{formatCurrency(Number(item.subtotal))}</td></tr>)}
    </tbody></table>
    <section className="pharmacy-print-totals">
      <div><span>Subtotal</span><strong>{formatCurrency(Number(sale.invoice.subtotal ?? sale.subtotal ?? 0))}</strong></div>
      <div><span>Discount</span><strong>−{formatCurrency(Number(sale.invoice.discountAmount ?? sale.discountAmount ?? 0))}</strong></div>
      <div><span>Tax</span><strong>{formatCurrency(Number(sale.invoice.taxAmount ?? sale.taxAmount ?? 0))}</strong></div>
      <div className="grand"><span>Total</span><strong>{formatCurrency(Number(sale.invoice.grandTotal ?? sale.totalAmount))}</strong></div>
    </section>
    <footer className="pharmacy-print-footer">Thank you for choosing {name}.</footer>
  </article>
}

export function PrescriptionPrintDocument({ prescription, layout }: { prescription: ApiPrescription; layout: PrintLayout }) {
  const profile = useHospitalProfile()
  const patientName = prescription.patient ? `${prescription.patient.firstName} ${prescription.patient.lastName}`.trim() : prescription.patientId
  const doctorName = prescription.doctor?.user.name ?? prescription.doctorId
  return <article id="pharmacy-print-root" className={`pharmacy-print-document pharmacy-print-${layout}`}>
    <PrintHeader title="Prescription" />
    <section className="pharmacy-print-meta">
      <PrintField label="Prescription ID" value={prescription.id} />
      <PrintField label="Date" value={formatDate(prescription.signedAt ?? prescription.createdAt)} />
      <PrintField label="Patient" value={patientName} />
      <PrintField label="Doctor" value={doctorName} />
    </section>
    <table className="pharmacy-print-table"><thead><tr><th>Medicine</th><th>Dose</th><th>Route</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead><tbody>
      {prescription.items.map((item) => <tr key={item.id}><td>{item.medicineName}</td><td>{item.doseAmount != null && item.doseUnit ? `${item.doseAmount} ${item.doseUnit}` : item.dosage || "—"}</td><td>{item.route || "—"}</td><td>{item.frequencyCode ? `${item.frequencyCode} — ${describeFrequency(item.frequencyCode)}` : item.frequency || "—"}</td><td>{item.durationValue != null && item.durationUnit ? `${item.durationValue} ${item.durationUnit}` : item.durationDays ? `${item.durationDays} days` : "—"}</td><td>{item.instructions || "—"}</td></tr>)}
    </tbody></table>
    <section className="pharmacy-print-signature"><PrintField label="Signed by" value={doctorName} /><PrintField label="Status" value={prescription.status} /></section>
    <footer className="pharmacy-print-footer">{profile.name} · Keep this prescription for your records.</footer>
  </article>
}