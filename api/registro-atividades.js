// Keep the activity-record API, including its nested document URLs, on a
// concrete Vercel function instead of relying on the generic catch-all.
module.exports = require('../artifacts/agendamento-dac/server.js');