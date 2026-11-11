import { spawn } from "child_process";
import { PrismaClient } from "@prisma/client";

function assertTestDb() {
  const dbUrl = process.env.DATABASE_URL || "";
  const dbMatch = dbUrl.match(/\/([^/?]+)(\?|$)/);
  const dbName = dbMatch ? dbMatch[1] : "";
  if (!dbName || !dbName.endsWith("_test")) {
    throw new Error(`CRITICAL SAFETY ABORT: Database "${dbName}" does not end with "_test"!`);
  }
}

const prisma = new PrismaClient();

async function main() {
  assertTestDb();
  console.log("=== HARD PROCESS KILL (-9) MID-TRANSACTION TEST ===");
  console.log("Database target:", process.env.DATABASE_URL?.split("@")[1]);

  const testInvoiceNumber = `INV-KILL-${Date.now()}`;
  console.log(`1. Setting up test invoice: ${testInvoiceNumber}`);

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  const patient = await prisma.patient.findFirst({ where: { deletedAt: null } });
  if (!admin || !patient) throw new Error("Admin or patient not found");

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: testInvoiceNumber,
      patientId: patient.id,
      department: "RECEPTION",
      status: "FINALIZED",
      subtotal: 5000,
      grandTotal: 5000,
      paidAmount: 0,
      balanceAmount: 5000,
      createdBy: admin.id,
    },
  });
  console.log(`   Invoice created with ID: ${invoice.id}, initial paidAmount: 0`);

  // 2. Spawn child process that opens a Prisma transaction and hangs
  console.log("2. Spawning child worker process to execute transaction...");
  const childScript = `
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    async function run() {
      await prisma.$transaction(async (tx) => {
        await tx.payment.create({
          data: {
            invoiceId: '${invoice.id}',
            amount: 2500,
            paymentMethod: 'CASH',
            type: 'PAYMENT',
            createdBy: '${admin.id}',
          }
        });
        await tx.invoice.update({
          where: { id: '${invoice.id}' },
          data: { paidAmount: 2500, balanceAmount: 2500 }
        });
        console.log('WORKER_MID_TRANSACTION_READY');
        // Hold transaction open until killed
        await new Promise(() => {});
      }, { timeout: 60000 });
    }
    run().catch(err => { console.error(err); process.exit(1); });
  `;

  const child = spawn("node", ["-e", childScript], {
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  await new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (data) => {
      const msg = data.toString();
      if (msg.includes("WORKER_MID_TRANSACTION_READY")) {
        console.log("   Worker staged payment and updated invoice within open transaction.");
        resolve();
      }
    });
    child.stderr.on("data", (data) => {
      console.error("Child stderr:", data.toString());
    });
    child.on("error", reject);
  });

  // 3. HARD KILL (-9) the child process
  console.log(`3. Force killing worker process (PID: ${child.pid}) via SIGKILL...`);
  if (process.platform === "win32") {
    spawn("taskkill", ["/F", "/PID", String(child.pid)]);
  } else {
    child.kill("SIGKILL");
  }

  // Wait 1 second for PostgreSQL to detect socket disconnect and rollback
  await new Promise((r) => setTimeout(r, 1200));

  // 4. Verify DB state in PostgreSQL
  console.log("4. Inspecting database state after process death...");
  const paymentsCount = await prisma.payment.count({ where: { invoiceId: invoice.id } });
  console.log(`   Payments found for invoice: ${paymentsCount} (Expected: 0)`);

  const updatedInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
  const paidAmount = Number(updatedInvoice.paidAmount);
  const balanceAmount = Number(updatedInvoice.balanceAmount);
  console.log(`   Invoice state: paidAmount = ${paidAmount}, balanceAmount = ${balanceAmount}`);

  // Teardown
  await prisma.invoice.delete({ where: { id: invoice.id } });
  await prisma.$disconnect();

  if (paymentsCount === 0 && paidAmount === 0 && balanceAmount === 5000) {
    console.log("\n[VERIFIED] PostgreSQL cleanly rolled back uncommitted transaction on process kill -9.");
    console.log("Zero half-saved records created.");
    process.exit(0);
  } else {
    console.error("\n[FAILED] Data integrity compromised: partial transaction persisted!");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
