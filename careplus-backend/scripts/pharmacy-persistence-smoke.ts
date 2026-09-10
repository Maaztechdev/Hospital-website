type Envelope<T> = { success: boolean; data: T; message?: string | null }
type Batch = { id: string; stockQuantity: number }
type Medicine = { id: string; batches: Batch[] }
type Tokens = { accessToken: string; refreshToken: string; user: { id: string } }

const baseUrl = (process.env.API_URL ?? "http://localhost:4000/api/v1").replace(/\/$/, "")
const email = process.env.PHARMACY_EMAIL ?? "admin@careplus.local"
const password = process.env.PHARMACY_PASSWORD ?? "Admin@12345"
const batchId = process.env.PHARMACY_BATCH_ID
const prescriptionItemId = process.env.PHARMACY_PRESCRIPTION_ITEM_ID
const stockInQuantity = Number(process.env.PHARMACY_STOCK_IN_QUANTITY ?? 2)
const dispenseQuantity = Number(process.env.PHARMACY_DISPENSE_QUANTITY ?? 1)

if (!batchId || !prescriptionItemId) {
  throw new Error("Set PHARMACY_BATCH_ID and PHARMACY_PRESCRIPTION_ITEM_ID for a seeded batch and SIGNED prescription item.")
}

async function request<T>(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init.headers },
  })
  const body = (await response.json()) as Envelope<T>
  if (!response.ok || !body.success) throw new Error(`${init.method ?? "GET"} ${path}: ${body.message ?? response.status}`)
  return body.data
}

async function login() {
  return request<Tokens>("/auth/login", "", { method: "POST", body: JSON.stringify({ email, password }) })
}

async function findBatch(token: string) {
  const medicines = await request<Medicine[]>("/pharmacy/medicines?limit=100", token)
  const batch = medicines.flatMap((medicine) => medicine.batches).find((candidate) => candidate.id === batchId)
  if (!batch) throw new Error(`Batch ${batchId} was not found in the pharmacy catalog.`)
  return batch
}

const before = await findBatch((await login()).accessToken)
await request("/pharmacy/stock-in", (await login()).accessToken, { method: "POST", body: JSON.stringify({ batchId, quantity: stockInQuantity, reason: "Persistence smoke test" }) })
const afterStockIn = await findBatch((await login()).accessToken)
if (afterStockIn.stockQuantity !== before.stockQuantity + stockInQuantity) throw new Error("Stock-in quantity was not persisted.")

await request("/pharmacy/dispense", (await login()).accessToken, { method: "POST", body: JSON.stringify({ prescriptionItemId, quantity: dispenseQuantity }) })
const afterReload = await findBatch((await login()).accessToken)
const expected = before.stockQuantity + stockInQuantity - dispenseQuantity
if (afterReload.stockQuantity !== expected) throw new Error(`Expected persisted stock ${expected}, received ${afterReload.stockQuantity}.`)

console.log(`Pharmacy persistence verified: ${before.stockQuantity} -> ${afterStockIn.stockQuantity} -> ${afterReload.stockQuantity}`)
