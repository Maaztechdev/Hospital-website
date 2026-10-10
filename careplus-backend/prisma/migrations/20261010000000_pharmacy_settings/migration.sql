ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PHARMACY_LOSS_ALERT';

CREATE TABLE "pharmacy_security" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "pin_hash" TEXT NOT NULL,
    "pin_admin_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pharmacy_security_pkey" PRIMARY KEY ("id")
);
