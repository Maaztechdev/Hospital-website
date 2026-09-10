-- Composite indexes for the dashboard's high-volume lookup and history queries.
CREATE INDEX "patients_last_name_first_name_idx" ON "patients"("last_name", "first_name");
CREATE INDEX "appointments_appointment_date_status_idx" ON "appointments"("appointment_date", "status");
CREATE INDEX "appointments_status_appointment_date_idx" ON "appointments"("status", "appointment_date");
CREATE INDEX "stock_movements_batch_id_created_at_idx" ON "stock_movements"("batch_id", "created_at");
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");
CREATE INDEX "audit_logs_module_created_at_idx" ON "audit_logs"("module", "created_at");