import { Prisma } from "@prisma/client";
import { env } from "@config/env";

/**
 * Generates the next MR number in the format MR-YYYY-NNNNNN.
 * MUST be called from within an active Prisma $transaction to avoid race conditions —
 * the upsert + increment on mr_number_sequences serializes concurrent callers per year.
 */
export async function generateMrNumber(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();

  const seq = await tx.mrNumberSequence.upsert({
    where: { year },
    create: { year, counter: 1 },
    update: { counter: { increment: 1 } },
  });

  const padded = String(seq.counter).padStart(6, "0");
  return `${env.MR_NUMBER_PREFIX}-${year}-${padded}`;
}

/**
 * Generates the next sequential invoice number in the format INV-YYYY-NNNNNN.
 * MUST be called from within an active Prisma $transaction.
 */
export async function generateInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();

  const seq = await tx.invoiceNumberSequence.upsert({
    where: { year },
    create: { year, counter: 1 },
    update: { counter: { increment: 1 } },
  });

  const padded = String(seq.counter).padStart(6, "0");
  return `${env.INVOICE_NUMBER_PREFIX}-${year}-${padded}`;
}

/**
 * Generates the next per-doctor per-day appointment token number.
 * MUST be called from within an active Prisma $transaction.
 */
export async function generateTokenNumber(
  tx: Prisma.TransactionClient,
  doctorId: string,
  date: Date
): Promise<number> {
  const dateOnly = new Date(date.toISOString().slice(0, 10));

  const seq = await tx.appointmentTokenSequence.upsert({
    where: { doctorId_date: { doctorId, date: dateOnly } },
    create: { doctorId, date: dateOnly, counter: 1 },
    update: { counter: { increment: 1 } },
  });

  return seq.counter;
}
