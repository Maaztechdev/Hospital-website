import * as React from "react"
import { Printer, Download } from "lucide-react"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { FilterBar, FilterSelect } from "@/dashboard/components/Primitives"
import { LineChartWidget, BarChartWidget, DonutChartWidget } from "@/dashboard/components/charts/Charts"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { WARD_TYPES, bedsSummary } from "@/dashboard/data/wardData"
import { api } from "@/lib/api"
import { toCsv } from "@/lib/csv"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/dashboard/lib/format"

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
  const { doctors } = useDashboard()
  const { toast } = useToast()
  const [departments, setDepartments] = React.useState<Awaited<ReturnType<typeof api.listPublicDepartments>>>([])
  const [dateRange, setDateRange] = React.useState("7d")
  const [department, setDepartment] = React.useState("all")
  const [ward, setWard] = React.useState("all")
  React.useEffect(() => { api.listPublicDepartments().then(setDepartments).catch((cause) => toast({ title: "Unable to load departments", description: cause instanceof Error ? cause.message : "Please try again.", variant: "error" })) }, [toast])
  const [reportData, setReportData] = React.useState({ appointments: [] as Array<{ status: string; count: number }>, surgeries: [] as Array<{ status: string; count: number }>, revenue: null as Awaited<ReturnType<typeof api.getReportsRevenueSummary>> | null, productivity: [] as Awaited<ReturnType<typeof api.getReportsDoctorProductivity>>, occupancy: {} as Record<string, Awaited<ReturnType<typeof api.getReportsBedOccupancy>>>, lowStock: 0, nearExpiry: 0, turnaround: 0 })
  React.useEffect(() => {
    const to = new Date().toISOString().slice(0, 10)
    const fromDate = new Date(); fromDate.setDate(fromDate.getDate() - Number(dateRange.replace("d", "")))
    const from = fromDate.toISOString().slice(0, 10)
    const departmentId = department === "all" ? undefined : department
    const wardTypes = (ward === "all" ? ["GENERAL", "PRIVATE", "ICU"] : [ward === "General Ward" ? "GENERAL" : ward === "Private Room" ? "PRIVATE" : "ICU"]) as Array<"GENERAL" | "PRIVATE" | "ICU">
    Promise.all([api.getReportsAppointmentStats(from, to, departmentId), api.getReportsSurgeryStats(to, departmentId), api.getReportsRevenueSummary(from, to), api.getReportsDoctorProductivity(from, to, departmentId), api.getReportsLowStock(), api.getReportsNearExpiry(), api.getReportsLabTurnaround(from, to), ...wardTypes.map((wardType) => api.getReportsBedOccupancy(wardType))])
      .then(([appointments, surgeries, revenue, productivity, lowStock, nearExpiry, turnaround, ...occupancy]) => setReportData({ appointments, surgeries, revenue, productivity, occupancy: Object.fromEntries(wardTypes.map((wardType, index) => [wardType, occupancy[index]])), lowStock: lowStock.length, nearExpiry: nearExpiry.length, turnaround: turnaround.averageTurnaroundHours }))
        .catch((cause) => toast({ title: "Unable to load report data", description: cause instanceof Error ? cause.message : "Please try again.", variant: "error" }))
      }, [dateRange, department, ward, toast])

  function exportReport() {
    const rows = [["Metric", "Value"], ["Discounts Given", String(reportData.revenue?.discountsGiven ?? 0)], ["Low stock medicines", String(reportData.lowStock)], ["Near expiry medicines", String(reportData.nearExpiry)], ["Average lab turnaround (hours)", String(reportData.turnaround)]]
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "careplus-report.csv"; link.click(); URL.revokeObjectURL(url)
  }

  const occupancyByWard = WARD_TYPES.filter((w) => ward === "all" || w === ward).map((w) => {
    const wardType = w === "General Ward" ? "GENERAL" : w === "Private Room" ? "PRIVATE" : "ICU"
    return { label: w.replace(" Ward", "").replace(" Room", ""), value: reportData.occupancy[wardType]?.occupancyRate ?? 0 }
  })

  const admissionsTrend = reportData.appointments.map((item) => ({ label: item.status, value: item.count }))

  const surgeriesByStatus = reportData.surgeries.map((item) => ({ label: item.status, value: item.count }))

  const revenueByDept = reportData.productivity.map((item) => ({ label: item.doctorName, value: item.consultationCount }))

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader title="Reports" />

      <div className="sticky top-16 z-20 sm:top-[68px]">
        <FilterBar>
          <FilterSelect label="Date range" value={dateRange} onChange={setDateRange} options={[{ value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" }, { value: "90d", label: "Last quarter" }]} />
          <FilterSelect label="Department" value={department} onChange={setDepartment} options={[{ value: "all", label: "All departments" }, ...departments.map((item) => ({ value: item.id, label: item.name }))]} />
          <FilterSelect label="Ward" value={ward} onChange={setWard} options={[{ value: "all", label: "All wards" }, ...WARD_TYPES.map((w) => ({ value: w, label: w }))]} />
        </FilterBar>
      </div>

      <ReportCard title="Discounts Given">
        <p className="cp-tabular text-2xl font-bold text-[var(--cp-ink)]">{formatCurrency(reportData.revenue?.discountsGiven ?? 0)}</p>
        <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Total pharmacy discounts for the selected date range</p>
      </ReportCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ReportCard title="Bed Occupancy by Ward (%)" onExport={exportReport}>
          <BarChartWidget data={occupancyByWard} />
          <p className="mt-2 text-xs text-[var(--cp-ink-soft)]">Backend occupancy data</p>
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
              {WARD_TYPES.filter((w) => ward === "all" || w === ward).map((w) => {
                const wardType = w === "General Ward" ? "GENERAL" : w === "Private Room" ? "PRIVATE" : "ICU"
                const s = reportData.occupancy[wardType]
                return (
                  <tr key={w} className="border-b border-[var(--cp-border)] last:border-0">
                    <td className="px-4 py-2.5 font-medium text-[var(--cp-ink)]">{w}</td>
                    <td className="cp-tabular px-4 py-2.5">{s?.totalBeds ?? 0}</td>
                    <td className="cp-tabular px-4 py-2.5">{s?.occupiedBeds ?? 0}</td>
                    <td className="cp-tabular px-4 py-2.5">{Math.max(0, (s?.totalBeds ?? 0) - (s?.occupiedBeds ?? 0))}</td>
                    <td className="cp-tabular px-4 py-2.5">{s?.occupancyRate ?? 0}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-2 sm:hidden">
          {WARD_TYPES.filter((w) => ward === "all" || w === ward).map((w) => {
            const wardType = w === "General Ward" ? "GENERAL" : w === "Private Room" ? "PRIVATE" : "ICU"
            const s = reportData.occupancy[wardType]
            return (
              <div key={w} className="rounded-lg border border-[var(--cp-border)] p-3">
                <p className="font-semibold text-[var(--cp-ink)]">{w}</p>
                <p className="cp-tabular text-xs text-[var(--cp-ink-soft)]">{s?.occupiedBeds ?? 0}/{s?.totalBeds ?? 0} occupied · {s?.occupancyRate ?? 0}%</p>
              </div>
            )
          })}
        </div>
      </ReportCard>
    </div>
  )
}
