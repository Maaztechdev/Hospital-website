import { Prisma } from "@prisma/client";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { BadRequestError, ConflictError, NotFoundError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { notifyRoles } from "@common/utils/notify";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { PageParams } from "@common/utils/pagination";
import { generateInvoiceNumber } from "@common/utils/sequenceGenerators";

const NEAR_EXPIRY_DAYS = 60;

async function deductStockFefo(
  tx: Prisma.TransactionClient,
  medicineId: string,
  quantity: number,
  referenceType: string,
  referenceId: string,
  createdBy: string
) {
  const batches = await tx.medicineBatch.findMany({
    where: { medicineId, isActive: true, expiryDate: { gt: new Date() }, stockQuantity: { gt: 0 } },
    orderBy: { expiryDate: "asc" },
  });
  let remaining = quantity;
  const movements: { batchId: string; qty: number }[] = [];

  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.stockQuantity, remaining);
    await tx.medicineBatch.update({ where: { id: batch.id }, data: { stockQuantity: { decrement: take } } });
    await tx.stockMovement.create({ data: { batchId: batch.id, movementType: "OUT", quantity: take, referenceType, referenceId, createdBy } });
    movements.push({ batchId: batch.id, qty: take });
    remaining -= take;
  }
  if (remaining > 0) throw new ConflictError(`Insufficient non-expired stock for medicine — short by ${remaining} unit(s). No stock was deducted.`);
  return movements;
}

