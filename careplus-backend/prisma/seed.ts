import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding CarePlus database...");

  // ── Departments ────────────────────────────────────────
  const departments = await Promise.all(
    ["General Medicine", "Cardiology", "Pediatrics", "Orthopedics", "Gynecology", "ENT"].map((name) =>
      prisma.department.upsert({ where: { name }, create: { name }, update: {} })
    )
  );

  // ── Admin user ─────────────────────────────────────────
  const adminPasswordHash = await argon2.hash("Admin@12345");
  const admin = await prisma.user.upsert({
    where: { email: "admin@careplus.local" },
    create: {
      name: "System Administrator",
      email: "admin@careplus.local",
      passwordHash: adminPasswordHash,
      role: "ADMIN",
      isActive: true,
    },
    update: {},
  });

  // ── Receptionist, Pharmacist, Lab Tech, Nurse ──────────
  const staffPasswordHash = await argon2.hash("Staff@12345");
  const [receptionist, pharmacist, labTech, nurse] = await Promise.all([
    prisma.user.upsert({ where: { email: "reception@careplus.local" }, create: { name: "Ayesha Front Desk", email: "reception@careplus.local", passwordHash: staffPasswordHash, role: "RECEPTIONIST" }, update: {} }),
    prisma.user.upsert({ where: { email: "pharmacist@careplus.local" }, create: { name: "Bilal Pharmacist", email: "pharmacist@careplus.local", passwordHash: staffPasswordHash, role: "PHARMACIST" }, update: {} }),
    prisma.user.upsert({ where: { email: "labtech@careplus.local" }, create: { name: "Sana Lab Tech", email: "labtech@careplus.local", passwordHash: staffPasswordHash, role: "LAB_TECHNICIAN" }, update: {} }),
    prisma.user.upsert({ where: { email: "nurse@careplus.local" }, create: { name: "Hina Nurse", email: "nurse@careplus.local", passwordHash: staffPasswordHash, role: "NURSE" }, update: {} }),
  ]);

  // ── Doctors ────────────────────────────────────────────
  const doctorPasswordHash = await argon2.hash("Doctor@12345");
  const doctorUser1 = await prisma.user.upsert({
    where: { email: "dr.ahmed@careplus.local" },
    create: { name: "Dr. Ahmed Khan", email: "dr.ahmed@careplus.local", passwordHash: doctorPasswordHash, role: "DOCTOR", departmentId: departments[0].id },
    update: {},
  });
  const doctorUser2 = await prisma.user.upsert({
    where: { email: "dr.fatima@careplus.local" },
    create: { name: "Dr. Fatima Sheikh", email: "dr.fatima@careplus.local", passwordHash: doctorPasswordHash, role: "DOCTOR", departmentId: departments[1].id },
    update: {},
  });

  const doctor1 = await prisma.doctor.upsert({
    where: { userId: doctorUser1.id },
    create: { 
      userId: doctorUser1.id, 
      departmentId: departments[0].id, 
      qualification: "MBBS, FCPS", 
      specialization: "General Medicine", 
      experienceYears: 8, 
      consultationFee: 1500,
      scheduleJson: {
        workingHours: { start: "09:00", end: "17:00" },
        slotDuration: 20,
        daysOff: ["Saturday", "Sunday"],
        slotsPerDay: ["09:00", "09:20", "09:40", "10:00", "10:20", "10:40", "11:00", "11:20", "11:40", "12:00", "14:00", "14:20", "14:40", "15:00", "15:20", "15:40", "16:00", "16:20", "16:40"]
      }
    },
    update: {},
  });
  const doctor2 = await prisma.doctor.upsert({
    where: { userId: doctorUser2.id },
    create: { 
      userId: doctorUser2.id, 
      departmentId: departments[1].id, 
      qualification: "MBBS, FCPS Cardiology", 
      specialization: "Cardiology", 
      experienceYears: 12, 
      consultationFee: 3000,
      scheduleJson: {
        workingHours: { start: "10:00", end: "16:00" },
        slotDuration: 20,
        daysOff: ["Friday", "Saturday", "Sunday"],
        slotsPerDay: ["10:00", "10:20", "10:40", "11:00", "11:20", "11:40", "12:00", "12:20", "12:40", "14:00", "14:20", "14:40", "15:00", "15:20", "15:40"]
      }
    },
    update: {},
  });

  const demoPatient = await prisma.patient.upsert({
    where: { mrNumber: "MR-2026-000001" },
    create: {
      mrNumber: "MR-2026-000001",
      firstName: "Demo",
      lastName: "Patient",
      dateOfBirth: new Date("1990-01-01"),
      age: 36,
      gender: "OTHER",
      phone: "03001234567",
      createdBy: receptionist.id,
    },
    update: {},
  });

  const seededAppointmentDate = new Date();
  seededAppointmentDate.setUTCDate(seededAppointmentDate.getUTCDate() + 2);
  seededAppointmentDate.setUTCHours(0, 0, 0, 0);
  const existingSeededAppointment = await prisma.appointment.findFirst({
    where: { patientId: demoPatient.id, doctorId: doctor1.id, appointmentDate: seededAppointmentDate, timeSlot: "09:00" },
  });
  if (!existingSeededAppointment) {
    await prisma.appointment.create({
      data: {
        patientId: demoPatient.id,
        doctorId: doctor1.id,
        departmentId: departments[0].id,
        appointmentDate: seededAppointmentDate,
        timeSlot: "09:00",
        tokenNumber: 1,
        appointmentType: "CONSULTATION",
        priority: "ROUTINE",
        source: "WALK_IN",
        createdBy: receptionist.id,
      },
    });
  }

  // ── Lab tests ──────────────────────────────────────────
  const labTests = await Promise.all(
    [
      { testName: "Complete Blood Count", testCode: "CBC", category: "Hematology", price: 800, unit: "cells/mcL" },
      { testName: "Blood Glucose (Fasting)", testCode: "FBS", category: "Chemistry", price: 300, unit: "mg/dL", referenceRangeMin: 70, referenceRangeMax: 100 },
      { testName: "Lipid Profile", testCode: "LIPID", category: "Chemistry", price: 1200 },
      { testName: "Urine Routine Examination", testCode: "URE", category: "Pathology", price: 400 },
    ].map((t) => prisma.labTest.upsert({ where: { testCode: t.testCode }, create: t, update: {} }))
  );

  // ── Medicines + batches ────────────────────────────────
  const category = await prisma.medicineCategory.upsert({ where: { name: "Analgesics" }, create: { name: "Analgesics" }, update: {} });
  const paracetamol =
    (await prisma.medicine.findFirst({ where: { name: "Panadol" } })) ??
    (await prisma.medicine.create({ data: { name: "Panadol", genericName: "Paracetamol", strength: "500mg", form: "Tablet", categoryId: category.id } }));

  const existingBatch = await prisma.medicineBatch.findFirst({ where: { medicineId: paracetamol.id } });
  if (!existingBatch) {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    await prisma.medicineBatch.create({
      data: {
        medicineId: paracetamol.id,
        batchNumber: "PCT-2026-A",
        expiryDate: futureDate,
        purchasePrice: 3,
        sellingPrice: 5,
        stockQuantity: 500,
        reorderLevel: 50,
      },
    });
  }

  // ── Wards / Rooms / Beds ───────────────────────────────
  const generalWard =
    (await prisma.ward.findFirst({ where: { wardName: "General Ward A" } })) ??
    (await prisma.ward.create({ data: { wardName: "General Ward A", wardType: "GENERAL" } }));

  const existingRoom = await prisma.room.findFirst({ where: { wardId: generalWard.id } });
  const room = existingRoom ?? (await prisma.room.create({ data: { wardId: generalWard.id, roomNumber: "101" } }));

  const existingBeds = await prisma.bed.findMany({ where: { roomId: room.id }, select: { bedNumber: true } });
  const bedNumbers = new Set(existingBeds.map((bed) => bed.bedNumber));
  const missingBeds = ["101-A", "101-B", "101-C", "101-D", "101-E", "101-F"]
    .filter((bedNumber) => !bedNumbers.has(bedNumber))
    .map((bedNumber) => ({ roomId: room.id, bedNumber, dailyRate: 2000 }));
  if (missingBeds.length > 0) await prisma.bed.createMany({ data: missingBeds });

  // ── OT room ─────────────────────────────────────────────
  const existingOtRoom = await prisma.otRoom.findFirst({ where: { roomName: "OT-1" } });
  if (!existingOtRoom) {
    await prisma.otRoom.create({ data: { roomName: "OT-1" } });
  }

  console.log("✅ Seed complete.");
  console.log("   Admin login:        admin@careplus.local / Admin@12345");
  console.log("   Doctor login:       dr.ahmed@careplus.local / Doctor@12345");
  console.log("   Receptionist login: reception@careplus.local / Staff@12345");
  console.log("   Pharmacist login:   pharmacist@careplus.local / Staff@12345");
  console.log("   Lab tech login:     labtech@careplus.local / Staff@12345");
  console.log("   Nurse login:        nurse@careplus.local / Staff@12345");
  console.log(`   Departments: ${departments.length}, Doctors: 2 (${doctor1.id}, ${doctor2.id}), Lab tests: ${labTests.length}`);
  void admin;
  void receptionist;
  void pharmacist;
  void labTech;
  void nurse;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
