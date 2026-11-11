-- Add is_active column to departments (legacy flag, superseded by status enum)
ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;
