import { NotificationType, Prisma } from "@prisma/client";
import { prisma } from "@config/prisma";
import { logger } from "@config/logger";

export interface NotifyInput {
  userId: string;
  notificationType: NotificationType;
  title: string;
  message: string;
  templateKey?: NotificationType | string;
  variables?: Record<string, unknown>;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

interface TemplateCacheEntry {
  titleTemplate: string;
  messageTemplate: string;
  isActive: boolean;
}

let templateCache: Map<string, TemplateCacheEntry> | null = null;
let lastTemplateCacheUpdate = 0;
const TEMPLATE_CACHE_TTL_MS = 60 * 1000; // 60 seconds

/**
 * Invalidates the in-memory notification template cache.
 * Called when notification templates are created, updated, or deleted via Settings API or in tests.
 */
export function invalidateNotificationTemplatesCache(): void {
  templateCache = null;
  lastTemplateCacheUpdate = 0;
}

/**
 * Loads active templates from cache or database.
 */
export async function getNotificationTemplate(
  notificationType: NotificationType | string
): Promise<TemplateCacheEntry | null> {
  const now = Date.now();
  if (templateCache && now - lastTemplateCacheUpdate < TEMPLATE_CACHE_TTL_MS) {
    return templateCache.get(String(notificationType)) ?? null;
  }

  try {
    const templates = await prisma.notificationTemplate.findMany({
      where: { isActive: true },
      select: { notificationType: true, titleTemplate: true, messageTemplate: true, isActive: true },
    });

    const map = new Map<string, TemplateCacheEntry>();
    for (const t of templates) {
      map.set(t.notificationType, {
        titleTemplate: t.titleTemplate,
        messageTemplate: t.messageTemplate,
        isActive: t.isActive,
      });
    }

    templateCache = map;
    lastTemplateCacheUpdate = now;
    return map.get(String(notificationType)) ?? null;
  } catch (err) {
    logger.warn({ err }, "Failed to fetch notification templates from database, falling back to defaults");
    return null;
  }
}

/**
 * Replaces {{placeholder}} tokens safely without crashing on missing or unknown keys.
 */
export function renderTemplateString(template: string, variables: Record<string, unknown> = {}): string {
  if (!template) return "";
  try {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
      const val = variables[key];
      if (val !== undefined && val !== null) {
        return String(val);
      }
      // Unknown or missing placeholders are replaced with empty string and do not crash
      return "";
    });
  } catch (err) {
    logger.warn({ err }, "Error rendering template string, falling back to raw template");
    return template;
  }
}

/**
 * Renders title and message using active NotificationTemplate if available,
 * falling back safely to hard-coded title and message if no template exists or rendering fails.
 */
export async function renderNotificationContent(input: {
  notificationType: NotificationType;
  title: string;
  message: string;
  templateKey?: NotificationType | string;
  variables?: Record<string, unknown>;
}): Promise<{ title: string; message: string }> {
  try {
    const key = input.templateKey ?? input.notificationType;
    const template = await getNotificationTemplate(key);

    if (!template || !template.isActive) {
      return { title: input.title, message: input.message };
    }

    const vars = input.variables ?? {};
    const renderedTitle = renderTemplateString(template.titleTemplate, vars);
    const renderedMessage = renderTemplateString(template.messageTemplate, vars);

    return {
      title: renderedTitle.trim() || input.title,
      message: renderedMessage.trim() || input.message,
    };
  } catch (err) {
    logger.warn({ err }, "Error resolving notification template, falling back to hard-coded text");
    return { title: input.title, message: input.message };
  }
}

/**
 * Sends a notification to a specific user.
 * Evaluates NotificationTemplate if available and renders {{placeholders}}.
 * Catches all errors so that notification issues never break the main business transaction.
 */
export async function notifyUser(
  input: NotifyInput,
  _tx?: Prisma.TransactionClient | typeof prisma
): Promise<void> {
  try {
    const { title, message } = await renderNotificationContent(input);

    // Isolate notification creation using standalone prisma client so that notification
    // failures/FK issues never poison the caller's clinical transaction.
    await prisma.notification.create({
      data: {
        userId: input.userId,
        notificationType: input.notificationType,
        title,
        message,
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
      },
    });
  } catch (error) {
    logger.warn({ error, userId: input.userId, notificationType: input.notificationType }, "Failed to create notification (best-effort)");
  }
}

/**
 * Notify every active user holding one of the given roles.
 * Evaluates NotificationTemplate and dispatches to each user.
 */
export async function notifyRoles(
  roles: string[],
  input: Omit<NotifyInput, "userId">,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  try {
    const { title, message } = await renderNotificationContent(input);

    const users = await tx.user.findMany({
      where: { role: { in: roles as never }, isActive: true, deletedAt: null },
      select: { id: true },
    });
    await Promise.all(
      users.map((u) =>
        notifyUser({
          ...input,
          title,
          message,
          userId: u.id,
        })
      )
    );
  } catch (error) {
    logger.warn({ error, roles, notificationType: input.notificationType }, "Failed to create role notifications (best-effort)");
  }
}
