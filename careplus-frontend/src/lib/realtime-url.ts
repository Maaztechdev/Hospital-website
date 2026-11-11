export function buildRealtimeUrl(apiBaseUrl: string, endpoint: string): string {
  return `${apiBaseUrl.replace(/\/$/, "")}/${endpoint.replace(/^\//, "")}`
}
