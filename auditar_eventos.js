const { google } = require('googleapis');

const CALENDAR_IDS = {
  teatro: 'oto.bezerra@ufsc.br',
  igrejinha: process.env.IGREJINHA_CALENDAR_ID || 'c_e19d30c40d4de176bc7d4e11ada96bfaffd130b3ed499d9807c88785e2c71c05@group.calendar.google.com',
};
const PADRAO = /^(Ensaio|Montagem|Evento|Desmontagem)( \d+)?: (.+)$/;

(async () => {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: creds.client_email, private_key: creds.private_key },
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  const authClient = await auth.getClient();
  const calendar = google.calendar({ version: 'v3' });

  for (const [nomeCal, id] of Object.entries(CALENDAR_IDS)) {
    let pageToken = undefined;
    const todos = [];
    do {
      const r = await calendar.events.list({
        auth: authClient, calendarId: id, maxResults: 2500, singleEvents: true,
        showDeleted: true, pageToken,
      });
      todos.push(...r.data.items);
      pageToken = r.data.nextPageToken;
    } while (pageToken);

    // Filtra só os que batem com o padrão do sistema
    const sistema = todos.filter(e => e.summary && PADRAO.test(e.summary));
    const grupos = {};
    for (const e of sistema) {
      const m = e.summary.match(PADRAO);
      const eventoNome = m[3];
      const tipo = m[1]; // Ensaio/Montagem/Evento/Desmontagem
      const data = (e.start?.date || e.start?.dateTime || '').slice(0, 10);
      const proponente = (e.description || '').match(/Proponente:\s*([^\n]+)/i)?.[1]
        || (e.description || '').match(/Responsável:\s*([^\n]+)/i)?.[1]
        || (e.description || '').match(/Email[a-z]*:\s*([^\s\n]+)/i)?.[1]
        || (e.description || '').split('\n')[0]?.slice(0, 60) || '?';
      if (!grupos[eventoNome]) grupos[eventoNome] = { proponentes: new Set(), dates: { confirmed: [], cancelled: [] } };
      grupos[eventoNome].proponentes.add(proponente);
      grupos[eventoNome].dates[e.status === 'confirmed' ? 'confirmed' : 'cancelled'].push({ tipo, data, id: e.id });
    }

    // Filtra os "preocupantes": eventos que tem PELO MENOS UMA cancelled-and-not-restored
    const preocupantes = Object.entries(grupos)
      .filter(([_, g]) => g.dates.cancelled.length > 0)
      // remove os que já foram completamente desfeitos (todas as datas canceladas, sem nenhuma confirmada) — esses provavelmente foram cancelados intencionalmente, não são vítimas do incidente
      .map(([nome, g]) => ({
        nome,
        proponentes: [...g.proponentes],
        confirmed: g.dates.confirmed,
        cancelled: g.dates.cancelled,
        completamente_cancelado: g.dates.confirmed.length === 0,
      }));

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`CALENDÁRIO: ${nomeCal.toUpperCase()}`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`Total eventos do sistema: ${sistema.length} (${sistema.filter(e=>e.status==='confirmed').length} ativos, ${sistema.filter(e=>e.status==='cancelled').length} cancelados)`);
    console.log(`Grupos (eventos distintos): ${Object.keys(grupos).length}`);
    console.log(`Grupos com pelo menos 1 data cancelada: ${preocupantes.length}`);

    // Categoria 1: parcialmente impactados (alguns confirmed + alguns cancelled)
    const parciais = preocupantes.filter(p => !p.completamente_cancelado);
    console.log(`\n🟡 PARCIALMENTE IMPACTADOS (${parciais.length} eventos): tem datas vivas E datas que sumiram`);
    parciais.forEach(p => {
      const datasSumiram = p.cancelled.map(c => `${c.tipo} ${c.data}`).sort();
      console.log(`  • "${p.nome}"`);
      console.log(`     proponente(s): ${p.proponentes.slice(0,2).join(', ')}`);
      console.log(`     Datas sumidas: ${datasSumiram.join(' | ')}`);
    });

    // Categoria 2: totalmente cancelados (todas as datas canceladas, nenhuma viva)
    const totais = preocupantes.filter(p => p.completamente_cancelado);
    console.log(`\n🔴 TOTALMENTE SUMIDOS (${totais.length} eventos): todas as datas canceladas, nenhuma voltou`);
    totais.slice(0, 30).forEach(p => {
      const datas = p.cancelled.map(c => `${c.tipo} ${c.data}`).sort();
      console.log(`  • "${p.nome}" (${p.proponentes.slice(0,2).join(', ')})`);
      console.log(`     Datas: ${datas.join(' | ')}`);
    });
    if (totais.length > 30) console.log(`     ... e mais ${totais.length - 30}`);
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
