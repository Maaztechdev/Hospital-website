import assert from "node:assert/strict"
import test from "node:test"

import { buildRealtimeUrl } from "./realtime-url.ts"

test("buildRealtimeUrl supports relative and absolute API base URLs", () => {
  assert.equal(buildRealtimeUrl("/api/v1", "/events/ticket"), "/api/v1/events/ticket")
  assert.equal(
    buildRealtimeUrl("https://api.example.com/api/v1", "/events/stream"),
    "https://api.example.com/api/v1/events/stream",
  )
})
