import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import fs from "node:fs";
import { prisma } from "@config/prisma";
import { logger } from "@config/logger";
import { resolvePrivateFile, savePrivateUpload } from "@common/utils/privateFiles";

export interface PrescriptionPdfRenderInput {
  prescription: {
    id: string;
    status: string;
    signedAt?: Date | string | null;
    createdAt: Date | string;
    visitNumber?: number | string | null;
    visitDate?: Date | string | null;
    presentingComplaints?: string | null;
    findings?: string | null;
    diagnosis?: string | null;
    vitalsJson?: Record<string, unknown> | null;
    items: Array<{
      id: string;
      medicineName: string;
      dosage: string;
      route?: string | null;
      frequency: string;
      durationDays?: number | null;
      durationValue?: number | null;
      durationUnit?: string | null;
      instructions?: string | null;
      medicine?: { genericName?: string | null } | null;
    }>;
  };
  patient: {
    firstName: string;
    lastName: string;
    mrNumber: string;
    age?: number | null;
    gender?: string | null;
    phone?: string | null;
    allergies?: string[];
  };
  doctor: {
    user: {
      name: string;
      staffProfile?: {
        qualification?: string | null;
        signatureUrl?: string | null;
        stampUrl?: string | null;
      } | null;
    };
    qualification?: string | null;
    specialization?: string | null;
    prescriptionPadConfig?: {
      clinicName?: string | null;
      clinicAddress?: string | null;
      clinicPhone?: string | null;
      clinicEmail?: string | null;
      doctorName?: string | null;
      doctorQualification?: string | null;
      doctorSpecialization?: string | null;
      pmdcRegistrationNo?: string | null;
      phcRegistrationNo?: string | null;
      logoUrl?: string | null;
      qrCodeUrl?: string | null;
    } | null;
  };
  appointment?: {
    tokenNumber?: number | string | null;
    appointmentDate?: string | null;
  } | null;
  consultation?: {
    bpSystolic?: number | null;
    bpDiastolic?: number | null;
    pulse?: number | null;
    temperature?: number | null;
    temperatureUnit?: string | null;
    respiratoryRate?: number | null;
    weight?: number | null;
    oxygenSaturation?: number | null;
    heightCm?: number | null;
    diagnosis?: string | null;
    findings?: string | null;
    followUpDate?: Date | string | null;
    followUpInstructions?: string | null;
  } | null;
  shareToken?: string;
  verificationUrl?: string;
}

/**
 * Resolves local file path from an asset URL like "/api/v1/files/doctor-signatures/..."
 */
