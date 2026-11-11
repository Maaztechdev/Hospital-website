import { PrismaClient } from "../node_modules/@prisma/client"

const prisma = new PrismaClient({
  datasources: {
    db: { url: "postgresql://careplus:carepluspass123@localhost:5432/careplus_test?schema=public" }
  }
})

async function runExplain(title: string, sql: string) {
  console.log(`\n=== EXPLAIN (ANALYZE, BUFFERS): ${title} ===`)
  console.log(`QUERY:\n${sql.trim()}\n`)
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`)
  rows.forEach(r => console.log(Object.values(r)[0]))
}

async function main() {
  // Grab row 10,000 to get a real cursor for page 200 (200 * 50 = 10,000)
  const cursorRow = await prisma.$queryRawUnsafe<Array<{ id: string; created_at: Date }>>(
    `SELECT id, created_at FROM appointments ORDER BY created_at DESC, id DESC OFFSET 10000 LIMIT 1;`
  )
  const cursor = cursorRow[0]
  console.log("Cursor at row 10,000 (Page 200):", cursor.created_at.toISOString(), cursor.id)

  const keysetSql = `SELECT id, appointment_date, time_slot, status, patient_id, doctor_id, created_at
FROM appointments
WHERE (created_at, id) < ('${cursor.created_at.toISOString()}'::timestamp with time zone, '${cursor.id}')
ORDER BY created_at DESC, id DESC
LIMIT 50;`

  await runExplain("Keyset Pagination: Page 200 (50 rows)", keysetSql)
}

main().finally(() => prisma.$disconnect())
