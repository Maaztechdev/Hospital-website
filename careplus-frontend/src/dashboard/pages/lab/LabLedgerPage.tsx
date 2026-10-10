import * as React from "react"
import { ArrowDownLeft, ArrowUpRight, BookOpen, Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { Modal } from "@/dashboard/components/Primitives"
import { formatCurrency, formatDateTime } from "@/dashboard/lib/format"
import { useToast } from "@/hooks/use-toast"
import { api, type ApiCreateLabLedgerAccountInput, type ApiLabLedger, type ApiLabLedgerAccount } from "@/lib/api"

type LedgerType = "RECEIVABLE" | "PAYABLE"

function entryLabel(type: string) {
  if (type === "INVOICE_CHARGE") return "Invoice charged"
  if (type === "PAYMENT_RECEIVED") return "Payment received"
  if (type === "SEND_OUT_CHARGE") return "Send-out cost"
  if (type === "PAYMENT_MADE") return "Payment to reference lab"
  return "Adjustment"
}

export default function LabLedgerPage() {
  const { toast } = useToast()
  const [accounts, setAccounts] = React.useState<ApiLabLedgerAccount[]>([])
  const [summary, setSummary] = React.useState({ receivable: 0, payable: 0 })
  const [search, setSearch] = React.useState("")
  const [accountType, setAccountType] = React.useState<LedgerType | "">("")
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [selected, setSelected] = React.useState<ApiLabLedgerAccount | null>(null)
  const [ledger, setLedger] = React.useState<ApiLabLedger | null>(null)
  const [ledgerLoading, setLedgerLoading] = React.useState(false)
  const [accountModalOpen, setAccountModalOpen] = React.useState(false)
  const [partyType, setPartyType] = React.useState<ApiCreateLabLedgerAccountInput["partyType"]>("CLINIC")
  const [partyName, setPartyName] = React.useState("")
  const [partyPhone, setPartyPhone] = React.useState("")
  const [paymentOpen, setPaymentOpen] = React.useState(false)
  const [paymentAmount, setPaymentAmount] = React.useState("")
  const [paymentMethod, setPaymentMethod] = React.useState<"CASH" | "CARD" | "BANK_TRANSFER" | "MOBILE_WALLET">("CASH")
  const [paymentNotes, setPaymentNotes] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  const loadAccounts = React.useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const result = await api.listLabLedgerAccounts({
        search: search.trim() || undefined,
        type: accountType || undefined,
        limit: 100,
      })
      setAccounts(result.items)
      setSummary(result.summary)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load Lab ledger accounts.")
    } finally {
      setLoading(false)
    }
  }, [accountType, search])

  React.useEffect(() => {
    const timer = window.setTimeout(() => { void loadAccounts() }, 250)
    return () => window.clearTimeout(timer)
  }, [loadAccounts])

  async function openLedger(account: ApiLabLedgerAccount) {
    setSelected(account)
    setLedger(null)
    setLedgerLoading(true)
    try {
      setLedger(await api.getLabLedger(account.id))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load this Lab ledger.")
    } finally {
      setLedgerLoading(false)
    }
  }

  async function createAccount() {
    if (!partyName.trim()) {
      setError("Enter a clinic or reference-lab name.")
      return
    }
    setBusy(true)
    setError("")
    try {
      await api.createLabLedgerAccount({
        partyType,
        partyName: partyName.trim(),
        ...(partyPhone.trim() ? { partyPhone: partyPhone.trim() } : {}),
      })
      setAccountModalOpen(false)
      setPartyName("")
      setPartyPhone("")
      toast({ title: partyType === "CLINIC" ? "Clinic account created" : "Reference lab account created", variant: "success" })
      await loadAccounts()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to create the Lab ledger account."
      setError(message)
      toast({ title: "Account creation failed", description: message, variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  async function recordPayment() {
    if (!selected || !paymentAmount || !Number.isFinite(Number(paymentAmount)) || Number(paymentAmount) <= 0) {
      setError("Enter a payment amount greater than zero.")
      return
    }
    setBusy(true)
    setError("")
    try {
      await api.recordLabLedgerPayment(selected.id, {
        amount: Number(paymentAmount),
        paymentMethod,
        ...(paymentNotes.trim() ? { notes: paymentNotes.trim() } : {}),
      })
      setPaymentOpen(false)
      setPaymentAmount("")
      setPaymentNotes("")
      toast({ title: selected.type === "RECEIVABLE" ? "Payment received" : "Reference-lab payment recorded", variant: "success" })
      await loadAccounts()
      await openLedger(selected)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to record the Lab ledger payment."
      setError(message)
      toast({ title: "Payment failed", description: message, variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  return <div className="flex flex-col gap-4">
    <DashboardPageHeader title="Lab Credit Ledger" action={<Button onClick={() => { setError(""); setAccountModalOpen(true) }}><Plus className="h-4 w-4" /> Add clinic / reference lab</Button>} />
    <p className="-mt-4 text-sm text-[var(--cp-ink-soft)]">Patient and clinic receivables, and amounts owed to outsourced reference labs.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <section className="rounded-2xl border border-[var(--cp-border)] bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-[var(--cp-ink-soft)]"><ArrowDownLeft className="h-4 w-4" /> Receivable</div>
        <p className="mt-2 text-2xl font-bold">{formatCurrency(summary.receivable)}</p>
        <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Outstanding patient and referring-clinic invoices</p>
      </section>
      <section className="rounded-2xl border border-[var(--cp-border)] bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-[var(--cp-ink-soft)]"><ArrowUpRight className="h-4 w-4" /> Payable</div>
        <p className="mt-2 text-2xl font-bold">{formatCurrency(summary.payable)}</p>
        <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Unpaid send-out costs to reference labs</p>
      </section>
    </div>
    <section className="rounded-2xl border border-[var(--cp-border)] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--cp-ink-soft)]" /><Input aria-label="Search Lab ledger accounts" className="pl-9" placeholder="Search party, phone, or patient MR number" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <select aria-label="Filter ledger type" className="h-10 rounded-md border border-[var(--cp-border)] bg-white px-3 text-sm" value={accountType} onChange={(event) => setAccountType(event.target.value as LedgerType | "")}><option value="">All accounts</option><option value="RECEIVABLE">Receivables</option><option value="PAYABLE">Payables</option></select>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-[var(--cp-critical-light)] p-2 text-sm text-[var(--cp-critical)]">{error}</p>}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="border-b border-[var(--cp-border)] text-xs uppercase text-[var(--cp-ink-soft)]"><tr><th className="p-3">Party</th><th className="p-3">Last activity</th><th className="p-3">Balance</th><th className="p-3">Type</th><th className="p-3 text-right">Ledger</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className="p-6 text-center text-[var(--cp-ink-soft)]">Loading Lab ledger…</td></tr>
              : accounts.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-[var(--cp-ink-soft)]">No Lab ledger accounts match this search.</td></tr>
                : accounts.map((account) => <tr key={account.id} className="border-b border-[var(--cp-border)] last:border-0">
                  <td className="p-3"><strong>{account.partyName}</strong><p className="text-xs text-[var(--cp-ink-soft)]">{account.patient ? `${account.patient.mrNumber} · Patient` : account.partyType === "CLINIC" ? "Referring clinic" : "Reference lab"}{account.partyPhone ? ` · ${account.partyPhone}` : ""}</p></td>
                  <td className="p-3 text-xs text-[var(--cp-ink-soft)]">{account.lastActivity ? formatDateTime(account.lastActivity.createdAt) : "No activity"}</td>
                  <td className="cp-tabular p-3 font-semibold">{formatCurrency(Number(account.balance))}</td>
                  <td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${account.type === "PAYABLE" ? "bg-amber-100 text-amber-800" : "bg-teal-100 text-teal-800"}`}>{account.type === "PAYABLE" ? "Payable" : "Receivable"}</span></td>
                  <td className="p-3 text-right"><Button variant="outline" size="sm" onClick={() => void openLedger(account)}><BookOpen className="h-4 w-4" /> Open ledger</Button></td>
                </tr>)}
          </tbody>
        </table>
      </div>
    </section>

    <Modal open={accountModalOpen} onClose={() => setAccountModalOpen(false)} title="Add clinic or reference lab" size="md">
      <div className="space-y-3">
        {error && <p role="alert" className="rounded-lg bg-[var(--cp-critical-light)] p-2 text-sm text-[var(--cp-critical)]">{error}</p>}
        <div><Label htmlFor="lab-ledger-party-type">Party type</Label><select id="lab-ledger-party-type" className="mt-1 h-10 w-full rounded-md border border-[var(--cp-border)] bg-white px-3 text-sm" value={partyType} onChange={(event) => setPartyType(event.target.value as typeof partyType)}><option value="CLINIC">Referring clinic · receivable</option><option value="REFERENCE_LAB">Reference lab · payable</option></select></div>
        <div><Label htmlFor="lab-ledger-party-name">{partyType === "CLINIC" ? "Clinic name" : "Reference lab name"} *</Label><Input id="lab-ledger-party-name" value={partyName} onChange={(event) => setPartyName(event.target.value)} maxLength={200} /></div>
        <div><Label htmlFor="lab-ledger-party-phone">Phone (optional)</Label><Input id="lab-ledger-party-phone" value={partyPhone} onChange={(event) => setPartyPhone(event.target.value)} maxLength={50} /></div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setAccountModalOpen(false)}>Cancel</Button><Button disabled={busy} onClick={() => void createAccount()}>{busy ? "Saving…" : "Create account"}</Button></div>
      </div>
    </Modal>

    <Modal open={Boolean(selected)} onClose={() => { setSelected(null); setLedger(null) }} title={selected ? `${selected.partyName} · Ledger` : "Ledger"} size="xl">
      {selected && <div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--cp-bg)] p-3">
          <div><p className="text-xs text-[var(--cp-ink-soft)]">{selected.type === "PAYABLE" ? "Amount payable" : "Amount receivable"}</p><p className="text-xl font-bold">{formatCurrency(ledger?.balance ?? Number(selected.balance))}</p></div>
          <Button disabled={Number(ledger?.balance ?? selected.balance) <= 0} onClick={() => { setError(""); setPaymentOpen(true) }}>{selected.type === "PAYABLE" ? "Record payment" : "Receive payment"}</Button>
        </div>
        {ledgerLoading ? <p className="p-6 text-center text-sm text-[var(--cp-ink-soft)]">Loading ledger…</p>
          : !ledger || ledger.entries.length === 0 ? <p className="p-6 text-center text-sm text-[var(--cp-ink-soft)]">No ledger activity yet.</p>
            : <div className="mt-4 max-h-[55vh] overflow-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="sticky top-0 bg-white text-xs uppercase text-[var(--cp-ink-soft)]"><tr><th className="p-2">Date</th><th className="p-2">Entry</th><th className="p-2">Note / reference</th><th className="p-2">Recorded by</th><th className="p-2 text-right">Change</th><th className="p-2 text-right">Balance</th></tr></thead><tbody>{ledger.entries.map((entry) => <tr key={entry.id} className="border-t border-[var(--cp-border)]"><td className="whitespace-nowrap p-2">{formatDateTime(entry.createdAt)}</td><td className="p-2">{entryLabel(entry.type)}</td><td className="p-2">{entry.invoice?.invoiceNumber ?? entry.labOrder?.orderNumber ?? entry.notes ?? "—"}</td><td className="p-2">{entry.creator?.name ?? "System"}</td><td className={`cp-tabular p-2 text-right ${Number(entry.amount) < 0 ? "text-emerald-700" : ""}`}>{Number(entry.amount) < 0 ? "−" : "+"}{formatCurrency(Math.abs(Number(entry.amount)))}</td><td className="cp-tabular p-2 text-right">{formatCurrency(Number(entry.balanceAfter))}</td></tr>)}</tbody></table></div>}
      </div>}
    </Modal>

    <Modal open={paymentOpen} onClose={() => setPaymentOpen(false)} title={selected?.type === "PAYABLE" ? "Record payment to reference lab" : "Receive Lab payment"} size="sm">
      {selected && <div className="space-y-3">
        {error && <p role="alert" className="rounded-lg bg-[var(--cp-critical-light)] p-2 text-sm text-[var(--cp-critical)]">{error}</p>}
        <p className="text-sm text-[var(--cp-ink-soft)]">Outstanding balance: {formatCurrency(ledger?.balance ?? Number(selected.balance))}</p>
        <div><Label htmlFor="lab-ledger-payment-amount">Amount (PKR)</Label><Input id="lab-ledger-payment-amount" type="number" min="0.01" step="0.01" max={ledger?.balance ?? Number(selected.balance)} value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></div>
        <div><Label htmlFor="lab-ledger-payment-method">Payment method</Label><select id="lab-ledger-payment-method" className="mt-1 h-10 w-full rounded-md border border-[var(--cp-border)] bg-white px-3 text-sm" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)}><option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK_TRANSFER">Bank transfer</option><option value="MOBILE_WALLET">Mobile wallet</option></select></div>
        <div><Label htmlFor="lab-ledger-payment-note">Note (optional)</Label><Input id="lab-ledger-payment-note" value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} maxLength={500} /></div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button><Button disabled={busy} onClick={() => void recordPayment()}>{busy ? "Recording…" : "Record payment"}</Button></div>
      </div>}
    </Modal>
  </div>
}
