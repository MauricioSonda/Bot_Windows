const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validarArchivo } = require('./formatos-archivos');
const { guardarDocumento } = require('./documentos');
const { manejarDocumentos } = require('./flujo-documentos');
const { obtenerRequisitos } = require('./requisitos');
const MENSAJES = require('./mensajes');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
const media = (contenido, filename, mimetype) => ({ data: contenido.toString('base64'), filename, mimetype });

test('Acepta imágenes y PDF reales, verifica su contenido y normaliza la extensión de guardado', async () => {
    const jpeg = fs.readFileSync(obtenerRequisitos('Piso firme').imagen);
    for (const [contenido, nombre, mime, extension] of [
        [png, 'INE.PNG', 'image/png', 'png'], [png, 'foto.png', 'application/octet-stream', 'png'],
        [png, undefined, 'image/png', 'png'], [jpeg, 'foto.JPEG', 'image/jpeg', 'jpg'],
        [pdf, 'documento.PDF', 'application/pdf; charset=binary', 'pdf'],
    ]) {
        const validado = await validarArchivo(media(contenido, nombre, mime));
        assert.equal(validado.extension, extension);
        assert.deepEqual(validado.contenido, contenido);
    }
});

test('Rechaza ejecutables, scripts, ZIP y otros archivos, incluso renombrados como imágenes o PDF', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]);
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200)]);
    const script = Buffer.from('console.log("archivo de prueba");');
    const casos = [
        [exe, 'archivo.exe', 'application/x-msdownload'], [exe, 'archivo.pdf', 'application/pdf'],
        [zip, 'archivo.zip', 'application/zip'], [zip, 'archivo.jpg', 'image/jpeg'], [zip, 'archivo.pdf', 'application/pdf'],
        [script, 'archivo.js', 'text/javascript'], [script, 'archivo.ps1', 'application/octet-stream'],
        [script, 'archivo.bat', 'application/octet-stream'], [script, 'archivo.cmd', 'application/octet-stream'],
        [script, 'archivo.sh', 'text/plain'], [script, 'archivo.pdf', 'application/pdf'],
        [Buffer.from('<svg onload="alert(1)"></svg>'), 'archivo.svg', 'image/svg+xml'],
        [Buffer.from('<svg></svg>'), 'archivo.png', 'image/png'],
        [zip, 'archivo.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        [png, 'foto.jpg.exe', 'image/png'], [png, 'foto.zip', 'image/png'],
        [png, 'foto.jpg', 'image/jpeg'], [png, 'foto.pdf', 'application/pdf'],
        [Buffer.from('contenido no reconocido'), 'foto.png', 'image/png'],
    ];
    for (const [contenido, nombre, mime] of casos)
        await assert.rejects(validarArchivo(media(contenido, nombre, mime)), { code: 'ARCHIVO_NO_PERMITIDO' }, nombre);
});

test('Guarda únicamente contenido aprobado, con extensión canónica y sin sobrescribir páginas', async (t) => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'codesvi-archivos-'));
    t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
    const cliente = { nombreCompleto: 'Persona Prueba', carpetaExpediente: path.join(raiz, 'persona', 'EXP-1') };
    const mensaje = { id: { _serialized: 'm1' }, downloadMedia: async () => media(png, 'original.png', 'image/png') };
    const primero = await guardarDocumento(mensaje, cliente, { id: 'INE' }, { raiz });
    const segundo = await guardarDocumento(mensaje, cliente, { id: 'INE' }, { raiz });
    assert.match(primero.ruta, /INE_Persona_Prueba_01\.png$/);
    assert.match(segundo.ruta, /INE_Persona_Prueba_02\.png$/);
    assert.equal(primero.mimetype, 'image/png');
    assert.deepEqual(fs.readFileSync(primero.ruta), png);
    const antes = fs.readdirSync(cliente.carpetaExpediente);
    await assert.rejects(guardarDocumento({ ...mensaje, downloadMedia: async () => media(Buffer.from('script'), 'falso.pdf', 'application/pdf') }, cliente, { id: 'INE' }, { raiz }), { code: 'ARCHIVO_NO_PERMITIDO' });
    assert.deepEqual(fs.readdirSync(cliente.carpetaExpediente), antes);
});

test('Un archivo rechazado no crea carpetas, no modifica el JSON y no permite avanzar con siguiente', async (t) => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'codesvi-rechazados-'));
    t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
    const cliente = { nombreCompleto: 'Persona Prueba', estado: 'esperando_documento', indiceDocumento: 0,
        documentos: {}, requisitos: [{ id: 'INE', nombre: 'INE' }], carpetaExpediente: path.join(raiz, 'EXP-1') };
    const antes = JSON.stringify(cliente), respuestas = [];
    let actualizaciones = 0;
    const actualizar = () => { actualizaciones += 1; };
    const mensaje = { from: '123@c.us', type: 'document', hasMedia: true, body: '', id: { _serialized: 'm1' },
        downloadMedia: async () => media(Buffer.from('MZ archivo de prueba'), 'adjunto.pdf', 'application/pdf'),
        reply: async (texto) => respuestas.push(texto) };
    assert.equal(await manejarDocumentos(mensaje, cliente, actualizar), true);
    assert.equal(respuestas.at(-1), MENSAJES.ARCHIVO_NO_PERMITIDO);
    assert.equal(fs.existsSync(cliente.carpetaExpediente), false);
    await manejarDocumentos({ ...mensaje, type: 'chat', body: 'siguiente', hasMedia: false }, cliente, actualizar);
    assert.equal(respuestas.at(-1), MENSAJES.FALTA_ARCHIVO);
    assert.equal(JSON.stringify(cliente), antes);
    assert.equal(actualizaciones, 0);
});
