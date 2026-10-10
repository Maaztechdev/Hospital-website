import * as React from "react"
import { useSearchParams } from "react-router-dom"
import { ArrowDownLeft, ArrowUpRight, BookOpen, Plus, Printer, Search, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { Modal } from "@/dashboard/components/Primitives"
import { formatCurrency, formatDateTime } from "@/dashboard/lib/format"
import { api, type ApiPharmacyLedger, type ApiPharmacyLedgerAccount, type ApiPharmacyLedgerEntry, type ApiPatient } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import { useHospitalProfile } from "@/lib/hospitalProfile"

type AccountType = "RECEIVABLE" | "PAYABLE"
type LedgerReceipt = { accountName: string; entry: ApiPharmacyLedgerEntry }

function entryLabel(entry: ApiPharmacyLedgerEntry) {
  if (entry.type === "SALE_ON_CREDIT") return "Sale on credit"
  if (entry.type === "PAYMENT_RECEIVED") return "Payment received"
  if (entry.type === "PAYMENT_MADE") return "Payment to party"
  return "Adjustment"
}

function PharmacyKhataReceipt({ receipt }: { receipt: LedgerReceipt }) {
  const profile = useHospitalProfile()
  return <article id="pharmacy-print-root" className="pharmacy-print-document pharmacy-print-receipt">
    <header className="pharmacy-print-header"><div><h1>{profile.name}</h1><p>{profile.address ?? ""}</p><p>{profile.phone ?? ""}</p><strong>Khata Receipt</strong></div></header>
    <section className="pharmacy-print-meta">
      <div className="pharmacy-print-field"><span>Customer / party</span><strong>{receipt.accountName}</strong></div>
      <div className="pharmacy-print-field"><span>Receipt date</span><strong>{formatDateTime(receipt.entry.createdAt)}</strong></div>
      <div className="pharmacy-print-field"><span>Receipt type</span><strong>{entryLabel(receipt.entry)}</strong></div>
      <div className="pharmacy-print-field"><span>Method</span><strong>{receipt.entry.paymentMethod?.replaceAll("_", " ") ?? "—"}</strong></div>
      <div className="pharmacy-print-field"><span>Amount</span><strong>{formatCurrency(Math.abs(Number(receipt.entry.amount)))}</strong></div>
      <div className="pharmacy-print-field"><span>Remaining balance</span><strong>{formatCurrency(Number(receipt.entry.balanceAfter))}</strong></div>
      {receipt.entry.notes && <div className="pharmacy-print-field"><span>Note</span><strong>{receipt.entry.notes}</strong></div>}
    </section>
    <footer className="pharmacy-print-footer">Payment recorded. Thank you.</footer>
  </article>
}

export default function PharmacyKhataPage() {
  const [searchParams] = useSearchParams()
  const patientIdFilter = searchParams.get("patientId") ?? undefined
  const { toast } = useToast()
  const [accounts, setAccounts] = React.useState<ApiPharmacyLedgerAccount[]>([])
  const [summary, setSummary] = React.useState({ receivable: 0, payable: 0 })
  const [search, setSearch] = React.useState("")
  const [accountType, setAccountType] = React.useState<AccountType | undefined>()
  const [loading, setLoading] = React.useState(true)
  const [selected, setSelected] = React.useState<ApiPharmacyLedgerAccount | null>(null)
  const [ledger, setLedger] = React.useState<ApiPharmacyLedger | null>(null)
  const [accountModalOpen, setAccountModalOpen] = React.useState(false)
  const [newAccountType, setNewAccountType] = React.useState<AccountType>("RECEIVABLE")
  const [customerName, setCustomerName] = React.useState("")
  const [customerPhone, setCustomerPhone] = React.useState("")
  const [patientSearch, setPatientSearch] = React.useState("")
  const [patientResults, setPatientResults] = React.useState<ApiPatient[]>([])
  const [linkedPatient, setLinkedPatient] = React.useState<ApiPatient | null>(null)
  const [paymentOpen, setPaymentOpen] = React.useState(false)
  const [paymentAmount, setPaymentAmount] = React.useState("")
  const [paymentMethod, setPaymentMethod] = React.useState<"CASH" | "CARD" | "BANK_TRANSFER" | "MOBILE_WALLET">("CASH")
  const [paymentNotes, setPaymentNotes] = React.useState("")
  const [adjustmentOpen, setAdjustmentOpen] = React.useState(false)
  const [adjustmentAmount, setAdjustmentAmount] = React.useState("")
  const [adjustmentNotes, setAdjustmentNotes] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [receipt, setReceipt] = React.useState<LedgerReceipt | null>(null)

  const loadAccounts = React.useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.listPharmacyLedgerAccounts({ search: search.trim() || undefined, type: accountType, patientId: patientIdFilter, limit: 50 })
      setAccounts(result.items)
      setSummary(result.summary)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load Khata accounts.")
    } finally {
      setLoading(false)
    }
  }, [accountType, patientIdFilter, search])

  React.useEffect(() => {
    const timer = window.setTimeout(() => { void loadAccounts() }, 250)
    return () => window.clearTimeout(timer)
  }, [loadAccounts])

  React.useEffect(() => {
    const invalidate = () => { void loadAccounts() }
    window.addEventListener("careplus:data-invalidated", invalidate)
    return () => window.removeEventListener("careplus:data-invalidated", invalidate)
  }, [loadAccounts])

  React.useEffect(() => {
    let active = true
    if (!patientSearch.trim() || linkedPatient || newAccountType !== "RECEIVABLE") {
      setPatientResults([])
      return () => { active = false }
    }
    void api.searchPatients(patientSearch.trim()).then((results) => {
      if (active) setPatientResults(results)
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : "Unable to search patients.")
    })
    return () => { active = false }
  }, [linkedPatient, newAccountType, patientSearch])

  const openLedger = async (account: ApiPharmacyLedgerAccount) => {
    setSelected(account)
    setLedger(null)
    try {
      setLedger(await api.getPharmacyLedger(account.id))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load this ledger.")
    }
  }

  const createAccount = async () => {
    if (!linkedPatient && !customerName.trim()) {
      setError("Enter a name or link an existing Patient.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.createPharmacyLedgerAccount({
        type: newAccountType,
        patientId: linkedPatient?.id,
        customerName: linkedPatient ? undefined : customerName.trim(),
        customerPhone: linkedPatient?.phone ?? (customerPhone.trim() || undefined),
      })
      setAccountModalOpen(false)
      setCustomerName("")
      setCustomerPhone("")
      setLinkedPatient(null)
      setPatientSearch("")
      toast({ title: newAccountType === "RECEIVABLE" ? "Customer added" : "Payable party added", variant: "success" })
      await loadAccounts()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to create the account."
      setError(message)
      toast({ title: "Khata account failed", description: message, variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  const submitPayment = async () => {
    if (!selected || !paymentAmount || !Number.isFinite(Number(paymentAmount)) || Number(paymentAmount) <= 0) {
      setError("Enter a payment amount greater than zero.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await api.recordPharmacyLedgerPayment(selected.id, {
        amount: Number(paymentAmount),
        paymentMethod,
        notes: paymentNotes.trim() || undefined,
      })
      setPaymentOpen(false)
      setReceipt({ accountName: selected.customerName, entry: result.entry })
      setSelected(null)
      setLedger(null)
      setPaymentAmount("")
      setPaymentNotes("")
      toast({ title: selected.type === "RECEIVABLE" ? "Payment received" : "Payment recorded", variant: "success" })
      await loadAccounts()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to record payment."
      setError(message)
      toast({ title: "Payment failed", description: message, variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  const submitAdjustment = async () => {
    if (!selected || !adjustmentAmount || !Number.isFinite(Number(adjustmentAmount)) || Number(adjustmentAmount) === 0 || !adjustmentNotes.trim()) {
      setError("Enter a non-zero adjustment and a reason.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.adjustPharmacyLedger(selected.id, { amount: Number(adjustmentAmount), notes: adjustmentNotes.trim() })
      setAdjustmentOpen(false)
      setAdjustmentAmount("")
      setAdjustmentNotes("")
      toast({ title: "Adjustment recorded", variant: "success" })
      await loadAccounts()
      await openLedger(selected)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to record adjustment."
      setError(message)
      toast({ title: "Adjustment failed", description: message, variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  React.useEffect(() => {
    if (!receipt) return
    const frame = window.requestAnimationFrame(() => window.print())
    return () => window.cancelAnimationFrame(frame)
  }, [receipt])

  return <div className="flex flex-col gap-4">
    <DashboardPageHeader title="Pharmacy Khata" action={<Button onClick={() => { setError(null); setAccountModalOpen(true) }}><Plus className="h-4 w-4" /> Add customer / party</Button>} />
    <p className="-mt-4 text-sm text-[var(--cp-ink-soft)]">Customer receivables and amounts payable to suppliers or other parties.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <section className="rounded-2xl border border-[var(--cp-border)] bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-sm text-[var(--cp-ink-soft)]"><ArrowDownLeft className="h-4 w-4" /> Receivable</div><p className="mt-2 text-2xl font-bold">{formatCurrency(summary.receivable)}</p><p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Outstanding customer balances</p></section>
      <section className="rounded-2xl border border-[var(--cp-border)] bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-sm text-[var(--cp-ink-soft)]"><ArrowUpRight className="h-4 w-4" /> Payable</div><p className="mt-2 text-2xl font-bold">{formatCurrency(summary.payable)}</p><p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Amounts owed to suppliers / parties</p></section>
    </div>
    <section className="rounded-2xl border border-[var(--cp-border)] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--cp-ink-soft)]" /><Input aria-label="Search Khata accounts" className="pl-9" placeholder="Search customer, phone, or MR number" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <select aria-label="Filter account type" className="h-10 rounded-md border border-[var(--cp-border)] bg-white px-3 text-sm" value={accountType ?? ""} onChange={(event) => setAccountType((event.target.value || undefined) as AccountType | undefined)}><option value="">All accounts</option><option value="RECEIVABLE">Customers</option><option value="PAYABLE">Payables</option></select>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-[var(--cp-critical-light)] p-2 text-sm text-[var(--cp-critical)]">{error}</p>}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="border-b border-[var(--cp-border)] text-xs uppercase text-[var(--cp-ink-soft)]"><tr><th className="p-3">Customer / party</th><th className="p-3">Last activity</th><th className="p-3">Balance</th><th className="p-3">Status</th><th className="p-3 text-right">Ledger</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className="p-6 text-center text-[var(--cp-ink-soft)]">Loading Khata accounts…</td></tr>
              : accounts.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-[var(--cp-ink-soft)]">No Khata accounts match this search.</td></tr>
                : accounts.map((account) => {
                  const balance = Number(account.balance)
                  return <tr key={account.id} className="border-b border-[var(--cp-border)] last:border-0">
                    <td className="p-3"><strong>{account.customerName}</strong><p className="text-xs text-[var(--cp-ink-soft)]">{account.patient ? `${account.patient.mrNumber} · ` : ""}{account.customerPhone ?? "No phone"} · {account.type === "PAYABLE" ? "Payable party" : account.patient ? "Linked Patient" : "Walk-in customer"}</p></td>
                    <td className="p-3 text-xs text-[var(--cp-ink-soft)]">{account.lastActivity ? formatDateTime(account.lastActivity.createdAt) : "No activity"}</td>
                    <td className="cp-tabular p-3 font-semibold">{formatCurrency(balance)}</td>
                    <td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${balance > 0 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{balance > 0 ? account.type === "PAYABLE" ? "Payable" : "Outstanding" : "Clear"}</span></td>
                    <td className="p-3 text-right"><Button variant="outline" size="sm" onClick={() => void openLedger(account)}><BookOpen className="h-4 w-4" /> Open ledger</Button></td>
                  </tr>
                })}
          </tbody>
        </table>
      </div>
    </section>

    <Modal open={accountModalOpen} onClose={() => setAccountModalOpen(false)} title="Add customer or payable party" size="md">
      <div className="space-y-3">
        <div><Label htmlFor="khata-account-type">Account type</Label><select id="khata-account-type" className="mt-1 h-10 w-full rounded-md border border-[var(--cp-border)] bg-white px-3 text-sm" value={newAccountType} onChange={(event) => { setNewAccountType(event.target.value as AccountType); setLinkedPatient(null) }}><option value="RECEIVABLE">Customer receivable</option><option value="PAYABLE">Supplier / party payable</option></select></div>
        {newAccountType === "RECEIVABLE" && <div>
          <Label htmlFor="khata-patient-search">Link existing Patient (optional)</Label>
          {linkedPatient ? <div className="mt-1 flex items-center justify-between rounded-lg bg-[var(--cp-bg)] p-3 text-sm"><span>{linkedPatient.firstName} {linkedPatient.lastName} · {linkedPatient.mrNumber}</span><Button size="sm" variant="outline" onClick={() => setLinkedPatient(null)}>Remove</Button></div> : <>
            <Input id="khata-patient-search" className="mt-1" placeholder="Search by name, phone, or MR number" value={patientSearch} onChange={(event) => setPatientSearch(event.target.value)} />
            {patientResults.length > 0 && <div className="max-h-36 overflow-y-auto rounded border border-[var(--cp-border)]">{patientResults.map((patient) => <button type="button" key={patient.id} className="block w-full p-2 text-left text-sm hover:bg-[var(--cp-bg)]" onClick={() => { setLinkedPatient(patient); setPatientSearch(""); setPatientResults([]) }}>{patient.firstName} {patient.lastName} · {patient.phone} · {patient.mrNumber}</button>)}</div>}
          </>}
        </div>}
        {!linkedPatient && <div><Label htmlFor="khata-account-name">{newAccountType === "PAYABLE" ? "Supplier / party name" : "Customer name"}</Label><Input id="khata-account-name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} maxLength={200} /></div>}
        {!linkedPatient && <div><Label htmlFor="khata-account-phone">Phone (optional)</Label><Input id="khata-account-phone" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} maxLength={50} /></div>}
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setAccountModalOpen(false)}>Cancel</Button><Button disabled={busy} onClick={() => void createAccount()}>{busy ? "Saving…" : "Create account"}</Button></div>
      </div>
    </Modal>

    <Modal open={Boolean(selected)} onClose={() => { setSelected(null); setLedger(null) }} title={selected ? `${selected.customerName} · Ledger` : "Ledger"} size="xl">
      {selected && <div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--cp-bg)] p-3"><div><p className="text-xs text-[var(--cp-ink-soft)]">{selected.type === "PAYABLE" ? "Amount payable" : "Amount receivable"}</p><p className="text-xl font-bold">{formatCurrency(ledger?.balance ?? Number(selected.balance))}</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => setAdjustmentOpen(true)}><Wallet className="h-4 w-4" /> Adjustment</Button><Button onClick={() => setPaymentOpen(true)}>{selected.type === "PAYABLE" ? "Record payment" : "Receive payment"}</Button></div></div>
        {!ledger ? <p className="p-6 text-center text-sm text-[var(--cp-ink-soft)]">Loading ledger…</p> : ledger.entries.length === 0 ? <p className="p-6 text-center text-sm text-[var(--cp-ink-soft)]">No ledger activity yet.</p> : <div className="mt-4 max-h-[55vh] overflow-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="sticky top-0 bg-white text-xs uppercase text-[var(--cp-ink-soft)]"><tr><th className="p-2">Date</th><th className="p-2">Entry</th><th className="p-2">Note / invoice</th><th className="p-2 text-right">Change</th><th className="p-2 text-right">Balance</th></tr></thead><tbody>{ledger.entries.map((entry) => <tr key={entry.id} className="border-t border-[var(--cp-border)]"><td className="p-2 whitespace-nowrap">{formatDateTime(entry.createdAt)}</td><td className="p-2">{entryLabel(entry)}</td><td className="p-2">{entry.invoice?.invoiceNumber ?? entry.notes ?? "—"}</td><td className={`cp-tabular p-2 text-right ${Number(entry.amount) < 0 ? "text-emerald-700" : ""}`}>{Number(entry.amount) < 0 ? "−" : "+"}{formatCurrency(Math.abs(Number(entry.amount)))}</td><td className="cp-tabular p-2 text-right">{formatCurrency(Number(entry.balanceAfter))}</td></tr>)}</tbody></table></div>}
      </div>}
    </Modal>

    <Modal open={paymentOpen} onClose={() => setPaymentOpen(false)} title={selected?.type === "PAYABLE" ? "Record payment to party" : "Receive customer payment"} size="sm">
      {selected && <div className="space-y-3">
        <p className="text-sm text-[var(--cp-ink-soft)]">Outstanding balance: {formatCurrency(ledger?.balance ?? Number(selected.balance))}</p>
        <div><Label htmlFor="khata-payment-amount">Amount (PKR)</Label><Input id="khata-payment-amount" type="number" min="0.01" step="0.01" max={ledger?.balance ?? Number(selected.balance)} value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></div>
        <div><Label htmlFor="khata-payment-method">Payment method</Label><select id="khata-payment-method" className="mt-1 h-10 w-full rounded-md border border-[var(--cp-border)] bg-white px-3 text-sm" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)}><option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK_TRANSFER">Other / bank transfer</option><option value="MOBILE_WALLET">Mobile wallet</option></select></div>
        <div><Label htmlFor="khata-payment-note">Note (optional)</Label><Input id="khata-payment-note" value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} maxLength={500} /></div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button><Button disabled={busy} onClick={() => void submitPayment()}>{busy ? "Recording…" : "Record payment"}</Button></div>
      </div>}
    </Modal>

    <Modal open={adjustmentOpen} onClose={() => setAdjustmentOpen(false)} title="Adjust ledger balance" size="sm">
      <div className="space-y-3"><p className="text-xs text-[var(--cp-ink-soft)]">Use a positive amount to increase the balance or a negative amount to reduce it.</p><div><Label htmlFor="khata-adjust-amount">Adjustment (PKR)</Label><Input id="khata-adjust-amount" type="number" step="0.01" value={adjustmentAmount} onChange={(event) => setAdjustmentAmount(event.target.value)} /></div><div><Label htmlFor="khata-adjust-note">Reason (required)</Label><Input id="khata-adjust-note" value={adjustmentNotes} onChange={(event) => setAdjustmentNotes(event.target.value)} maxLength={500} /></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setAdjustmentOpen(false)}>Cancel</Button><Button disabled={busy} onClick={() => void submitAdjustment()}>{busy ? "Saving…" : "Save adjustment"}</Button></div></div>
    </Modal>

    {receipt && <div className="fixed bottom-4 right-4 z-50 flex gap-2 rounded-xl border bg-white p-3 shadow-lg print:hidden"><span className="self-center text-sm">Payment receipt ready</span><Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print receipt</Button><Button size="sm" onClick={() => setReceipt(null)}>Done</Button></div>}
    {receipt && <PharmacyKhataReceipt receipt={receipt} />}
  </div>
}
