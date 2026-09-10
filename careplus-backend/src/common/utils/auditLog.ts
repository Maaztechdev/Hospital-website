import { AuditAction, Prisma } from "@prisma/client";
import { Request } from "express";
import { prisma } from "@config/prisma";

interface AuditEntryInput {
  userId?: string | null;
  action: AuditAction;
  module: string;
  entityType: string;
  entityId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  req?: Request;
}

const REDACTED_AUDIT_KEYS = new Set([
  "password",
  "passwordHash",
  "refreshToken",
  "accessToken",
  "resetToken",
  "clinicalNotes",
  "technicianNotes",
  "notes",
  "diagnosis",
  "treatmentPlan",
  "fileUrl",
]);

function sanitizeAuditValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) return Prisma.JsonNull;
  if (Array.isArray(value)) return value.map((item) => sanitizeAuditValue(item)) as Prisma.InputJsonValue;
  if (typeof value !== "object") return value as Prisma.InputJsonValue;

  if (value instanceof Date) return value.toISOString();
  const toJSON = (value as { toJSON?: () => unknown }).toJSON;
  if (typeof toJSON === "function") return sanitizeAuditValue(toJSON.call(value));

  const sanitized: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (!REDACTED_AUDIT_KEYS.has(key)) sanitized[key] = sanitizeAuditValue(nestedValue) as Prisma.InputJsonValue;
  }
  return sanitized;
}

/**
 * Writes an audit log entry. Accepts an optional Prisma transaction client so
 * the audit write participates in the same transaction as the mutating action
 * it describes (audit + data change succeed or fail together).
 */
export async function writeAuditLog(
  input: AuditEntryInput,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: input.userId ?? null,
      action: input.action,
      module: input.module,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      oldValuesJson: sanitizeAuditValue(input.oldValues),
      newValuesJson: sanitizeAuditValue(input.newValues),
      ipAddress: input.req?.ip ?? null,
      userAgent: input.req?.headers["user-agent"] ?? null,
    },
  });
}
