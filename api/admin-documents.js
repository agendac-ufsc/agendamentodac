// Keep nested document-management URLs on a concrete Vercel function.
// The generic catch-all function is not reliably selected when custom routes
// are present, while the Express app already owns the complete API logic.
module.exports = require('../artifacts/agendamento-dac/server.js');