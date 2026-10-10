import * as React from "react"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { formatCurrency, formatDate } from "@/dashboard/lib/format"
import { useToast } from "@/hooks/use-toast"
import { api, type ApiPharmacyReportParams, type ApiPharmacyReports } from "@/lib/api"
import { toCsv } from "@/lib/csv"

const PAGE_SIZE = 20
const PAGE_KEYS = {
  categories: "categoriesPage",
  topMedicines: "topMedicinesPage",
  lowStock: "lowStockPage",
  expiringSoon: "expiringPage",
  expiredStock: "expiredPage",
  salesByCashier: "cashiersPage",
  salesByPaymentMethod: "paymentMethodsPage",
} as const

type PageKey = typeof PAGE_KEYS[keyof typeof PAGE_KEYS]
type ReportSection = keyof typeof PAGE_KEYS

const PERIODS = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["week", "Week"],
  ["month", "Month"],
  ["all", "All"],
] as const

function Pagination({ value, onChange }: { value: ApiPharmacyReports["categories"]["pagination"]; onChange: (page: number) => void }) {
  return <div className="mt-3 flex items-center justify-end gap-3 text-xs text-[var(--cp-ink-soft)]">
    <span>Page {value.page} of {value.pages} · {value.total} records</span>
    <Button size="sm" variant="outline" disabled={value.page <= 1} onClick={() => onChange(value.page - 1)}>Previous</Button>
    <Button size="sm" variant="outline" disabled={value.page >= value.pages} onClick={() => onChange(value.page + 1)}>Next</Button>
  </div>
}

function ReportCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-[var(--cp-border)] bg-white p-4 shadow-sm">
    <h2 className="mb-3 text-base font-semibold">{title}</h2>
    {children}
  </section>
}

