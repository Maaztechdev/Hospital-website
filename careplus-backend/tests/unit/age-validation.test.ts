import { createPatientSchema } from "../../src/modules/patients/patients.validators";
import { publicAppointmentSchema as publicAppointmentSchemaFromModule } from "../../src/modules/appointments/appointments.validators";

describe("age validation", () => {
  it("accepts a valid age and rejects invalid values", () => {
    const validPatient = createPatientSchema.parse({
      firstName: "Ali",
      lastName: "Hassan",
      age: 36,
      gender: "MALE",
      phone: "03001234567",
    });

    expect(validPatient.age).toBe(36);

    expect(() => createPatientSchema.parse({
      firstName: "Ali",
      lastName: "Hassan",
      age: -1,
      gender: "MALE",
      phone: "03001234567",
    })).toThrow();

    expect(() => createPatientSchema.parse({
      firstName: "Ali",
      lastName: "Hassan",
      age: 999,
      gender: "MALE",
      phone: "03001234567",
    })).toThrow();
  });

  it("requires a valid age for public booking requests", () => {
    expect(() => publicAppointmentSchemaFromModule.parse({
      fullName: "Ali Hassan",
      phone: "+923001234567",
      age: "abc",
      doctorId: "123e4567-e89b-12d3-a456-426614174000",
      departmentId: "123e4567-e89b-12d3-a456-426614174001",
      appointmentDate: "2026-09-18",
      timeSlot: "09:30",
    })).toThrow();

    expect(() => publicAppointmentSchemaFromModule.parse({
      fullName: "Ali Hassan",
      phone: "+923001234567",
      age: 150,
      doctorId: "123e4567-e89b-12d3-a456-426614174000",
      departmentId: "123e4567-e89b-12d3-a456-426614174001",
      appointmentDate: "2026-09-18",
      timeSlot: "09:30",
    })).toThrow();
  });
});
