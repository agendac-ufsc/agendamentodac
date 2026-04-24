require('dotenv').config();
const { google } = require('googleapis');

const CALENDAR_ID = 'oto.bezerra@ufsc.br';
const SUMMARY = 'ensaio do grupo Não Precisa Ser Forte';

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

  console.log('Etapa 1: removendo eventos antigos com o mesmo título...');
  const list = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: '2026-01-01T00:00:00-03:00',
    timeMax: '2026-12-31T23:59:59-03:00',
    singleEvents: true,
    maxResults: 2500,
    q: 'Não Precisa Ser Forte',
  });
  const antigos = (list.data.items || []).filter(e => (e.summary || '').trim() === SUMMARY);
  console.log(`Encontrados ${antigos.length} eventos antigos para remover.`);
  for (const e of antigos) {
    try {
      await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: e.id });
      console.log(`🗑️  removido ${e.start.dateTime || e.start.date}`);
    } catch (err) {
      console.error(`❌ falha ao remover ${e.id}: ${err.message}`);
    }
  }

  console.log('\nEtapa 2: recriando eventos sem dados pessoais...');
  const resultados = [];
  for (const data of datas) {
    try {
      const resp = await calendar.events.insert({
        calendarId: CALENDAR_ID,
        resource: {
          summary: SUMMARY,
          start: { dateTime: `${data}T${HORARIO_INICIO}:00-03:00`, timeZone: 'America/Sao_Paulo' },
          end:   { dateTime: `${data}T${HORARIO_FIM}:00-03:00`,   timeZone: 'America/Sao_Paulo' },
        },
      });
      console.log(`✅ ${data} ${HORARIO_INICIO}-${HORARIO_FIM} → id=${resp.data.id}`);
      resultados.push({ data, ok: true });
    } catch (e) {
      console.error(`❌ ${data} → ${e.message}`);
      resultados.push({ data, ok: false, erro: e.message });
    }
  }
  const ok = resultados.filter(r => r.ok).length;
  console.log(`\nTotal: ${ok}/${datas.length} eventos criados.`);
})();