export default function PharmacyReportsPage() {
  const { toast } = useToast()
  const [params, setParams] = React.useState<ApiPharmacyReportParams>({ period: "today", expiryDays: 30, limit: PAGE_SIZE })
  const [fromInput, setFromInput] = React.useState("")
  const [toInput, setToInput] = React.useState("")
  const [data, setData] = React.useState<ApiPharmacyReports | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [exporting, setExporting] = React.useState(false)

  React.useEffect(() => {
    let active = true
    setLoading(true)
    api.getPharmacyReports(params).then((result) => {
      if (active) setData(result)
    }).catch((error) => {
      if (active) toast({ title: "Unable to load pharmacy reports", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [params, toast])

  function updateSectionPage(section: ReportSection, page: number) {
    const key: PageKey = PAGE_KEYS[section]
    setParams((current) => ({ ...current, [key]: page }))
  }

  function choosePeriod(period: NonNullable<ApiPharmacyReportParams["period"]>) {
    setParams({ period, expiryDays: params.expiryDays, limit: PAGE_SIZE })
  }

  function applyCustomRange() {
    if (!fromInput || !toInput || fromInput > toInput) {
      toast({ title: "Invalid date range", description: "Choose a From date on or before the To date.", variant: "error" })
      return
    }
    setParams({ period: "custom", from: fromInput, to: toInput, expiryDays: params.expiryDays, limit: PAGE_SIZE })
  }

  function resetFilters() {
    setFromInput("")
    setToInput("")
    choosePeriod("today")
  }

  async function exportReport() {
    if (!data) return
    setExporting(true)
    try {
      const rows: Array<Array<string | number | null | undefined>> = [
        ["Section", "Name", "Quantity", "Transactions", "Revenue (PKR)", "Stock", "Reorder level", "Batch", "Expiry"],
        ["Summary", "Total Sales Revenue", "", "", data.summary.totalSalesRevenue],
        ["Summary", "Transactions", "", data.summary.transactions],
        ["Summary", "Discounts Given", "", "", data.summary.discountsGiven],
        ["Summary", "Taxes Collected", "", "", data.summary.taxesCollected],
        ["Summary", "Returns", "", "", data.summary.returns],
        ["Summary", "Net Revenue", "", "", data.summary.netRevenue],
        ["Summary", "Gross Profit", "", "", data.summary.grossProfit],
      ]
      const sectionRows = async (section: ReportSection) => {
        const first = data[section]
        const pageKey = PAGE_KEYS[section]
        const allItems: Array<unknown> = []
        for (let page = 1; page <= Math.max(1, Math.ceil(first.pagination.total / 100)); page += 1) {
          const response = await api.getPharmacyReports({ ...params, [pageKey]: page, limit: 100 })
          allItems.push(...response[section].items)
        }
        return allItems
      }
      const [categories, medicines, lowStock, expiring, expired, cashiers, paymentMethods] = await Promise.all([
        sectionRows("categories"),
        sectionRows("topMedicines"),
        sectionRows("lowStock"),
        sectionRows("expiringSoon"),
        sectionRows("expiredStock"),
        sectionRows("salesByCashier"),
        sectionRows("salesByPaymentMethod"),
      ])
      for (const item of categories as ApiPharmacyReports["categories"]["items"]) rows.push(["Category", item.name, item.quantity, "", item.revenue])
      for (const item of medicines as ApiPharmacyReports["topMedicines"]["items"]) rows.push(["Top medicine", item.name, item.quantity, "", item.revenue])
      for (const [sectionName, items] of [["Low stock", lowStock], ["Expiring soon", expiring], ["Expired stock", expired]] as const) {
        for (const item of items as ApiPharmacyReports["lowStock"]["items"]) rows.push([sectionName, item.medicineName, "", "", "", item.stockQuantity, item.reorderLevel, item.batchNumber, formatDate(item.expiryDate)])
      }
      for (const item of cashiers as ApiPharmacyReports["salesByCashier"]["items"]) rows.push(["Sales by cashier", item.name, "", item.transactions, item.revenue])
      for (const item of paymentMethods as ApiPharmacyReports["salesByPaymentMethod"]["items"]) rows.push(["Sales by payment method", item.paymentMethod.replaceAll("_", " "), "", item.transactions, item.revenue])
      const blob = new Blob(["\uFEFF", toCsv(rows)], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `pharmacy-report-${params.period ?? "today"}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast({ title: "Unable to export pharmacy report", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
    } finally {
      setExporting(false)
    }
  }

  const summary = data?.summary
  const currencyCards = [
    ["Total Sales Revenue", summary?.totalSalesRevenue],
    ["Discounts Given", summary?.discountsGiven],
    ["Taxes Collected", summary?.taxesCollected],
    ["Returns", summary?.returns],
    ["Net Revenue", summary?.netRevenue],
    ["Gross Profit", summary?.grossProfit],
  ] as const

  return <div className="flex flex-col gap-4">
    <DashboardPageHeader title="Pharmacy Reports" action={<Button variant="outline" onClick={() => void exportReport()} disabled={!data || loading || exporting}><Download className="h-4 w-4" />{exporting ? "Exporting…" : "Export CSV"}</Button>} />
    <ReportCard title="Report period">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Report period">
        {PERIODS.map(([value, label]) => <Button key={value} role="tab" aria-selected={params.period === value} variant={params.period === value ? "primary" : "outline"} size="sm" onClick={() => choosePeriod(value)}>{label}</Button>)}
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div><Label htmlFor="pharmacy-report-from">From</Label><Input id="pharmacy-report-from" type="date" value={fromInput} onChange={(event) => setFromInput(event.target.value)} /></div>
        <div><Label htmlFor="pharmacy-report-to">To</Label><Input id="pharmacy-report-to" type="date" value={toInput} onChange={(event) => setToInput(event.target.value)} /></div>
        <Button variant="outline" onClick={applyCustomRange}>Apply</Button>
        <Button variant="ghost" onClick={resetFilters}>Reset</Button>
        <div className="ml-auto"><Label htmlFor="pharmacy-report-expiry-days">Expiring within</Label><Select id="pharmacy-report-expiry-days" value={String(params.expiryDays ?? 30)} onChange={(event) => setParams((current) => ({ ...current, expiryDays: Number(event.target.value), expiringPage: 1 }))}><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option></Select></div>
      </div>
      {data && <p className="mt-3 text-xs text-[var(--cp-ink-soft)]">Pharmacy timezone: Asia/Karachi · {data.dateRange.from ? `${data.dateRange.from} to ${data.dateRange.to}` : "All dates"}</p>}
    </ReportCard>

    {loading && <p className="text-sm text-[var(--cp-ink-soft)]">Loading pharmacy report…</p>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-2xl border border-[var(--cp-border)] bg-white p-4 shadow-sm"><p className="text-xs text-[var(--cp-ink-soft)]">Transactions</p><p className="mt-1 text-2xl font-bold">{summary?.transactions ?? "—"}</p></div>
      {currencyCards.map(([label, value]) => <div key={label} className="rounded-2xl border border-[var(--cp-border)] bg-white p-4 shadow-sm"><p className="text-xs text-[var(--cp-ink-soft)]">{label}</p><p className="mt-1 text-2xl font-bold">{value === undefined ? "—" : formatCurrency(value)}</p></div>)}
    </div>

    <ReportCard title="Category Breakdown">
      {!data?.categories.items.length ? <p className="text-sm text-[var(--cp-ink-soft)]">No pharmacy sales in this period.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-[var(--cp-ink-soft)]"><th className="py-2">Category</th><th className="py-2 text-right">Units sold</th><th className="py-2 text-right">Sales (PKR)</th></tr></thead><tbody>{data.categories.items.map((item) => <tr key={item.name} className="border-b last:border-0"><td className="py-2">{item.name}</td><td className="py-2 text-right">{item.quantity}</td><td className="py-2 text-right">{formatCurrency(item.revenue)}</td></tr>)}</tbody></table></div>}
      {data && <Pagination value={data.categories.pagination} onChange={(page) => updateSectionPage("categories", page)} />}
    </ReportCard>

    <div className="grid gap-4 xl:grid-cols-2">
      <ReportCard title="Top Selling Medicines">
        {!data?.topMedicines.items.length ? <p className="text-sm text-[var(--cp-ink-soft)]">No medicine sales in this period.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-[var(--cp-ink-soft)]"><th className="py-2">Medicine</th><th className="py-2 text-right">Units</th><th className="py-2 text-right">Sales (PKR)</th></tr></thead><tbody>{data.topMedicines.items.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="py-2">{item.name}{item.genericName && <span className="block text-xs text-[var(--cp-ink-soft)]">{item.genericName}</span>}</td><td className="py-2 text-right">{item.quantity}</td><td className="py-2 text-right">{formatCurrency(item.revenue)}</td></tr>)}</tbody></table></div>}
        {data && <Pagination value={data.topMedicines.pagination} onChange={(page) => updateSectionPage("topMedicines", page)} />}
      </ReportCard>
      <ReportCard title="Sales by Cashier">
        {!data?.salesByCashier.items.length ? <p className="text-sm text-[var(--cp-ink-soft)]">No sales in this period.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-[var(--cp-ink-soft)]"><th className="py-2">Cashier</th><th className="py-2 text-right">Transactions</th><th className="py-2 text-right">Sales (PKR)</th></tr></thead><tbody>{data.salesByCashier.items.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="py-2">{item.name}</td><td className="py-2 text-right">{item.transactions}</td><td className="py-2 text-right">{formatCurrency(item.revenue)}</td></tr>)}</tbody></table></div>}
        {data && <Pagination value={data.salesByCashier.pagination} onChange={(page) => updateSectionPage("salesByCashier", page)} />}
      </ReportCard>
    </div>

    <div className="grid gap-4 xl:grid-cols-2">
      <ReportCard title="Low Stock">
        {!data?.lowStock.items.length ? <p className="text-sm text-[var(--cp-ink-soft)]">No low-stock batches.</p> : <InventoryTable items={data.lowStock.items} mode="low" />}
        {data && <Pagination value={data.lowStock.pagination} onChange={(page) => updateSectionPage("lowStock", page)} />}
      </ReportCard>
      <ReportCard title={`Expiring Within ${data?.expiringSoon.days ?? params.expiryDays} Days`}>
        {!data?.expiringSoon.items.length ? <p className="text-sm text-[var(--cp-ink-soft)]">No batches expiring in this window.</p> : <InventoryTable items={data.expiringSoon.items} mode="expiry" />}
        {data && <Pagination value={data.expiringSoon.pagination} onChange={(page) => updateSectionPage("expiringSoon", page)} />}
      </ReportCard>
      <ReportCard title="Expired Stock">
        {!data?.expiredStock.items.length ? <p className="text-sm text-[var(--cp-ink-soft)]">No expired stock on hand.</p> : <InventoryTable items={data.expiredStock.items} mode="expiry" />}
        {data && <Pagination value={data.expiredStock.pagination} onChange={(page) => updateSectionPage("expiredStock", page)} />}
      </ReportCard>
      <ReportCard title="Sales by Payment Method">
        {!data?.salesByPaymentMethod.items.length ? <p className="text-sm text-[var(--cp-ink-soft)]">No sales in this period.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-[var(--cp-ink-soft)]"><th className="py-2">Payment method</th><th className="py-2 text-right">Transactions</th><th className="py-2 text-right">Sales (PKR)</th></tr></thead><tbody>{data.salesByPaymentMethod.items.map((item) => <tr key={item.paymentMethod} className="border-b last:border-0"><td className="py-2">{item.paymentMethod.replaceAll("_", " ")}</td><td className="py-2 text-right">{item.transactions}</td><td className="py-2 text-right">{formatCurrency(item.revenue)}</td></tr>)}</tbody></table></div>}
        {data && <Pagination value={data.salesByPaymentMethod.pagination} onChange={(page) => updateSectionPage("salesByPaymentMethod", page)} />}
      </ReportCard>
    </div>
  </div>
}

function InventoryTable({ items, mode }: { items: ApiPharmacyReports["lowStock"]["items"]; mode: "low" | "expiry" }) {
  return <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-[var(--cp-ink-soft)]"><th className="py-2">Medicine / batch</th><th className="py-2 text-right">Stock</th>{mode === "low" ? <th className="py-2 text-right">Reorder</th> : <th className="py-2 text-right">Expiry</th>}</tr></thead><tbody>{items.map((item) => <tr key={`${item.batchNumber}-${item.medicineName}`} className="border-b last:border-0"><td className="py-2">{item.medicineName}<span className="block text-xs text-[var(--cp-ink-soft)]">Batch {item.batchNumber}</span></td><td className="py-2 text-right">{item.stockQuantity}</td><td className="py-2 text-right">{mode === "low" ? item.reorderLevel : formatDate(item.expiryDate)}</td></tr>)}</tbody></table></div>
}
