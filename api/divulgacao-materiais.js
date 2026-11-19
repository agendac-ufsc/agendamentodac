// Preserve multipart/client-upload request bodies for the private Blob upload
// flow, then reuse the Express handlers and validation in the main app.
module.exports = require('../artifacts/agendamento-dac/server.js');
module.exports.config = {
    api: {
        bodyParser: false
    }
};
