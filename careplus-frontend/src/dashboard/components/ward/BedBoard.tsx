import * as React from "react"
import { Check, UserRound, Clock3, Wrench, Sparkles } from "lucide-react"
import { BedTile } from "@/dashboard/components/ward/BedTile"
import { FilterBar, FilterSelect, EmptyState } from "@/dashboard/components/Primitives"
import type { Bed, BedStatus } from "@/dashboard/types"
import { WARD_TYPES } from "@/dashboard/data/wardData"
import { BedDouble } from "lucide-react"

const LEGEND: { status: BedStatus; icon: typeof Check; tone: string }[] = [
  { status: "Available", icon: Check, tone: "text-[var(--cp-success)]" },
  { status: "Occupied", icon: UserRound, tone: "text-[var(--cp-critical)]" },
  { status: "Reserved", icon: Clock3, tone: "text-[var(--cp-warning)]" },
  { status: "Cleaning", icon: Sparkles, tone: "text-[var(--cp-info)]" },
  { status: "Maintenance", icon: Wrench, tone: "text-[var(--cp-neutral)]" },
]

export function BedLegend() {
  return (
    <div className="sticky top-16 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)]/95 px-3 py-2 backdrop-blur cp-shadow sm:top-[68px]">
      {LEGEND.map((l) => {
        const Icon = l.icon
        return (
          <span key={l.status} className="flex items-center gap-1.5 text-xs font-medium text-[var(--cp-ink-soft)]">
            <Icon className={`h-3.5 w-3.5 ${l.tone}`} /> {l.status}
          </span>
        )
      })}
    </div>
  )
}

export function BedBoard({
  beds,
  onSelectBed,
  pickerMode,
  selectedBedId,
  showFilters = true,
}: {
  beds: Bed[]
  onSelectBed?: (bed: Bed) => void
  pickerMode?: boolean
  selectedBedId?: string
  showFilters?: boolean
}) {
  const [search, setSearch] = React.useState("")
  const [wardFilter, setWardFilter] = React.useState("all")
  const [statusFilter, setStatusFilter] = React.useState("all")

  const visibleBeds = pickerMode ? beds.filter((b) => b.status === "Available") : beds

  const filtered = visibleBeds.filter((b) => {
    const q = search.trim().toLowerCase()
    const matchesSearch = !q || b.bedNumber.toLowerCase().includes(q) || b.patientName?.toLowerCase().includes(q) || b.room.toLowerCase().includes(q)
    const matchesWard = wardFilter === "all" || b.ward === wardFilter
    const matchesStatus = pickerMode || statusFilter === "all" || b.status === statusFilter
    return matchesSearch && matchesWard && matchesStatus
  })

  const groups = WARD_TYPES.map((ward) => ({
    ward,
    beds: filtered.filter((b) => b.ward === ward),
  })).filter((g) => g.beds.length > 0)

  return (
    <div className="flex flex-col gap-4">
      {!pickerMode && <BedLegend />}

      {showFilters && (
        <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search bed, room, or patient…">
          <FilterSelect label="Ward" value={wardFilter} onChange={setWardFilter} options={[{ value: "all", label: "All wards" }, ...WARD_TYPES.map((w) => ({ value: w, label: w }))]} />
          {!pickerMode && (
            <FilterSelect
              label="Status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[{ value: "all", label: "All statuses" }, { value: "Available", label: "Available" }, { value: "Occupied", label: "Occupied" }, { value: "Reserved", label: "Reserved" }, { value: "Cleaning", label: "Cleaning" }, { value: "Maintenance", label: "Maintenance" }]}
            />
          )}
        </FilterBar>
      )}

      {groups.length === 0 && (
        <EmptyState icon={BedDouble} title="No beds match" description="Try adjusting the ward, status, or search filters." />
      )}

      {groups.map((g) => (
        <div key={g.ward} className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-[var(--cp-ink)]">{g.ward}</h3>
            <span className="cp-tabular rounded-full bg-[var(--cp-primary-light)] px-2 py-0.5 text-[11px] font-semibold text-[var(--cp-primary)]">{g.beds.length}</span>
          </div>
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {g.beds.map((bed) => (
              <BedTile key={bed.id} bed={bed} onClick={onSelectBed} selected={selectedBedId === bed.id} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
