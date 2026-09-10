import * as React from "react"
import { Printer, Download } from "lucide-react"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { FilterBar, FilterSelect } from "@/dashboard/components/Primitives"
import { LineChartWidget, BarChartWidget, DonutChartWidget } from "@/dashboard/components/charts/Charts"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { WARD_TYPES, bedsSummary } from "@/dashboard/data/wardData"
import { api } from "@/lib/api"

function ReportCard({ title, children, onExport }: { title: string; children: React.ReactNode; onExport?: () => void }) {
  return (
    <div className="rounded-2xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-4 cp-shadow">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-bold text-[var(--cp-ink)]">{title}</p>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => window.print()}><Printer className="h-3.5 w-3.5" /> Print</Button>
          <Button variant="ghost" size="sm" onClick={onExport}><Download className="h-3.5 w-3.5" /> Export</Button>
        </div>
      </div>
      {children}
    </div>
  )
}

export default function ReportsPage() {
  const { beds, admissions, surgeries, invoices, doctors } = useDashboard()
  const [dateRange, setDateRange] = React.useState("7d")
  const [department, setDepartment] = React.useState("all")
  const [ward, setWard] = React.useState("all")
  const [reportData, setReportData] = React.useState({ appointments: [] as Array<{ status: string; count: number }>, surgeries: [] as Array<{ status: string; count: number }>, revenue: null as Awaited<ReturnType<typeof api.getReportsRevenueSummary>> | null, productivity: [] as Awaited<ReturnType<typeof api.getReportsDoctorProductivity>>, lowStock: 0, nearExpiry: 0, turnaround: 0 })
  React.useEffect(() => {
    const to = new Date().toISOString().slice(0, 10)
    const fromDate = new Date(); fromDate.setDate(fromDate.getDate() - Number(dateRange.replace("d", "")))
    const from = fromDate.toISOString().slice(0, 10)
    Promise.all([api.getReportsAppointmentStats(from, to), api.getReportsSurgeryStats(to), api.getReportsRevenueSummary(from, to), api.getReportsDoctorProductivity(from, to), api.getReportsLowStock(), api.getReportsNearExpiry(), api.getReportsLabTurnaround(from, to)])
      .then(([appointments, surgeries, revenue, productivity, lowStock, nearExpiry, turnaround]) => setReportData({ appointments, surgeries, revenue, productivity, lowStock: lowStock.length, nearExpiry: nearExpiry.length, turnaround: turnaround.averageTurnaroundHours }))
      .catch(() => undefined)
  }, [dateRange])

  function exportReport() {
    const rows = [["Metric", "Value"], ["Low stock medicines", String(reportData.lowStock)], ["Near expiry medicines", String(reportData.nearExpiry)], ["Average lab turnaround (hours)", String(reportData.turnaround)]]
    const blob = new Blob([rows.map((row) => row.join(",")).join("\n")], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "careplus-report.csv"; link.click(); URL.revokeObjectURL(url)
  }

  const summary = bedsSummary(beds)

  const occupancyByWard = WARD_TYPES.map((w) => ({
    label: w.replace(" Ward", "").replace(" Room", ""),
    value: bedsSummary(beds.filter((b) => b.ward === w)).occupancyPct,
  }))

  const admissionsTrend = reportData.appointments.map((item) => ({ label: item.status, value: item.count }))

  const surgeriesByStatus = reportData.surgeries.map((item) => ({ label: item.status, value: item.count }))

  const revenueByDept = reportData.productivity.map((item) => ({ label: item.doctorName, value: item.consultationCount }))

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader title="Reports" />

      <div className="sticky top-16 z-20 sm:top-[68px]">
        <FilterBar>
          <FilterSelect label="Date range" value={dateRange} onChange={setDateRange} options={[{ value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" }, { value: "90d", label: "Last quarter" }]} />
          <FilterSelect label="Department" value={department} onChange={setDepartment} options={[{ value: "all", label: "All departments" }, ...[...new Set(doctors.map((d) => d.department))].map((d) => ({ value: d, label: d }))]} />
          <FilterSelect label="Ward" value={ward} onChange={setWard} options={[{ value: "all", label: "All wards" }, ...WARD_TYPES.map((w) => ({ value: w, label: w }))]} />
        </FilterBar>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ReportCard title="Bed Occupancy by Ward (%)" onExport={exportReport}>
          <BarChartWidget data={occupancyByWard} />
          <p className="mt-2 text-xs text-[var(--cp-ink-soft)]">Overall occupancy: <span className="cp-tabular font-semibold text-[var(--cp-ink)]">{summary.occupancyPct}%</span></p>
        </ReportCard>

        <ReportCard title="Appointment Statistics" onExport={exportReport}>
          <LineChartWidget data={admissionsTrend} />
        </ReportCard>

        <ReportCard title="Surgeries by Status" onExport={exportReport}>
          <DonutChartWidget data={surgeriesByStatus} />
        </ReportCard>

        <ReportCard title="Doctor Productivity" onExport={exportReport}>
          <BarChartWidget data={revenueByDept} />
        </ReportCard>
      </div>

      {/* Responsive table -> cards on mobile */}
      <ReportCard title="Ward Summary">
        <div className="hidden overflow-hidden rounded-lg border border-[var(--cp-border)] sm:block">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--cp-border)] bg-[var(--cp-surface-warm)] text-left text-xs font-semibold uppercase tracking-wide text-[var(--cp-ink-soft)]">
                <th className="px-4 py-2.5">Ward</th><th className="px-4 py-2.5">Total</th><th className="px-4 py-2.5">Occupied</th><th className="px-4 py-2.5">Available</th><th className="px-4 py-2.5">Occupancy</th>
              </tr>
            </thead>
            <tbody>
              {WARD_TYPES.map((w) => {
                const s = bedsSummary(beds.filter((b) => b.ward === w))
                return (
                  <tr key={w} className="border-b border-[var(--cp-border)] last:border-0">
                    <td className="px-4 py-2.5 font-medium text-[var(--cp-ink)]">{w}</td>
                    <td className="cp-tabular px-4 py-2.5">{s.total}</td>
                    <td className="cp-tabular px-4 py-2.5">{s.occupied}</td>
                    <td className="cp-tabular px-4 py-2.5">{s.available}</td>
                    <td className="cp-tabular px-4 py-2.5">{s.occupancyPct}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-2 sm:hidden">
          {WARD_TYPES.map((w) => {
            const s = bedsSummary(beds.filter((b) => b.ward === w))
            return (
              <div key={w} className="rounded-lg border border-[var(--cp-border)] p-3">
                <p className="font-semibold text-[var(--cp-ink)]">{w}</p>
                <p className="cp-tabular text-xs text-[var(--cp-ink-soft)]">{s.occupied}/{s.total} occupied · {s.occupancyPct}%</p>
              </div>
            )
          })}
        </div>
      </ReportCard>
    </div>
  )
}
