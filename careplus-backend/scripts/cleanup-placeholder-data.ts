import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const confirm = process.argv.includes("--confirm");

type Deletion = { type: string; id: string; description: string };

function log(deletions: Deletion[]) {
  for (const deletion of deletions) console.log(`${confirm ? "DELETED" : "WOULD DELETE"} ${deletion.type} ${deletion.id} - ${deletion.description}`);
}

async function collect() {
  const patients = await prisma.patient.findMany({
    where: {
      deletedAt: null,
      OR: [
        { firstName: { contains: "Lifecycle", mode: "insensitive" } },
        { lastName: { contains: "Lifecycle", mode: "insensitive" } },
        { firstName: { equals: "check", mode: "insensitive" } },
        { firstName: { equals: "check 1", mode: "insensitive" } },
      ],
    },
    select: { id: true, mrNumber: true, firstName: true, lastName: true },
  });
  const medicines = await prisma.medicine.findMany({
    where: {
      OR: [
        { name: { in: ["aproion", "ansd"], mode: "insensitive" } },
        { genericName: { in: ["aproion", "ansd"], mode: "insensitive" } },
        { batches: { some: { batchNumber: { equals: "djsj", mode: "insensitive" } } } },
      ],
    },
    include: { batches: { select: { id: true, batchNumber: true } } },
  });
  const tasks = await prisma.nursingTask.findMany({ where: { taskDescription: { equals: "lxkdd", mode: "insensitive" } }, select: { id: true, taskDescription: true } });
  const legacyDobCount = await prisma.patient.count({ where: { deletedAt: null, dateOfBirth: null } });
  return { patients, medicines, tasks, legacyDobCount };
}

