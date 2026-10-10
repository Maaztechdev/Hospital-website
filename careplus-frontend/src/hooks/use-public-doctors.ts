import { useEffect, useState } from "react"
import { api, type ApiDoctor } from "@/lib/api"

export function usePublicDoctors() {
  const [doctors, setDoctors] = useState<ApiDoctor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let active = true

    api.listPublicDoctors().then((items) => {
      if (!active) return
      setDoctors(items)
      setError(null)
    }).catch((cause) => {
      if (!active) return
      console.error("Unable to load public doctors", cause)
      setError(cause)
    }).finally(() => {
      if (active) setLoading(false)
    })

    return () => {
      active = false
    }
  }, [])

  return { doctors, loading, error }
}