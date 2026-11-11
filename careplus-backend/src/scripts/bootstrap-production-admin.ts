import "dotenv/config";
import argon2 from "argon2";
import { prisma } from "../config/prisma";
import { passwordPolicySchema } from "../common/validators/passwordPolicy";

export async function bootstrapAdmin(options?: {
  email?: string;
  password?: string;
  name?: string;
}) {
  const email = options?.email ?? process.env.BOOTSTRAP_ADMIN_EMAIL ?? process.env.ADMIN_EMAIL;
  const password = options?.password ?? process.env.BOOTSTRAP_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD;
  const name = options?.name ?? process.env.BOOTSTRAP_ADMIN_NAME ?? process.env.ADMIN_NAME ?? "System Administrator";

  if (!email || !email.includes("@")) {
    throw new Error("Bootstrap error: Valid BOOTSTRAP_ADMIN_EMAIL or ADMIN_EMAIL is required.");
  }

  if (!password) {
    throw new Error("Bootstrap error: BOOTSTRAP_ADMIN_PASSWORD or ADMIN_PASSWORD is required.");
  }

  // Ensure password meets production password policy
  const policyCheck = passwordPolicySchema.safeParse(password);
  if (!policyCheck.success) {
    throw new Error(
      `Bootstrap error: Password does not meet security requirements: ${policyCheck.error.errors.map((e) => e.message).join(", ")}`
    );
  }

  // Disallow common demo passwords even if they match syntax
  const lower = password.toLowerCase();
  const demoPasswords = ["admin@12345", "doctor@12345", "staff@12345", "password@123", "careplus@123"];
  if (demoPasswords.includes(lower)) {
    throw new Error("Bootstrap error: Known demo passwords cannot be used for production admin.");
  }

  const passwordHash = await argon2.hash(password);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      passwordHash,
      role: "ADMIN",
      isActive: true,
    },
    create: {
      name,
      email,
      passwordHash,
      role: "ADMIN",
      isActive: true,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
  });

  console.log(`✓ Production administrator account ready: ${admin.email} (ID: ${admin.id})`);
  return admin;
}

if (require.main === module) {
  bootstrapAdmin()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ " + (err instanceof Error ? err.message : String(err)));
      process.exit(1);
    });
}
