import * as React from "react"
import { Download, FileText, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { formatCurrency, formatDate } from "@/dashboard/lib/format"
import { toCsv } from "@/lib/csv"
import { api, type ApiLabReports } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"

type Period = "today" | "yesterday" | "week" | "month" | "all" | "custom"

function hospitalToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function periodRange(period: Period, customFrom: string, customTo: string) {
  const today = hospitalToday()
  if (period === "today") return { from: today, to: today }
  if (period === "yesterday") {
    const yesterday = addDays(today, -1)
    return { from: yesterday, to: yesterday }
  }
  if (period === "week") {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay()
    const mondayOffset = (weekday + 6) % 7
    return { from: addDays(today, -mondayOffset), to: today }
  }
  if (period === "month") return { from: `${today.slice(0, 7)}-01`, to: today }
  if (period === "custom") return { from: customFrom, to: customTo }
  return { from: "", to: "" }
}

function reportRows(report: ApiLabReports) {
  const rows: Array<Array<string | number | null | undefined>> = [
    ["Section", "Metric", "Value"],
    ["Summary", "Orders / tests", report.orderCount],
    ["Summary", "Average turnaround (hours)", report.averageTurnaroundHours],
    ["Summary", "Turnaround sample size", report.turnaroundSampleSize],
    ["Results", "Abnormal orders", report.abnormalCount],
    ["Results", "Critical orders", report.criticalCount],
    ["Samples", "Rejected samples", report.rejectedSampleCount],
  ]
  if (report.revenue) {
    rows.push(["Revenue", "Billed", report.revenue.billed], ["Revenue", "Collected", report.revenue.collected], ["Revenue", "Outstanding", report.revenue.outstanding])
  }
  report.testsByCategory.forEach((item) => rows.push(["Tests by category", item.category, item.count]))
  report.doctorReferrals.forEach((item) => rows.push(["Doctor referrals", item.doctorName, item.count]))
  report.technicianCounts.forEach((item) => rows.push(["Technician counts", item.technicianName, item.count]))
  report.rejectedSamples.forEach((item) => rows.push(["Rejected samples", `${item.orderNumber} · ${item.patientName} · ${item.testName}`, item.reason]))
  return rows
}

export default function LabReportsPage() {
  const { toast } = useToast()
  const [period, setPeriod] = React.useState<Period>("today")
  const [customFrom, setCustomFrom] = React.useState(hospitalToday())
  const [customTo, setCustomTo] = React.useState(hospitalToday())
  const [report, setReport] = React.useState<ApiLabReports | null>(null)
  const [loading, setLoading] = React.useState(true)
  const range = periodRange(period, customFrom, customTo)

  const load = React.useCallback(async () => {
    if (period === "custom" && (!range.from || !range.to || range.from > range.to)) {
      setReport(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setReport(await api.getLabReports(range.from || undefined, range.to || undefined))
    } catch (error) {
      toast({ title: "Unable to load Lab reports", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
    } finally {
      setLoading(false)
    }
  }, [period, range.from, range.to, toast])

  React.useEffect(() => { void load() }, [load])

  function exportCsv() {
    if (!report) return
    const blob = new Blob([toCsv(reportRows(report))], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "lab-report.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  async function exportPdf() {
    if (!report) return
    try {
      const { jsPDF } = await import("jspdf")
      const pdf = new jsPDF({ format: "a4", unit: "mm" })
      const pageHeight = pdf.internal.pageSize.getHeight()
      let y = 17
      const addLine = (line: string, bold = false) => {
        if (y > pageHeight - 14) { pdf.addPage(); y = 17 }
        pdf.setFont("helvetica", bold ? "bold" : "normal")
        pdf.setFontSize(bold ? 12 : 9)
        const wrapped = pdf.splitTextToSize(line, 180) as string[]
        pdf.text(wrapped, 14, y)
        y += wrapped.length * 4.5 + (bold ? 2 : 1)
      }
      addLine("Laboratory Report", true)
      addLine(`Period: ${range.from ? `${formatDate(range.from)} – ${formatDate(range.to)}` : "All dates"}`)
      addLine(`Orders/tests: ${report.orderCount} · Average turnaround: ${report.averageTurnaroundHours} hours · Abnormal: ${report.abnormalCount} · Critical: ${report.criticalCount}`)
      if (report.revenue) addLine(`Revenue — billed: ${formatCurrency(report.revenue.billed)} · collected: ${formatCurrency(report.revenue.collected)} · outstanding: ${formatCurrency(report.revenue.outstanding)}`)
      addLine("Tests by category", true)
      report.testsByCategory.forEach((item) => addLine(`${item.category}: ${item.count}`))
      addLine("Doctor referrals", true)
      report.doctorReferrals.forEach((item) => addLine(`${item.doctorName}: ${item.count}`))
      addLine("Technician counts", true)
      report.technicianCounts.forEach((item) => addLine(`${item.technicianName}: ${item.count}`))
      addLine(`Rejected samples (${report.rejectedSampleCount})`, true)
      report.rejectedSamples.forEach((item) => addLine(`${formatDate(item.rejectedAt)} · ${item.orderNumber} · ${item.patientName} · ${item.testName} · ${item.reason}`))
      pdf.save("lab-report.pdf")
    } catch (error) {
      toast({ title: "Unable to export Lab report PDF", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
    }
  }

  const cards = [
    { label: "Tests ordered", value: report?.orderCount ?? 0 },
    { label: "Average turnaround", value: `${report?.averageTurnaroundHours ?? 0} hrs` },
    { label: "Abnormal", value: report?.abnormalCount ?? 0 },
    { label: "Critical", value: report?.criticalCount ?? 0 },
    { label: "Rejected samples", value: report?.rejectedSampleCount ?? 0 },
  ]

  return <div className="flex flex-col gap-5">
    <DashboardPageHeader title="Lab Reports" action={<div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" />Refresh</Button><Button variant="outline" size="sm" onClick={exportCsv} disabled={!report}><Download className="h-4 w-4" />Export CSV</Button><Button size="sm" onClick={() => void exportPdf()} disabled={!report}><FileText className="h-4 w-4" />Export PDF</Button></div>} />
    <Card><CardContent className="flex flex-wrap items-end gap-3 p-4">
      <label className="space-y-1 text-xs font-medium text-[var(--cp-ink-soft)]">Date range<select aria-label="Date range" className="block h-10 min-w-48 rounded-xl border border-[var(--cp-border)] bg-white px-3 text-sm text-[var(--cp-ink)]" value={period} onChange={(event) => setPeriod(event.target.value as Period)}><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="week">Week</option><option value="month">Month</option><option value="all">All</option><option value="custom">Custom range</option></select></label>
      {period === "custom" && <><label className="space-y-1 text-xs font-medium text-[var(--cp-ink-soft)]">From<input aria-label="From date" type="date" className="block h-10 rounded-xl border border-[var(--cp-border)] bg-white px-3 text-sm text-[var(--cp-ink)]" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} /></label><label className="space-y-1 text-xs font-medium text-[var(--cp-ink-soft)]">To<input aria-label="To date" type="date" className="block h-10 rounded-xl border border-[var(--cp-border)] bg-white px-3 text-sm text-[var(--cp-ink)]" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} /></label></>}
      <p className="pb-2 text-xs text-[var(--cp-ink-soft)]">{range.from ? `${formatDate(range.from)} – ${formatDate(range.to)}` : "All available Lab records"}</p>
    </CardContent></Card>
    {loading && <p className="text-sm text-[var(--cp-ink-soft)]">Loading Lab report data…</p>}
    {period === "custom" && (!range.from || !range.to || range.from > range.to) && <p role="alert" className="text-sm text-[var(--cp-critical)]">Choose a valid start and end date.</p>}
    {report && <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{cards.map((card) => <Card key={card.label}><CardContent className="p-4"><p className="text-xs text-[var(--cp-ink-soft)]">{card.label}</p><p className="mt-1 text-2xl font-bold text-[var(--cp-ink)]">{card.value}</p></CardContent></Card>)}</div>
      {report.revenue && <Card><CardHeader><CardTitle>Lab revenue</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-3">{[["Billed", report.revenue.billed], ["Collected", report.revenue.collected], ["Outstanding", report.revenue.outstanding]].map(([label, value]) => <div key={String(label)}><p className="text-xs text-[var(--cp-ink-soft)]">{label}</p><p className="cp-tabular text-xl font-bold text-[var(--cp-ink)]">{formatCurrency(Number(value))}</p></div>)}</CardContent></Card>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown title="Tests by category" rows={report.testsByCategory.map((item) => [item.category, item.count])} />
        <Breakdown title="Doctor-wise referrals" rows={report.doctorReferrals.map((item) => [item.doctorName, item.count])} />
        <Breakdown title="Technician-wise results" rows={report.technicianCounts.map((item) => [item.technicianName, item.count])} />
        <Breakdown title="Rejected samples" rows={report.rejectedSamples.map((item) => [`${item.orderNumber} · ${item.patientName} · ${item.testName}`, `${item.reason} · ${formatDate(item.rejectedAt)}`])} emptyText="No rejected samples in this period." />
      </div>
      <p className="text-xs text-[var(--cp-ink-soft)]">Turnaround average is based on {report.turnaroundSampleSize} completed tests. Rejected sample total: {report.rejectedSampleCount}.</p>
    </>}
  </div>
}

function Breakdown({ title, rows, emptyText = "No records for this period." }: { title: string; rows: Array<[string, string | number]>; emptyText?: string }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent>
    {rows.length ? <div className="space-y-2">{rows.map(([label, value], index) => <div key={`${label}-${index}`} className="flex justify-between gap-3 border-b border-[var(--cp-border)] pb-2 text-sm last:border-0"><span>{label}</span><span className="cp-tabular font-semibold">{value}</span></div>)}</div> : <p className="text-sm text-[var(--cp-ink-soft)]">{emptyText}</p>}
  </CardContent></Card>
}
