import { prisma } from "@config/prisma";
import { AccessTokenPayload } from "@common/middleware/authenticate";
import { ForbiddenError } from "@common/errors/AppError";

export async function getActorDoctorId(actor: AccessTokenPayload): Promise<string | null> {
  if (actor.role !== "DOCTOR") return null;
  const doctor = await prisma.doctor.findUnique({ where: { userId: actor.sub }, select: { id: true } });
  if (!doctor) throw new ForbiddenError("Doctor profile not found");
  return doctor.id;
}

export async function assertDoctorOwns(actor: AccessTokenPayload, doctorId: string | null | undefined): Promise<void> {
  if (actor.role !== "DOCTOR") return;
  const actorDoctorId = await getActorDoctorId(actor);
  if (actorDoctorId !== doctorId) throw new ForbiddenError("You are not authorized to access this record");
}

export async function assertPatientAccess(actor: AccessTokenPayload, patientId: string): Promise<void> {
  if (actor.role !== "DOCTOR") return;
  const doctorId = await getActorDoctorId(actor);
  if (!doctorId) throw new ForbiddenError("Doctor profile not found");
  const access = await prisma.patient.findFirst({
    where: {
      id: patientId,
      deletedAt: null,
      OR: [
        { appointments: { some: { doctorId } } },
        { consultations: { some: { doctorId } } },
        { prescriptions: { some: { doctorId } } },
        { labOrders: { some: { doctorId } } },
        { admissions: { some: { attendingDoctorId: doctorId } } },
        { surgeries: { some: { surgeonId: doctorId } } },
      ],
    },
    select: { id: true },
  });
  if (!access) throw new ForbiddenError("You are not authorized to access this patient");
}