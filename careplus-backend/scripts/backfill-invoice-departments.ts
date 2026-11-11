import "../tests/setupEnv";
import { InvoiceDepartment, InvoiceItemType, Prisma, PrismaClient } from "@prisma/client";
import fs from "fs/promises";
import path from "path";

const reviewPath = path.resolve(__dirname, "../../docs/billing-redesign/backfill-review.csv");
const fallbackDepartment: InvoiceDepartment = "RECEPTION";

type InvoiceForClassification = {
  department: InvoiceDepartment | null;
  admissionId: string | null;
  labPackageId: string | null;
  pharmacySale: unknown;
  labOrders: unknown[];
  ultrasoundOrder: unknown;
  items: Array<{ itemType: InvoiceItemType }>;
};

export function classifyInvoiceDepartment(invoice: InvoiceForClassification) {
  const candidates = new Set<InvoiceDepartment>();
  if (invoice.pharmacySale || invoice.items.some((item) => item.itemType === "MEDICINE")) candidates.add("PHARMACY");
  if (invoice.labPackageId || invoice.labOrders.length > 0 || invoice.items.some((item) => item.itemType === "LAB")) candidates.add("LAB");
  if (invoice.ultrasoundOrder || invoice.items.some((item) => item.itemType === "ULTRASOUND")) candidates.add("ULTRASOUND");
  if (invoice.admissionId || invoice.items.some((item) => item.itemType === "WARD")) candidates.add("IPD");

  if (candidates.size > 1) {
    return { department: null, reason: `Mixed department evidence: ${Array.from(candidates).sort().join(", ")}` };
  }
  if (candidates.size === 1) {
    return { department: Array.from(candidates)[0], reason: null };
  }
  if (invoice.items.length > 0 && invoice.items.every((item) => item.itemType === "CONSULTATION")) {
    return { department: "RECEPTION" as const, reason: null };
  }
  return { department: null, reason: "No unambiguous source link or department-specific item type" };
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function ensureTestDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  const databaseName = databaseUrl
    ? new URL(databaseUrl).pathname.split("/").filter(Boolean).pop()?.split("?")[0]
    : undefined;
  if (!databaseName || !databaseName.endsWith("_test")) {
    throw new Error(`CRITICAL SAFETY ABORT: Database "${databaseName ?? "missing"}" does not end with "_test"!`);
  }
}

export async function backfillInvoiceDepartments(
  prisma: PrismaClient,
  apply: boolean,
  writeReport = true,
) {
  const result = await prisma.$transaction(async (tx) => {
    const invoices = await tx.invoice.findMany({
      include: {
        pharmacySale: { select: { id: true } },
        labOrders: { select: { id: true } },
        ultrasoundOrder: { select: { id: true } },
        items: { select: { itemType: true } },
      },
      orderBy: { id: "asc" },
    });
    const counts: Record<InvoiceDepartment, number> = {
      RECEPTION: 0,
      LAB: 0,
      PHARMACY: 0,
      ULTRASOUND: 0,
      IPD: 0,
    };
    const review: Array<{ id: string; invoiceNumber: string; reason: string; suggestedDepartment: InvoiceDepartment }> = [];

    for (const invoice of invoices) {
      if (invoice.department) {
        counts[invoice.department] += 1;
        continue;
      }
      const classification = classifyInvoiceDepartment(invoice);
      const department = classification.department ?? fallbackDepartment;
      counts[department] += 1;
      if (classification.reason) {
        review.push({
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          reason: classification.reason,
          suggestedDepartment: fallbackDepartment,
        });
      }
      if (apply) {
        await tx.invoice.update({ where: { id: invoice.id }, data: { department } });
      }
    }
    return { counts, ambiguousCount: review.length, review };
  }, { timeout: 30000, maxWait: 10000 });

  if (writeReport) {
    const lines = [
      ["invoice id", "invoice number", "reason", "suggested department"].join(","),
      ...result.review.map((item) => [
        item.id,
        item.invoiceNumber,
        item.reason,
        item.suggestedDepartment,
      ].map(csvCell).join(",")),
    ];
    await fs.mkdir(path.dirname(reviewPath), { recursive: true });
    await fs.writeFile(reviewPath, `${lines.join("\n")}\n`, "utf8");
  }
  return result;
}

async function main() {
  ensureTestDatabase();
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--dry-run" && arg !== "--apply") || (args.includes("--dry-run") && args.includes("--apply"))) {
    throw new Error("Usage: tsx scripts/backfill-invoice-departments.ts [--dry-run | --apply]");
  }
  // Defaults to --dry-run unless --apply is specified
  const apply = args.includes("--apply");
  const prisma = new PrismaClient();
  try {
    const result = await backfillInvoiceDepartments(prisma, apply);
    for (const [department, count] of Object.entries(result.counts)) {
      console.log(`${department}: ${count}`);
    }
    console.log(`Ambiguous: ${result.ambiguousCount}`);
    console.log(`Mode: ${apply ? "apply" : "dry-run"}; review: ${reviewPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