export const pharmacyService = {
  async listMedicines(params: PageParams & { search?: string; lowStock?: string; nearExpiry?: string }) {
    const where: Prisma.MedicineWhereInput = {
      isActive: true,
      ...(params.search ? { name: { contains: params.search, mode: "insensitive" } } : {}),
    };

    const medicines = await prisma.medicine.findMany({
      where,
      skip: params.skip,
      take: params.limit,
      include: { batches: { where: { isActive: true }, orderBy: { expiryDate: "asc" } } },
      orderBy: { name: "asc" },
    });
    const total = await prisma.medicine.count({ where });

    let items = medicines;
    if (params.lowStock === "true") {
      items = items.filter((m) => m.batches.some((b) => b.stockQuantity <= b.reorderLevel));
    }
    if (params.nearExpiry === "true") {
      const threshold = new Date();
      threshold.setDate(threshold.getDate() + NEAR_EXPIRY_DAYS);
      items = items.filter((m) => m.batches.some((b) => b.expiryDate <= threshold));
    }

    return { items, total };
  },

  async createMedicine(actor: AccessTokenPayload, input: { name: string; genericName?: string; strength?: string; form?: string; categoryId?: string }, req?: Request) {
    const medicine = await prisma.medicine.create({ data: input });
    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "pharmacy", entityType: "Medicine", entityId: medicine.id, newValues: medicine, req });
    return medicine;
  },

  async addBatch(
    actor: AccessTokenPayload,
    input: { medicineId: string; batchNumber: string; expiryDate: string; purchasePrice: number; sellingPrice: number; stockQuantity: number; reorderLevel?: number; supplierId?: string },
    req?: Request
  ) {
    const medicine = await prisma.medicine.findUnique({ where: { id: input.medicineId } });
    if (!medicine) throw new NotFoundError("Medicine not found");

    const batch = await prisma.$transaction(async (tx) => {
      const created = await tx.medicineBatch.create({
        data: {
          medicineId: input.medicineId,
          batchNumber: input.batchNumber,
          expiryDate: new Date(input.expiryDate),
          purchasePrice: input.purchasePrice,
          sellingPrice: input.sellingPrice,
          stockQuantity: input.stockQuantity,
          reorderLevel: input.reorderLevel ?? 10,
          supplierId: input.supplierId,
        },
      });
      await tx.stockMovement.create({
        data: { batchId: created.id, movementType: "IN", quantity: input.stockQuantity, referenceType: "batch_created", createdBy: actor.sub },
      });
      return created;
    });

    await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "pharmacy", entityType: "MedicineBatch", entityId: batch.id, newValues: batch, req });
    return batch;
  },

  async stockIn(actor: AccessTokenPayload, input: { batchId: string; quantity: number; reason?: string }, req?: Request) {
    const batch = await prisma.medicineBatch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new NotFoundError("Batch not found");

    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.medicineBatch.update({
        where: { id: input.batchId },
        data: { stockQuantity: { increment: input.quantity } },
      });
      await tx.stockMovement.create({
        data: { batchId: input.batchId, movementType: "IN", quantity: input.quantity, reason: input.reason, createdBy: actor.sub },
      });
      return b;
    });

    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "pharmacy", entityType: "MedicineBatch", entityId: input.batchId, newValues: { stockIn: input.quantity }, req });
    await this.checkLowStockAlert(updated.id);
    return updated;
  },

  /**
   * Dispense against a SIGNED prescription item using FEFO (first-expiry-first-out)
   * batch selection. Refuses to dispense from expired batches. Runs in a transaction
   * so the stock decrement and stock-movement write succeed or fail together.
   */
  async dispense(actor: AccessTokenPayload, input: { prescriptionItemId: string; quantity: number }, req?: Request) {
    const item = await prisma.prescriptionItem.findUnique({
      where: { id: input.prescriptionItemId },
      include: { prescription: true },
    });
    if (!item) throw new NotFoundError("Prescription item not found");
    if (item.prescription.status !== "SIGNED") {
      throw new ConflictError("Cannot dispense — prescription is not SIGNED");
    }
    if (!item.medicineId) {
      throw new BadRequestError("This prescription item is not linked to a catalog medicine and cannot be auto-dispensed");
    }

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const movements = await deductStockFefo(tx, item.medicineId as string, input.quantity, "prescription_dispense", item.id, actor.sub);

      const updatedItem = await tx.prescriptionItem.update({
        where: { id: item.id },
        data: { quantityDispensed: { increment: input.quantity } },
      });

      await writeAuditLog(
        { userId: actor.sub, action: "DISPENSE", module: "pharmacy", entityType: "PrescriptionItem", entityId: item.id, newValues: { quantity: input.quantity, movements }, req },
        tx
      );

      return { updatedItem, movements };
    });

    // Low stock check happens outside the tx (side-effect notification, not critical to atomicity)
    for (const m of result.movements) {
      await this.checkLowStockAlert(m.batchId);
    }

    return result.updatedItem;
  },

  async createSale(
    actor: AccessTokenPayload,
    input: { items: { medicineId: string; quantity: number; unitPrice?: number; discount: number }[]; tax: number; paymentMethod: "CASH" | "CARD" | "BANK_TRANSFER" | "MOBILE_WALLET"; customerName?: string; customerPhone?: string },
    req?: Request
  ) {
    const idempotencyKey = req?.get("Idempotency-Key");
    if (idempotencyKey) {
      const previous = await prisma.pharmacySale.findUnique({ where: { idempotencyKey }, include: { invoice: { include: { items: true, payments: true } }, items: { include: { medicine: true, batch: true } } } });
      if (previous) return previous;
    }

    const sale = await prisma.$transaction(async (tx) => {
      const grouped = new Map<string, { medicineId: string; quantity: number; unitPrice?: number; discount: number }>();
      for (const item of input.items) {
        const existing = grouped.get(item.medicineId);
        if (existing) { existing.quantity += item.quantity; existing.discount += item.discount; }
        else grouped.set(item.medicineId, { ...item });
      }
      const saleId = crypto.randomUUID();
      const allocated: { medicineId: string; batchId: string; quantity: number; unitPrice: number; discount: number; subtotal: number }[] = [];
      for (const item of grouped.values()) {
        const medicine = await tx.medicine.findUnique({ where: { id: item.medicineId }, include: { batches: { where: { isActive: true }, orderBy: { expiryDate: "asc" } } } });
        if (!medicine || !medicine.isActive) throw new NotFoundError("Medicine not found");
        const unitPrice = item.unitPrice ?? Number(medicine.batches.find((batch) => batch.stockQuantity > 0 && batch.expiryDate > new Date())?.sellingPrice ?? 0);
        const movements = await deductStockFefo(tx, item.medicineId, item.quantity, "pharmacy_sale", saleId, actor.sub);
        for (const movement of movements) {
          const discount = movements.length === 1 ? item.discount : item.discount * (movement.qty / item.quantity);
          allocated.push({ medicineId: item.medicineId, batchId: movement.batchId, quantity: movement.qty, unitPrice, discount, subtotal: Math.round((movement.qty * unitPrice - discount) * 100) / 100 });
        }
      }
      const subtotal = Math.round(allocated.reduce((sum, item) => sum + item.subtotal, 0) * 100) / 100;
      const discountAmount = Math.round(allocated.reduce((sum, item) => sum + item.discount, 0) * 100) / 100;
      const totalAmount = Math.round((subtotal + input.tax) * 100) / 100;
      const invoiceNumber = await generateInvoiceNumber(tx);
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber, patientId: null, createdBy: actor.sub, status: "PAID", subtotal, discountAmount, taxAmount: input.tax, grandTotal: totalAmount, paidAmount: totalAmount, balanceAmount: 0,
          items: { create: allocated.map((item) => ({ itemType: "MEDICINE", description: `${item.medicineId} / batch ${item.batchId}`, quantity: item.quantity, unitPrice: item.unitPrice, discount: item.discount, subtotal: item.subtotal })) },
        }, include: { items: true },
      });
      const created = await tx.pharmacySale.create({
        data: { id: saleId, invoiceId: invoice.id, cashierId: actor.sub, customerName: input.customerName, customerPhone: input.customerPhone, paymentMethod: input.paymentMethod, subtotal, discountAmount, taxAmount: input.tax, totalAmount, idempotencyKey, items: { create: allocated } },
        include: { invoice: { include: { items: true } }, items: { include: { medicine: true, batch: true } } },
      });
      await tx.payment.create({ data: { invoiceId: invoice.id, paymentMethod: input.paymentMethod, amount: totalAmount, createdBy: actor.sub, notes: "Pharmacy sale" } });
      await writeAuditLog({ userId: actor.sub, action: "CREATE", module: "pharmacy", entityType: "PharmacySale", entityId: created.id, newValues: created, req }, tx);
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return sale;
  },

  async getSaleInvoice(_actor: AccessTokenPayload, id: string) {
    const sale = await prisma.pharmacySale.findUnique({ where: { id }, include: { invoice: { include: { items: true, payments: true } }, items: { include: { medicine: true, batch: true } } } });
    if (!sale) throw new NotFoundError("Pharmacy sale not found");
    return sale.invoice;
  },

  async returnStock(actor: AccessTokenPayload, input: { batchId: string; quantity: number; reason: string }, req?: Request) {
    const batch = await prisma.medicineBatch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new NotFoundError("Batch not found");

    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.medicineBatch.update({ where: { id: input.batchId }, data: { stockQuantity: { increment: input.quantity } } });
      await tx.stockMovement.create({
        data: { batchId: input.batchId, movementType: "RETURN", quantity: input.quantity, reason: input.reason, createdBy: actor.sub },
      });
      return b;
    });

    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "pharmacy", entityType: "MedicineBatch", entityId: input.batchId, newValues: { returned: input.quantity, reason: input.reason }, req });
    return updated;
  },

  async adjust(actor: AccessTokenPayload, input: { batchId: string; quantity: number; reason: string }, req?: Request) {
    const batch = await prisma.medicineBatch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new NotFoundError("Batch not found");
    if (batch.stockQuantity + input.quantity < 0) throw new BadRequestError("Adjustment would result in negative stock");

    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.medicineBatch.update({ where: { id: input.batchId }, data: { stockQuantity: { increment: input.quantity } } });
      await tx.stockMovement.create({
        data: { batchId: input.batchId, movementType: "ADJUSTMENT", quantity: input.quantity, reason: input.reason, createdBy: actor.sub },
      });
      return b;
    });

    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "pharmacy", entityType: "MedicineBatch", entityId: input.batchId, newValues: { adjustment: input.quantity, reason: input.reason }, req });
    return updated;
  },

  async markDamagedOrExpired(actor: AccessTokenPayload, input: { batchId: string; quantity: number; type: "DAMAGED" | "EXPIRED"; reason: string }, req?: Request) {
    const batch = await prisma.medicineBatch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new NotFoundError("Batch not found");
    if (batch.stockQuantity < input.quantity) throw new BadRequestError("Quantity exceeds current stock");

    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.medicineBatch.update({ where: { id: input.batchId }, data: { stockQuantity: { decrement: input.quantity } } });
      await tx.stockMovement.create({
        data: { batchId: input.batchId, movementType: input.type, quantity: input.quantity, reason: input.reason, createdBy: actor.sub },
      });
      return b;
    });

    await writeAuditLog({ userId: actor.sub, action: "UPDATE", module: "pharmacy", entityType: "MedicineBatch", entityId: input.batchId, newValues: { [input.type.toLowerCase()]: input.quantity, reason: input.reason }, req });
    return updated;
  },

  async checkLowStockAlert(batchId: string) {
    const batch = await prisma.medicineBatch.findUnique({ where: { id: batchId }, include: { medicine: true } });
    if (!batch) return;
    if (batch.stockQuantity <= batch.reorderLevel) {
      await notifyRoles(["PHARMACIST", "ADMIN"], {
        notificationType: "LOW_STOCK_MEDICINE",
        title: "Low stock alert",
        message: `${batch.medicine.name} (batch ${batch.batchNumber}) is at or below reorder level (${batch.stockQuantity}/${batch.reorderLevel})`,
        relatedEntityType: "MedicineBatch",
        relatedEntityId: batch.id,
      });
    }
  },

  async listStockMovements(params: PageParams & { batchId?: string; medicineId?: string }) {
    const where: Prisma.StockMovementWhereInput = {
      ...(params.batchId ? { batchId: params.batchId } : {}),
      ...(params.medicineId ? { batch: { medicineId: params.medicineId } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.stockMovement.findMany({ where, skip: params.skip, take: params.limit, orderBy: { createdAt: "desc" }, include: { batch: { include: { medicine: true } } } }),
      prisma.stockMovement.count({ where }),
    ]);
    return { items, total };
  },
};