function resolveAssetPath(url?: string | null): string | null {
  if (!url) return null;
  try {
    const relative = url.replace(/^\/api\/v1\/files\//, "");
    const absPath = resolvePrivateFile(relative);
    if (fs.existsSync(absPath)) return absPath;
  } catch {
    // Ignore invalid or missing asset
  }
  return null;
}

/**
 * Formats date into readable string.
 */
function formatDate(val?: Date | string | null): string {
  if (!val) return "—";
  const d = typeof val === "string" ? new Date(val) : val;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Generates an A4 PDF Buffer matching the CarePlus print layout using PDFKit.
 */
export async function generatePrescriptionPdfBuffer(
  input: PrescriptionPdfRenderInput
): Promise<Buffer> {
  // Fetch hospital profile defaults
  const hospital = await prisma.hospitalProfile.findFirst();
  const pad = input.doctor.prescriptionPadConfig;

  const hospitalName = pad?.clinicName || hospital?.name || "Khalida Medicare Hospital";
  const hospitalAddress = pad?.clinicAddress || hospital?.address || "Main Boulevard, Lahore";
  const hospitalPhone = pad?.clinicPhone || hospital?.phone || "+92 42 111-227-375";
  const hospitalEmail = pad?.clinicEmail || hospital?.email || "info@careplus.local";
  const pmdcReg = pad?.pmdcRegistrationNo || hospital?.pmdcRegistrationNo;
  const phcReg = pad?.phcRegistrationNo || hospital?.phcRegistrationNo;

  // Generate QR Code Buffer if share token / verification URL is available
  let qrCodeBuffer: Buffer | null = null;
  const verifyLink =
    input.verificationUrl ||
    (input.shareToken ? `/api/v1/prescriptions/shared/${input.shareToken}/verify` : null);
  if (verifyLink) {
    try {
      qrCodeBuffer = await QRCode.toBuffer(verifyLink, {
        width: 100,
        margin: 1,
        color: { dark: "#0f172a", light: "#ffffff" },
      });
    } catch (err) {
      logger.warn({ err }, "Failed to generate QR code for prescription PDF");
    }
  }

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 32, bottom: 32, left: 36, right: 36 },
      bufferPages: true,
      info: {
        Title: `Prescription - ${input.patient.mrNumber}`,
        Author: input.doctor.user.name,
        Subject: "Medical Prescription",
      },
    });

    const buffers: Buffer[] = [];
    doc.on("data", (chunk) => buffers.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", (err) => reject(err));

    const left = 36;
    const right = 595.28 - 36;
    const contentWidth = right - left;

    // Header Background / Border Top Accent
    doc.rect(left, 32, contentWidth, 3).fill("#1769AA");

    // Header Section
    let y = 44;
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(18).text(hospitalName, left, y);
    y += 22;

    const contactParts = [hospitalAddress, hospitalPhone, hospitalEmail].filter(Boolean);
    doc.fillColor("#64748b").font("Helvetica").fontSize(8).text(contactParts.join("  ·  "), left, y);
    y += 13;

    const regParts: string[] = [];
    if (pmdcReg) regParts.push(`PMDC Reg: ${pmdcReg}`);
    if (phcReg) regParts.push(`PHC Reg: ${phcReg}`);
    if (regParts.length > 0) {
      doc.fillColor("#94a3b8").font("Helvetica").fontSize(7.5).text(regParts.join("  |  "), left, y);
      y += 12;
    }

    // Divider Line
    y += 4;
    doc.moveTo(left, y).lineTo(right, y).strokeColor("#cbd5e1").lineWidth(1).stroke();
    y += 10;

    // Document Title Banner
    doc.rect(left, y, contentWidth, 22).fill("#f1f5f9");
    doc.fillColor("#1769AA").font("Helvetica-Bold").fontSize(11).text("PRESCRIPTION", left + 8, y + 6);

    const tokenText = input.appointment?.tokenNumber || input.prescription.visitNumber ? `Token #${input.appointment?.tokenNumber || input.prescription.visitNumber}` : "";
    const dateText = formatDate(input.prescription.visitDate || input.appointment?.appointmentDate || input.prescription.createdAt);
    const rightBannerText = [tokenText, dateText].filter(Boolean).join("  ·  ");
    doc.fillColor("#475569").font("Helvetica-Bold").fontSize(9).text(rightBannerText, left, y + 6, {
      width: contentWidth - 8,
      align: "right",
    });
    y += 30;

    // Patient & Visit Details Box
    const patientName = `${input.patient.firstName} ${input.patient.lastName}`.trim();
    const ageGender = [input.patient.age ? `${input.patient.age} yrs` : null, input.patient.gender || null].filter(Boolean).join(" / ") || "—";
    const phone = input.patient.phone || "—";
    const allergies = input.patient.allergies && input.patient.allergies.length > 0 ? input.patient.allergies.join(", ") : "None recorded";

    doc.rect(left, y, contentWidth, 48).fillAndStroke("#fafafa", "#e2e8f0");
    const py = y + 8;

    // Col 1: Patient Name & MR No
    doc.fillColor("#64748b").font("Helvetica").fontSize(8).text("PATIENT NAME", left + 10, py);
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(9.5).text(patientName, left + 10, py + 11);
    doc.fillColor("#64748b").font("Helvetica").fontSize(7.5).text(`MR#: ${input.patient.mrNumber}`, left + 10, py + 24);

    // Col 2: Age / Gender & Contact
    doc.fillColor("#64748b").font("Helvetica").fontSize(8).text("AGE / GENDER", left + 190, py);
    doc.fillColor("#0f172a").font("Helvetica").fontSize(9).text(ageGender, left + 190, py + 11);
    doc.fillColor("#64748b").font("Helvetica").fontSize(7.5).text(`Phone: ${phone}`, left + 190, py + 24);

    // Col 3: Allergies & Doctor
    const docName = input.doctor.prescriptionPadConfig?.doctorName || input.doctor.user.name;
    const docSpec = [input.doctor.prescriptionPadConfig?.doctorQualification || input.doctor.qualification, input.doctor.specialization].filter(Boolean).join(" · ");
    doc.fillColor("#64748b").font("Helvetica").fontSize(8).text("ALLERGIES", left + 350, py);
    doc.fillColor(allergies !== "None recorded" ? "#b91c1c" : "#0f172a").font("Helvetica").fontSize(8.5).text(allergies, left + 350, py + 11);
    doc.fillColor("#64748b").font("Helvetica").fontSize(7.5).text(`Doctor: ${docName}${docSpec ? ` (${docSpec})` : ""}`, left + 350, py + 24, { width: 160 });

    y += 56;

    // Vitals Section (if available)
    const v = input.consultation || (input.prescription.vitalsJson as Record<string, unknown> | undefined);
    const bp = v?.bpSystolic != null && v?.bpDiastolic != null ? `${v.bpSystolic}/${v.bpDiastolic} mmHg` : v?.bpSystolic != null ? `${v.bpSystolic} mmHg` : null;
    const pulse = v?.pulse != null ? `${v.pulse} bpm` : null;
    const temp = v?.temperature != null ? `${v.temperature} °${v.temperatureUnit || "F"}` : null;
    const weight = v?.weight != null ? `${v.weight} kg` : null;
    const spo2 = v?.oxygenSaturation != null ? `${v.oxygenSaturation}%` : null;

    const vitalChips = [
      bp ? `BP: ${bp}` : null,
      pulse ? `Pulse: ${pulse}` : null,
      temp ? `Temp: ${temp}` : null,
      weight ? `Wt: ${weight}` : null,
      spo2 ? `SpO2: ${spo2}` : null,
    ].filter(Boolean);

    if (vitalChips.length > 0) {
      doc.rect(left, y, contentWidth, 18).fill("#f8fafc");
      doc.fillColor("#1769AA").font("Helvetica-Bold").fontSize(7.5).text("VITALS:", left + 8, y + 5);
      doc.fillColor("#334155").font("Helvetica").fontSize(8).text(vitalChips.join("    |    "), left + 50, y + 5);
      y += 24;
    }

    // Diagnosis Section (if present)
    const diagnosis = input.consultation?.diagnosis || input.prescription.diagnosis || input.prescription.presentingComplaints;
    if (diagnosis) {
      doc.fillColor("#64748b").font("Helvetica-Bold").fontSize(8).text("DIAGNOSIS / CHIEF COMPLAINT:", left, y);
      y += 11;
      doc.fillColor("#1e293b").font("Helvetica").fontSize(8.5).text(diagnosis, left, y, { width: contentWidth });
      y += 16;
    }

    // Rx Symbol & Medications Table
    doc.fillColor("#1769AA").font("Helvetica-Bold").fontSize(14).text("℞", left, y);
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(10).text("MEDICATIONS", left + 18, y + 2);
    y += 18;

    // Table Header
    const colWidths = {
      name: 155,
      dosage: 60,
      route: 55,
      freq: 70,
      duration: 65,
      instructions: 118,
    };

    doc.rect(left, y, contentWidth, 16).fill("#1769AA");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);
    let colX = left + 6;
    doc.text("Medicine / Generic", colX, y + 4, { width: colWidths.name });
    colX += colWidths.name;
    doc.text("Dose", colX, y + 4, { width: colWidths.dosage });
    colX += colWidths.dosage;
    doc.text("Route", colX, y + 4, { width: colWidths.route });
    colX += colWidths.route;
    doc.text("Frequency", colX, y + 4, { width: colWidths.freq });
    colX += colWidths.freq;
    doc.text("Duration", colX, y + 4, { width: colWidths.duration });
    colX += colWidths.duration;
    doc.text("Instructions", colX, y + 4, { width: colWidths.instructions });
    y += 16;

    // Table Rows
    const items = input.prescription.items || [];
    if (items.length === 0) {
      doc.rect(left, y, contentWidth, 20).strokeColor("#e2e8f0").stroke();
      doc.fillColor("#64748b").font("Helvetica-Oblique").fontSize(8.5).text("No medicines recorded on this prescription.", left + 10, y + 6);
      y += 24;
    } else {
      items.forEach((item, index) => {
        const rowBg = index % 2 === 0 ? "#ffffff" : "#f8fafc";
        const rowHeight = 22;
        doc.rect(left, y, contentWidth, rowHeight).fillAndStroke(rowBg, "#e2e8f0");

        let curX = left + 6;
        // Medicine name + optional generic
        doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(8).text(item.medicineName, curX, y + 3, { width: colWidths.name, lineBreak: false });
        if (item.medicine?.genericName) {
          doc.fillColor("#64748b").font("Helvetica").fontSize(7).text(`(${item.medicine.genericName})`, curX, y + 12, { width: colWidths.name, lineBreak: false });
        }
        curX += colWidths.name;

        // Dose
        doc.fillColor("#334155").font("Helvetica").fontSize(8).text(item.dosage || "—", curX, y + 6, { width: colWidths.dosage, lineBreak: false });
        curX += colWidths.dosage;

        // Route
        doc.fillColor("#334155").font("Helvetica").fontSize(8).text(item.route || "Oral", curX, y + 6, { width: colWidths.route, lineBreak: false });
        curX += colWidths.route;

        // Frequency
        doc.fillColor("#334155").font("Helvetica").fontSize(8).text(item.frequency || "—", curX, y + 6, { width: colWidths.freq, lineBreak: false });
        curX += colWidths.freq;

        // Duration
        const durationText = item.durationValue != null ? `${item.durationValue} ${item.durationUnit || "days"}` : item.durationDays != null ? `${item.durationDays} days` : "—";
        doc.fillColor("#334155").font("Helvetica").fontSize(8).text(durationText, curX, y + 6, { width: colWidths.duration, lineBreak: false });
        curX += colWidths.duration;

        // Instructions
        doc.fillColor("#334155").font("Helvetica").fontSize(7.5).text(item.instructions || "As directed", curX, y + 6, { width: colWidths.instructions, lineBreak: false });

        y += rowHeight;
      });
      y += 8;
    }

    // Findings & Clinical Notes (if available)
    const notes = input.consultation?.findings || input.prescription.findings;
    if (notes) {
      doc.fillColor("#64748b").font("Helvetica-Bold").fontSize(8).text("CLINICAL NOTES / ADVICE:", left, y);
      y += 11;
      doc.fillColor("#334155").font("Helvetica").fontSize(8).text(notes, left, y, { width: contentWidth });
      y += 16;
    }

    // Follow-up Section
    const followUpDate = input.consultation?.followUpDate;
    const followUpInst = input.consultation?.followUpInstructions;
    if (followUpDate || followUpInst) {
      const followUpText = [followUpDate ? `Next visit: ${formatDate(followUpDate)}` : null, followUpInst ? `Instructions: ${followUpInst}` : null].filter(Boolean).join("  ·  ");
      doc.rect(left, y, contentWidth, 16).fill("#eff6ff");
      doc.fillColor("#1e40af").font("Helvetica-Bold").fontSize(7.5).text("FOLLOW-UP:", left + 8, y + 4);
      doc.fillColor("#1e3a8a").font("Helvetica").fontSize(7.5).text(followUpText, left + 65, y + 4, { width: contentWidth - 75 });
      y += 22;
    }

    // Signatures & Verification Area (Pinned to bottom or right below content)
    const bottomY = Math.max(y + 10, 710);

    // Left Side: Doctor's Signature Block
    const sigPath = resolveAssetPath(input.doctor.user.staffProfile?.signatureUrl);
    if (sigPath) {
      try {
        doc.image(sigPath, left + 10, bottomY - 32, { fit: [120, 32] });
      } catch {
        // Fall back to line if image reading fails
      }
    }
    doc.moveTo(left, bottomY).lineTo(left + 180, bottomY).strokeColor("#94a3b8").lineWidth(0.8).stroke();
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(9).text(docName, left, bottomY + 4);
    if (docSpec) {
      doc.fillColor("#64748b").font("Helvetica").fontSize(7.5).text(docSpec, left, bottomY + 15);
    }
    const signedDate = formatDate(input.prescription.signedAt || input.prescription.createdAt);
    doc.fillColor("#94a3b8").font("Helvetica").fontSize(7).text(`Signed electronically: ${signedDate}`, left, bottomY + 26);

    // Right Side: Verification QR Code Block
    if (qrCodeBuffer) {
      const qrSize = 58;
      const qrX = right - qrSize;
      doc.image(qrCodeBuffer, qrX, bottomY - 26, { width: qrSize, height: qrSize });
      doc.fillColor("#64748b").font("Helvetica").fontSize(6.5).text("Scan to verify", qrX - 30, bottomY + 34, { width: qrSize + 30, align: "right" });
    }

    // Page Footer
    doc.moveTo(left, 792).lineTo(right, 792).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
    doc.fillColor("#94a3b8").font("Helvetica").fontSize(7).text("This prescription is valid for pharmacy dispensing. Generated by CarePlus HMS.", left, 796);
    doc.text("Page 1 of 1", right - 60, 796, { width: 60, align: "right" });

    doc.end();
  });
}

