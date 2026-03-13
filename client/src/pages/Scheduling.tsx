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
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
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
    if (!startTime) {
      setStartTime(time);
    } else if (!endTime) {
      // Validar se o horário de saída é posterior ao de entrada
      if (time <= startTime) {
        toast.error('O horário de saída deve ser posterior ao de entrada');
        return;
      }
      setEndTime(time);
    } else {
      // Resetar e começar de novo se já tiver ambos selecionados
      setStartTime(time);
      setEndTime('');
    }
  };

  const handleCreateAppointment = async () => {
    if (!startTime || !endTime) {
      toast.error('Selecione os horários de entrada e saída');
      return;
    }

    setIsLoading(true);
    try {
      await createAppointmentMutation.mutateAsync({
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        appointmentDate: selectedDate,
        startTime: startTime,
        endTime: endTime,
        googleFormsLink: process.env.VITE_GOOGLE_FORMS_LINK,
      });
    } catch (error) {
      console.error('Error creating appointment:', error);
    }
  };

  // Gera horários de 30 em 30 minutos das 08:00 às 22:00
  const generateTimeSlots = () => {
    const slots = [];
    for (let hour = 8; hour <= 22; hour++) {
      const h = hour.toString().padStart(2, '0');
      slots.push(`${h}:00`);
      if (hour < 22) {
        slots.push(`${h}:30`);
      }
    }
    return slots;
  };

  const timeSlots = generateTimeSlots();

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
                Selecione os Horários
              </CardTitle>
              <CardDescription>
                Data: {new Date(selectedDate).toLocaleDateString('pt-BR')}
                <br />
                {!startTime ? 'Selecione o horário de entrada' : !endTime ? 'Selecione o horário de saída' : 'Horários selecionados'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-6">
                {timeSlots.map((time) => (
                  <Button
                    key={time}
                    variant={startTime === time || endTime === time ? 'default' : 'outline'}
                    onClick={() => handleTimeSelect(time)}
                    className={`text-xs ${startTime === time ? 'bg-blue-600' : endTime === time ? 'bg-green-600' : ''}`}
                  >
                    {time}
                  </Button>
                ))}
              </div>

              <div className="bg-slate-50 p-4 rounded-lg mb-4 border border-slate-200">
                <div className="flex justify-between text-sm">
                  <span><strong>Entrada:</strong> {startTime || '--:--'}</span>
                  <span><strong>Saída:</strong> {endTime || '--:--'}</span>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setStep('calendar');
                    setStartTime('');
                    setEndTime('');
                  }}
                  className="flex-1"
                >
                  Voltar
                </Button>
                <Button
                  onClick={handleCreateAppointment}
                  disabled={!startTime || !endTime || isLoading}
                  className="flex-1"
                >
                  {isLoading ? 'Processando...' : 'Confirmar'}
                </Button>
              </div>
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
                  <strong>Período:</strong> {startTime} às {endTime}
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
                  setStartTime('');
                  setEndTime('');
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
