import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

/**
 * Envia um e-mail genérico via Resend
 */
export async function sendEmail({ to, subject, html, from = 'noreply@agendamento.com' }: SendEmailParams) {
  try {
    const response = await resend.emails.send({
      from,
      to,
      subject,
      html,
    });

    if (response.error) {
      console.error('[Email] Error sending email:', response.error);
      throw new Error(`Failed to send email: ${response.error.message}`);
    }

    console.log('[Email] Email sent successfully:', response.data);
    return response.data;
  } catch (error) {
    console.error('[Email] Error:', error);
    throw error;
  }
}

/**
 * Envia e-mail de confirmação de agendamento para o cliente
 */
export async function sendConfirmationEmailToClient(
  clientEmail: string,
  clientName: string,
  appointmentDate: Date,
  appointmentTime: string,
  formLink?: string
) {
  const formattedDate = appointmentDate.toLocaleDateString('pt-BR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Agendamento Confirmado! 🎉</h2>
      <p>Olá <strong>${clientName}</strong>,</p>
      <p>Seu agendamento foi confirmado com sucesso!</p>
      
      <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="color: #333; margin-top: 0;">Detalhes do Agendamento</h3>
        <p><strong>Data:</strong> ${formattedDate}</p>
        <p><strong>Horário:</strong> ${appointmentTime}</p>
      </div>

      ${formLink ? `
        <div style="margin: 20px 0;">
          <p>Próximo passo: Complete o formulário da segunda etapa clicando no botão abaixo.</p>
          <a href="${formLink}" style="display: inline-block; background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">
            Ir para Formulário
          </a>
        </div>
      ` : ''}

      <p style="color: #666; font-size: 14px; margin-top: 30px;">
        Se você tiver dúvidas, entre em contato conosco.
      </p>
      
      <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
      <p style="color: #999; font-size: 12px;">
        Este é um e-mail automático. Não responda diretamente.
      </p>
    </div>
  `;

  return sendEmail({
    to: clientEmail,
    subject: `Agendamento Confirmado - ${formattedDate}`,
    html,
  });
}

/**
 * Envia e-mail de notificação para o administrador
 */
export async function sendNotificationEmailToAdmin(
  adminEmail: string,
  clientName: string,
  clientEmail: string,
  clientPhone: string,
  appointmentDate: Date,
  appointmentTime: string
) {
  const formattedDate = appointmentDate.toLocaleDateString('pt-BR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Novo Agendamento Recebido 📅</h2>
      
      <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="color: #333; margin-top: 0;">Informações do Cliente</h3>
        <p><strong>Nome:</strong> ${clientName}</p>
        <p><strong>E-mail:</strong> ${clientEmail}</p>
        <p><strong>Telefone:</strong> ${clientPhone}</p>
        
        <h3 style="color: #333; margin-top: 20px;">Detalhes do Agendamento</h3>
        <p><strong>Data:</strong> ${formattedDate}</p>
        <p><strong>Horário:</strong> ${appointmentTime}</p>
      </div>

      <p style="color: #666; font-size: 14px; margin-top: 30px;">
        Você pode acompanhar todos os agendamentos no painel administrativo.
      </p>
      
      <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
      <p style="color: #999; font-size: 12px;">
        Este é um e-mail automático. Não responda diretamente.
      </p>
    </div>
  `;

  return sendEmail({
    to: adminEmail,
    subject: `Novo Agendamento - ${clientName}`,
    html,
  });
}
