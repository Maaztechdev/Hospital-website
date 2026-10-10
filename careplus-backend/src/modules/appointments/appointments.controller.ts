import { Request, Response } from "express";
import { asyncHandler } from "@common/utils/asyncHandler";
import { sendSuccess, paginationMeta } from "@common/utils/apiResponse";
import { getPageParams } from "@common/utils/pagination";
import { UnauthorizedError } from "@common/errors/AppError";
import { appointmentsService, serializeAppointmentDateFields } from "./appointments.service";

async function serializeAppointment<T extends { id: string }>(appointment: T) {
  const [serialized] = await serializeAppointmentDateFields([appointment]);
  return serialized;
}

export const appointmentsController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = getPageParams(req);
    const { date, doctorId, departmentId, status } = req.query as Record<string, string | undefined>;
    const sort = req.query.sort === "recentlyCreated" ? "recentlyCreated" : "date";
    if (!req.user) throw new UnauthorizedError();
    const { items, total } = await appointmentsService.list(req.user, { ...page, date, doctorId, departmentId, status, sort });
    sendSuccess(res, 200, { data: await serializeAppointmentDateFields(items), pagination: paginationMeta(page.page, page.limit, total) });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const appt = await appointmentsService.getById(req.user, req.params.id);
    sendSuccess(res, 200, { data: await serializeAppointment(appt) });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const appt = await appointmentsService.create(req.user, req.body, req);
    sendSuccess(res, 201, { data: await serializeAppointment(appt), message: "Appointment created" });
  }),

  createPublic: asyncHandler(async (req: Request, res: Response) => {
    const appt = await appointmentsService.createPublic(req.body, req);
    sendSuccess(res, 201, { data: await serializeAppointment(appt), message: "Appointment requested" });
  }),

  approve: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const appt = await appointmentsService.approve(req.user, req.params.id, req);
    sendSuccess(res, 200, { data: await serializeAppointment(appt), message: "Appointment approved" });
  }),

  reject: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const appt = await appointmentsService.reject(req.user, req.params.id, req.body.rejectionReason, req);
    sendSuccess(res, 200, { data: await serializeAppointment(appt), message: "Appointment rejected" });
  }),

  reschedule: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const appt = await appointmentsService.reschedule(req.user, req.params.id, req.body.appointmentDate, req.body.timeSlot, req);
    sendSuccess(res, 200, { data: await serializeAppointment(appt), message: "Appointment rescheduled" });
  }),

  cancel: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const appt = await appointmentsService.cancel(req.user, req.params.id, req.body.reason, req);
    sendSuccess(res, 200, { data: await serializeAppointment(appt), message: "Appointment cancelled" });
  }),

  markDone: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const appt = await appointmentsService.markDone(req.user, req.params.id, req);
    sendSuccess(res, 200, { data: await serializeAppointment(appt), message: "Appointment marked done" });
  }),

  markNoShow: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const appt = await appointmentsService.markNoShow(req.user, req.params.id, req);
    sendSuccess(res, 200, { data: await serializeAppointment(appt), message: "Appointment marked no-show" });
  }),

  // OPD queue endpoints
  opdQueue: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const queue = await appointmentsService.opdQueue(req.user, req.query.date as string | undefined);
    sendSuccess(res, 200, { data: await serializeAppointmentDateFields(queue) });
  }),

  callNext: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const appt = await appointmentsService.callNext(req.user, req.params.doctorId, req);
    sendSuccess(res, 200, { data: await serializeAppointment(appt), message: "Next patient called" });
  }),

  startConsultation: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const appt = await appointmentsService.startConsultation(req.user, req.params.id, req);
    sendSuccess(res, 200, { data: await serializeAppointment(appt), message: "Consultation started" });
  }),

  requeue: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const appt = await appointmentsService.requeue(req.user, req.params.id, req);
    sendSuccess(res, 200, { data: await serializeAppointment(appt), message: "Patient requeued" });
  }),

  getAvailableSlots: asyncHandler(async (req: Request, res: Response) => {
    const { doctorId } = req.params;
    const { date } = req.query as Record<string, string | undefined>;
    if (!date) throw new UnauthorizedError("Date is required");
    const slots = await appointmentsService.getAvailableSlots(doctorId, date);
    sendSuccess(res, 200, { data: slots });
  }),
};
