require('dotenv').config();
const { google } = require('googleapis');

const CALENDAR_ID = 'oto.bezerra@ufsc.br';
const SUMMARY = 'ensaio do grupo Não Precisa Ser Forte';
const DESCRIPTION = 'Ensaio do grupo #NPSF: Entre a Terra e o Céu, No Meio do Caminho.\nProjeto de Extensão "Diálogos Artísticos em Cena" — DAC/UFSC.\nResponsável: THUANNY (producao.thuanny@gmail.com / 48 99609-7663).\nAgendado automaticamente a partir do Termo de Participação.';

const datas = [
  '2026-02-06', '2026-02-11', '2026-02-27',
  '2026-03-05', '2026-03-06', '2026-03-26',
  '2026-04-02', '2026-04-10', '2026-04-17', '2026-04-24',
  '2026-05-08', '2026-05-15', '2026-05-22',
  '2026-06-12', '2026-06-19', '2026-06-26',
  '2026-07-03', '2026-07-10', '2026-07-17',
];

const HORARIO_INICIO = '09:30';
const HORARIO_FIM = '12:30';

(async () => {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: credentials.client_email, private_key: credentials.private_key },
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  const authClient = await auth.getClient();
  const calendar = google.calendar({ version: 'v3', auth: authClient });

  const resultados = [];
  for (const data of datas) {
    try {
      const resp = await calendar.events.insert({
        calendarId: CALENDAR_ID,
        resource: {
          summary: SUMMARY,
          description: DESCRIPTION,
          start: { dateTime: `${data}T${HORARIO_INICIO}:00-03:00`, timeZone: 'America/Sao_Paulo' },
          end:   { dateTime: `${data}T${HORARIO_FIM}:00-03:00`,   timeZone: 'America/Sao_Paulo' },
        },
      });
      console.log(`✅ ${data} ${HORARIO_INICIO}-${HORARIO_FIM} → id=${resp.data.id}`);
      resultados.push({ data, ok: true, id: resp.data.id });
    } catch (e) {
      console.error(`❌ ${data} → ${e.message}`);
      resultados.push({ data, ok: false, erro: e.message });
    }
  }
  const ok = resultados.filter(r => r.ok).length;
  console.log(`\nTotal: ${ok}/${datas.length} eventos criados.`);
})();
