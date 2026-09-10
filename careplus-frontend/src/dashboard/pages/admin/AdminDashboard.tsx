import * as React from "react"
import { useNavigate } from "react-router-dom"
import {
  Users, CalendarCheck, Clock, BedDouble, DollarSign, Wallet, FlaskConical,
  Syringe, PackageX, Hourglass,
} from "lucide-react"
import { StatCard } from "@/dashboard/components/StatCard"
import { DataTable } from "@/dashboard/components/DataTable"
import { StatusBadge, toneFor } from "@/dashboard/components/StatusBadge"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { useDashboard } from "@/dashboard/store/useDashboard"
import { formatCurrency, formatDate } from "@/dashboard/lib/format"
import { LineChartWidget, BarChartWidget, DonutChartWidget } from "@/dashboard/components/charts/Charts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { api, type ApiError } from "@/lib/api"

export default function AdminDashboard() {
  const { patients, appointments, labOrders, medicines, invoices } = useDashboard()
  const navigate = useNavigate()
  const [dashboardSummary, setDashboardSummary] = React.useState({
    admitted: 0,
    availableBeds: 0,
    todaysRevenue: 0,
    pendingPayments: 0,
    lowStock: 0,
    pendingLab: 0,
    otSurgeries: 0,
  })
  const [appointmentStats, setAppointmentStats] = React.useState<Array<{ status: string; count: number }>>([])
  const [surgeries, setSurgeries] = React.useState<Array<{ id: string; patient: string; procedure: string; surgeon: string; time: string }>>([])
  const [summaryError, setSummaryError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    Promise.all([
      api.getReportsBedOccupancy(),
      api.getReportsRevenueSummary(),
      api.getReportsAppointmentStats(),
      api.getReportsSurgeryStats(new Date().toISOString().slice(0, 10)),
      api.listSurgeries(),
    ])
      .then(([bedOccupancy, revenueSummary, fetchedAppointmentStats, surgeryStats, fetchedSurgeries]) => {
        if (cancelled) return
        const admitted = bedOccupancy.occupiedBeds
        const availableBeds = Math.max(0, bedOccupancy.totalBeds - bedOccupancy.occupiedBeds)
        const otSurgeries = surgeryStats.reduce((sum, item) => sum + item.count, 0)
        setAppointmentStats(fetchedAppointmentStats)
        setSurgeries(fetchedSurgeries.map((surgery) => ({
          id: surgery.id,
          patient: `${surgery.patient.firstName} ${surgery.patient.lastName}`,
          procedure: surgery.surgeryType,
          surgeon: surgery.surgeon.user.name,
          time: new Date(surgery.scheduledStart).toLocaleString(),
        })))
        setDashboardSummary({
          admitted,
          availableBeds,
          todaysRevenue: revenueSummary.totalCollected,
          pendingPayments: revenueSummary.totalOutstanding,
          lowStock: 0,
          pendingLab: 0,
          otSurgeries,
        })
        setSummaryError(null)
      })
      .catch((error: ApiError) => {
        if (!cancelled) setSummaryError(error.message || "Unable to load dashboard metrics")
      })
    return () => { cancelled = true }
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const todaysAppointments = appointments.filter((a) => a.date === today)
  const pendingApprovals = appointments.filter((a) => a.status === "Pending Approval")
  const admitted = dashboardSummary.admitted || 0
  const availableBeds = dashboardSummary.availableBeds || 0
  const todaysRevenue = dashboardSummary.todaysRevenue || 0
  const pendingPayments = dashboardSummary.pendingPayments || 0
  const lowStock = medicines.filter((m) => m.status === "Low Stock" || m.status === "Out of Stock").length
  const pendingLab = labOrders.filter((l) => l.status !== "Verified").length
  const otSurgeries = dashboardSummary.otSurgeries || 0

  const recentRegistrations = [...patients].sort((a, b) => (a.registeredAt < b.registeredAt ? 1 : -1)).slice(0, 5)
  const pendingLabTests = labOrders.filter((l) => l.status === "Ordered" || l.status === "Sample Collected").slice(0, 5)
  const recentPayments = invoices.flatMap((i) => i.payments.map((p) => ({ ...p, invoiceId: i.id, patientName: i.patientName }))).slice(0, 5)

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader title="Admin Overview" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total Patients" value={patients.length.toString()} icon={Users} tone="primary" onClick={() => navigate("/dashboard/patients")} />
        <StatCard label="Today's Appointments" value={todaysAppointments.length.toString()} icon={CalendarCheck} tone="primary" onClick={() => navigate("/dashboard/appointments")} />
        <StatCard label="Pending Approvals" value={pendingApprovals.length.toString()} icon={Clock} tone="warning" onClick={() => navigate("/dashboard/appointments")} />
        <StatCard label="Admitted Patients" value={admitted.toString()} icon={BedDouble} tone="primary" />
        <StatCard label="Available Beds" value={availableBeds.toString()} icon={BedDouble} tone="success" />
        <StatCard label="Today's Revenue" value={formatCurrency(todaysRevenue)} icon={DollarSign} tone="success" onClick={() => navigate("/dashboard/billing")} />
        <StatCard label="Pending Payments" value={formatCurrency(pendingPayments)} icon={Wallet} tone="warning" onClick={() => navigate("/dashboard/billing")} />
        <StatCard label="Low Stock Medicines" value={lowStock.toString()} icon={PackageX} tone="critical" onClick={() => navigate("/dashboard/pharmacy")} />
        <StatCard label="Pending Lab Tests" value={pendingLab.toString()} icon={FlaskConical} tone="warning" onClick={() => navigate("/dashboard/lab")} />
        <StatCard label="Today's OT Surgeries" value={otSurgeries.toString()} icon={Syringe} tone="primary" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Weekly Revenue</CardTitle></CardHeader>
          <CardContent>
            <LineChartWidget data={[{ label: "Selected period", value: todaysRevenue }]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Monthly Patient Visits</CardTitle></CardHeader>
          <CardContent>
            <BarChartWidget data={appointmentStats.map((item) => ({ label: item.status, value: item.count }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Department-wise Distribution</CardTitle></CardHeader>
          <CardContent>
            <DonutChartWidget data={[]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Bed Occupancy</CardTitle></CardHeader>
          <CardContent>
            <DonutChartWidget data={[{ label: "Occupied", value: admitted }, { label: "Available", value: availableBeds }]} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Today's Appointments</CardTitle></CardHeader>
        <CardContent className="px-4 pb-4 sm:px-6">
          <DataTable
            rows={todaysAppointments}
            getRowKey={(r) => r.id}
            emptyIcon={CalendarCheck}
            emptyTitle="No appointments today"
            emptyDescription="Approved and confirmed visits for today will show up here."
            onRowClick={() => navigate("/dashboard/appointments")}
            rowTone={(r) => toneFor(r.status)}
            columns={[
              { key: "token", header: "Token", render: (r) => <span className="cp-tabular font-semibold">#{r.token}</span> },
              { key: "patient", header: "Patient", render: (r) => r.patientName },
              { key: "doctor", header: "Doctor", render: (r) => r.doctorName, hideOnMobile: true },
              { key: "time", header: "Time", render: (r) => r.time },
              { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            ]}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Recent Patient Registrations</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4 sm:px-6">
            <DataTable
              rows={recentRegistrations}
              getRowKey={(r) => r.mrNumber}
              emptyIcon={Users}
              onRowClick={(r) => navigate(`/dashboard/patients/${r.mrNumber}`)}
              columns={[
                { key: "mr", header: "MR Number", render: (r) => <span className="cp-tabular text-xs">{r.mrNumber}</span> },
                { key: "name", header: "Name", render: (r) => r.name },
                { key: "date", header: "Registered", render: (r) => formatDate(r.registeredAt), hideOnMobile: true },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Pending Lab Tests</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4 sm:px-6">
            <DataTable
              rows={pendingLabTests}
              getRowKey={(r) => r.id}
              emptyIcon={Hourglass}
              onRowClick={() => navigate("/dashboard/lab")}
              rowTone={(r) => toneFor(r.status)}
              columns={[
                { key: "id", header: "Order", render: (r) => <span className="cp-tabular text-xs">{r.id}</span> },
                { key: "patient", header: "Patient", render: (r) => r.patientName },
                { key: "test", header: "Test", render: (r) => r.testName, hideOnMobile: true },
                { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent Payments</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4 sm:px-6">
            <DataTable
              rows={recentPayments}
              getRowKey={(r) => r.id}
              emptyIcon={Wallet}
              onRowClick={() => navigate("/dashboard/billing")}
              columns={[
                { key: "invoice", header: "Invoice", render: (r) => <span className="cp-tabular text-xs">{r.invoiceId}</span> },
                { key: "patient", header: "Patient", render: (r) => r.patientName },
                { key: "amount", header: "Amount", render: (r) => <span className="cp-tabular font-semibold">{formatCurrency(r.amount)}</span> },
                { key: "method", header: "Method", render: (r) => r.method, hideOnMobile: true },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Upcoming Surgeries</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4 sm:px-6">
            <DataTable
              rows={surgeries}
              getRowKey={(r) => r.id}
              emptyIcon={Syringe}
              columns={[
                { key: "patient", header: "Patient", render: (r) => r.patient },
                { key: "procedure", header: "Procedure", render: (r) => r.procedure },
                { key: "time", header: "Scheduled", render: (r) => r.time, hideOnMobile: true },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
