import crypto from "crypto";
import { Role } from "@prisma/client";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";
import { BadRequestError } from "@common/errors/AppError";
import {
  addIpdChargeInTransaction,
  createWardMedicineOrder,
  ensureBedRentLines,
  ipdBillingService,
  issueWardMedicineOrder,
  listWardMedicineOrders,
  recordIpdRefund,
  returnWardMedicine,
} from "@modules/ipd/ipdBilling.service";
import { wardsService } from "@modules/wards/wards.service";
import { ultrasoundService } from "@modules/ultrasound/ultrasound.service";

describe("Integration: IPD billing", () => {
  let patientId = "";
  let doctorId = "";
  let wardId = "";
  let roomId = "";
  let firstBedId = "";
  let secondBedId = "";
  let admissionId = "";
  let invoiceId = "";
  let serviceChargeId = "";
  let medicineId = "";
  let batchId = "";
  const actor = { sub: "", role: "ADMIN" as Role, email: "admin@careplus.local" };

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || new URL(databaseUrl).pathname.split("/").filter(Boolean).pop()?.split("?")[0] !== "careplus_test") {
      throw new Error("IPD billing integration tests require the careplus_test database.");
    }
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@careplus.local" } });
    const patient = await prisma.patient.findFirstOrThrow({
      where: { deletedAt: null, admissions: { none: { status: "ACTIVE" } } },
    });
    const doctor = await prisma.doctor.findFirstOrThrow({ select: { id: true } });
    const suffix = crypto.randomUUID();
    const ward = await prisma.ward.create({
      data: { wardName: `IPD billing test ${suffix}`, wardType: "GENERAL", dailyRate: 100, capacity: 2 },
    });
    const room = await prisma.room.create({ data: { wardId: ward.id, roomNumber: `IPD-${suffix.slice(0, 8)}` } });
    const firstBed = await prisma.bed.create({
      data: { roomId: room.id, bedNumber: "A", dailyRate: 100, status: "AVAILABLE" },
    });
    const secondBed = await prisma.bed.create({
      data: { roomId: room.id, bedNumber: "B", dailyRate: 200, status: "AVAILABLE" },
    });
    patientId = patient.id;
    doctorId = doctor.id;
    wardId = ward.id;
    roomId = room.id;
    firstBedId = firstBed.id;
    secondBedId = secondBed.id;
    actor.sub = admin.id;
    actor.email = admin.email;
  });

  afterAll(async () => {
    if (admissionId) {
      const ultrasoundOrders = await prisma.ultrasoundOrder.findMany({ where: { admissionId }, select: { id: true } });
      const invoice = await prisma.invoice.findUnique({ where: { admissionId }, select: { id: true } });
      const invoiceItemIds = invoice
        ? (await prisma.invoiceItem.findMany({ where: { invoiceId: invoice.id }, select: { id: true } })).map((item) => item.id)
        : [];
      const paymentIds = invoice
        ? (await prisma.payment.findMany({ where: { invoiceId: invoice.id }, select: { id: true } })).map((payment) => payment.id)
        : [];
      const wardOrders = await prisma.wardMedicineOrder.findMany({ where: { admissionId }, include: { items: { select: { id: true } } } });
      const wardOrderIds = wardOrders.map((order) => order.id);
      const wardOrderItemIds = wardOrders.flatMap((order) => order.items.map((item) => item.id));
      await prisma.auditLog.deleteMany({
        where: {
          entityId: {
            in: [
              admissionId,
              ...(invoice ? [invoice.id] : []),
              ...invoiceItemIds,
              ...paymentIds,
              ...wardOrderIds,
              ...ultrasoundOrders.map((order) => order.id),
              ...(serviceChargeId ? [serviceChargeId] : []),
            ],
          },
        },
      });
      await prisma.ultrasoundOrder.deleteMany({ where: { id: { in: ultrasoundOrders.map((order) => order.id) } } });
      await prisma.patientLedgerEntry.deleteMany({ where: { admissionId } });
      await prisma.stockMovement.deleteMany({ where: { referenceId: { in: wardOrderItemIds } } });
      await prisma.wardMedicineOrderItem.deleteMany({ where: { orderId: { in: wardOrderIds } } });
      await prisma.wardMedicineOrder.deleteMany({ where: { id: { in: wardOrderIds } } });
      if (invoice) {
        await prisma.payment.deleteMany({ where: { invoiceId: invoice.id } });
        await prisma.invoiceItem.deleteMany({ where: { invoiceId: invoice.id } });
        await prisma.invoice.delete({ where: { id: invoice.id } });
      }
      await prisma.bedTransfer.deleteMany({ where: { admissionId } });
      await prisma.admission.delete({ where: { id: admissionId } });
    }
    if (serviceChargeId) await prisma.serviceCharge.deleteMany({ where: { id: serviceChargeId } });
    if (medicineId) {
      await prisma.medicineBatch.deleteMany({ where: { medicineId } });
      await prisma.medicine.deleteMany({ where: { id: medicineId } });
    }
    const testBedIds = [firstBedId, secondBedId].filter(Boolean);
    if (testBedIds.length) {
      await prisma.bedRateHistory.deleteMany({ where: { bedId: { in: testBedIds } } });
      await prisma.bed.deleteMany({ where: { id: { in: testBedIds } } });
    }
    if (roomId) await prisma.room.deleteMany({ where: { id: roomId } });
    if (wardId) await prisma.ward.deleteMany({ where: { id: wardId } });
    redis.disconnect();
  });

  it("creates one invoice and accrues bed rent idempotently using the transferred bed rate", async () => {
    const admission = await wardsService.admit(actor, {
      patientId,
      bedId: firstBedId,
      attendingDoctorId: doctorId,
      admissionType: "PLANNED",
      admissionReason: "IPD billing test",
      dailyRate: 100,
      depositAmount: 0,
      bedRentCutoffTime: "12:00",
    });
    admissionId = admission.id;

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { admissionId } });
    invoiceId = invoice.id;
    expect(invoice.department).toBe("IPD");
    expect(await prisma.invoice.count({ where: { admissionId } })).toBe(1);
    expect(await prisma.invoiceItem.count({ where: { invoiceId, serviceCategory: "BED" } })).toBe(1);

    await wardsService.transferBed(actor, admissionId, secondBedId, "Rate snapshot test");
    const upTo = new Date(admission.admissionDate.getTime() + 72 * 60 * 60 * 1000);
    const firstRun = await ensureBedRentLines(admissionId, upTo);
    const secondRun = await ensureBedRentLines(admissionId, upTo);
    expect(firstRun.added).toBeGreaterThan(0);
    expect(secondRun.added).toBe(0);
    expect(await prisma.invoice.count({ where: { admissionId } })).toBe(1);
    const lines = await prisma.invoiceItem.findMany({ where: { admissionId, serviceCategory: "BED" } });
    expect(lines.some((line) => line.bedId === secondBedId && Number(line.unitPrice) === 200)).toBe(true);
  });

  it("runs the daily rent job once under its distributed lock", async () => {
    const setLock = jest.spyOn(redis, "set")
      .mockResolvedValueOnce("OK")
      .mockResolvedValueOnce(null);
    try {
      const [firstRun, secondRun] = await Promise.all([
        ipdBillingService.runDailyBedRentJob(),
        ipdBillingService.runDailyBedRentJob(),
      ]);
      const linesAfterFirstRun = await prisma.invoiceItem.count({ where: { admissionId, serviceCategory: "BED" } });
      const linesAfterConcurrentRuns = await prisma.invoiceItem.count({ where: { admissionId, serviceCategory: "BED" } });
      expect(firstRun).toMatchObject({ acquired: true });
      expect(firstRun.processed).toBeGreaterThan(0);
      expect(secondRun).toEqual({ acquired: false, processed: 0 });
      expect(linesAfterConcurrentRuns).toBe(linesAfterFirstRun);
    } finally {
      setLock.mockRestore();
    }
  });

  it("serializes concurrent payments, rejects an over-refund, and links deposits to payment rows", async () => {
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const paymentAmount = Math.ceil((Number(invoice.balanceAmount) / 2 + 0.01) * 100) / 100;
    const results = await Promise.allSettled([
      ipdBillingService.recordPayment(actor, admissionId, { amount: paymentAmount, paymentMethod: "CASH", purpose: "PAYMENT" }),
      ipdBillingService.recordPayment(actor, admissionId, { amount: paymentAmount, paymentMethod: "CASH", purpose: "PAYMENT" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    await expect(recordIpdRefund(actor, admissionId, {
      amount: paymentAmount + 0.01,
      paymentMethod: "CASH",
      reason: "Over-limit regression test",
    })).rejects.toBeInstanceOf(BadRequestError);

    const refund = await recordIpdRefund(actor, admissionId, {
      amount: 30,
      paymentMethod: "CASH",
      reason: "Partial refund regression test",
    });
    expect(refund.type).toBe("REFUND");
    await wardsService.recordAdmissionDeposit(actor, admissionId, { amount: 10, paymentMethod: "CASH" });
    const deposit = await prisma.payment.findFirstOrThrow({ where: { invoiceId, purpose: "DEPOSIT" } });
    const ledgerMirror = await prisma.patientLedgerEntry.findFirstOrThrow({ where: { paymentId: deposit.id } });
    expect(ledgerMirror.invoiceId).toBe(invoiceId);
  });

  it("keeps service-line reversals as a reasoned credit history", async () => {
    const serviceCharge = await ipdBillingService.createServiceCharge(actor, {
      name: `IPD test service ${crypto.randomUUID()}`,
      category: "NURSING",
      defaultPrice: 75,
    });
    serviceChargeId = serviceCharge.id;
    const line = await ipdBillingService.addServiceCharge(actor, admissionId, { serviceChargeId });
    const credit = await ipdBillingService.reverseLine(actor, admissionId, line.id, "Correction regression test");
    const original = await prisma.invoiceItem.findUniqueOrThrow({ where: { id: line.id } });
    expect(credit.subtotal.toNumber()).toBe(-75);
    expect(original.reversedAt).not.toBeNull();
    expect(original.reversalReason).toBe("Correction regression test");
    expect(await prisma.invoiceItem.count({ where: { invoiceId, admissionId } })).toBeGreaterThan(1);
  });

  it("posts ward Lab and Ultrasound charges to the existing IPD invoice only", async () => {
    const labSourceId = crypto.randomUUID();
    await prisma.$transaction((tx) => addIpdChargeInTransaction(tx, {
      admissionId,
      itemType: "LAB",
      description: "IPD Lab charge",
      amount: 80,
      sourceType: "LAB_ORDER",
      sourceId: labSourceId,
      sourceDepartment: "LAB",
      createdBy: actor.sub,
    }));
    expect(await prisma.invoice.count({ where: { admissionId } })).toBe(1);
    expect(await prisma.invoiceItem.count({ where: { invoiceId, sourceId: labSourceId, sourceDepartment: "LAB" } })).toBe(1);

    const doctor = await prisma.doctor.findUniqueOrThrow({ where: { id: doctorId }, include: { user: true } });
    const doctorActor = { sub: doctor.userId, role: "DOCTOR" as Role, email: doctor.user.email };
    const ultrasound = await ultrasoundService.create(doctorActor, {
      patientId,
      examType: "IPD billing test scan",
      feeAmount: 125,
      admissionId,
    });
    expect(ultrasound.admissionId).toBe(admissionId);
    expect(ultrasound.invoiceId).toBe(invoiceId);
    expect(await prisma.invoice.count({ where: { admissionId } })).toBe(1);
    expect(await prisma.invoiceItem.count({ where: { invoiceId, sourceId: ultrasound.id, sourceDepartment: "ULTRASOUND" } })).toBe(1);
  });

  it("issues ward medicine by FEFO and records returned stock and invoice credit", async () => {
    const medicine = await prisma.medicine.create({
      data: { name: `IPD medicine ${crypto.randomUUID()}`, isActive: true },
    });

    medicineId = medicine.id;
    const batch = await prisma.medicineBatch.create({
      data: {
        medicineId: medicine.id,
        batchNumber: `IPD-${crypto.randomUUID().slice(0, 8)}`,
        expiryDate: new Date(Date.now() + 30 * 86400000),
        purchasePrice: 5,
        sellingPrice: 25,
        stockQuantity: 5,
      },
    });
    batchId = batch.id;
    const order = await createWardMedicineOrder(
      { ...actor, role: "NURSE" },
      admissionId,
      { orderNote: "Ward dose", items: [{ medicineId: medicine.id, quantity: 2 }] },
    );
    const issued = await issueWardMedicineOrder({ ...actor, role: "PHARMACIST" }, admissionId, order.id);
    expect(issued.issuedLines).toHaveLength(1);
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batch.id } })).stockQuantity).toBe(3);

    const credit = await returnWardMedicine(
      { ...actor, role: "PHARMACIST" },
      admissionId,
      order.items[0].id,
      { quantity: 2, reason: "Unused ward dose" },
    );
    expect(credit.sourceDepartment).toBe("PHARMACY");
    expect(credit.reversalReason).toBe("Unused ward dose");
    expect(credit.subtotal.toNumber()).toBe(-50);
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batch.id } })).stockQuantity).toBe(5);
  });

  it("lists Pharmacy ward orders with the FEFO batches actually issued", async () => {
    const medicine = await prisma.medicine.create({
      data: { name: `IPD queue medicine ${crypto.randomUUID()}`, isActive: true },
    });
    const batch = await prisma.medicineBatch.create({
      data: {
        medicineId: medicine.id,
        batchNumber: `IPD-Q-${crypto.randomUUID().slice(0, 8)}`,
        expiryDate: new Date("2030-12-31T00:00:00.000Z"),
        purchasePrice: 2,
        sellingPrice: 5,
        stockQuantity: 5,
        reorderLevel: 0,
      },
    });
    const doctor = await prisma.doctor.findUniqueOrThrow({ where: { id: doctorId }, include: { user: true } });
    const doctorActor = { sub: doctor.userId, role: "DOCTOR" as Role, email: doctor.user.email };
    const pharmacistActor = { ...actor, role: "PHARMACIST" as Role };
    const order = await createWardMedicineOrder(doctorActor, admissionId, {
      orderNote: "Queue order",
      items: [{ medicineId: medicine.id, quantity: 2 }],
    });
    const pending = await listWardMedicineOrders(pharmacistActor, admissionId);
    expect(pending).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: order.id,
        issuedAt: null,
        items: [expect.objectContaining({ medicine: expect.objectContaining({ id: medicine.id, name: medicine.name }), issuedQuantity: 0 })],
      }),
    ]));

    await issueWardMedicineOrder(pharmacistActor, admissionId, order.id);
    const issued = await listWardMedicineOrders(pharmacistActor, admissionId);
    const queuedOrder = issued.find((item) => item.id === order.id);
    expect(queuedOrder?.issuedAt).toBeTruthy();
    expect(queuedOrder?.items[0].fefoBatches).toEqual([
      expect.objectContaining({ batchNumber: batch.batchNumber, quantity: 2 }),
    ]);
  });

  it("enforces IPD operation permissions at the service layer", async () => {
    const roles: Role[] = [
      "ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "LAB_TECHNICIAN",
      "PHARMACIST", "ULTRASOUND_TECH", "ULTRASOUND_TECHNICIAN", "PATHOLOGIST", "RADIOLOGIST", "NURSE",
    ];
    const doctor = await prisma.doctor.findUniqueOrThrow({ where: { id: doctorId }, include: { user: true } });
    const doctorActor = { sub: doctor.userId, role: "DOCTOR" as Role, email: doctor.user.email };
    const paymentAllowed = new Set<Role>(["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"]);
    const refundAllowed = new Set<Role>(["ADMIN", "BILLING_MANAGER"]);
    const runningBillAllowed = new Set<Role>(["ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "NURSE"]);
    const invoiceListAllowed = new Set<Role>(["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"]);
    const serviceCatalogAllowed = new Set<Role>(["ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "NURSE"]);
    const serviceLineAllowed = new Set<Role>(["ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "NURSE"]);
    const serviceReverseAllowed = new Set<Role>(["ADMIN", "BILLING_MANAGER"]);
    const orderAllowed = new Set<Role>(["DOCTOR", "NURSE"]);
    const pharmacyAllowed = new Set<Role>(["ADMIN", "PHARMACIST"]);
    const rbacBatch = await prisma.medicineBatch.create({
      data: {
        medicineId,
        batchNumber: `IPD-RBAC-${crypto.randomUUID().slice(0, 8)}`,
        expiryDate: new Date(Date.now() + 30 * 86400000),
        purchasePrice: 5,
        sellingPrice: 25,
        stockQuantity: 100,
      },
    });
    const rbacOrder = await createWardMedicineOrder(
      { ...actor, role: "NURSE" },
      admissionId,
      { orderNote: "RBAC order", items: [{ medicineId, quantity: 20 }] },
    );
    await issueWardMedicineOrder({ ...actor, role: "PHARMACIST" }, admissionId, rbacOrder.id);
    const returnedOrder = await prisma.wardMedicineOrder.findFirstOrThrow({
      where: { id: rbacOrder.id },
      include: { items: true },
    });

    for (const role of roles) {
      const roleActor = role === "DOCTOR" ? doctorActor : { ...actor, role };
      if (runningBillAllowed.has(role)) {
        await expect(ipdBillingService.getRunningBill(roleActor, admissionId)).resolves.toMatchObject({ admissionId });
      } else {
        await expect(ipdBillingService.getRunningBill(roleActor, admissionId)).rejects.toMatchObject({ statusCode: 403 });
      }
      if (invoiceListAllowed.has(role)) {
        await expect(ipdBillingService.listInvoices(roleActor, { skip: 0, limit: 1 })).resolves.toHaveProperty("total");
      } else {
        await expect(ipdBillingService.listInvoices(roleActor, { skip: 0, limit: 1 })).rejects.toMatchObject({ statusCode: 403 });
      }
      if (serviceCatalogAllowed.has(role)) {
        await expect(ipdBillingService.listServiceCharges(roleActor)).resolves.toBeDefined();
      } else {
        await expect(ipdBillingService.listServiceCharges(roleActor)).rejects.toMatchObject({ statusCode: 403 });
      }
      if (serviceLineAllowed.has(role)) {
        const line = await ipdBillingService.addServiceCharge(roleActor, admissionId, { serviceChargeId });
        if (serviceReverseAllowed.has(role)) {
          await expect(ipdBillingService.reverseLine(roleActor, admissionId, line.id, "RBAC matrix reversal")).resolves.toBeDefined();
        }
      } else {
        await expect(ipdBillingService.addServiceCharge(roleActor, admissionId, { serviceChargeId })).rejects.toMatchObject({ statusCode: 403 });
      }
      if (serviceReverseAllowed.has(role)) {
        await expect(ipdBillingService.reverseLine(roleActor, admissionId, crypto.randomUUID(), "RBAC matrix reversal"))
          .rejects.toMatchObject({ statusCode: 404 });
      } else {
        await expect(ipdBillingService.reverseLine(roleActor, admissionId, crypto.randomUUID(), "RBAC matrix reversal"))
          .rejects.toMatchObject({ statusCode: 403 });
      }
      if (paymentAllowed.has(role)) {
        await ipdBillingService.recordPayment(roleActor, admissionId, { amount: 0.01, paymentMethod: "CASH", purpose: "PAYMENT" });
      } else {
        await expect(ipdBillingService.recordPayment(roleActor, admissionId, {
          amount: 0.01,
          paymentMethod: "CASH",
          purpose: "PAYMENT",
        })).rejects.toMatchObject({ statusCode: 403 });
      }
      if (refundAllowed.has(role)) {
        await recordIpdRefund(roleActor, admissionId, { amount: 0.01, paymentMethod: "CASH", reason: "RBAC matrix refund" });
      } else {
        await expect(recordIpdRefund(roleActor, admissionId, {
          amount: 0.01,
          paymentMethod: "CASH",
          reason: "Unauthorized refund regression test",
        })).rejects.toMatchObject({ statusCode: 403 });
      }
      if (paymentAllowed.has(role)) {
        await expect(ipdBillingService.settle(roleActor, admissionId, { paymentMethod: "CASH" }))
          .rejects.toMatchObject({ statusCode: 409 });
      } else {
        await expect(ipdBillingService.settle(roleActor, admissionId, { paymentMethod: "CASH" }))
          .rejects.toMatchObject({ statusCode: 403 });
      }
      if (orderAllowed.has(role)) {
        await expect(createWardMedicineOrder(roleActor, admissionId, {
          orderNote: "RBAC matrix",
          items: [{ medicineId: crypto.randomUUID(), quantity: 1 }],
        })).rejects.not.toMatchObject({ statusCode: 403 });
      } else {
        await expect(createWardMedicineOrder(roleActor, admissionId, {
          orderNote: "RBAC matrix",
          items: [{ medicineId: crypto.randomUUID(), quantity: 1 }],
        })).rejects.toMatchObject({ statusCode: 403 });
      }
      if (pharmacyAllowed.has(role)) {
        await expect(listWardMedicineOrders(roleActor, admissionId)).resolves.toEqual(expect.any(Array));
        await expect(issueWardMedicineOrder(roleActor, admissionId, returnedOrder.id))
          .rejects.toMatchObject({ statusCode: 404 });
        await expect(returnWardMedicine(roleActor, admissionId, returnedOrder.items[0].id, {
          quantity: 1,
          reason: "RBAC matrix",
        })).resolves.toBeDefined();
        await expect(returnWardMedicine(roleActor, admissionId, returnedOrder.items[0].id, {
          quantity: 9999,
          reason: "RBAC matrix",
        })).rejects.toMatchObject({ statusCode: 400 });
      } else {
        await expect(listWardMedicineOrders(roleActor, admissionId))
          .rejects.toMatchObject({ statusCode: 403 });
        await expect(issueWardMedicineOrder(roleActor, admissionId, returnedOrder.id))
          .rejects.toMatchObject({ statusCode: 403 });
        await expect(returnWardMedicine(roleActor, admissionId, returnedOrder.items[0].id, {
          quantity: 1,
          reason: "RBAC matrix",
        })).rejects.toMatchObject({ statusCode: 403 });
      }
    }
  });

  it("finalizes on discharge and refunds an excess deposit only for Admin or Billing Manager", async () => {
    await wardsService.recordAdmissionDeposit(actor, admissionId, { amount: 10000, paymentMethod: "CASH", notes: "Settlement fixture" });
    await wardsService.discharge(actor, admissionId, {
      diagnosis: "IPD billing test",
      courseInHospital: "Stable",
      medications: [],
      conditionAtDischarge: "Stable",
      referral: "",
      instructions: "Follow up as scheduled",
      confirmUnpaidBalance: true,
      overrideReason: "Approved for billing test",
    });

    const receptionist = { ...actor, role: "RECEPTIONIST" as Role };
    await expect(ipdBillingService.settle(receptionist, admissionId, {
      paymentMethod: "CASH",
      refundReason: "Receptionist cannot refund",
    })).rejects.toMatchObject({ statusCode: 403 });

    const settled = await ipdBillingService.settle(actor, admissionId, {
      paymentMethod: "CASH",
      refundReason: "Excess deposit settlement",
    });
    expect(settled.settled).toBe(true);
    expect(settled.refund?.type).toBe("REFUND");
    expect(settled.refund?.reason).toBe("Excess deposit settlement");
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(invoice.status).toBe("FINALIZED");
    expect(Number(invoice.balanceAmount)).toBe(0);
  });

  it("verifies BILLING_MANAGER is authorized for IPD refunds/reversals while RECEPTIONIST is forbidden (403)", async () => {
    const billingManager = { ...actor, role: "BILLING_MANAGER" as Role };
    const receptionist = { ...actor, role: "RECEPTIONIST" as Role };

    // RECEPTIONIST cannot record IPD refund
    await expect(recordIpdRefund(receptionist, admissionId, {
      amount: 50,
      paymentMethod: "CASH",
      reason: "Unauthorized attempt",
    })).rejects.toMatchObject({ statusCode: 403 });

    // RECEPTIONIST cannot reverse IPD service line
    await expect(ipdBillingService.reverseLine(receptionist, admissionId, "00000000-0000-0000-0000-000000000000", "Unauthorized attempt"))
      .rejects.toMatchObject({ statusCode: 403 });

    // BILLING_MANAGER is authorized and successfully records refund
    const refund = await recordIpdRefund(billingManager, admissionId, {
      amount: 50,
      paymentMethod: "CASH",
      reason: "Authorized refund check",
    });
    expect(refund.type).toBe("REFUND");

    // For reversing a non-existent item, BILLING_MANAGER fails with 404 (NotFoundError), NOT 403 Forbidden
    await expect(ipdBillingService.reverseLine(billingManager, admissionId, "00000000-0000-0000-0000-000000000000", "Authorized check"))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});
