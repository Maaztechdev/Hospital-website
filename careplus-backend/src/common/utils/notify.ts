import { NotificationType, Prisma } from "@prisma/client";
import { prisma } from "@config/prisma";

interface NotifyInput {
  userId: string;
  notificationType: NotificationType;
  title: string;
  message: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

export async function notifyUser(
  input: NotifyInput,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  await tx.notification.create({
    data: {
      userId: input.userId,
      notificationType: input.notificationType,
      title: input.title,
      message: input.message,
      relatedEntityType: input.relatedEntityType ?? null,
      relatedEntityId: input.relatedEntityId ?? null,
    },
  });
}

/** Notify every active user holding one of the given roles. */
export async function notifyRoles(
  roles: string[],
  input: Omit<NotifyInput, "userId">,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  const users = await tx.user.findMany({
    where: { role: { in: roles as never }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  await Promise.all(users.map((u) => notifyUser({ ...input, userId: u.id }, tx)));
}
