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
 * Generates the next laboratory order number in the format LAB-YYYY-NNNNNN.
 * MUST be called from within an active Prisma $transaction.
 */
export async function generateLabOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  const seq = await tx.labOrderNumberSequence.upsert({
    where: { year },
    create: { year, counter: 1 },
    update: { counter: { increment: 1 } },
  });
  return `LAB-${year}-${String(seq.counter).padStart(6, "0")}`;
}

/**
 * Allocates the next token number for one doctor/date without reordering existing appointments.
 * It preserves historical values and only advances the per-doctor/day counter in a DB transaction.
 */
export async function generateNextAppointmentToken(
  tx: Prisma.TransactionClient,
  doctorId: string,
  date: string
): Promise<number> {
  const [next] = await tx.$queryRaw<Array<{ counter: number }>>`
    INSERT INTO appointment_token_sequences (doctor_id, date, counter)
    VALUES (
      ${doctorId},
      ${date}::date,
      COALESCE((
        SELECT MAX(token_number)
        FROM appointments
        WHERE doctor_id = ${doctorId} AND appointment_date = ${date}::date
      ), 0) + 1
    )
    ON CONFLICT (doctor_id, date) DO UPDATE
    SET counter = GREATEST(
      appointment_token_sequences.counter,
      COALESCE((
        SELECT MAX(token_number)
        FROM appointments
        WHERE doctor_id = ${doctorId} AND appointment_date = ${date}::date
      ), 0)
    ) + 1
    RETURNING counter
  `;

  return next.counter;
}

export async function findDuplicateAppointmentTokens(
  tx: Prisma.TransactionClient | { $queryRaw: <T>(query: TemplateStringsArray | string, ...values: unknown[]) => Promise<T> }
) {
  return tx.$queryRaw<Array<{ doctorId: string; appointmentDate: string; tokenNumber: number; duplicateCount: number }>>`
    SELECT
      doctor_id AS "doctorId",
      appointment_date::text AS "appointmentDate",
      token_number AS "tokenNumber",
      COUNT(*)::int AS "duplicateCount"
    FROM appointments
    WHERE token_number > 0
    GROUP BY doctor_id, appointment_date, token_number
    HAVING COUNT(*) > 1
    ORDER BY appointment_date, doctor_id, token_number;
  `;
}
