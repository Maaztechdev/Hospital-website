UPDATE "appointments"
SET "rejection_reason" = 'Cancelled by staff'
WHERE "rejection_reason" IN (
  'Temporary token-order verification',
  'Temporary OPD queue display verification'
);
