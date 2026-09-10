import argon2 from "argon2";
import { Prisma } from "@prisma/client";
import { prisma } from "@config/prisma";
import { BadRequestError, ConflictError, NotFoundError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { PageParams } from "@common/utils/pagination";

const safeSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
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

    const user = await prisma.user.create({
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

    await writeAuditLog({ userId: actorId, action: "CREATE", module: "users", entityType: "User", entityId: user.id, newValues: user });
    return user;
  },

  async update(actorId: string, id: string, input: Record<string, unknown>) {
    const existing = await prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundError("User not found");

    const updated = await prisma.user.update({ where: { id }, data: input, select: safeSelect });

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
