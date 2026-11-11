import { API_BASE_URL, getAccessToken, subscribeToSession } from "./api"
import { buildRealtimeUrl } from "./realtime-url"

let eventSource: EventSource | null = null
let reconnectTimer: number | null = null
let isConnecting = false
const listeners = new Set<(event: { type: string; payload?: unknown }) => void>()

const tabId = typeof window !== "undefined" ? Math.random().toString(36).slice(2, 9) : "server"
const channel = typeof window !== "undefined" && "BroadcastChannel" in window
  ? new BroadcastChannel("careplus_realtime_bus")
  : null

let isChannelLeader = false
let leaderLastSeen = 0
let leaderHeartbeatInterval: number | null = null

export function subscribeRealtime(listener: (event: { type: string; payload?: unknown }) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notifyListeners(event: { type: string; payload?: unknown }) {
  listeners.forEach((l) => {
    try {
      l(event)
    } catch {}
  })
}

// Broadcast incoming SSE events to all tabs
function dispatchEvent(event: { type: string; payload?: unknown }) {
  notifyListeners(event)
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("careplus:data-invalidated", { detail: event }))
  }
  if (channel && isChannelLeader) {
    channel.postMessage({ type: "SSE_EVENT", event })
  }
}

if (channel) {
  channel.onmessage = (msgEvent) => {
    const data = msgEvent.data
    if (!data || typeof data !== "object") return

    if (data.type === "SSE_EVENT" && data.event) {
      // Received broadcast from the leader tab
      notifyListeners(data.event)
      window.dispatchEvent(new CustomEvent("careplus:data-invalidated", { detail: data.event }))
    } else if (data.type === "LEADER_HEARTBEAT") {
      leaderLastSeen = Date.now()
      if (isChannelLeader && data.tabId !== tabId) {
        // Yield to older leader if duplicate
        if (data.tabId < tabId) {
          isChannelLeader = false
          cleanupEventSource()
        }
      }
    } else if (data.type === "LEADER_DEPARTING" && data.tabId !== tabId) {
      leaderLastSeen = 0
      initRealtime()
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
      if (isChannelLeader) {
        channel.postMessage({ type: "LEADER_DEPARTING", tabId })
      }
    })
  }
}

export function cleanupRealtime() {
  cleanupEventSource()
  isChannelLeader = false
  isConnecting = false
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

function cleanupEventSource() {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
  if (leaderHeartbeatInterval) {
    window.clearInterval(leaderHeartbeatInterval)
    leaderHeartbeatInterval = null
  }
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

async function obtainTicket(token: string): Promise<string | null> {
  try {
    const res = await fetch(buildRealtimeUrl(API_BASE_URL, "/events/ticket"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
    })
    if (!res.ok) return null
    const json = await res.json()
    return json.ticket || null
  } catch {
    return null
  }
}

export async function initRealtime() {
  if (typeof window === "undefined") return
  const token = getAccessToken()
  if (!token) {
    cleanupEventSource()
    isChannelLeader = false
    return
  }

  // If another tab is active leader and seen within 6 seconds, do not open duplicate connection
  const now = Date.now()
  if (!isChannelLeader && channel && (now - leaderLastSeen < 6000)) {
    return
  }

  if (isConnecting || (eventSource && eventSource.readyState !== EventSource.CLOSED)) {
    return
  }

  isConnecting = true

  try {
    // Obtain short-lived single-use ticket to avoid exposing JWT in URL query string
    const ticket = await obtainTicket(token)
    if (!ticket) {
      isConnecting = false
      scheduleReconnect()
      return
    }

    const url = `${buildRealtimeUrl(API_BASE_URL, "/events/stream")}?ticket=${encodeURIComponent(ticket)}`
    eventSource = new EventSource(url, { withCredentials: true })
    isChannelLeader = true

    if (leaderHeartbeatInterval) window.clearInterval(leaderHeartbeatInterval)
    leaderHeartbeatInterval = window.setInterval(() => {
      if (channel && isChannelLeader) {
        channel.postMessage({ type: "LEADER_HEARTBEAT", tabId })
      }
    }, 3000)

    eventSource.onopen = () => {
      isConnecting = false
    }

    eventSource.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data)
        dispatchEvent(parsed)
      } catch {}
    }

    const eventTypes = [
      "queue:updated",
      "appointment:updated",
      "appointment:created",
      "consultation:started",
      "consultation:completed",
      "prescription:created",
      "prescription:dispensed",
      "ward:admission_updated",
      "ward:bed_updated",
      "ward:round_recorded",
      "lab:order_updated",
      "ultrasound:order_updated",
    ]

    eventTypes.forEach((type) => {
      eventSource?.addEventListener(type, (e: MessageEvent) => {
        try {
          const parsed = JSON.parse(e.data)
          dispatchEvent(parsed)
        } catch {}
      })
    })

    eventSource.onerror = () => {
      cleanupEventSource()
      isChannelLeader = false
      isConnecting = false
      scheduleReconnect()
    }
  } catch {
    isConnecting = false
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  if (reconnectTimer) window.clearTimeout(reconnectTimer)
  reconnectTimer = window.setTimeout(() => {
    initRealtime()
  }, 5000)
}

if (typeof window !== "undefined") {
  subscribeToSession(() => {
    if (!getAccessToken()) {
      cleanupRealtime()
    } else {
      initRealtime()
    }
  })
  window.addEventListener("focus", () => {
    if (getAccessToken()) {
      initRealtime()
      window.dispatchEvent(new CustomEvent("careplus:data-invalidated"))
    }
  })
}