async function main() {
  const found = await collect();
  const deletions: Deletion[] = [];
  const patientIds = found.patients.map((patient) => patient.id);
  const medicineIds = found.medicines.map((medicine) => medicine.id);
  const batchIds = found.medicines.flatMap((medicine) => medicine.batches.map((batch) => batch.id));

  for (const patient of found.patients) deletions.push({ type: "Patient", id: patient.id, description: `${patient.mrNumber} ${patient.firstName} ${patient.lastName}` });
  for (const medicine of found.medicines) deletions.push({ type: "Medicine", id: medicine.id, description: medicine.name });
  for (const medicine of found.medicines.flatMap((item) => item.batches)) deletions.push({ type: "MedicineBatch", id: medicine.id, description: medicine.batchNumber });
  for (const task of found.tasks) deletions.push({ type: "NursingTask", id: task.id, description: task.taskDescription });

  if (!confirm) {
    log(deletions);
    console.log(`LEGACY DOB REPORT: ${found.legacyDobCount} active patients have no dateOfBirth and require optional staff backfill.`);
    console.log("Dry run only. Review the records above, back up the database, then rerun with --confirm to delete them.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (patientIds.length > 0) {
      const admissions = await tx.admission.findMany({ where: { patientId: { in: patientIds } }, select: { id: true, bedId: true, status: true } });
      const admissionIds = admissions.map((admission) => admission.id);
      for (const admission of admissions) deletions.push({ type: "Admission", id: admission.id, description: "dependent junk-patient admission" });
      if (admissionIds.length > 0) {
        await tx.nursingTask.deleteMany({ where: { admissionId: { in: admissionIds } } });
        await tx.patientVitals.deleteMany({ where: { admissionId: { in: admissionIds } } });
        await tx.bedTransfer.deleteMany({ where: { admissionId: { in: admissionIds } } });
        await tx.admission.deleteMany({ where: { id: { in: admissionIds } } });
        await tx.bed.updateMany({ where: { id: { in: admissions.filter((admission) => admission.status === "ACTIVE").map((admission) => admission.bedId) }, status: "OCCUPIED" }, data: { status: "AVAILABLE" } });
      }

      const labOrders = await tx.labOrder.findMany({ where: { patientId: { in: patientIds } }, select: { id: true } });
      const labOrderIds = labOrders.map((order) => order.id);
      for (const order of labOrders) deletions.push({ type: "LabOrder", id: order.id, description: "dependent junk-patient lab order" });
      if (labOrderIds.length > 0) {
        await tx.labReportAttachment.deleteMany({ where: { labOrderId: { in: labOrderIds } } });
        await tx.labResult.deleteMany({ where: { labOrderId: { in: labOrderIds } } });
        await tx.labOrder.deleteMany({ where: { id: { in: labOrderIds } } });
      }

      const prescriptions = await tx.prescription.findMany({ where: { patientId: { in: patientIds } }, select: { id: true } });
      const prescriptionIds = prescriptions.map((prescription) => prescription.id);
      for (const prescription of prescriptions) deletions.push({ type: "Prescription", id: prescription.id, description: "dependent junk-patient prescription" });
      if (prescriptionIds.length > 0) {
        await tx.prescriptionItem.deleteMany({ where: { prescriptionId: { in: prescriptionIds } } });
        await tx.prescription.deleteMany({ where: { id: { in: prescriptionIds } } });
      }
      const ultrasoundOrders = await tx.ultrasoundOrder.findMany({ where: { patientId: { in: patientIds } }, select: { id: true } });
      const consultations = await tx.consultation.findMany({ where: { patientId: { in: patientIds } }, select: { id: true } });
      const appointments = await tx.appointment.findMany({ where: { patientId: { in: patientIds } }, select: { id: true } });
      const surgeries = await tx.surgery.findMany({ where: { patientId: { in: patientIds } }, select: { id: true } });
      for (const item of ultrasoundOrders) deletions.push({ type: "UltrasoundOrder", id: item.id, description: "dependent junk-patient ultrasound order" });
      for (const item of consultations) deletions.push({ type: "Consultation", id: item.id, description: "dependent junk-patient consultation" });
      for (const item of appointments) deletions.push({ type: "Appointment", id: item.id, description: "dependent junk-patient appointment" });
      for (const item of surgeries) deletions.push({ type: "Surgery", id: item.id, description: "dependent junk-patient surgery" });
      await tx.ultrasoundOrder.deleteMany({ where: { id: { in: ultrasoundOrders.map((item) => item.id) } } });
      await tx.consultation.deleteMany({ where: { id: { in: consultations.map((item) => item.id) } } });
      await tx.appointment.deleteMany({ where: { id: { in: appointments.map((item) => item.id) } } });
      await tx.surgery.deleteMany({ where: { id: { in: surgeries.map((item) => item.id) } } });

      const invoices = await tx.invoice.findMany({ where: { patientId: { in: patientIds } }, select: { id: true } });
      const invoiceIds = invoices.map((invoice) => invoice.id);
      for (const invoice of invoices) deletions.push({ type: "Invoice", id: invoice.id, description: "dependent junk-patient invoice" });
      if (invoiceIds.length > 0) {
        const sales = await tx.pharmacySale.findMany({ where: { invoiceId: { in: invoiceIds } }, select: { id: true } });
        const saleIds = sales.map((sale) => sale.id);
        await tx.pharmacySaleItem.deleteMany({ where: { saleId: { in: saleIds } } });
        await tx.pharmacySale.deleteMany({ where: { id: { in: saleIds } } });
        await tx.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        await tx.invoiceItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        await tx.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      }
      await tx.patientVitals.deleteMany({ where: { patientId: { in: patientIds } } });
      await tx.patient.deleteMany({ where: { id: { in: patientIds } } });
    }

    if (medicineIds.length > 0) {
      await tx.prescriptionItem.deleteMany({ where: { medicineId: { in: medicineIds } } });
      await tx.pharmacySaleItem.deleteMany({ where: { medicineId: { in: medicineIds } } });
    }
    if (batchIds.length > 0) {
      await tx.stockMovement.deleteMany({ where: { batchId: { in: batchIds } } });
      await tx.pharmacySaleItem.deleteMany({ where: { batchId: { in: batchIds } } });
      await tx.medicineBatch.deleteMany({ where: { id: { in: batchIds } } });
    }
    if (medicineIds.length > 0) await tx.medicine.deleteMany({ where: { id: { in: medicineIds } } });
    if (found.tasks.length > 0) await tx.nursingTask.deleteMany({ where: { id: { in: found.tasks.map((task) => task.id) } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  log(deletions);
  console.log(`Deleted ${deletions.length} identified placeholder records in one transaction.`);
}

main().catch((error) => {
  console.error("Placeholder cleanup failed:", error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
