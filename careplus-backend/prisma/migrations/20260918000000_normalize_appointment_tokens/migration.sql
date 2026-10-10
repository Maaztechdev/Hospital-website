-- Tokens represent queue order by scheduled time within each doctor's day.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY doctor_id, appointment_date
      ORDER BY time_slot ASC, created_at ASC, id ASC
    ) AS token
  FROM appointments
)
UPDATE appointments AS appointment
SET token_number = ranked.token
FROM ranked
WHERE appointment.id = ranked.id;

CREATE UNIQUE INDEX "appointments_doctor_id_appointment_date_token_number_key"
ON "appointments"("doctor_id", "appointment_date", "token_number");