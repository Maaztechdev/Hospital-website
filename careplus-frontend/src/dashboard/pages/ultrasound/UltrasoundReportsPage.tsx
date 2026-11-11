import * as React from "react"
import { Download, FileText, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { formatCurrency, formatDate } from "@/dashboard/lib/format"
import { useToast } from "@/hooks/use-toast"
import { api, type ApiUltrasoundAnalyticsReport } from "@/lib/api"
import { toCsv } from "@/lib/csv"

type Period = "today" | "yesterday" | "week" | "month" | "all"
type DateRange = { from?: string; to?: string }

function hospitalToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function rangeFor(period: Period): DateRange {
  const today = hospitalToday()
  if (period === "today") return { from: today, to: today }
  if (period === "yesterday") {
    const yesterday = addDays(today, -1)
    return { from: yesterday, to: yesterday }
  }
  if (period === "week") {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay()
    return { from: addDays(today, -((weekday + 6) % 7)), to: today }
  }
  if (period === "month") return { from: `${today.slice(0, 7)}-01`, to: today }
  return {}
}

function breakdownRows(report: ApiUltrasoundAnalyticsReport) {
  const rows: Array<Array<string | number>> = [
    ["Breakdown", "Name", "Scan count", "Revenue"],
    ...report.byScanType.map((row) => ["Scan type", row.examType, row.count, row.revenue]),
    ...report.byTechnician.map((row) => ["Technician", row.technicianName, row.count, row.revenue]),
    ...report.byDoctor.map((row) => ["Doctor", row.doctorName, row.count, row.revenue]),
  ]
  return rows
}

export default function UltrasoundReportsPage() {
  const { toast } = useToast()
  const today = hospitalToday()
  const [period, setPeriod] = React.useState<Period>("today")
  const [from, setFrom] = React.useState(today)
  const [to, setTo] = React.useState(today)
  const [appliedRange, setAppliedRange] = React.useState<DateRange>(() => rangeFor("today"))
  const [report, setReport] = React.useState<ApiUltrasoundAnalyticsReport | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [exporting, setExporting] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setReport(await api.getUltrasoundAnalyticsReport(appliedRange.from, appliedRange.to))
    } catch (cause) {
      toast({ title: "Unable to load Ultrasound reports", description: cause instanceof Error ? cause.message : "Please try again.", variant: "error" })
    } finally {
      setLoading(false)
    }
  }, [appliedRange.from, appliedRange.to, toast])

  React.useEffect(() => { void load() }, [load])

  const choosePeriod = (nextPeriod: Period) => {
    setPeriod(nextPeriod)
    const nextRange = rangeFor(nextPeriod)
    setAppliedRange(nextRange)
    setFrom(nextRange.from ?? "")
    setTo(nextRange.to ?? "")
  }

  const applyRange = () => {
    if (!from || !to || from > to) {
      toast({ title: "Invalid date range", description: "Choose a start date and an end date on or after it.", variant: "error" })
      return
    }
    setPeriod("all")
    setAppliedRange({ from, to })
  }

  const resetRange = () => {
    const nextRange = rangeFor("today")
    setPeriod("today")
    setFrom(nextRange.from ?? "")
    setTo(nextRange.to ?? "")
    setAppliedRange(nextRange)
  }

  const exportCsv = () => {
    if (!report) return
    const rows = [
      ["Metric", "Value"],
      ["Period", appliedRange.from ? `${appliedRange.from} to ${appliedRange.to}` : "All"],
      ["Total scans", report.totalScans],
      ["Total revenue", report.totalRevenue],
      ["Discounts given", report.discountsGiven],
      ["Average turnaround hours", report.averageTurnaroundHours],
      [],
      ...breakdownRows(report),
    ]
    const blob = new Blob(["\uFEFF", toCsv(rows)], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "ultrasound-report.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  const exportPdf = async () => {
    if (!report) return
    setExporting(true)
    try {
      const { jsPDF } = await import("jspdf")
      const pdf = new jsPDF({ format: "a4", unit: "mm" })
      const pageHeight = pdf.internal.pageSize.getHeight()
      let y = 17
      const addLine = (text: string, bold = false) => {
        if (y > pageHeight - 14) { pdf.addPage(); y = 17 }
        pdf.setFont("helvetica", bold ? "bold" : "normal")
        pdf.setFontSize(bold ? 12 : 9)
        const lines = pdf.splitTextToSize(text, 180) as string[]
        pdf.text(lines, 14, y)
        y += lines.length * 4.5 + (bold ? 2 : 1)
      }
      addLine("Ultrasound Report", true)
      addLine(`Period: ${appliedRange.from ? `${formatDate(appliedRange.from)} – ${formatDate(appliedRange.to ?? appliedRange.from)}` : "All available records"}`)
      addLine(`Total scans: ${report.totalScans} · Revenue: ${formatCurrency(report.totalRevenue)} · Discounts: ${formatCurrency(report.discountsGiven)}`)
      addLine(`Average turnaround: ${report.averageTurnaroundHours} hours (n=${report.turnaroundSampleSize})`)
      addLine("By scan type", true)
      report.byScanType.forEach((row) => addLine(`${row.examType}: ${row.count} scans · ${formatCurrency(row.revenue)}`))
      addLine("By technician", true)
      report.byTechnician.forEach((row) => addLine(`${row.technicianName}: ${row.count} scans · ${formatCurrency(row.revenue)}`))
      addLine("By doctor", true)
      report.byDoctor.forEach((row) => addLine(`${row.doctorName}: ${row.count} scans · ${formatCurrency(row.revenue)}`))
      pdf.save("ultrasound-report.pdf")
    } catch (cause) {
      toast({ title: "Unable to export Ultrasound PDF", description: cause instanceof Error ? cause.message : "Please try again.", variant: "error" })
    } finally {
      setExporting(false)
    }
  }

  const summary = [
    { label: "Total scans", value: report?.totalScans ?? 0 },
    { label: "Total revenue", value: formatCurrency(report?.totalRevenue ?? 0) },
    { label: "Discounts given", value: formatCurrency(report?.discountsGiven ?? 0) },
    { label: "Avg. turnaround", value: `${report?.averageTurnaroundHours ?? 0} hrs` },
  ]

  return <div className="flex flex-col gap-5">
    <DashboardPageHeader title="Ultrasound Reports" action={<div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" />Refresh</Button>
      <Button variant="outline" size="sm" onClick={exportCsv} disabled={!report || loading}><Download className="h-4 w-4" />Export CSV</Button>
      <Button size="sm" onClick={() => void exportPdf()} disabled={!report || loading || exporting}><FileText className="h-4 w-4" />{exporting ? "Exporting…" : "Export PDF"}</Button>
    </div>} />

    <Card><CardContent className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Report timeframe">
        {(["today", "yesterday", "week", "month", "all"] as Period[]).map((item) => <button key={item} type="button" role="tab" aria-selected={period === item} onClick={() => choosePeriod(item)} className={`rounded-full border px-4 py-2 text-sm font-semibold capitalize ${period === item ? "border-[var(--cp-primary)] bg-[var(--cp-primary-light)] text-[var(--cp-primary)]" : "border-[var(--cp-border)] text-[var(--cp-ink-soft)]"}`}>{item}</button>)}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-xs font-medium text-[var(--cp-ink-soft)]">From<input aria-label="From date" type="date" className="block h-10 rounded-xl border border-[var(--cp-border)] bg-white px-3 text-sm text-[var(--cp-ink)]" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="space-y-1 text-xs font-medium text-[var(--cp-ink-soft)]">To<input aria-label="To date" type="date" className="block h-10 rounded-xl border border-[var(--cp-border)] bg-white px-3 text-sm text-[var(--cp-ink)]" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label>
        <Button size="sm" onClick={applyRange}>Apply</Button>
        <Button size="sm" variant="outline" onClick={resetRange}>Reset</Button>
        <p className="pb-2 text-xs text-[var(--cp-ink-soft)]">{appliedRange.from ? `${formatDate(appliedRange.from)} – ${formatDate(appliedRange.to ?? appliedRange.from)}` : "All available records"}</p>
      </div>
    </CardContent></Card>

    {loading && <p role="status" className="text-sm text-[var(--cp-ink-soft)]">Loading Ultrasound report data…</p>}
    {report && report.totalScans === 0 && !loading ? <Card><CardContent className="p-10 text-center text-sm text-[var(--cp-ink-soft)]">No scans in this timeframe.</CardContent></Card> : report && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summary.map((item) => <Card key={item.label}><CardContent className="p-4"><p className="text-xs text-[var(--cp-ink-soft)]">{item.label}</p><p className="mt-1 text-2xl font-bold text-[var(--cp-ink)]">{item.value}</p></CardContent></Card>)}
      </div>
      <p className="text-xs text-[var(--cp-ink-soft)]">Turnaround runs from order creation to report submission and is based on {report.turnaroundSampleSize} reported scans. Revenue is the recorded ultrasound fee less the recorded discount; cancelled orders are excluded.</p>
      <div className="grid gap-4 xl:grid-cols-3">
        <Breakdown title="By scan type" rows={report.byScanType.map((row) => [row.examType, row.count, row.revenue])} />
        <Breakdown title="By technician" rows={report.byTechnician.map((row) => [row.technicianName, row.count, row.revenue])} />
        <Breakdown title="By doctor" rows={report.byDoctor.map((row) => [row.doctorName, row.count, row.revenue])} />
      </div>
    </>}
  </div>
}

function Breakdown({ title, rows }: { title: string; rows: Array<[string, number, number]> }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent>
    {rows.length ? <div className="space-y-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-[var(--cp-border)] pb-2 text-xs font-semibold uppercase text-[var(--cp-ink-soft)]"><span>Name</span><span>Count</span><span>Revenue</span></div>
      {rows.map(([name, count, revenue], index) => <div key={`${name}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-[var(--cp-border)] pb-2 text-sm last:border-0"><span className="truncate">{name}</span><span className="cp-tabular font-semibold">{count}</span><span className="cp-tabular font-semibold">{formatCurrency(revenue)}</span></div>)}
    </div> : <p className="text-sm text-[var(--cp-ink-soft)]">No scans in this timeframe.</p>}
  </CardContent></Card>
}
