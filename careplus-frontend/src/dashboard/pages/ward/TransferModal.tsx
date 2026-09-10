import * as React from "react"
import { ArrowRight } from "lucide-react"
import { Modal, ConfirmDialog } from "@/dashboard/components/Primitives"
import { BedTile } from "@/dashboard/components/ward/BedTile"
import { BedBoard } from "@/dashboard/components/ward/BedBoard"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import type { Bed } from "@/dashboard/types"
import { useToast } from "@/hooks/use-toast"
import { api } from "@/lib/api"

export function TransferModal({ bed, onClose }: { bed: Bed | null; onClose: () => void }) {
  const { beds, admissions, refreshWardState } = useDashboard()
  const { toast } = useToast()
  const [toBedId, setToBedId] = React.useState<string | null>(null)
  const [reason, setReason] = React.useState("")
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  React.useEffect(() => { setToBedId(null); setReason(""); setConfirmOpen(false) }, [bed])

  if (!bed) return null
  const admission = admissions.find((a) => a.id === bed.admissionId)
  const toBed = beds.find((b) => b.id === toBedId)

  function requestSubmit() {
    if (!toBed || !reason.trim()) return
    setConfirmOpen(true)
  }

  async function submit() {
    if (!admission || !toBed) return
    try {
      await api.transferAdmission(admission.id, { toBedId: toBed.id, reason: reason.trim() })
      await refreshWardState()
      toast({ title: "Patient transferred", description: `${admission.patientName} moved to ${toBed.bedNumber}.`, variant: "success" })
      setConfirmOpen(false)
      onClose()
    } catch (error) {
      toast({ title: "Transfer failed", description: error instanceof Error ? error.message : "Unable to transfer patient.", variant: "error" })
    }
  }

  return (
    <Modal open={!!bed} onClose={onClose} title="Transfer Patient" description="Move this patient to a different bed." size="lg">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-center gap-3 rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface-warm)] p-4">
          <div className="w-32"><BedTile bed={bed} /></div>
          <ArrowRight className="h-6 w-6 shrink-0 text-[var(--cp-primary)]" />
          <div className="w-32">
            {toBed ? <BedTile bed={toBed} selected /> : (
              <div className="flex h-full min-h-[84px] items-center justify-center rounded-xl border-2 border-dashed border-[var(--cp-border-strong)] text-center text-[11px] text-[var(--cp-ink-faint)]">
                Select new bed below
              </div>
            )}
          </div>
        </div>

        <div>
          <Label className="mb-1.5 block">Choose New Bed</Label>
          <div className="max-h-64 overflow-y-auto cp-scrollbar rounded-xl border border-[var(--cp-border)] p-3">
            <BedBoard beds={beds.filter((b) => b.id !== bed.id)} pickerMode onSelectBed={(b) => setToBedId(b.id)} selectedBedId={toBedId ?? undefined} />
          </div>
        </div>

        <div>
          <Label>Reason for Transfer</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Family requested private room, clinical escalation to ICU…" />
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!toBed || !reason.trim()} onClick={requestSubmit}>Confirm Transfer</Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={submit}
        title="Confirm Transfer"
        description={`Transfer ${admission?.patientName ?? "this patient"} from ${bed.bedNumber} to ${toBed?.bedNumber ?? "—"}?`}
        confirmLabel="Transfer Patient"
      />
    </Modal>
  )
}
