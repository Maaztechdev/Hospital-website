import * as React from "react"
import { Archive, Download, FlaskConical, PackagePlus, Plus, RotateCw, Save, TestTube2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { DataTable } from "@/dashboard/components/DataTable"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { FilterBar, FilterSelect, Modal, Tabs } from "@/dashboard/components/Primitives"
import { StatusBadge } from "@/dashboard/components/StatusBadge"
import { formatCurrency } from "@/dashboard/lib/format"
import { useToast } from "@/hooks/use-toast"
import { api, type ApiCreateLabTestInput, type ApiLabPackage, type ApiLabPackageInput, type ApiLabReferenceRangeInput, type ApiLabTest, type ApiLabTestParameterInput } from "@/lib/api"

type RangeDraft = {
  id?: string
  gender: "MALE" | "FEMALE" | "ANY"
  ageMinDays: string
  ageMaxDays: string
  low: string
  high: string
  criticalLow: string
  criticalHigh: string
  notes: string
}

type ParameterDraft = {
  id?: string
  name: string
  unit: string
  displayOrder: number
  resultType: "NUMERIC" | "TEXT" | "CHOICE"
  decimalPlaces: number
  ranges: RangeDraft[]
}

type TestDraft = {
  testName: string
  testCode: string
  category: string
  sampleType: string
  price: string
  turnaroundTimeHours: string
  isActive: boolean
  isSendOut: boolean
  referenceLabSupplierId: string
  sendOutCost: string
  parameters: ParameterDraft[]
}

const CATEGORIES = ["Hematology", "Biochemistry", "Serology", "Urine", "Other"]
const NEW_RANGE: RangeDraft = { gender: "ANY", ageMinDays: "", ageMaxDays: "", low: "", high: "", criticalLow: "", criticalHigh: "", notes: "" }
const NEW_PARAMETER: ParameterDraft = { name: "", unit: "", displayOrder: 0, resultType: "NUMERIC", decimalPlaces: 2, ranges: [] }
const NEW_TEST: TestDraft = { testName: "", testCode: "", category: "Other", sampleType: "", price: "", turnaroundTimeHours: "", isActive: true, isSendOut: false, referenceLabSupplierId: "", sendOutCost: "", parameters: [] }

function formatNumber(value?: number | string | null) {
  return value == null ? "" : String(value)
}

function toRangeDraft(range: NonNullable<ApiLabTest["parameters"]>[number]["ranges"][number]): RangeDraft {
  return {
    id: range.id,
    gender: range.gender,
    ageMinDays: formatNumber(range.ageMinDays),
    ageMaxDays: formatNumber(range.ageMaxDays),
    low: formatNumber(range.low),
    high: formatNumber(range.high),
    criticalLow: formatNumber(range.criticalLow),
    criticalHigh: formatNumber(range.criticalHigh),
    notes: range.notes ?? "",
  }
}

function toTestDraft(test?: ApiLabTest): TestDraft {
  if (!test) return { ...NEW_TEST, parameters: [] }
  return {
    testName: test.testName,
    testCode: test.testCode,
    category: test.category ?? "Other",
    sampleType: test.sampleType ?? "",
    price: String(test.price ?? ""),
    turnaroundTimeHours: formatNumber(test.turnaroundTimeHours),
    isActive: test.isActive,
    isSendOut: test.isSendOut ?? false,
    referenceLabSupplierId: test.referenceLabSupplierId ?? "",
    sendOutCost: formatNumber(test.sendOutCost),
    parameters: (test.parameters ?? []).map((parameter) => ({
      id: parameter.id,
      name: parameter.name,
      unit: parameter.unit ?? "",
      displayOrder: parameter.displayOrder,
      resultType: parameter.resultType,
      decimalPlaces: parameter.decimalPlaces,
      ranges: parameter.ranges.map(toRangeDraft),
    })),
  }
}

function optionalNumber(value: string) {
  return value.trim() === "" ? null : Number(value)
}

function toTestPayload(form: TestDraft): ApiCreateLabTestInput {
  const parameters: ApiLabTestParameterInput[] = form.parameters.map((parameter, displayOrder) => ({
    ...(parameter.id ? { id: parameter.id } : {}),
    name: parameter.name.trim(),
    unit: parameter.unit.trim() || undefined,
    displayOrder,
    resultType: parameter.resultType,
    decimalPlaces: parameter.decimalPlaces,
    ranges: parameter.ranges.map((range): ApiLabReferenceRangeInput => ({
      ...(range.id ? { id: range.id } : {}),
      gender: range.gender,
      ageMinDays: optionalNumber(range.ageMinDays),
      ageMaxDays: optionalNumber(range.ageMaxDays),
      low: optionalNumber(range.low),
      high: optionalNumber(range.high),
      criticalLow: optionalNumber(range.criticalLow),
      criticalHigh: optionalNumber(range.criticalHigh),
      notes: range.notes.trim() || undefined,
    })),
  }))
  return {
    testName: form.testName.trim(),
    testCode: form.testCode.trim(),
    category: form.category.trim() || "Other",
    sampleType: form.sampleType.trim() || undefined,
    price: Number(form.price),
    turnaroundTimeHours: form.turnaroundTimeHours === "" ? undefined : Number(form.turnaroundTimeHours),
    isActive: form.isActive,
    isSendOut: form.isSendOut,
    referenceLabSupplierId: form.isSendOut ? form.referenceLabSupplierId : null,
    sendOutCost: form.isSendOut ? Number(form.sendOutCost) : null,
    parameters,
  }
}

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`
}

export default function LabCatalogPage() {
  const { toast } = useToast()
  const [tests, setTests] = React.useState<ApiLabTest[]>([])
  const [packages, setPackages] = React.useState<ApiLabPackage[]>([])
  const [referenceLabs, setReferenceLabs] = React.useState<Array<{ id: string; name: string; phone?: string | null }>>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [labName, setLabName] = React.useState("")
  const [tab, setTab] = React.useState("Tests")
  const [search, setSearch] = React.useState("")
  const [category, setCategory] = React.useState("All")
  const [activeFilter, setActiveFilter] = React.useState("active")
  const [sortBy, setSortBy] = React.useState("name")
  const [testModalOpen, setTestModalOpen] = React.useState(false)
  const [packageModalOpen, setPackageModalOpen] = React.useState(false)
  const [editingTest, setEditingTest] = React.useState<ApiLabTest | null>(null)
  const [editingPackage, setEditingPackage] = React.useState<ApiLabPackage | null>(null)
  const [testForm, setTestForm] = React.useState<TestDraft>(toTestDraft())
  const [packageForm, setPackageForm] = React.useState({ name: "", price: "", testIds: [] as string[], isActive: true })
  const [saving, setSaving] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)

  const loadCatalog = React.useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [testItems, packageItems, labItems] = await Promise.all([api.listLabTests(true), api.listLabPackages(true), api.listLabReferenceLabs()])
      setTests(testItems)
      setPackages(packageItems)
      setReferenceLabs(labItems)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to load the lab catalog."
      setError(message)
      toast({ title: "Unable to load lab catalog", description: message, variant: "error" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  React.useEffect(() => { void loadCatalog() }, [loadCatalog])

  React.useEffect(() => {
    api.getLabReportSettings()
      .then((settings) => setLabName(settings.labName.trim()))
      .catch((caught) => toast({ title: "Unable to load Lab report identity", description: caught instanceof Error ? caught.message : "Please retry.", variant: "error" }))
  }, [toast])

  const categories = React.useMemo(
    () => [...new Set([...CATEGORIES, ...tests.map((test) => test.category).filter((value): value is string => Boolean(value))])],
    [tests],
  )
  const visibleTests = React.useMemo(() => tests
    .filter((test) => {
      const query = search.trim().toLocaleLowerCase()
      const searchable = [test.testName, test.testCode, test.category ?? "", test.sampleType ?? "", ...(test.parameters ?? []).map((parameter) => parameter.name)].join(" ").toLocaleLowerCase()
      return (!query || searchable.includes(query))
        && (category === "All" || test.category === category)
        && (activeFilter === "all" || (activeFilter === "active" ? test.isActive : !test.isActive))
    })
    .sort((left, right) => sortBy === "price"
      ? Number(left.price) - Number(right.price)
      : left.testName.localeCompare(right.testName)),
  [activeFilter, category, search, sortBy, tests])
  const visiblePackages = React.useMemo(() => packages
    .filter((labPackage) => activeFilter === "all" || (activeFilter === "active" ? labPackage.isActive : !labPackage.isActive))
    .filter((labPackage) => `${labPackage.name} ${labPackage.tests.map((item) => item.test.testName).join(" ")}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((left, right) => sortBy === "price" ? Number(left.price) - Number(right.price) : left.name.localeCompare(right.name)),
  [activeFilter, packages, search, sortBy])

  const openTestForm = (test?: ApiLabTest) => {
    setEditingTest(test ?? null)
    setTestForm(toTestDraft(test))
    setTestModalOpen(true)
  }

  const saveTest = async () => {
    if (!testForm.testName.trim() || !testForm.testCode.trim() || testForm.price === "" || !Number.isFinite(Number(testForm.price)) || Number(testForm.price) < 0) {
      toast({ title: "Complete the required test details", description: "Name, code, and a non-negative price are required.", variant: "error" })
      return
    }
    if (testForm.isSendOut && (!testForm.referenceLabSupplierId || testForm.sendOutCost === "" || !Number.isFinite(Number(testForm.sendOutCost)) || Number(testForm.sendOutCost) < 0)) {
      toast({ title: "Complete send-out details", description: "Select a reference lab and enter a non-negative outsourced cost.", variant: "error" })
      return
    }
    if (testForm.parameters.some((parameter) => !parameter.name.trim())) {
      toast({ title: "Parameter name required", description: "Each parameter must have a name.", variant: "error" })
      return
    }
    setSaving(true)
    try {
      const payload = toTestPayload(testForm)
      if (editingTest) await api.updateLabTest(editingTest.id, payload)
      else await api.createLabTest(payload)
      setTestModalOpen(false)
      toast({ title: editingTest ? "Lab test updated" : "Lab test added", variant: "success" })
      await loadCatalog()
    } catch (caught) {
      toast({ title: "Unable to save lab test", description: caught instanceof Error ? caught.message : "Please try again.", variant: "error" })
    } finally {
      setSaving(false)
    }
  }

  const toggleTestActive = async (test: ApiLabTest) => {
    try {
      const payload = toTestPayload({ ...toTestDraft(test), isActive: !test.isActive })
      await api.updateLabTest(test.id, payload)
      await loadCatalog()
      toast({ title: test.isActive ? "Lab test deactivated" : "Lab test activated", description: "Catalog tests are never hard-deleted; existing orders remain linked.", variant: "success" })
    } catch (caught) {
      toast({ title: "Unable to update lab test", description: caught instanceof Error ? caught.message : "Please try again.", variant: "error" })
    }
  }

  const openPackageForm = (labPackage?: ApiLabPackage) => {
    setEditingPackage(labPackage ?? null)
    setPackageForm({
      name: labPackage?.name ?? "",
      price: labPackage ? String(labPackage.price) : "",
      testIds: labPackage?.tests.map((item) => item.testId) ?? [],
      isActive: labPackage?.isActive ?? true,
    })
    setPackageModalOpen(true)
  }

  const savePackage = async () => {
    if (!packageForm.name.trim() || packageForm.price === "" || !Number.isFinite(Number(packageForm.price)) || Number(packageForm.price) < 0 || packageForm.testIds.length === 0) {
      toast({ title: "Complete the package details", description: "Enter a name, non-negative price, and at least one active test.", variant: "error" })
      return
    }
    setSaving(true)
    try {
      const payload: ApiLabPackageInput = { name: packageForm.name.trim(), price: Number(packageForm.price), testIds: packageForm.testIds, isActive: packageForm.isActive }
      if (editingPackage) await api.updateLabPackage(editingPackage.id, payload)
      else await api.createLabPackage(payload)
      setPackageModalOpen(false)
      toast({ title: editingPackage ? "Lab package updated" : "Lab package added", variant: "success" })
      await loadCatalog()
    } catch (caught) {
      toast({ title: "Unable to save lab package", description: caught instanceof Error ? caught.message : "Please try again.", variant: "error" })
    } finally {
      setSaving(false)
    }
  }

  const togglePackageActive = async (labPackage: ApiLabPackage) => {
    try {
      await api.updateLabPackage(labPackage.id, {
        name: labPackage.name,
        price: Number(labPackage.price),
        testIds: labPackage.tests.map((item) => item.testId),
        isActive: !labPackage.isActive,
      })
      await loadCatalog()
      toast({ title: labPackage.isActive ? "Package deactivated" : "Package activated", variant: "success" })
    } catch (caught) {
      toast({ title: "Unable to update package", description: caught instanceof Error ? caught.message : "Please try again.", variant: "error" })
    }

  }

  const exportCsv = () => {
    const rows = tab === "Tests"
      ? [
        ["Test name", "Code", "Category", "Sample type", "Price", "Turnaround hours", "Active", "Send-out", "Reference lab", "Outsourced cost", "Parameter", "Result type", "Decimal places", "Unit", "Gender", "Age min days", "Age max days", "Low", "High", "Critical low", "Critical high", "Range notes"],
        ...visibleTests.flatMap((test) => {
          const parameters = test.parameters ?? []
          return (parameters.length ? parameters : [null]).flatMap((parameter) => {
            const ranges = parameter?.ranges ?? []
            return (ranges.length ? ranges : [null]).map((range) => [
              test.testName, test.testCode, test.category ?? "", test.sampleType ?? "", String(test.price),
              String(test.turnaroundTimeHours ?? ""),               test.isActive ? "Yes" : "No", test.isSendOut ? "Yes" : "No", test.referenceLabSupplier?.name ?? "", formatNumber(test.sendOutCost), parameter?.name ?? "",
              parameter?.resultType ?? "", String(parameter?.decimalPlaces ?? ""), parameter?.unit ?? "", range?.gender ?? "",
              String(range?.ageMinDays ?? ""), String(range?.ageMaxDays ?? ""), formatNumber(range?.low),
              formatNumber(range?.high), formatNumber(range?.criticalLow), formatNumber(range?.criticalHigh), range?.notes ?? "",
            ])
          })
        }),
      ]
      : [
        ["Package name", "Price", "Active", "Included test code", "Included test name"],
        ...visiblePackages.flatMap((labPackage) => labPackage.tests.map((item) => [labPackage.name, String(labPackage.price), labPackage.isActive ? "Yes" : "No", item.test.testCode, item.test.testName])),
      ]
    const blob = new Blob(["\uFEFF", rows.map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "careplus-lab-test-catalog.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  const exportPdf = async () => {
    setExporting(true)
    try {
      const { jsPDF } = await import("jspdf")
      const pdf = new jsPDF({ format: "a4", unit: "mm" })
      let y = 16
      pdf.setFontSize(16)
      pdf.text(`${labName ? `${labName} · ` : ""}${tab === "Tests" ? "Lab Test Catalog" : "Lab Packages"}`, 14, y)
      y += 9
      pdf.setFontSize(9)
      const pdfEntries = tab === "Tests" ? visibleTests.map((test) => ({
        heading: test.testName,
        body: [
          `${test.testCode} · ${test.category ?? "Other"} · ${formatCurrency(Number(test.price))} · ${test.turnaroundTimeHours ?? "—"} h · ${test.isActive ? "Active" : "Inactive"}`,
          ...(test.isSendOut ? [`Send-out to ${test.referenceLabSupplier?.name ?? "reference lab"} · outsourced cost ${formatCurrency(Number(test.sendOutCost ?? 0))}`] : []),
          ...(test.parameters ?? []).map((parameter) => {
            const ranges = parameter.ranges.map((range) => `${range.gender} ${range.ageMinDays ?? 0}-${range.ageMaxDays ?? "∞"} days: ${formatNumber(range.low) || "—"} to ${formatNumber(range.high) || "—"}${range.criticalLow != null || range.criticalHigh != null ? ` (critical ${formatNumber(range.criticalLow) || "—"} to ${formatNumber(range.criticalHigh) || "—"})` : ""}`).join("; ")
            return `${parameter.name}${parameter.unit ? ` (${parameter.unit})` : ""} [${parameter.resultType}, ${parameter.decimalPlaces} decimals]${ranges ? ` — ${ranges}` : ""}`
          }),
        ].join("\n"),
      })) : visiblePackages.map((labPackage) => ({
        heading: labPackage.name,
        body: `${formatCurrency(Number(labPackage.price))} · ${labPackage.isActive ? "Active" : "Inactive"}\n${labPackage.tests.map((item) => `${item.test.testCode} ${item.test.testName}`).join(", ")}`,
      }))
      for (const entry of pdfEntries) {
        const lines = pdf.splitTextToSize(`${entry.heading}\n${entry.body}`, 180) as string[]
        if (y + lines.length * 5 > 280) { pdf.addPage(); y = 16 }
        pdf.text(lines, 14, y)
        y += lines.length * 5 + 4
      }
      pdf.save("careplus-lab-test-catalog.pdf")
    } catch (caught) {
      toast({ title: "Unable to export catalog PDF", description: caught instanceof Error ? caught.message : "Please try again.", variant: "error" })
    } finally {
      setExporting(false)
    }
  }

  const addParameter = () => setTestForm((form) => ({ ...form, parameters: [...form.parameters, { ...NEW_PARAMETER, displayOrder: form.parameters.length, ranges: [] }] }))
  const updateParameter = (index: number, patch: Partial<ParameterDraft>) => setTestForm((form) => ({
    ...form,
    parameters: form.parameters.map((parameter, current) => current === index ? { ...parameter, ...patch } : parameter),
  }))
  const updateRange = (parameterIndex: number, rangeIndex: number, patch: Partial<RangeDraft>) => setTestForm((form) => ({
    ...form,
    parameters: form.parameters.map((parameter, currentParameter) => currentParameter !== parameterIndex ? parameter : {
      ...parameter,
      ranges: parameter.ranges.map((range, currentRange) => currentRange === rangeIndex ? { ...range, ...patch } : range),
    }),
  }))

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader
        title="Lab Test Catalog"
        action={<div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4" />Export CSV</Button>
          <Button variant="outline" size="sm" onClick={() => void exportPdf()} disabled={exporting}><Download className="h-4 w-4" />{exporting ? "Exporting…" : "Export PDF"}</Button>
          {tab === "Tests"
            ? <Button size="sm" onClick={() => openTestForm()}><Plus className="h-4 w-4" />Add test</Button>
            : <Button size="sm" onClick={() => openPackageForm()}><PackagePlus className="h-4 w-4" />Add package</Button>}
        </div>}
      />

      <div role="note" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Seeded medical reference ranges are placeholders only — to be reviewed by a pathologist before clinical use.
      </div>

      {error && <div role="alert" className="flex items-center justify-between rounded-xl border border-[var(--cp-critical)] bg-[var(--cp-critical-light)] p-3 text-sm text-[var(--cp-critical)]"><span>{error}</span><Button variant="outline" size="sm" onClick={() => void loadCatalog()}><RotateCw className="h-4 w-4" />Retry</Button></div>}

      <Tabs tabs={["Tests", "Packages"]} active={tab} onChange={setTab} />

      {tab === "Tests" && <>
        <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search tests, codes, categories, parameters…">
          <FilterSelect label="Test status" value={activeFilter} onChange={setActiveFilter} options={[{ value: "active", label: "Active tests" }, { value: "inactive", label: "Inactive tests" }, { value: "all", label: "All tests" }]} />
          <FilterSelect label="Sort tests" value={sortBy} onChange={setSortBy} options={[{ value: "name", label: "Sort: name" }, { value: "price", label: "Sort: price" }]} />
        </FilterBar>
        <div className="flex flex-wrap gap-2" aria-label="Filter tests by category">
          {["All", ...categories].map((item) => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${category === item ? "border-[var(--cp-primary)] bg-[var(--cp-primary-light)] text-[var(--cp-primary)]" : "border-[var(--cp-border)] bg-white text-[var(--cp-ink-soft)]"}`}>{item}</button>)}
        </div>
        <DataTable
          rows={visibleTests}
          loading={loading}
          getRowKey={(test) => test.id}
          emptyIcon={FlaskConical}
          emptyTitle="No lab tests found"
          emptyDescription="Try another search or add a test to the catalog."
          columns={[
            { key: "name", header: "Test", render: (test) => <div><p className="font-semibold">{test.testName}</p><p className="text-xs text-[var(--cp-ink-soft)]">{test.testCode}</p></div>, sortValue: (test) => test.testName.toLocaleLowerCase() },
            { key: "category", header: "Category", render: (test) => test.category ?? "Other" },
            { key: "sendout", header: "Send-out", render: (test) => test.isSendOut ? <span className="text-xs font-semibold text-amber-800">{test.referenceLabSupplier?.name ?? "Reference lab"}</span> : "—", hideOnMobile: true },
            { key: "parameters", header: "Parameters", render: (test) => <span className="text-xs">{test.parameters?.length ? test.parameters.map((parameter) => parameter.name).join(", ") : "Not configured"}</span>, hideOnMobile: true },
            { key: "sample", header: "Sample", render: (test) => test.sampleType ?? "—", hideOnMobile: true },
            { key: "price", header: "Price", render: (test) => <span className="cp-tabular">{formatCurrency(Number(test.price))}</span>, sortValue: (test) => Number(test.price) },
            { key: "turnaround", header: "TAT", render: (test) => test.turnaroundTimeHours == null ? "—" : `${test.turnaroundTimeHours} h`, hideOnMobile: true },
            { key: "status", header: "Status", render: (test) => <StatusBadge status={test.isActive ? "Active" : "Inactive"} /> },
            { key: "actions", header: "Actions", render: (test) => <div className="flex gap-1.5">
              <button type="button" onClick={() => openTestForm(test)} className="rounded-lg border border-[var(--cp-border)] px-2 py-1 text-xs font-semibold hover:bg-[var(--cp-bg)]">Edit</button>
              <button type="button" onClick={() => void toggleTestActive(test)} aria-label={`${test.isActive ? "Deactivate" : "Activate"} ${test.testName}`} className="rounded-lg border border-[var(--cp-border)] px-2 py-1 text-xs font-semibold text-[var(--cp-critical)] hover:bg-[var(--cp-critical-light)]"><Archive className="mr-1 inline h-3 w-3" />{test.isActive ? "Deactivate" : "Activate"}</button>
            </div> },
          ]}
          pageSize={20}
        />
      </>}

      {tab === "Packages" && <DataTable
        rows={visiblePackages}
        loading={loading}
        getRowKey={(labPackage) => labPackage.id}
        emptyIcon={PackagePlus}
        emptyTitle="No lab packages found"
        columns={[
          { key: "name", header: "Package", render: (labPackage) => labPackage.name, sortValue: (labPackage) => labPackage.name.toLocaleLowerCase() },
          { key: "tests", header: "Included tests", render: (labPackage) => <span className="text-xs">{labPackage.tests.map((item) => item.test.testName).join(", ")}</span> },
          { key: "price", header: "Price", render: (labPackage) => formatCurrency(Number(labPackage.price)), sortValue: (labPackage) => Number(labPackage.price) },
          { key: "status", header: "Status", render: (labPackage) => <StatusBadge status={labPackage.isActive ? "Active" : "Inactive"} /> },
          { key: "actions", header: "Actions", render: (labPackage) => <div className="flex gap-1.5">
            <button type="button" onClick={() => openPackageForm(labPackage)} className="rounded-lg border border-[var(--cp-border)] px-2 py-1 text-xs font-semibold hover:bg-[var(--cp-bg)]">Edit</button>
            <button type="button" onClick={() => void togglePackageActive(labPackage)} className="rounded-lg border border-[var(--cp-border)] px-2 py-1 text-xs font-semibold text-[var(--cp-critical)] hover:bg-[var(--cp-critical-light)]">{labPackage.isActive ? "Deactivate" : "Activate"}</button>
          </div> },
        ]}
        pageSize={20}
      />}

      <Modal open={testModalOpen} onClose={() => setTestModalOpen(false)} title={editingTest ? "Edit lab test" : "Add lab test"} size="xl">
        <div className="flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="catalog-test-name">Test name *</Label><Input id="catalog-test-name" autoComplete="off" value={testForm.testName} onChange={(event) => setTestForm((form) => ({ ...form, testName: event.target.value }))} /></div>
            <div><Label htmlFor="catalog-test-code">Code *</Label><Input id="catalog-test-code" autoComplete="off" value={testForm.testCode} onChange={(event) => setTestForm((form) => ({ ...form, testCode: event.target.value.toUpperCase() }))} /></div>
            <div><Label htmlFor="catalog-category">Category</Label><Input id="catalog-category" list="lab-catalog-categories" value={testForm.category} onChange={(event) => setTestForm((form) => ({ ...form, category: event.target.value }))} /><datalist id="lab-catalog-categories">{categories.map((item) => <option key={item} value={item} />)}</datalist></div>
            <div><Label htmlFor="catalog-sample">Sample type</Label><Input id="catalog-sample" value={testForm.sampleType} onChange={(event) => setTestForm((form) => ({ ...form, sampleType: event.target.value }))} placeholder="Serum, EDTA whole blood…" /></div>
            <div><Label htmlFor="catalog-price">Price (PKR) *</Label><Input id="catalog-price" type="number" min="0" step="0.01" value={testForm.price} onChange={(event) => setTestForm((form) => ({ ...form, price: event.target.value }))} /></div>
            <div><Label htmlFor="catalog-tat">Turnaround (hours)</Label><Input id="catalog-tat" type="number" min="0" step="1" value={testForm.turnaroundTimeHours} onChange={(event) => setTestForm((form) => ({ ...form, turnaroundTimeHours: event.target.value }))} /></div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={testForm.isActive} onChange={(event) => setTestForm((form) => ({ ...form, isActive: event.target.checked }))} /> Active and available for new orders</label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={testForm.isSendOut} onChange={(event) => setTestForm((form) => ({ ...form, isSendOut: event.target.checked }))} /> Send this test to an external reference lab</label>
            {testForm.isSendOut && <>
              <div><Label htmlFor="catalog-reference-lab">Reference lab *</Label><Select id="catalog-reference-lab" value={testForm.referenceLabSupplierId} onChange={(event) => setTestForm((form) => ({ ...form, referenceLabSupplierId: event.target.value }))}><option value="">Select reference lab</option>{referenceLabs.map((referenceLab) => <option key={referenceLab.id} value={referenceLab.id}>{referenceLab.name}</option>)}</Select><p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Add reference-lab accounts in Lab Ledger before configuring send-out tests.</p></div>
              <div><Label htmlFor="catalog-sendout-cost">Outsourced cost (PKR) *</Label><Input id="catalog-sendout-cost" type="number" min="0" step="0.01" value={testForm.sendOutCost} onChange={(event) => setTestForm((form) => ({ ...form, sendOutCost: event.target.value }))} /></div>
            </>}
          </div>

          <div className="flex items-center justify-between border-t border-[var(--cp-border)] pt-4">
            <div><h3 className="font-semibold">Test parameters</h3><p className="text-xs text-[var(--cp-ink-soft)]">Set units and demographic/age-specific reference ranges.</p></div>
            <Button variant="outline" size="sm" onClick={addParameter}><Plus className="h-4 w-4" />Add parameter</Button>
          </div>
          {testForm.parameters.map((parameter, parameterIndex) => (
            <section key={parameter.id ?? `new-${parameterIndex}`} className="rounded-xl border border-[var(--cp-border)] bg-[var(--cp-bg)] p-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div><Label>Parameter name *</Label><Input autoComplete="off" value={parameter.name} onChange={(event) => updateParameter(parameterIndex, { name: event.target.value })} /></div>
                <div><Label>Unit</Label><Input value={parameter.unit} onChange={(event) => updateParameter(parameterIndex, { unit: event.target.value })} /></div>
                <div><Label>Result type</Label><Select value={parameter.resultType} onChange={(event) => updateParameter(parameterIndex, { resultType: event.target.value as ParameterDraft["resultType"] })}><option value="NUMERIC">Numeric</option><option value="TEXT">Text</option><option value="CHOICE">Choice</option></Select></div>
                <div><Label>Decimal places</Label><Input type="number" min="0" max="8" value={parameter.decimalPlaces} onChange={(event) => updateParameter(parameterIndex, { decimalPlaces: Number(event.target.value) })} /></div>
              </div>
              <div className="mt-3 flex justify-end"><button type="button" className="text-xs font-semibold text-[var(--cp-critical)]" onClick={() => setTestForm((form) => ({ ...form, parameters: form.parameters.filter((_, index) => index !== parameterIndex) }))}><Trash2 className="mr-1 inline h-3.5 w-3.5" />Remove parameter</button></div>
              <div className="mt-3 border-t border-[var(--cp-border)] pt-3">
                <div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-semibold">Reference ranges</h4><button type="button" className="text-xs font-semibold text-[var(--cp-primary)]" onClick={() => updateParameter(parameterIndex, { ranges: [...parameter.ranges, { ...NEW_RANGE }] })}>Add range</button></div>
                {parameter.ranges.map((range, rangeIndex) => (
                  <div key={range.id ?? `new-range-${rangeIndex}`} className="mb-3 grid gap-2 rounded-lg border border-[var(--cp-border)] bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div><Label>Gender</Label><Select value={range.gender} onChange={(event) => updateRange(parameterIndex, rangeIndex, { gender: event.target.value as RangeDraft["gender"] })}><option value="ANY">Any</option><option value="MALE">Male</option><option value="FEMALE">Female</option></Select></div>
                    <div><Label>Age min (days)</Label><Input type="number" min="0" value={range.ageMinDays} onChange={(event) => updateRange(parameterIndex, rangeIndex, { ageMinDays: event.target.value })} /></div>
                    <div><Label>Age max (days)</Label><Input type="number" min="0" value={range.ageMaxDays} onChange={(event) => updateRange(parameterIndex, rangeIndex, { ageMaxDays: event.target.value })} /></div>
                    <div><Label>Notes</Label><Input value={range.notes} onChange={(event) => updateRange(parameterIndex, rangeIndex, { notes: event.target.value })} /></div>
                    {parameter.resultType === "NUMERIC" && <>
                      <div><Label>Low</Label><Input type="number" step="any" value={range.low} onChange={(event) => updateRange(parameterIndex, rangeIndex, { low: event.target.value })} /></div>
                      <div><Label>High</Label><Input type="number" step="any" value={range.high} onChange={(event) => updateRange(parameterIndex, rangeIndex, { high: event.target.value })} /></div>
                      <div><Label>Critical low</Label><Input type="number" step="any" value={range.criticalLow} onChange={(event) => updateRange(parameterIndex, rangeIndex, { criticalLow: event.target.value })} /></div>
                      <div><Label>Critical high</Label><Input type="number" step="any" value={range.criticalHigh} onChange={(event) => updateRange(parameterIndex, rangeIndex, { criticalHigh: event.target.value })} /></div>
                    </>}
                    <button type="button" className="justify-self-start text-xs font-semibold text-[var(--cp-critical)] sm:col-span-2 lg:col-span-4" onClick={() => updateParameter(parameterIndex, { ranges: parameter.ranges.filter((_, index) => index !== rangeIndex) })}>Remove range</button>
                  </div>
                ))}
              </div>
            </section>
          ))}
          <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">Seeded reference ranges are placeholders only and must be reviewed by a pathologist.</div>
          <div className="flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4"><Button variant="outline" onClick={() => setTestModalOpen(false)}>Cancel</Button><Button onClick={() => void saveTest()} disabled={saving}><Save className="h-4 w-4" />{saving ? "Saving…" : editingTest ? "Save changes" : "Add test"}</Button></div>
        </div>
      </Modal>

      <Modal open={packageModalOpen} onClose={() => setPackageModalOpen(false)} title={editingPackage ? "Edit lab package" : "Add lab package"} size="lg">
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="package-name">Package name *</Label><Input id="package-name" autoComplete="off" value={packageForm.name} onChange={(event) => setPackageForm((form) => ({ ...form, name: event.target.value }))} /></div>
            <div><Label htmlFor="package-price">Price (PKR) *</Label><Input id="package-price" type="number" min="0" step="0.01" value={packageForm.price} onChange={(event) => setPackageForm((form) => ({ ...form, price: event.target.value }))} /></div>
          </div>
          <fieldset className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-[var(--cp-border)] p-3">
            <legend className="px-1 text-sm font-semibold">Included active tests *</legend>
            {tests.filter((test) => test.isActive || packageForm.testIds.includes(test.id)).map((test) => <label key={test.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--cp-bg)]">
              <span><input type="checkbox" checked={packageForm.testIds.includes(test.id)} onChange={(event) => setPackageForm((form) => ({ ...form, testIds: event.target.checked ? [...form.testIds, test.id] : form.testIds.filter((id) => id !== test.id) }))} className="mr-2" />{test.testName}<span className="ml-2 text-xs text-[var(--cp-ink-soft)]">{test.testCode}{test.isActive ? "" : " · inactive; already linked"}</span></span>
              <span className="cp-tabular text-xs">{formatCurrency(Number(test.price))}</span>
            </label>)}
          </fieldset>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={packageForm.isActive} onChange={(event) => setPackageForm((form) => ({ ...form, isActive: event.target.checked }))} /> Active package</label>
          <div className="flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4"><Button variant="outline" onClick={() => setPackageModalOpen(false)}>Cancel</Button><Button onClick={() => void savePackage()} disabled={saving || packageForm.testIds.length === 0}><TestTube2 className="h-4 w-4" />{saving ? "Saving…" : editingPackage ? "Save package" : "Add package"}</Button></div>
        </div>
      </Modal>
    </div>
  )
}
