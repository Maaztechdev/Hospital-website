import { Role } from "@prisma/client";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { logger } from "@config/logger";
import { isConfigurablePermission } from "@common/permissions";

let permissionCache: Map<string, string[]> | null = null;
let lastCacheUpdate = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds
let isTableEmpty = false;

/**
 * Invalidate the memory cache for role permissions.
 * Called whenever role permissions are modified via Settings API or in tests.
 */
export function invalidateRolePermissionsCache(): void {
  permissionCache = null;
  lastCacheUpdate = 0;
  isTableEmpty = false;
}

/**
 * Load role permissions from cache or database with safety fallback.
 * Returns null if database lookup fails (signaling fallback to hard-coded defaults).
 */
export async function loadRolePermissions(): Promise<Map<string, string[]> | null> {
  const now = Date.now();
  if (permissionCache && now - lastCacheUpdate < CACHE_TTL_MS) {
    return permissionCache;
  }

  try {
    const rows = await prisma.rolePermission.findMany({
      select: { role: true, module: true, allowedActions: true },
    });

    const map = new Map<string, string[]>();
    for (const row of rows) {
      map.set(`${row.role}:${row.module.toLowerCase()}`, row.allowedActions.map((a) => a.toLowerCase()));
    }

    permissionCache = map;
    lastCacheUpdate = now;
    isTableEmpty = rows.length === 0;
    return map;
  } catch (err) {
    logger.warn({ err }, "Failed to load role permissions from database; falling back to hard-coded defaults");
    return null;
  }
}

/**
 * Check whether a given role is allowed to perform an action on a module.
 *
 * Rules:
 * 1. ADMIN safeguard: Always allowed (cannot lock out admin).
 * 2. If (module, action) is not in CONFIGURABLE_PERMISSION_PAIRS: Strictly obeys fallbackRoles.
 * 3. If database lookup fails or table has no rows: Falls back to fallbackRoles.
 * 4. If no stored record exists for (role, module): Falls back to fallbackRoles.
 * 5. If stored record exists for (role, module): Authoritative (true if action in allowedActions, false otherwise).
 */
export async function checkPermission(
  role: Role,
  module: string,
  action: string,
  fallbackRoles: Role[]
): Promise<boolean> {
  // Hard-coded safeguard: Admin must never lose access
  if (role === "ADMIN") {
    return true;
  }

  const normalizedModule = module.toLowerCase();
  const normalizedAction = action.toLowerCase();

  // If not explicitly marked configurable, strictly obey hard-coded defaults
  if (!isConfigurablePermission(normalizedModule, normalizedAction)) {
    return fallbackRoles.includes(role);
  }

  const storedMap = await loadRolePermissions();

  // If lookup failed or table is empty, fall back to hard-coded defaults
  if (!storedMap || isTableEmpty) {
    return fallbackRoles.includes(role);
  }

  const key = `${role}:${normalizedModule}`;
  const allowedActions = storedMap.get(key);

  // If no record exists for this role + module, fall back to hard-coded defaults
  if (!allowedActions) {
    return fallbackRoles.includes(role);
  }

  // Stored record is authoritative for this configurable pair
  return allowedActions.includes(normalizedAction);
}

/**
 * Resolve target module and action from allowedRoles metadata or Express request context.
 */
export function resolvePermissionTarget(
  allowedRoles: Role[],
  req: Request
): { module: string; action: string } | null {
  // 1. Tagged array metadata from permissions.ts
  const tagged = allowedRoles as Role[] & { __module?: string; __action?: string };
  if (tagged && tagged.__module && tagged.__action) {
    return { module: tagged.__module, action: tagged.__action };
  }

  // 2. Derive from Express route context
  const baseUrl = req.baseUrl || "";
  const path = req.path || "";
  const method = req.method.toUpperCase();

  let module: string | null = null;
  if (baseUrl.includes("/wards")) {
    module = "ward";
  } else if (baseUrl.includes("/billing")) {
    module = "billing";
  } else if (baseUrl.includes("/reports")) {
    module = "reports";
  } else if (baseUrl.includes("/patients")) {
    module = "patients";
  } else if (baseUrl.includes("/appointments")) {
    module = "appointments";
  }

  if (!module) return null;

  // Safeguard: Specialized clinical operations, financial reversals, voids, refunds are non-configurable
  if (path.includes("/medicine-orders")) {
    return { module, action: "medicine-orders" };
  }
  if (path.includes("/transfer")) {
    return { module, action: "transfer" };
  }
  if (path.includes("/discharge")) {
    return { module, action: "discharge" };
  }
  if (path.includes("/refund") || path.includes("/refunds")) {
    return { module, action: "refund" };
  }
  if (path.includes("/void")) {
    return { module, action: "void" };
  }
  if (path.includes("/reversal") || path.includes("/reversals")) {
    return { module, action: "reversal" };
  }

  let action = "view";
  if (method === "GET") {
    action = path.includes("/export") ? "export" : "view";
  } else if (method === "POST") {
    action = "create";
  } else if (method === "PUT" || method === "PATCH") {
    action = "edit";
  } else if (method === "DELETE") {
    action = "delete";
  }

  return { module, action };
}
