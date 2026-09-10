import swaggerJsdoc from "swagger-jsdoc";
import { env } from "./env";

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "CarePlus Hospital Management System API",
      version: "1.0.0",
      description:
        "REST API for the CarePlus HMS backend — auth, patients, appointments, OPD queue, consultations, prescriptions, lab, pharmacy, billing, wards, nursing, OT, notifications, reports, settings, and audit logs.",
    },
    servers: [{ url: `http://localhost:${env.PORT}${env.API_PREFIX}` }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: "Auth" },
      { name: "Users" },
      { name: "Patients" },
      { name: "Appointments" },
      { name: "OPD Queue" },
      { name: "Consultations" },
      { name: "Prescriptions" },
      { name: "Lab" },
      { name: "Pharmacy" },
      { name: "Billing" },
      { name: "Wards" },
      { name: "Nursing" },
      { name: "OT" },
      { name: "Notifications" },
      { name: "Reports" },
      { name: "Settings" },
      { name: "Audit Logs" },
    ],
  },
  apis: ["./src/modules/**/*.routes.ts"],
});