/**
 * High-level helper: loads complete prescription & consultation data,
 * renders PDF, saves to private files storage, and updates PrescriptionShare record.
 */
export async function createAndStorePrescriptionPdf(
  prescriptionId: string,
  shareId?: string,
  shareToken?: string
): Promise<{ filePath: string; fileUrl: string; buffer: Buffer }> {
  // Load complete prescription details
  const rx = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    include: {
      patient: true,
      doctor: {
        include: {
          user: {
            select: {
              name: true,
              staffProfile: {
                select: {
                  qualification: true,
                  signatureUrl: true,
                  stampUrl: true,
                },
              },
            },
          },
          prescriptionPadConfig: true,
        },
      },
      items: {
        include: {
          medicine: {
            select: { genericName: true },
          },
        },
      },
      consultation: {
        include: {
          appointment: true,
        },
      },
    },
  });

  if (!rx) {
    throw new Error(`Prescription ${prescriptionId} not found`);
  }

  const renderInput: PrescriptionPdfRenderInput = {
    prescription: {
      id: rx.id,
      status: rx.status,
      signedAt: rx.signedAt,
      createdAt: rx.createdAt,
      visitNumber: rx.visitNumber,
      visitDate: rx.visitDate,
      presentingComplaints: rx.presentingComplaints,
      findings: rx.findings,
      diagnosis: rx.consultation?.diagnosis,
      vitalsJson: (rx.vitalsJson as Record<string, unknown> | null) ?? null,
      items: rx.items.map((item) => ({
        id: item.id,
        medicineName: item.medicineName,
        dosage: item.dosage,
        route: item.route,
        frequency: item.frequency,
        durationDays: item.durationDays,
        durationValue: item.durationValue,
        durationUnit: item.durationUnit,
        instructions: item.instructions,
        medicine: item.medicine,
      })),
    },
    patient: {
      firstName: rx.patient.firstName,
      lastName: rx.patient.lastName,
      mrNumber: rx.patient.mrNumber,
      age: rx.patient.age,
      gender: rx.patient.gender,
      phone: rx.patient.phone,
      allergies: rx.patient.allergies,
    },
    doctor: {
      user: {
        name: rx.doctor.user.name,
        staffProfile: rx.doctor.user.staffProfile,
      },
      qualification: rx.doctor.qualification,
      specialization: rx.doctor.specialization,
      prescriptionPadConfig: rx.doctor.prescriptionPadConfig,
    },
    appointment: rx.consultation?.appointment
      ? {
          tokenNumber: rx.consultation.appointment.tokenNumber,
          appointmentDate: rx.consultation.appointment.appointmentDate
            ? rx.consultation.appointment.appointmentDate.toISOString().slice(0, 10)
            : null,
        }
      : null,
    consultation: rx.consultation
      ? {
          bpSystolic: rx.consultation.bpSystolic,
          bpDiastolic: rx.consultation.bpDiastolic,
          pulse: rx.consultation.pulse,
          temperature: rx.consultation.temperature ? Number(rx.consultation.temperature) : null,
          temperatureUnit: rx.consultation.temperatureUnit,
          respiratoryRate: rx.consultation.respiratoryRate,
          weight: rx.consultation.weight ? Number(rx.consultation.weight) : null,
          oxygenSaturation: rx.consultation.oxygenSaturation,
          heightCm: rx.consultation.heightCm ? Number(rx.consultation.heightCm) : null,
          diagnosis: rx.consultation.diagnosis,
          findings: rx.consultation.findings,
          followUpDate: rx.consultation.followUpDate,
          followUpInstructions: rx.consultation.followUpInstructions,
        }
      : null,
    shareToken,
  };

  const buffer = await generatePrescriptionPdfBuffer(renderInput);

  // Save PDF into private files
  const fileMock = {
    buffer,
    mimetype: "application/pdf",
    size: buffer.length,
    originalname: `prescription-${rx.patient.mrNumber}.pdf`,
  } as Express.Multer.File;

  const fileUrl = await savePrivateUpload(fileMock, "document", "shared-prescriptions");
  const filePath = fileUrl.split("/files/")[1];
  if (!filePath) {
    throw new Error("Unable to resolve stored prescription file path");
  }

  // Update prescription share record if shareId is supplied
  if (shareId) {
    await prisma.prescriptionShare.update({
      where: { id: shareId },
      data: { filePath },
    });
  }

  return { filePath, fileUrl, buffer };
}
