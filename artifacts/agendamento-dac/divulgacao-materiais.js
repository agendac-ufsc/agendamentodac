const { createHmac, timingSafeEqual } = require('node:crypto');

const MAX_MATERIAL_FILES = 10;
const MAX_MATERIAL_FILE_BYTES = 10 * 1024 * 1024;
const MAX_MATERIAL_TOTAL_BYTES = 15 * 1024 * 1024;

const MIME_TYPES_BY_EXTENSION = Object.freeze({
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain'
});

function normalizarIdInscricao(id) {
    const valor = String(id || '').trim();
    return /^\d{1,20}$/.test(valor) ? valor : '';
}

function criarTokenMateriaisDivulgacao(secret, id) {
    const idNormalizado = normalizarIdInscricao(id);
    if (!secret || !idNormalizado) return '';
    return createHmac('sha256', String(secret))
        .update(`dac-divulgacao-materiais:v1:${idNormalizado}`)
        .digest('hex');
}

function validarTokenMateriaisDivulgacao(secret, id, token) {
    const esperado = criarTokenMateriaisDivulgacao(secret, id);
    const valor = String(token || '');
    if (!esperado || !/^[a-f0-9]{64}$/i.test(valor)) return false;
    const esperadoBuffer = Buffer.from(esperado, 'hex');
    const recebidoBuffer = Buffer.from(valor, 'hex');
    return esperadoBuffer.length === recebidoBuffer.length
        && timingSafeEqual(esperadoBuffer, recebidoBuffer);
}

function normalizarMimeType(mimeType) {
    return String(mimeType || '').split(';')[0].trim().toLowerCase();
}

function obterMimeTypeMaterial(nome) {
    const extensao = String(nome || '').toLowerCase().match(/\.[^.]+$/)?.[0] || '';
    return MIME_TYPES_BY_EXTENSION[extensao] || '';
}

function normalizarNomeMaterial(nome) {
    return String(nome || 'material')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/[\\/<>:"|?*]+/g, '_')
        .replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/^\.+/, '')
        .slice(-150) || 'material';
}

function pathnameMaterialDivulgacaoValido(pathname, id) {
    const idNormalizado = normalizarIdInscricao(id);
    const partes = String(pathname || '').split('/');
    return Boolean(idNormalizado)
        && partes.length === 3
        && partes[0] === 'inscricoes'
        && partes[1] === idNormalizado
        && /^[a-f0-9-]{36}-[a-zA-Z0-9._-]{1,150}$/i.test(partes[2]);
}

function validarAssinaturaMaterial(buffer, mimeType) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
    const mime = normalizarMimeType(mimeType);

    if (mime === 'application/pdf') {
        return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    }
    if (mime === 'image/jpeg') {
        return buffer.length >= 3
            && buffer[0] === 0xff
            && buffer[1] === 0xd8
            && buffer[2] === 0xff;
    }
    if (mime === 'image/png') {
        return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (mime === 'image/webp') {
        return buffer.length >= 12
            && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
            && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    }
    if (mime === 'text/plain') {
        return !buffer.includes(0);
    }
    return false;
}

function validarListaMateriais(arquivos, id) {
    if (!Array.isArray(arquivos) || arquivos.length < 1 || arquivos.length > MAX_MATERIAL_FILES) {
        return { valido: false, erro: `Envie de 1 a ${MAX_MATERIAL_FILES} arquivos.` };
    }

    let totalBytes = 0;
    const caminhos = new Set();
    for (const arquivo of arquivos) {
        const nome = String(arquivo?.nome || '').trim();
        const pathname = String(arquivo?.pathname || '');
        const mimeType = normalizarMimeType(arquivo?.mimeType);
        const tamanho = Number(arquivo?.tamanho);
        const mimeEsperado = obterMimeTypeMaterial(nome);

        if (!nome || nome.length > 255 || /[\u0000-\u001f\u007f]/.test(nome)) {
            return { valido: false, erro: 'Um dos nomes de arquivo não é válido.' };
        }
        if (!pathnameMaterialDivulgacaoValido(pathname, id) || caminhos.has(pathname)) {
            return { valido: false, erro: 'O caminho de um dos arquivos não é válido.' };
        }
        if (!mimeEsperado || mimeType !== mimeEsperado) {
            return { valido: false, erro: 'Use arquivos PDF, JPG, PNG, WebP ou TXT.' };
        }
        if (!Number.isSafeInteger(tamanho) || tamanho < 1 || tamanho > MAX_MATERIAL_FILE_BYTES) {
            return { valido: false, erro: 'Cada arquivo pode ter até 10 MB.' };
        }

        caminhos.add(pathname);
        totalBytes += tamanho;
    }

    if (totalBytes > MAX_MATERIAL_TOTAL_BYTES) {
        return { valido: false, erro: 'O tamanho total dos arquivos não pode passar de 15 MB.' };
    }
    return { valido: true, totalBytes };
}

module.exports = {
    MAX_MATERIAL_FILES,
    MAX_MATERIAL_FILE_BYTES,
    MAX_MATERIAL_TOTAL_BYTES,
    normalizarIdInscricao,
    criarTokenMateriaisDivulgacao,
    validarTokenMateriaisDivulgacao,
    normalizarMimeType,
    obterMimeTypeMaterial,
    normalizarNomeMaterial,
    pathnameMaterialDivulgacaoValido,
    validarAssinaturaMaterial,
    validarListaMateriais
};
