import type { Invoice, Payment } from "@/dashboard/types"
import { formatCurrency, formatDateTime } from "@/dashboard/lib/format"
import { apiAssetUrl, useHospitalProfile } from "@/lib/hospitalProfile"

export function InvoiceReceiptPrint({ invoice, payment }: { invoice: Invoice; payment: Payment }) {
  const profile = useHospitalProfile()
  const isRefund = payment.type === "REFUND"

  return (
    <article id="pharmacy-print-root" className="pharmacy-print-document pharmacy-print-receipt">
      <header className="pharmacy-print-header">
        {profile.logoUrl && <img src={apiAssetUrl(profile.logoUrl)} alt="" className="pharmacy-print-logo" />}
        <div>
          <h1>{profile.name}</h1>
          {profile.address && <p>{profile.address}</p>}
          {profile.phone && <p>{profile.phone}</p>}
        </div>
        <strong>{isRefund ? "Refund Receipt" : "Payment Receipt"}</strong>
      </header>

      <section className="pharmacy-print-meta">
        <div className="pharmacy-print-field"><span>Invoice</span><strong>{invoice.invoiceNumber ?? invoice.id}</strong></div>
        <div className="pharmacy-print-field"><span>Date</span><strong>{formatDateTime(payment.date)}</strong></div>
        <div className="pharmacy-print-field"><span>Patient</span><strong>{invoice.patientName}</strong></div>
        <div className="pharmacy-print-field"><span>MR Number</span><strong>{invoice.mrNumber}</strong></div>
      </section>

      <table className="pharmacy-print-table">
        <tbody>
          <tr><th>Transaction</th><td>{isRefund ? "Refund" : "Payment"}</td></tr>
          <tr><th>Amount</th><td className="number">{formatCurrency(payment.amount)}</td></tr>
          <tr><th>Method</th><td>{payment.method}</td></tr>
          <tr><th>Received by</th><td>{payment.receivedBy ?? "Billing staff"}</td></tr>
          <tr><th>Reference / Reason</th><td>{[payment.referenceNumber, payment.reason, payment.notes].filter(Boolean).join(" · ") || "—"}</td></tr>
          <tr><th>Invoice total</th><td className="number">{formatCurrency(invoice.grandTotal ?? 0)}</td></tr>
          <tr><th>Balance</th><td className="number">{formatCurrency(invoice.balanceAmount ?? 0)}</td></tr>
        </tbody>
      </table>

      <footer className="pharmacy-print-footer">Thank you for choosing {profile.name}.</footer>
    </article>
  )
}
