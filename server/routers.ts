import { z } from 'zod';
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { createAppointment, getAvailableSlots, updateAppointmentStatus } from "./db";
import { createGoogleCalendarEvent } from "./services/googleCalendar";
import { sendConfirmationEmailToClient, sendNotificationEmailToAdmin } from "./services/email";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req as any);
      (ctx.res as any).clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  appointments: router({
    // Obter horários disponíveis para uma data específica
    getAvailableSlots: publicProcedure
      .input(z.object({ date: z.string() }))
      .query(async ({ input }) => {
        return await getAvailableSlots(input.date);
      }),

    // Criar um novo agendamento
    create: publicProcedure
      .input(
        z.object({
          name: z.string().min(1, 'Nome é obrigatório'),
          email: z.string().email('E-mail inválido'),
          phone: z.string().min(1, 'Telefone é obrigatório'),
          appointmentDate: z.string(), // YYYY-MM-DD
          startTime: z.string(), // HH:mm
          endTime: z.string(), // HH:mm
          googleFormsLink: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          // Combina data e hora
          const startDateTime = new Date(`${input.appointmentDate}T${input.startTime}:00`);
          const endDateTime = new Date(`${input.appointmentDate}T${input.endTime}:00`);

          // Cria o agendamento no banco de dados
          const appointment = await createAppointment({
            userId: ctx.user?.id || 1, // Fallback para usuário padrão se não autenticado
            name: input.name,
            email: input.email,
            phone: input.phone,
            appointmentDate: startDateTime,
            status: 'pending',
          });

          if (!appointment) {
            throw new Error('Failed to create appointment in database');
          }

          // Cria evento no Google Calendar
          let googleCalendarEventId: string | undefined;
          try {
            const calendarEvent = await createGoogleCalendarEvent(
              `Agendamento - ${input.name}`,
              `Agendamento confirmado para ${input.name}\nE-mail: ${input.email}\nTelefone: ${input.phone}\nPeríodo: ${input.startTime} às ${input.endTime}`,
              startDateTime,
              endDateTime,
              input.email
            );
            googleCalendarEventId = calendarEvent.eventId;
          } catch (error) {
            console.warn('[Appointment] Failed to create Google Calendar event:', error);
            // Continua mesmo se o Google Calendar falhar
          }

          // Atualiza o agendamento com o ID do evento do Google Calendar
          if (googleCalendarEventId) {
            await updateAppointmentStatus(appointment.id, 'confirmed', googleCalendarEventId);
          }

          // Envia e-mail de confirmação para o cliente
          try {
            await sendConfirmationEmailToClient(
              input.email,
              input.name,
              startDateTime,
              `${input.startTime} às ${input.endTime}`,
              input.googleFormsLink
            );
          } catch (error) {
            console.warn('[Appointment] Failed to send confirmation email to client:', error);
          }

          // Envia e-mail de notificação para o administrador
          try {
            const adminEmail = process.env.ADMIN_EMAIL || 'admin@agendamento.com';
            await sendNotificationEmailToAdmin(
              adminEmail,
              input.name,
              input.email,
              input.phone,
              startDateTime,
              `${input.startTime} às ${input.endTime}`
            );
          } catch (error) {
            console.warn('[Appointment] Failed to send notification email to admin:', error);
          }

          return {
            success: true,
            appointmentId: appointment.id,
            message: 'Agendamento criado com sucesso!',
          };
        } catch (error) {
          console.error('[Appointment] Error creating appointment:', error);
          throw new Error('Falha ao criar agendamento. Tente novamente.');
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
