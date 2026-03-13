import { useState } from 'react';
import { Calendar, Clock, User, Mail, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

export default function Scheduling() {
  const [step, setStep] = useState<'form' | 'calendar' | 'time' | 'success'>('form');
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
  });
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [appointmentId, setAppointmentId] = useState<number | null>(null);

  // Mutation para criar agendamento
  const createAppointmentMutation = trpc.appointments.create.useMutation({
    onSuccess: (data) => {
      setAppointmentId(data.appointmentId);
      setStep('success');
      toast.success('Agendamento criado com sucesso!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao criar agendamento');
      setIsLoading(false);
    },
  });

  // Query para obter horários disponíveis
  const { data: availableSlots, isLoading: slotsLoading } = trpc.appointments.getAvailableSlots.useQuery(
    { date: selectedDate },
    { enabled: !!selectedDate }
  );

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.phone) {
      toast.error('Preencha todos os campos');
      return;
    }
    setStep('calendar');
  };

  const handleDateSelect = (date: string) => {
    setSelectedDate(date);
    setStep('time');
  };

  const handleTimeSelect = (time: string) => {
    setSelectedTime(time);
    handleCreateAppointment(time);
  };

  const handleCreateAppointment = async (time: string) => {
    setIsLoading(true);
    try {
      await createAppointmentMutation.mutateAsync({
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        appointmentDate: selectedDate,
        appointmentTime: time,
        googleFormsLink: process.env.VITE_GOOGLE_FORMS_LINK,
      });
    } catch (error) {
      console.error('Error creating appointment:', error);
    }
  };

  // Gera datas disponíveis (próximos 30 dias)
  const generateAvailableDates = () => {
    const dates = [];
    const today = new Date();
    for (let i = 1; i <= 30; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      if (date.getDay() !== 0 && date.getDay() !== 6) { // Exclui domingos e sábados
        dates.push(date.toISOString().split('T')[0]);
      }
    }
    return dates;
  };

  const availableDates = generateAvailableDates();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Agendamento</h1>
          <p className="text-slate-600">Sistema de Agendamento em Duas Etapas</p>
        </div>

        {/* Step 1: Form */}
        {step === 'form' && (
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                Informações Pessoais
              </CardTitle>
              <CardDescription>Preencha seus dados para continuar</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleFormSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
                  <Input
                    type="text"
                    placeholder="Seu nome completo"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">E-mail</label>
                  <Input
                    type="email"
                    placeholder="seu@email.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Telefone</label>
                  <Input
                    type="tel"
                    placeholder="(11) 99999-9999"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full"
                  />
                </div>
                <Button type="submit" className="w-full">
                  Próximo: Selecionar Data
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Calendar */}
        {step === 'calendar' && (
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                Selecione uma Data
              </CardTitle>
              <CardDescription>Escolha um dia disponível</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {availableDates.map((date) => (
                  <Button
                    key={date}
                    variant={selectedDate === date ? 'default' : 'outline'}
                    onClick={() => handleDateSelect(date)}
                    className="text-sm"
                  >
                    {new Date(date).toLocaleDateString('pt-BR', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </Button>
                ))}
              </div>
              <Button
                variant="ghost"
                onClick={() => setStep('form')}
                className="w-full mt-4"
              >
                Voltar
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Time */}
        {step === 'time' && (
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5" />
                Selecione um Horário
              </CardTitle>
              <CardDescription>
                Data selecionada: {new Date(selectedDate).toLocaleDateString('pt-BR')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {slotsLoading ? (
                <div className="text-center py-8">Carregando horários...</div>
              ) : availableSlots && availableSlots.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {availableSlots.map((slot) => (
                    <Button
                      key={`${slot.date}-${slot.startTime}`}
                      variant="outline"
                      onClick={() => handleTimeSelect(slot.startTime)}
                      disabled={slot.currentAppointments >= slot.maxAppointments}
                      className="text-sm"
                    >
                      {slot.startTime}
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-600">
                  Nenhum horário disponível para esta data
                </div>
              )}
              <Button
                variant="ghost"
                onClick={() => setStep('calendar')}
                className="w-full mt-4"
              >
                Voltar
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Success */}
        {step === 'success' && (
          <Card className="shadow-lg border-green-200 bg-green-50">
            <CardHeader>
              <CardTitle className="text-green-700">✓ Agendamento Confirmado!</CardTitle>
              <CardDescription>Sua solicitação foi recebida com sucesso</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-white p-4 rounded-lg border border-green-200">
                <p className="text-sm text-slate-600 mb-2">
                  <strong>Nome:</strong> {formData.name}
                </p>
                <p className="text-sm text-slate-600 mb-2">
                  <strong>E-mail:</strong> {formData.email}
                </p>
                <p className="text-sm text-slate-600 mb-2">
                  <strong>Data:</strong> {new Date(selectedDate).toLocaleDateString('pt-BR')}
                </p>
                <p className="text-sm text-slate-600">
                  <strong>Horário:</strong> {selectedTime}
                </p>
              </div>
              <p className="text-sm text-slate-600">
                Um e-mail de confirmação foi enviado para <strong>{formData.email}</strong>
              </p>
              {process.env.VITE_GOOGLE_FORMS_LINK && (
                <div className="pt-4 border-t border-green-200">
                  <p className="text-sm text-slate-600 mb-3">
                    Próximo passo: Complete o formulário da segunda etapa
                  </p>
                  <a
                    href={process.env.VITE_GOOGLE_FORMS_LINK}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block w-full"
                  >
                    <Button className="w-full bg-blue-600 hover:bg-blue-700">
                      Ir para Formulário da Etapa 2
                    </Button>
                  </a>
                </div>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  setStep('form');
                  setFormData({ name: '', email: '', phone: '' });
                  setSelectedDate('');
                  setSelectedTime('');
                }}
                className="w-full"
              >
                Fazer Novo Agendamento
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
