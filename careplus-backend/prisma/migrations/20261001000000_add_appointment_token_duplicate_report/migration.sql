CREATE OR REPLACE VIEW appointment_token_duplicates AS
SELECT
  doctor_id,
  appointment_date,
  token_number,
  COUNT(*) AS duplicate_count
FROM appointments
WHERE token_number > 0
GROUP BY doctor_id, appointment_date, token_number
HAVING COUNT(*) > 1;
