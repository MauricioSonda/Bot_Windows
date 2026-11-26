const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { obtenerRequisitos } = require('./requisitos');
const { FORMATO_SOLICITUD } = require('./configuracion');
const { guardarDocumento } = require('./documentos');
const { resumirDocumentos } = require('./estado-documentos');

function preparar(t, { fallarFormato = false } = {}) {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'codesvi-solicitud-'));
    t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
    const modulo = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'flujo-documentos.js'), 'utf8'), {
        module: modulo,
        require: (nombre) => {
            if (nombre === './index') return { MessageMedia: { fromFilePath: (archivo) => {
                if (fallarFormato && archivo === FORMATO_SOLICITUD) throw new Error('PDF no disponible');
                return { filename: path.basename(archivo), data: fs.readFileSync(archivo).toString('base64') };
            } } };
            if (nombre === './documentos') return {
                crearExpediente: () => ({ expedienteId: 'EXP-TEST', carpetaExpediente: path.join(raiz, 'EXP-TEST') }),
                guardarDocumento: (mensaje, cliente, requisito, opciones) => guardarDocumento(mensaje, cliente, requisito, { ...opciones, raiz }),
            };
            return require(nombre);
        },
    });
    const cliente = { nombreCompleto: 'Persona Prueba', programa: 'Mejoramiento de vivienda', subprograma: 'Piso firme' };
    const respuestas = [];
    const actualizar = (cambios) => Object.assign(cliente, cambios);
    const mensaje = { from: '123@c.us', type: 'chat', body: 'reanudar', id: { _serialized: 'texto-1' },
        reply: async (...args) => respuestas.push(args) };
    return { ...modulo.exports, cliente, respuestas, actualizar, mensaje };
}

test('Todos los programas de inscripción incluyen el formato obligatorio y el PDF distribuible', () => {
    for (const nombre of ['Piso firme', 'Techo firme', 'Recámara', 'Cuarto de baño', 'Estufas ecológicas']) {
        const config = obtenerRequisitos(nombre);
        assert.equal(config.formatoSolicitud, FORMATO_SOLICITUD);
        assert.equal(fs.readFileSync(config.formatoSolicitud).subarray(0, 5).toString(), '%PDF-');
        const formatos = config.documentos.filter((item) => item.id === 'Formato_Solicitud');
        assert.equal(formatos.length, 1);
        assert.ok(!formatos[0].opcional);
        assert.ok(config.documentos.some((item) => item.id === 'Solicitud_Programa'));
    }
    assert.equal(obtenerRequisitos('Regularización').formatoSolicitud, null);
    assert.equal(obtenerRequisitos('Escrituración').formatoSolicitud, null);
});

test('Envía ficha y PDF antes de pausar; recibe y guarda el formato como requisito independiente', async (t) => {
    const bot = preparar(t);
    await bot.iniciarDocumentos(bot.mensaje, bot.cliente, bot.actualizar);
    assert.equal(bot.respuestas[0][0].filename, path.basename(obtenerRequisitos('Piso firme').imagen));
    assert.equal(bot.respuestas[1][0].filename, path.basename(FORMATO_SOLICITUD));
    assert.equal(bot.respuestas[1][2].sendMediaAsDocument, true);
    assert.match(bot.respuestas[2][0], /llene el formato/);
    assert.match(bot.respuestas[2][0], /reanudar/);
    assert.equal(bot.cliente.estado, 'pausado_documentos');
    bot.cliente.indiceDocumento = bot.cliente.requisitos.findIndex((item) => item.id === 'Formato_Solicitud');
    await bot.manejarDocumentos(bot.mensaje, bot.cliente, bot.actualizar);
    assert.match(bot.respuestas.at(-1)[0], /Formato de solicitud CODESVI 2026 llenado/);
    const cantidadAntes = bot.cliente.indiceDocumento;
    await bot.manejarDocumentos({ ...bot.mensaje, body: 'siguiente', id: { _serialized: 'sin-archivo' } }, bot.cliente, bot.actualizar);
    assert.equal(bot.cliente.indiceDocumento, cantidadAntes);
    await bot.manejarDocumentos({ ...bot.mensaje, type: 'document', hasMedia: true, body: '',
        id: { _serialized: 'formato-pdf' }, downloadMedia: async () => ({ filename: 'solicitud.pdf', mimetype: 'application/pdf', data: fs.readFileSync(FORMATO_SOLICITUD).toString('base64') }),
    }, bot.cliente, bot.actualizar);
    const guardado = bot.cliente.documentos.Formato_Solicitud.archivos[0];
    assert.match(path.basename(guardado.ruta), /^Formato_Solicitud_Persona_Prueba_01\.pdf$/);
    assert.deepEqual(fs.readFileSync(guardado.ruta), fs.readFileSync(FORMATO_SOLICITUD));
    const resumen = resumirDocumentos(bot.cliente);
    assert.ok(resumen.requisitos.some((item) => item.id === 'Formato_Solicitud' && item.archivosGuardados === 1));
});

test('Si falla el envío del PDF queda en error recuperable y no pide documentos todavía', async (t) => {
    const bot = preparar(t, { fallarFormato: true });
    await assert.rejects(bot.iniciarDocumentos(bot.mensaje, bot.cliente, bot.actualizar), /PDF no disponible/);
    assert.equal(bot.cliente.estado, 'error_ficha');
    assert.equal(bot.cliente.indiceDocumento, 0);
    assert.equal(bot.respuestas.length, 1);
});
