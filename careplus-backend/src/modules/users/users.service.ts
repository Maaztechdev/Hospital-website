import argon2 from "argon2";
import { Prisma } from "@prisma/client";
import { prisma } from "@config/prisma";
import { BadRequestError, ConflictError, NotFoundError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { PageParams } from "@common/utils/pagination";
import { savePrivateUpload } from "@common/utils/privateFiles";
import { validateStaffProfileForRole, staffProfileSchema } from "./users.validators";

const safeSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  profilePictureUrl: true,
  departmentId: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

interface ListFilters extends PageParams {
  role?: string;
  isActive?: string;
  search?: string;
}

export const usersService = {
  async listUltrasoundStaff() {
    return prisma.user.findMany({
      where: { deletedAt: null, isActive: true, role: { in: ["ULTRASOUND_TECH", "ULTRASOUND_TECHNICIAN", "RADIOLOGIST"] } },
      select: safeSelect,
      orderBy: { name: "asc" },
    });
  },

  async getProfile(id: string) {
    const user = await prisma.user.findFirst({ where: { id, deletedAt: null }, include: { staffProfile: true, doctorProfile: { select: { specialization: true } } } });
    if (!user) throw new NotFoundError("User not found");
    const profile = user.staffProfile
      ? { ...user.staffProfile, specialization: user.doctorProfile?.specialization ?? null }
      : null;
    return { user: { id: user.id, name: user.name, email: user.email, role: user.role, profilePictureUrl: user.profilePictureUrl }, profile };
  },

  async updateProfile(actorId: string, id: string, rawInput: unknown, files: { signature?: Express.Multer.File[]; stamp?: Express.Multer.File[]; profilePicture?: Express.Multer.File[] }) {
    const existing = await prisma.user.findFirst({ where: { id, deletedAt: null }, include: { staffProfile: true } });
    if (!existing) throw new NotFoundError("User not found");
    const parsed = staffProfileSchema.safeParse(rawInput);
    if (!parsed.success) throw new BadRequestError("Invalid staff profile", parsed.error.flatten().fieldErrors);
    const validationErrors = validateStaffProfileForRole(existing.role, parsed.data);
    if (Object.keys(validationErrors).length > 0) throw new BadRequestError("Complete the required staff profile fields", validationErrors);
    const signatureUrl = files.signature?.[0] ? await savePrivateUpload(files.signature[0], "image", "staff-profiles") : existing.staffProfile?.signatureUrl;
    const stampUrl = files.stamp?.[0] ? await savePrivateUpload(files.stamp[0], "image", "staff-profiles") : existing.staffProfile?.stampUrl;
    const profilePictureUrl = files.profilePicture?.[0] ? await savePrivateUpload(files.profilePicture[0], "image", "public-profile-pictures") : existing.profilePictureUrl;

    const profile = await prisma.staffProfile.upsert({
      where: { userId: id },
      create: {
        userId: id,
        qualification: parsed.data.qualification,
        specialization: parsed.data.specialization,
        registrationNumber: parsed.data.registrationNumber ?? parsed.data.pmdcRegistrationNo,
        pmdcRegistrationNo: parsed.data.pmdcRegistrationNo ?? parsed.data.registrationNumber,
        phcRegistrationNo: parsed.data.phcRegistrationNo,
        consultationFee: parsed.data.consultationFee,
        signatureUrl,
        stampUrl,
      },
      update: {
        qualification: parsed.data.qualification,
        specialization: parsed.data.specialization,
        registrationNumber: parsed.data.registrationNumber ?? parsed.data.pmdcRegistrationNo,
        pmdcRegistrationNo: parsed.data.pmdcRegistrationNo ?? parsed.data.registrationNumber,
        phcRegistrationNo: parsed.data.phcRegistrationNo,
        consultationFee: parsed.data.consultationFee,
        signatureUrl,
        stampUrl,
      },
    });
    if (existing.role === "DOCTOR") {
      await prisma.doctor.updateMany({ where: { userId: id }, data: { specialization: parsed.data.specialization ?? null } });
    }
    const user = parsed.data.fullName !== existing.name || profilePictureUrl !== existing.profilePictureUrl
      ? await prisma.user.update({
          where: { id },
          data: {
            name: parsed.data.fullName,
            ...(profilePictureUrl !== existing.profilePictureUrl ? { profilePictureUrl } : {}),
          },
          select: safeSelect,
        })
      : await prisma.user.findUniqueOrThrow({ where: { id }, select: safeSelect });
    await writeAuditLog({ userId: actorId, action: "UPDATE", module: "users", entityType: "StaffProfile", entityId: profile.id, oldValues: existing.staffProfile, newValues: profile });
    return { user, profile };
  },
  async list(filters: ListFilters) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(filters.role ? { role: filters.role as never } : {}),
      ...(filters.isActive ? { isActive: filters.isActive === "true" } : {}),
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: "insensitive" } },
              { email: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.user.findMany({ where, select: safeSelect, skip: filters.skip, take: filters.limit, orderBy: { createdAt: "desc" } }),
      prisma.user.count({ where }),
    ]);

    return { items, total };
  },

  async getById(id: string) {
    const user = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: safeSelect });
    if (!user) throw new NotFoundError("User not found");
    return user;
  },

  async create(actorId: string, input: { name: string; email: string; phone?: string; password: string; role: string; departmentId?: string }) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictError("A user with this email already exists");

    const passwordHash = await argon2.hash(input.password);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          phone: input.phone,
          role: input.role as never,
          departmentId: input.departmentId,
          passwordHash,
        },
        select: safeSelect,
      });
      if (created.role === "DOCTOR") {
        await tx.doctor.create({
          data: { userId: created.id, departmentId: created.departmentId, consultationFee: 0 },
        });
      }
      return created;
    });

    await writeAuditLog({ userId: actorId, action: "CREATE", module: "users", entityType: "User", entityId: user.id, newValues: user });
    return user;
  },

  async update(actorId: string, id: string, input: Record<string, unknown>) {
    const existing = await prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundError("User not found");

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id }, data: input, select: safeSelect });
      if (user.role === "DOCTOR") {
        await tx.doctor.upsert({
          where: { userId: id },
          create: { userId: id, departmentId: user.departmentId, consultationFee: 0 },
          update: { departmentId: user.departmentId },
        });
      }
      return user;
    });

    await writeAuditLog({
      userId: actorId,
      action: "UPDATE",
      module: "users",
      entityType: "User",
      entityId: id,
      oldValues: existing,
      newValues: updated,
    });
    return updated;
  },

  /** Deactivate (soft-disable), never hard-delete. Self-deactivation is blocked. */
  async deactivate(actorId: string, id: string) {
    if (actorId === id) throw new BadRequestError("You cannot deactivate your own account");

    const existing = await prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundError("User not found");

    const updated = await prisma.user.update({ where: { id }, data: { isActive: false }, select: safeSelect });

    await writeAuditLog({
      userId: actorId,
      action: "UPDATE",
      module: "users",
      entityType: "User",
      entityId: id,
      oldValues: { isActive: existing.isActive },
      newValues: { isActive: false },
    });
    return updated;
  },
};
