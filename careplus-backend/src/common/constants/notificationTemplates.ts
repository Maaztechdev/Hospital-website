import { NotificationType } from "@prisma/client";

export interface DefaultNotificationTemplateDefinition {
  notificationType: NotificationType;
  name: string;
  titleTemplate: string;
  messageTemplate: string;
  availablePlaceholders: string[];
}

export const DEFAULT_NOTIFICATION_TEMPLATES: DefaultNotificationTemplateDefinition[] = [
  {
    notificationType: "APPOINTMENT_PENDING",
    name: "New appointment pending approval",
    titleTemplate: "New appointment pending: {{patientName}}",
    messageTemplate: "Token #{{tokenNumber}} for {{patientName}} with {{doctorName}} on {{appointmentDate}} {{timeSlot}} is awaiting confirmation.",
    availablePlaceholders: ["tokenNumber", "patientName", "doctorName", "appointmentDate", "timeSlot", "date", "time"],
  },
  {
    notificationType: "APPOINTMENT_CONFIRMED",
    name: "Appointment confirmed",
    titleTemplate: "Appointment confirmed: {{patientName}}",
    messageTemplate: "Token #{{tokenNumber}} confirmed for {{patientName}} with {{doctorName}} on {{appointmentDate}} {{timeSlot}}.",
    availablePlaceholders: ["tokenNumber", "patientName", "doctorName", "appointmentDate", "timeSlot", "date", "time"],
  },
  {
    notificationType: "LAB_RESULT_READY",
    name: "Lab result ready",
    titleTemplate: "Lab result ready: {{testName}}",
    messageTemplate: "{{testName}} result is ready for {{patientName}} (Order #{{orderNumber}}).",
    availablePlaceholders: ["testName", "patientName", "orderNumber", "date"],
  },
  {
    notificationType: "CRITICAL_LAB_RESULT",
    name: "Critical lab result alert",
    titleTemplate: "CRITICAL lab alert: {{testName}}",
    messageTemplate: "URGENT: {{testName}} for {{patientName}} contains critical parameter values. Immediate clinical review required.",
    availablePlaceholders: ["testName", "patientName", "orderNumber", "criticalParameters"],
  },
  {
    notificationType: "LOW_STOCK_MEDICINE",
    name: "Low stock medicine alert",
    titleTemplate: "Low stock alert: {{medicineName}}",
    messageTemplate: "{{medicineName}} (Batch {{batchNumber}}) has reached reorder level ({{stockQuantity}}/{{reorderLevel}} units remaining).",
    availablePlaceholders: ["medicineName", "batchNumber", "stockQuantity", "reorderLevel"],
  },
  {
    notificationType: "NEAR_EXPIRY_MEDICINE",
    name: "Near expiry medicine alert",
    titleTemplate: "Near expiry alert: {{medicineName}}",
    messageTemplate: "{{medicineName}} (Batch {{batchNumber}}) expires on {{expiryDate}}.",
    availablePlaceholders: ["medicineName", "batchNumber", "expiryDate", "stockQuantity"],
  },
  {
    notificationType: "BED_AVAILABLE",
    name: "Bed available notification",
    titleTemplate: "Bed available in {{wardName}}",
    messageTemplate: "Bed {{bedNumber}} in {{wardName}} is now available for patient admission.",
    availablePlaceholders: ["bedNumber", "wardName", "wardType"],
  },
  {
    notificationType: "PAYMENT_PENDING",
    name: "Payment pending alert",
    titleTemplate: "Payment pending for {{patientName}}",
    messageTemplate: "Invoice {{invoiceNumber}} for {{patientName}} has an outstanding balance of PKR {{balanceAmount}}.",
    availablePlaceholders: ["invoiceNumber", "patientName", "balanceAmount", "dueDate"],
  },
  {
    notificationType: "DISCHARGE_REMINDER",
    name: "Patient discharge reminder",
    titleTemplate: "Discharge reminder: {{patientName}}",
    messageTemplate: "Patient {{patientName}} (Bed {{bedNumber}}, {{wardName}}) is scheduled for discharge.",
    availablePlaceholders: ["patientName", "bedNumber", "wardName", "dischargeDate"],
  },
  {
    notificationType: "SURGERY_STARTING_SOON",
    name: "Surgery starting soon",
    titleTemplate: "Surgery starting soon: {{surgeryType}}",
    messageTemplate: "{{surgeryType}} for patient {{patientName}} is scheduled to start soon in {{otRoomName}}.",
    availablePlaceholders: ["surgeryType", "patientName", "otRoomName", "scheduledStart"],
  },
  {
    notificationType: "OT_CHECKLIST_INCOMPLETE",
    name: "Pre-op checklist incomplete",
    titleTemplate: "Pre-op checklist incomplete",
    messageTemplate: "Cannot start surgery {{surgeryType}} for {{patientName}} — missing checklist items: {{missingItems}}.",
    availablePlaceholders: ["surgeryType", "missingItems", "patientName"],
  },
  {
    notificationType: "OT_STATUS_CHANGED",
    name: "Surgery status changed",
    titleTemplate: "Surgery status updated: {{surgeryType}}",
    messageTemplate: "{{surgeryType}} for {{patientName}}: {{message}}.",
    availablePlaceholders: ["surgeryType", "status", "patientName", "message"],
  },
  {
    notificationType: "PHARMACY_LOSS_ALERT",
    name: "Pharmacy sale below cost alert",
    titleTemplate: "Pharmacy loss threshold exceeded",
    messageTemplate: "Pharmacy sale loss of PKR {{saleLoss}} reached the configured alert threshold.",
    availablePlaceholders: ["saleLoss", "threshold", "saleId"],
  },
  {
    notificationType: "ULTRASOUND_ASSIGNED",
    name: "Ultrasound order assigned",
    titleTemplate: "Ultrasound scan assigned: {{examType}}",
    messageTemplate: "{{examType}} scan has been assigned for {{patientName}}.",
    availablePlaceholders: ["examType", "patientName", "orderId"],
  },
  {
    notificationType: "ULTRASOUND_REPORT_READY",
    name: "Ultrasound report ready",
    titleTemplate: "Ultrasound report ready: {{examType}}",
    messageTemplate: "{{examType}} report for {{patientName}} is ready for verification.",
    availablePlaceholders: ["examType", "patientName", "orderId"],
  },
  {
    notificationType: "ACCOUNT_LOCKED",
    name: "Security alert: account locked",
    titleTemplate: "Security Alert: Account Locked",
    messageTemplate: "Account for {{userName}} ({{userEmail}}) has been locked out after {{failedAttempts}} failed login attempts.",
    availablePlaceholders: ["userName", "userEmail", "failedAttempts"],
  },
];
