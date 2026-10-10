import * as React from "react"
import { Modal } from "@/dashboard/components/Primitives"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { api } from "@/lib/api"

export function AddAdmissionDepositModal({
  open,
  admissionId,
  patientName,
  onClose,
  onRecorded,
}: {
  open: boolean
  admissionId: string | null
  patientName: string
  onClose: () => void
  onRecorded: () => Promise<void> | void
}) {
  const { toast } = useToast()
  const [amount, setAmount] = React.useState("")
  const [paymentMethod, setPaymentMethod] = React.useState<"CASH" | "CARD" | "BANK_TRANSFER" | "MOBILE_WALLET">("CASH")
  const [notes, setNotes] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState("")

  React.useEffect(() => {
    if (!open) return
    setAmount("")
    setPaymentMethod("CASH")
    setNotes("")
    setError("")
  }, [open, admissionId])

  async function submit() {
    const numericAmount = Number(amount)
    if (!admissionId || !Number.isInteger(numericAmount) || numericAmount < 1 || numericAmount > 1_000_000) {
      setError("Enter a whole deposit amount between PKR 1 and PKR 1,000,000.")
      return
    }
    setSaving(true)
    setError("")
    try {
      await api.recordAdmissionDeposit(admissionId, { amount: numericAmount, paymentMethod, ...(notes.trim() ? { notes: notes.trim() } : {}) })
      toast({ title: "Deposit recorded", description: `PKR ${numericAmount.toLocaleString()} recorded for ${patientName}.`, variant: "success" })
      onClose()
      try {
        await onRecorded()
      } catch (cause) {
        toast({ title: "Deposit recorded; refresh failed", description: cause instanceof Error ? cause.message : "Refresh the admission details to see the deposit.", variant: "error" })
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The deposit could not be recorded."
      setError(message)
      toast({ title: "Deposit failed", description: message, variant: "error" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add admission deposit" size="sm">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[var(--cp-ink-soft)]">Record a deposit for {patientName}.</p>
        <div>
          <Label htmlFor="admission-deposit-amount">Amount (PKR)</Label>
          <Input id="admission-deposit-amount" aria-label="Amount (PKR)" type="number" min="1" max="1000000" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="admission-deposit-method">Payment method</Label>
          <Select id="admission-deposit-method" aria-label="Payment method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)}>
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="MOBILE_WALLET">Mobile wallet</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="admission-deposit-notes">Notes (optional)</Label>
          <Textarea id="admission-deposit-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
        {error && <p role="alert" className="text-sm text-[var(--cp-critical)]">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={() => void submit()} disabled={saving}>{saving ? "Saving…" : "Record deposit"}</Button>
        </div>
      </div>
    </Modal>
  )
}
