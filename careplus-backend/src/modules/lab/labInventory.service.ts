import { Prisma } from "@prisma/client";
import { prisma } from "@config/prisma";
import { BadRequestError, ConflictError, NotFoundError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import type { Request } from "express";
import type { AccessTokenPayload } from "@common/middleware/authenticate";

type Actor = AccessTokenPayload;
type Db = Prisma.TransactionClient | typeof prisma;

function todayUtc() {
  return new Date(new Date().toISOString().slice(0, 10));
}

export const labInventoryService = {
  async overview(input: { search?: string; sort?: string } = {}) {
    const search = input.search?.trim();
    const items = await prisma.labInventoryItem.findMany({
      where: {
        isActive: true,
        ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
      },
      include: {
        supplier: { select: { id: true, name: true } },
        batches: { orderBy: [{ expiryDate: "asc" }, { id: "asc" }] },
        mappings: { include: { test: { select: { id: true, testName: true, testCode: true } } } },
      },
      orderBy: { name: "asc" },
    });
    const now = todayUtc();
    const inThirtyDays = new Date(now);
    inThirtyDays.setUTCDate(inThirtyDays.getUTCDate() + 30);
    const data = items.map((item) => {
      const quantity = item.batches.reduce((sum, batch) =>
        batch.expiryDate >= now ? sum + Number(batch.quantity) : sum, 0,
      );
      return {
        ...item,
        reorderLevel: Number(item.reorderLevel),
        totalQuantity: quantity,
        lowStock: quantity <= Number(item.reorderLevel),
        batches: item.batches.map((batch) => ({ ...batch, quantity: Number(batch.quantity), purchasePrice: Number(batch.purchasePrice) })),
      };
    });
    if (input.sort === "low_stock") data.sort((a, b) => Number(b.lowStock) - Number(a.lowStock) || a.name.localeCompare(b.name));
    if (input.sort === "expiry") data.sort((a, b) =>
      (a.batches.find((batch) => batch.quantity > 0)?.expiryDate.getTime() ?? Number.MAX_SAFE_INTEGER)
      - (b.batches.find((batch) => batch.quantity > 0)?.expiryDate.getTime() ?? Number.MAX_SAFE_INTEGER));
    const [allBatches, allItems] = await Promise.all([
      prisma.labInventoryBatch.findMany({ where: { quantity: { gt: 0 } }, select: { expiryDate: true } }),
      prisma.labInventoryItem.findMany({
        where: { isActive: true },
        select: { reorderLevel: true, batches: { select: { quantity: true, expiryDate: true } } },
      }),
    ]);
    return {
      items: data,
      suppliers: await prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      counts: {
        lowStock: allItems.filter((item) =>
          item.batches.reduce((sum, batch) =>
            batch.expiryDate >= now ? sum + Number(batch.quantity) : sum, 0,
          ) <= Number(item.reorderLevel),
        ).length,
        expiringWithin30Days: allBatches.filter((batch) => batch.expiryDate >= now && batch.expiryDate <= inThirtyDays).length,
        expiredBatches: allBatches.filter((batch) => batch.expiryDate < now).length,
      },
    };
  },

  async createItem(actor: Actor, input: { name: string; category: string; unit: string; reorderLevel: number; supplierId?: string | null }, req?: Request) {
    const item = await prisma.labInventoryItem.create({ data: input });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "lab_inventory", entityType: "LabInventoryItem", entityId: item.id, newValues: item, req });
    return item;
  },

  async updateItem(actor: Actor, id: string, input: { name: string; category: string; unit: string; reorderLevel: number; supplierId?: string | null }, req?: Request) {
    const exists = await prisma.labInventoryItem.findUnique({ where: { id } });
    if (!exists) throw new NotFoundError("Lab inventory item not found");
    const item = await prisma.labInventoryItem.update({ where: { id }, data: input });
    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "lab_inventory", entityType: "LabInventoryItem", entityId: item.id, oldValues: exists, newValues: item, req });
    return item;
  },

  async addBatch(actor: Actor, input: { itemId: string; batchNumber: string; expiryDate: string; quantity: number; purchasePrice: number; supplierId?: string | null }, req?: Request) {
    if (new Date(input.expiryDate) < todayUtc()) throw new BadRequestError("Expired stock cannot be received into Lab inventory.");
    return prisma.$transaction(async (tx) => {
      const batch = await tx.labInventoryBatch.upsert({
        where: { itemId_batchNumber: { itemId: input.itemId, batchNumber: input.batchNumber } },
        create: { ...input, expiryDate: new Date(input.expiryDate) },
        update: {
          quantity: { increment: input.quantity },
          purchasePrice: input.purchasePrice,
          supplierId: input.supplierId,
          expiryDate: new Date(input.expiryDate),
        },
      });
      await tx.labInventoryMovement.create({
        data: { batchId: batch.id, movementType: "IN", quantity: input.quantity, referenceType: "RECEIPT", reason: "Stock received", createdBy: actor.sub },
      });
      await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "lab_inventory", entityType: "LabInventoryBatch", entityId: batch.id, newValues: batch, req }, tx);
      return batch;
    });
  },

  async saveMapping(actor: Actor, input: { testId: string; itemId: string; quantityPerTestRun: number }, req?: Request) {
    const mapping = await prisma.labTestInventoryMapping.upsert({
      where: { testId_itemId: { testId: input.testId, itemId: input.itemId } },
      create: input,
      update: { quantityPerTestRun: input.quantityPerTestRun },
    });
    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "lab_inventory", entityType: "LabTestInventoryMapping", entityId: mapping.id, newValues: mapping, req });
    return mapping;
  },

  async removeMapping(actor: Actor, id: string, req?: Request) {
    const mapping = await prisma.labTestInventoryMapping.findUnique({ where: { id } });
    if (!mapping) throw new NotFoundError("Lab test inventory mapping not found");
    await prisma.labTestInventoryMapping.delete({ where: { id } });
    await writeAuditLog({ userId: actor.sub, action: "DELETE", module: "lab_inventory", entityType: "LabTestInventoryMapping", entityId: id, oldValues: mapping, req });
    return mapping;
  },

  async adjust(actor: Actor, input: { batchId: string; quantity: number; reason: string }, req?: Request) {
    return prisma.$transaction(async (tx) => {
      const batch = await tx.labInventoryBatch.findUnique({ where: { id: input.batchId } });
      if (!batch) throw new NotFoundError("Lab inventory batch not found");
      const next = Number(batch.quantity) + input.quantity;
      if (next < 0) throw new ConflictError("Adjustment cannot reduce stock below zero.");
      const updated = await tx.labInventoryBatch.update({ where: { id: batch.id }, data: { quantity: next } });
      await tx.labInventoryMovement.create({
        data: { batchId: batch.id, movementType: "ADJUSTMENT", quantity: input.quantity, reason: input.reason, createdBy: actor.sub },
      });
      await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "lab_inventory", entityType: "LabInventoryBatch", entityId: batch.id, oldValues: batch, newValues: updated, req }, tx);
      return updated;
    });
  },

  async listMovements(limit = 200) {
    return prisma.labInventoryMovement.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      include: { batch: { include: { item: { select: { name: true, unit: true } } } }, creator: { select: { id: true, name: true } } },
    });
  },
};

