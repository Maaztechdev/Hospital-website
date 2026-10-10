import * as React from "react"
import { LoaderCircle, Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Patient } from "@/dashboard/types"
import { api, toPatient } from "@/lib/api"
import { cn } from "@/lib/utils"
import { displayPakistaniPhone } from "@/dashboard/lib/format"

interface PatientSearchSelectProps {
  value: Patient | null
  onChange: (patient: Patient | null) => void
  prefillMR?: string
  label?: string
  error?: string
  disabled?: boolean
}

export function PatientSearchSelect({ value, onChange, prefillMR, label = "Patient", error, disabled }: PatientSearchSelectProps) {
  const inputId = React.useId()
  const listboxId = React.useId()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const onChangeRef = React.useRef(onChange)
  const prefillsRequestedRef = React.useRef(new Set<string>())
  const [query, setQuery] = React.useState("")
  const [results, setResults] = React.useState<Patient[]>([])
  const [loading, setLoading] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(-1)

  React.useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  React.useEffect(() => {
    const mrNumber = prefillMR?.trim()
    if (!mrNumber || value?.mrNumber === mrNumber || prefillsRequestedRef.current.has(mrNumber)) return
    prefillsRequestedRef.current.add(mrNumber)
    let cancelled = false
    api.searchPatients(mrNumber, 10).then((patients) => {
      if (cancelled) return
      const match = patients.find((patient) => patient.mrNumber.toLowerCase() === mrNumber.toLowerCase())
      if (match) onChangeRef.current(toPatient(match))
    }).catch(() => undefined)
    return () => {
      cancelled = true
      prefillsRequestedRef.current.delete(mrNumber)
    }
  }, [prefillMR, value?.mrNumber])

  React.useEffect(() => {
    const term = query.trim()
    if (value || term.length < 2) {
      setResults([])
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    const timeout = window.setTimeout(() => {
      api.searchPatients(term, 10)
        .then((patients) => {
          if (cancelled) return
          setResults(patients.map(toPatient))
          setActiveIndex(-1)
        })
        .catch(() => {
          if (!cancelled) setResults([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 300)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [query, value])

  function selectPatient(patient: Patient) {
    onChange(patient)
    setQuery("")
    setResults([])
    setOpen(false)
    setActiveIndex(-1)
  }

  function clearSelection() {
    onChange(null)
    setQuery("")
    setResults([])
    setOpen(true)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setOpen(true)
      if (results.length > 0) setActiveIndex((index) => (index + 1) % results.length)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setOpen(true)
      if (results.length > 0) setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1))
    } else if (event.key === "Enter" && open && activeIndex >= 0 && results[activeIndex]) {
      event.preventDefault()
      selectPatient(results[activeIndex])
    } else if (event.key === "Escape") {
      setOpen(false)
      setActiveIndex(-1)
    }
  }

  return (
    <div className="relative">
      <Label htmlFor={inputId}>{label}</Label>
      {value ? (
        <div className="mt-1 flex items-center justify-between gap-3 rounded-lg border border-[var(--cp-border)] bg-[var(--cp-surface)] p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--cp-ink)]">{value.name}</p>
            <p className="cp-tabular truncate text-xs text-[var(--cp-ink-soft)]">
              {value.mrNumber} · {value.age} yrs · {value.gender} · {displayPakistaniPhone(value.phone)}
            </p>
          </div>
          <button
            type="button"
            aria-label="Change patient"
            title="Change patient"
            onClick={clearSelection}
            disabled={disabled}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--cp-ink-soft)] hover:bg-[var(--cp-bg)] hover:text-[var(--cp-critical)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)] disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="relative mt-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--cp-ink-faint)]" />
          <Input
            ref={inputRef}
            id={inputId}
            name="patient_search"
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open && query.trim().length >= 2}
            aria-controls={listboxId}
            aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
            placeholder="Search by name, MR number or phone"
            value={query}
            disabled={disabled}
            error={!!error}
            className="pl-9"
            onFocus={() => { if (query.trim().length >= 2) setOpen(true) }}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onChange={(event) => {
              setQuery(event.target.value)
              setOpen(true)
              setActiveIndex(-1)
            }}
            onKeyDown={handleKeyDown}
          />
          {error && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{error}</p>}

          {open && query.trim().length >= 2 && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-[var(--cp-border)] bg-[var(--cp-surface)] shadow-lg">
              {loading ? (
                <p role="status" className="flex items-center gap-2 px-3 py-3 text-sm text-[var(--cp-ink-soft)]">
                  <LoaderCircle className="h-4 w-4 animate-spin" /> Searching patients…
                </p>
              ) : results.length === 0 ? (
                <p role="status" className="px-3 py-3 text-sm text-[var(--cp-ink-soft)]">No patient found</p>
              ) : (
                <ul id={listboxId} role="listbox" aria-label="Matching patients" className="max-h-72 overflow-y-auto py-1">
                  {results.map((patient, index) => (
                    <li key={patient.id ?? patient.mrNumber} role="presentation">
                      <button
                        id={`${listboxId}-option-${index}`}
                        type="button"
                        role="option"
                        aria-selected={activeIndex === index}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => selectPatient(patient)}
                        className={cn(
                          "flex w-full flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-[var(--cp-bg)]",
                          activeIndex === index && "bg-[var(--cp-bg)]"
                        )}
                      >
                        <span className="text-sm font-semibold text-[var(--cp-ink)]">{patient.name}</span>
                        <span className="cp-tabular text-xs text-[var(--cp-ink-soft)]">
                          {patient.mrNumber} · {patient.age} yrs · {patient.gender} · {displayPakistaniPhone(patient.phone)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
