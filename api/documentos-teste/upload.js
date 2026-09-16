// Vercel does not reliably resolve the nested upload URL through the generic
// catch-all function when custom routes are present. Keep a concrete function
// for this multipart endpoint and reuse the existing Express handlers.
module.exports = require('../../artifacts/agendamento-dac/server.js');