export async function consumeLabInventory(
  tx: Db,
  input: { orderId: string; testId: string; resultId: string; actorId: string; overrideReason?: string },
) {
  const existing = await tx.labInventoryConsumption.findUnique({ where: { labOrderId: input.orderId } });
  if (existing) return existing;
  const mappings = await tx.labTestInventoryMapping.findMany({
    where: { testId: input.testId },
    include: { item: { select: { name: true, unit: true } } },
  });
  if (!mappings.length) return null;
  const now = todayUtc();
  const problems: Array<{ item: string; needed: number; available: number; expired: number }> = [];
  const plans = [];
  for (const mapping of mappings) {
    const batches = await tx.labInventoryBatch.findMany({
      where: { itemId: mapping.itemId, quantity: { gt: 0 } },
      orderBy: [{ expiryDate: "asc" }, { id: "asc" }],
    });
    const available = batches.filter((batch) => batch.expiryDate >= now).reduce((sum, batch) => sum + Number(batch.quantity), 0);
    const expired = batches.filter((batch) => batch.expiryDate < now).reduce((sum, batch) => sum + Number(batch.quantity), 0);
    const needed = Number(mapping.quantityPerTestRun);
    if (available < needed) problems.push({ item: mapping.item.name, needed, available, expired });
    plans.push({ mapping, batches, needed, available });
  }
  if (problems.length && !input.overrideReason?.trim()) {
    throw new ConflictError("Lab inventory needs attention. Provide an override reason to use expired stock or proceed with a shortage.", problems);
  }
  const details: Array<{ itemId: string; itemName: string; unit: string; needed: number; deducted: number; shortage: number; batches: Array<{ batchId: string; batchNumber: string; quantity: number; expired: boolean }> }> = [];
  for (const plan of plans) {
    let remaining = plan.needed;
    const deductions = [];
    const eligibleBatches = [
      ...plan.batches.filter((batch) => batch.expiryDate >= now),
      ...(input.overrideReason?.trim() ? plan.batches.filter((batch) => batch.expiryDate < now) : []),
    ];
    for (const batch of eligibleBatches) {
      if (remaining <= 0) break;
      const quantity = Math.min(remaining, Number(batch.quantity));
      if (quantity <= 0) continue;
      const changed = await tx.labInventoryBatch.updateMany({
        where: { id: batch.id, quantity: { gte: quantity } },
        data: { quantity: { decrement: quantity } },
      });
      if (!changed.count) throw new ConflictError("Lab stock changed while the result was being saved. Review inventory and retry.");
      remaining -= quantity;
      deductions.push({ batchId: batch.id, batchNumber: batch.batchNumber, quantity, expired: batch.expiryDate < now });
      await tx.labInventoryMovement.create({
        data: {
          batchId: batch.id,
          movementType: "OUT",
          quantity,
          referenceType: "LAB_ORDER",
          referenceId: input.orderId,
          reason: input.overrideReason?.trim() || "Consumed for lab test",
          createdBy: input.actorId,
        },
      });
    }
    details.push({
      itemId: plan.mapping.itemId,
      itemName: plan.mapping.item.name,
      unit: plan.mapping.item.unit,
      needed: plan.needed,
      deducted: plan.needed - remaining,
      shortage: remaining,
      batches: deductions,
    });
  }
  return tx.labInventoryConsumption.create({
    data: {
      labOrderId: input.orderId,
      resultId: input.resultId,
      overrideReason: input.overrideReason?.trim(),
      details: details as Prisma.InputJsonValue,
      createdBy: input.actorId,
    },
  });
}
