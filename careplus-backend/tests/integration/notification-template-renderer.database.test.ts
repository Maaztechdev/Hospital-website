import { prisma } from "@config/prisma";
import {
  renderTemplateString,
  renderNotificationContent,
  invalidateNotificationTemplatesCache,
  notifyUser,
  notifyRoles,
} from "../../src/common/utils/notify";

describe("TASK A: NotificationTemplate renderer and resilience", () => {
  let testUserId: string;

  beforeAll(async () => {
    // Pick or create an active user for testing notifications
    const user = await prisma.user.findFirst({ where: { isActive: true, deletedAt: null } });
    if (!user) {
      throw new Error("No active user found for notification test");
    }
    testUserId = user.id;
  });

  beforeEach(() => {
    invalidateNotificationTemplatesCache();
  });

  afterAll(async () => {
    invalidateNotificationTemplatesCache();
    await prisma.notification.deleteMany({
      where: {
        title: { contains: "[TEST-TASK-A]" },
      },
    });
  });

  describe("1. renderTemplateString", () => {
    it("replaces {{placeholders}} with provided variable values", () => {
      const template = "Hello {{patientName}}, your token is #{{tokenNumber}} with Dr. {{doctorName}}.";
      const variables = {
        patientName: "Muhammad Ali",
        tokenNumber: 42,
        doctorName: "Dr. Ahmed",
      };

      const result = renderTemplateString(template, variables);
      expect(result).toBe("Hello Muhammad Ali, your token is #42 with Dr. Dr. Ahmed.");
    });

    it("handles placeholders with internal whitespace {{ tokenNumber }}", () => {
      const template = "Token {{  tokenNumber  }} confirmed for {{ patientName }}.";
      const variables = { tokenNumber: "15", patientName: "Ayesha" };

      const result = renderTemplateString(template, variables);
      expect(result).toBe("Token 15 confirmed for Ayesha.");
    });

    it("replaces missing or unknown placeholders with empty string without crashing", () => {
      const template = "Appointment with {{doctorName}} on {{date}} at {{time}}. Unknown: {{nonExistentField}}.";
      const variables = {
        doctorName: "Dr. Fatima",
        // date, time, and nonExistentField are deliberately omitted
      };

      expect(() => renderTemplateString(template, variables)).not.toThrow();
      const result = renderTemplateString(template, variables);
      expect(result).toBe("Appointment with Dr. Fatima on  at . Unknown: .");
    });

    it("safely handles null/undefined template input without throwing", () => {
      expect(renderTemplateString(null as unknown as string)).toBe("");
      expect(renderTemplateString(undefined as unknown as string)).toBe("");
      expect(renderTemplateString("No placeholders")).toBe("No placeholders");
    });
  });

  describe("2. renderNotificationContent (template lookup & fallback)", () => {
    const customTestType = "APPOINTMENT_CONFIRMED" as const;

    it("uses active database template and interpolates variables", async () => {
      // Ensure template exists and is active
      await prisma.notificationTemplate.upsert({
        where: { notificationType: customTestType },
        update: {
          titleTemplate: "[TEST-TASK-A] Confirmed: {{patientName}}",
          messageTemplate: "Token #{{tokenNumber}} confirmed for {{patientName}} with {{doctorName}} on {{appointmentDate}}.",
          isActive: true,
        },
        create: {
          notificationType: customTestType,
          name: "Test Appointment Confirmed",
          titleTemplate: "[TEST-TASK-A] Confirmed: {{patientName}}",
          messageTemplate: "Token #{{tokenNumber}} confirmed for {{patientName}} with {{doctorName}} on {{appointmentDate}}.",
          availablePlaceholders: ["patientName", "tokenNumber", "doctorName", "appointmentDate"],
          isActive: true,
        },
      });
      invalidateNotificationTemplatesCache();

      const rendered = await renderNotificationContent({
        notificationType: customTestType,
        title: "Fallback Title",
        message: "Fallback Message",
        variables: {
          patientName: "Zainab Bibi",
          tokenNumber: 7,
          doctorName: "Dr. Ahmed",
          appointmentDate: "2026-11-01",
        },
      });

      expect(rendered.title).toBe("[TEST-TASK-A] Confirmed: Zainab Bibi");
      expect(rendered.message).toBe("Token #7 confirmed for Zainab Bibi with Dr. Ahmed on 2026-11-01.");
    });

    it("falls back to hard-coded title and message when template does not exist", async () => {
      invalidateNotificationTemplatesCache();

      const rendered = await renderNotificationContent({
        notificationType: "APPOINTMENT_PENDING",
        templateKey: "NON_EXISTENT_TEMPLATE_KEY_XYZ",
        title: "Default Pending Title",
        message: "Default Pending Message",
        variables: { patientName: "Someone" },
      });

      expect(rendered.title).toBe("Default Pending Title");
      expect(rendered.message).toBe("Default Pending Message");
    });

    it("falls back to hard-coded title and message when template is inactive (isActive = false)", async () => {
      await prisma.notificationTemplate.upsert({
        where: { notificationType: customTestType },
        update: { isActive: false },
        create: {
          notificationType: customTestType,
          name: "Inactive Test Template",
          titleTemplate: "Inactive Title {{patientName}}",
          messageTemplate: "Inactive Message {{patientName}}",
          isActive: false,
        },
      });
      invalidateNotificationTemplatesCache();

      const rendered = await renderNotificationContent({
        notificationType: customTestType,
        title: "Hard-Coded Fallback Title",
        message: "Hard-Coded Fallback Message",
        variables: { patientName: "Zainab" },
      });

      expect(rendered.title).toBe("Hard-Coded Fallback Title");
      expect(rendered.message).toBe("Hard-Coded Fallback Message");

      // Re-enable for subsequent tests
      await prisma.notificationTemplate.update({
        where: { notificationType: customTestType },
        data: { isActive: true },
      });
      invalidateNotificationTemplatesCache();
    });

    it("falls back to hard-coded values if template renders to empty strings", async () => {
      await prisma.notificationTemplate.upsert({
        where: { notificationType: customTestType },
        update: {
          titleTemplate: "{{onlyMissingField}}",
          messageTemplate: "{{anotherMissingField}}",
          isActive: true,
        },
        create: {
          notificationType: customTestType,
          name: "Empty Field Test",
          titleTemplate: "{{onlyMissingField}}",
          messageTemplate: "{{anotherMissingField}}",
          isActive: true,
        },
      });
      invalidateNotificationTemplatesCache();

      const rendered = await renderNotificationContent({
        notificationType: customTestType,
        title: "Safety Fallback Title",
        message: "Safety Fallback Message",
        variables: {},
      });

      expect(rendered.title).toBe("Safety Fallback Title");
      expect(rendered.message).toBe("Safety Fallback Message");
    });
  });

  describe("3. notifyUser & notifyRoles end-to-end integration", () => {
    it("creates notification in database using rendered template and variables", async () => {
      await prisma.notificationTemplate.upsert({
        where: { notificationType: "LAB_RESULT_READY" },
        update: {
          titleTemplate: "[TEST-TASK-A] Result Ready: {{testName}}",
          messageTemplate: "Report for {{patientName}} (Order #{{orderNumber}}) is ready.",
          isActive: true,
        },
        create: {
          notificationType: "LAB_RESULT_READY",
          name: "Lab Result Ready Test",
          titleTemplate: "[TEST-TASK-A] Result Ready: {{testName}}",
          messageTemplate: "Report for {{patientName}} (Order #{{orderNumber}}) is ready.",
          isActive: true,
        },
      });
      invalidateNotificationTemplatesCache();

      await notifyUser({
        userId: testUserId,
        notificationType: "LAB_RESULT_READY",
        title: "Fallback Lab Title",
        message: "Fallback Lab Message",
        variables: {
          testName: "CBC (Complete Blood Count)",
          patientName: "Kamran Akmal",
          orderNumber: "LAB-9999",
        },
      });

      const saved = await prisma.notification.findFirst({
        where: {
          userId: testUserId,
          title: "[TEST-TASK-A] Result Ready: CBC (Complete Blood Count)",
        },
        orderBy: { createdAt: "desc" },
      });

      expect(saved).not.toBeNull();
      expect(saved?.message).toBe("Report for Kamran Akmal (Order #LAB-9999) is ready.");
    });

    it("notifyRoles delivers rendered notification to users with specified role", async () => {
      await prisma.notificationTemplate.upsert({
        where: { notificationType: "LOW_STOCK_MEDICINE" },
        update: {
          titleTemplate: "[TEST-TASK-A] Low Stock: {{medicineName}}",
          messageTemplate: "{{medicineName}} batch {{batchNumber}} remaining: {{stockQuantity}} units.",
          isActive: true,
        },
        create: {
          notificationType: "LOW_STOCK_MEDICINE",
          name: "Low Stock Test",
          titleTemplate: "[TEST-TASK-A] Low Stock: {{medicineName}}",
          messageTemplate: "{{medicineName}} batch {{batchNumber}} remaining: {{stockQuantity}} units.",
          isActive: true,
        },
      });
      invalidateNotificationTemplatesCache();

      await notifyRoles(["ADMIN"], {
        notificationType: "LOW_STOCK_MEDICINE",
        title: "Fallback Stock Title",
        message: "Fallback Stock Message",
        variables: {
          medicineName: "Amoxicillin 500mg",
          batchNumber: "AMX-2026-X",
          stockQuantity: 12,
        },
      });

      const saved = await prisma.notification.findFirst({
        where: {
          title: "[TEST-TASK-A] Low Stock: Amoxicillin 500mg",
        },
        orderBy: { createdAt: "desc" },
      });

      expect(saved).not.toBeNull();
      expect(saved?.message).toBe("Amoxicillin 500mg batch AMX-2026-X remaining: 12 units.");
    });
  });

  describe("4. Notification failure resilience: never breaks the caller transaction", () => {
    it("does not throw when prisma.notification.create fails with an error", async () => {
      const spy = jest.spyOn(prisma.notification, "create").mockRejectedValueOnce(
        new Error("Simulated DB connection error or constraint failure on notifications table")
      );

      // Caller performs a business action and triggers notifyUser
      await expect(
        notifyUser({
          userId: testUserId,
          notificationType: "APPOINTMENT_CONFIRMED",
          title: "Title",
          message: "Message",
          variables: { patientName: "Test" },
        })
      ).resolves.not.toThrow();

      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("does not throw when notifyRoles encounters a database or notification failure", async () => {
      const spy = jest.spyOn(prisma.notification, "create").mockRejectedValue(
        new Error("Simulated DB failure for role notification")
      );

      await expect(
        notifyRoles(["ADMIN"], {
          notificationType: "PAYMENT_PENDING",
          title: "Payment Title",
          message: "Payment Message",
          variables: { patientName: "Test" },
        })
      ).resolves.not.toThrow();

      spy.mockRestore();
    });
  });
});
