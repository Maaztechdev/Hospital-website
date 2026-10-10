ALTER TABLE "appointments"
  ALTER COLUMN "time_slot" TYPE TIME(0)
  USING btrim("time_slot")::TIME(0);
