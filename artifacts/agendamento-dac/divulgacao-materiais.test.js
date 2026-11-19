const test = require('node:test');
const assert = require('node:assert/strict');
const {
    MAX_MATERIAL_FILE_BYTES,
    MAX_MATERIAL_TOTAL_BYTES,
    criarTokenMateriaisDivulgacao,
    validarTokenMateriaisDivulgacao,
    normalizarNomeMaterial,
    pathnameMaterialDivulgacaoValido,
    validarAssinaturaMaterial,
    validarListaMateriais
} = require('./divulgacao-materiais');

const id = '1795009322497';
const pathname = `inscricoes/${id}/123e4567-e89b-12d3-a456-426614174000-release.pdf`;

test('materiais token only authorizes the matching registration and secret', () => {
    const token = criarTokenMateriaisDivulgacao('secret-for-test', id);
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal(validarTokenMateriaisDivulgacao('secret-for-test', id, token), true);
    assert.equal(validarTokenMateriaisDivulgacao('secret-for-test', '1795009322498', token), false);
    assert.equal(validarTokenMateriaisDivulgacao('different-secret', id, token), false);
    assert.equal(validarTokenMateriaisDivulgacao('', id, token), false);
    assert.equal(criarTokenMateriaisDivulgacao('secret-for-test', '../other'), '');
});

test('material paths are restricted to the registration and safe generated filenames', () => {
    assert.equal(pathnameMaterialDivulgacaoValido(pathname, id), true);
    assert.equal(pathnameMaterialDivulgacaoValido(`inscricoes/other/${pathname.split('/')[2]}`, id), false);
    assert.equal(pathnameMaterialDivulgacaoValido(`inscricoes/${id}/../release.pdf`, id), false);
    assert.equal(pathnameMaterialDivulgacaoValido(`inscricoes/${id}/folder/release.pdf`, id), false);
    assert.equal(normalizarNomeMaterial('Foto de divulgação.png'), 'Foto_de_divulgacao.png');
});

test('material metadata requires allowed types, a safe path and bounded size', () => {
    const arquivo = { pathname, nome: 'release.pdf', mimeType: 'application/pdf', tamanho: 1024 };
    assert.deepEqual(validarListaMateriais([arquivo], id), { valido: true, totalBytes: 1024 });
    assert.equal(validarListaMateriais([], id).valido, false);
    assert.equal(validarListaMateriais([{ ...arquivo, nome: 'script.html', mimeType: 'text/html' }], id).valido, false);
    assert.equal(validarListaMateriais([{ ...arquivo, tamanho: MAX_MATERIAL_FILE_BYTES + 1 }], id).valido, false);
    assert.equal(validarListaMateriais([{ ...arquivo, pathname: 'inscricoes/other/file.pdf' }], id).valido, false);

    const twoLargeFiles = [
        { ...arquivo, tamanho: MAX_MATERIAL_FILE_BYTES },
        { ...arquivo, pathname: `inscricoes/${id}/123e4567-e89b-12d3-a456-426614174001-release.pdf`, tamanho: MAX_MATERIAL_FILE_BYTES }
    ];
    assert.ok(twoLargeFiles.reduce((total, item) => total + item.tamanho, 0) > MAX_MATERIAL_TOTAL_BYTES);
    assert.equal(validarListaMateriais(twoLargeFiles, id).valido, false);
});

test('uploaded bytes must match the declared file type before email forwarding', () => {
    assert.equal(validarAssinaturaMaterial(Buffer.from('%PDF-1.7'), 'application/pdf'), true);
    assert.equal(validarAssinaturaMaterial(Buffer.from('<html>bad</html>'), 'application/pdf'), false);
    assert.equal(validarAssinaturaMaterial(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg'), true);
    assert.equal(validarAssinaturaMaterial(Buffer.from('plain text'), 'text/plain'), true);
    assert.equal(validarAssinaturaMaterial(Buffer.from([0x00, 0x01]), 'text/plain'), false);
});
