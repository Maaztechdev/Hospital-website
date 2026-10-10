CREATE TABLE "notification_templates" (
    "id" TEXT NOT NULL,
    "notification_type" "NotificationType" NOT NULL,
    "name" TEXT NOT NULL,
    "title_template" TEXT NOT NULL,
    "message_template" TEXT NOT NULL,
    "available_placeholders" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_templates_notification_type_key" ON "notification_templates"("notification_type");

INSERT INTO "notification_templates" ("id", "notification_type", "name", "title_template", "message_template", "available_placeholders", "updated_at") VALUES
('c2c4f7c1-4a7a-45e0-9d45-7cf0d4f4c101', 'APPOINTMENT_CONFIRMED', 'Appointment reminder', 'Appointment reminder for {{patientName}}', 'Your appointment is scheduled for {{date}} at {{time}} with {{doctorName}}.', ARRAY['patientName', 'date', 'time', 'doctorName'], CURRENT_TIMESTAMP),
('c2c4f7c1-4a7a-45e0-9d45-7cf0d4f4c102', 'LAB_RESULT_READY', 'Lab result ready', 'Lab result ready for {{patientName}}', '{{testName}} result is ready. Please review the report dated {{date}}.', ARRAY['patientName', 'testName', 'date'], CURRENT_TIMESTAMP),
('c2c4f7c1-4a7a-45e0-9d45-7cf0d4f4c103', 'PAYMENT_PENDING', 'Payment receipt', 'Payment received from {{patientName}}', 'Payment of {{amount}} was received on {{date}}. Receipt number: {{receiptNumber}}.', ARRAY['patientName', 'amount', 'date', 'receiptNumber'], CURRENT_TIMESTAMP);