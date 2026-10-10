import * as React from "react"
import { useParams } from "react-router-dom"
import { CheckCircle2, CircleX, LoaderCircle, ShieldCheck } from "lucide-react"
import { api, describeApiError, type ApiPublicLabReportVerification } from "@/lib/api"

export default function LabReportVerification() {
  const { orderNumber = "" } = useParams()
  const [report, setReport] = React.useState<ApiPublicLabReportVerification | null>(null)
  const [error, setError] = React.useState("")

  React.useEffect(() => {
    let active = true
    api.verifyPublicLabReport(orderNumber)
      .then((result) => { if (active) setReport(result) })
      .catch((cause) => { if (active) setError(describeApiError(cause)) })
    return () => { active = false }
  }, [orderNumber])

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--cp-bg)] px-4 py-10">
      <section className="w-full max-w-lg rounded-2xl border border-[var(--cp-border)] bg-white p-8 text-center shadow-sm">
        <ShieldCheck className="mx-auto h-10 w-10 text-[var(--cp-primary)]" />
        <h1 className="mt-4 text-xl font-bold text-[var(--cp-ink)]">Lab report verification</h1>
        <p className="mt-2 text-sm text-[var(--cp-ink-soft)]">Report number <strong className="cp-tabular">{orderNumber}</strong></p>
        {!report && !error && <p className="mt-6 flex items-center justify-center gap-2 text-sm"><LoaderCircle className="h-4 w-4 animate-spin" /> Checking report status…</p>}
        {error && <p role="alert" className="mt-6 text-sm text-[var(--cp-critical)]">{error}</p>}
        {report && (report.isAuthentic
          ? <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-left">
            <CheckCircle2 className="h-6 w-6 text-emerald-700" />
            <p className="mt-2 font-semibold text-emerald-900">Verified report found</p>
            <p className="mt-1 text-sm text-emerald-800">This report number is currently verified by the laboratory.{report.amended ? " The current report version is amended." : ""}</p>
          </div>
          : <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-left">
            <CircleX className="h-6 w-6 text-rose-700" />
            <p className="mt-2 font-semibold text-rose-900">Unable to verify this report</p>
            <p className="mt-1 text-sm text-rose-800">No currently verified report matches this number. Contact the laboratory for assistance.</p>
          </div>)}
        <p className="mt-6 text-xs text-[var(--cp-ink-soft)]">This check confirms report status only. It does not display patient information.</p>
      </section>
    </main>
  )
}
