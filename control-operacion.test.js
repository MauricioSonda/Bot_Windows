const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { crearControlConversaciones } = require('./control-conversaciones');
const { crearRespuestaConRetraso } = require('./retrasos');
const { manejarDocumentos } = require('./flujo-documentos');
const { reiniciarIntentos } = require('./intentos-documentos');
const { adquirirInstancia } = require('./control-ejecucion');
const { crearServidorAtencion } = require('./api-atencion');
const CONFIG = require('./configuracion');

function escenario() {
    let reloj = 100000;
    const clientes = { '123@c.us': { nombreCompleto: 'Persona Prueba', estado: 'esperando_programa', telefono: '123' } };
    const solicitudes = [];
    const actualizar = (id, cambios) => Object.assign(clientes[id] ||= {}, cambios);
    const opciones = { clientes, actualizarCliente: actualizar, ahora: () => reloj, consultar: () => solicitudes,
        registrar: (id, cliente, motivo) => {
            const solicitud = { id: 'sol-' + solicitudes.length, contactoId: id, estado: 'pendiente', motivo,
                detalleDerivacion: cliente.detalleDerivacion, solicitadoEn: 'fecha' };
            solicitudes.push(solicitud); return solicitud;
        } };
    const control = crearControlConversaciones(opciones);
    control.activar();
    const mensaje = (id, timestamp = 101, cambios = {}) => ({ from: '123@c.us', fromMe: false, type: 'chat', body: 'Hola', timestamp,
        id: { _serialized: id }, ...cambios });
    return { control, clientes, solicitudes, actualizar, opciones, mensaje, hora: (valor) => { reloj = valor; } };
}

test('Solo acepta mensajes nuevos tras Listo y descarta historial, duplicados, sistemas y mensajes de desconexión', () => {
    const e = escenario();
    assert.equal(e.control.aceptar(e.mensaje('ayer', 1)), false);
    assert.equal(e.control.aceptar(e.mensaje('mismo-segundo', 100)), false);
    assert.equal(e.control.aceptar(e.mensaje('sin-fecha', undefined, { timestamp: undefined })), false);
    e.hora(101000);
    assert.equal(e.control.aceptar(e.mensaje('nuevo')), true);
    assert.equal(e.control.aceptar(e.mensaje('nuevo')), false);
    assert.equal(e.control.aceptar(e.mensaje('grupo', 101, { from: '1@g.us' })), false);
    assert.equal(e.control.aceptar(e.mensaje('notificacion', 101, { type: 'e2e_notification' })), false);
    const contexto = e.control.contexto('123@c.us');
    e.control.desactivar();
    assert.throws(contexto.verificar, { code: 'BOT_CANCELADO' });
    assert.equal(e.control.aceptar(e.mensaje('desconectado', 102)), false);
    e.hora(110000); e.control.activar();
    assert.equal(e.control.aceptar(e.mensaje('acumulado', 105)), false);
    e.hora(111000);
    assert.equal(e.control.aceptar(e.mensaje('reconexion', 111)), true);
    e.control.finalizar();
});

test('Pausa persistente y comandos propios: el cliente no puede reactivar y no se confunde el remitente con el chat', async () => {
    const e = escenario(); e.hora(101000);
    assert.equal(await e.control.comando(e.mensaje('cliente-comando', 101, { body: '!bot pausa' })), false);
    assert.equal(await e.control.comando(e.mensaje('admin', 101, { fromMe: true, from: '999@c.us', body: '!bot pausa',
        getChat: async () => ({ id: { _serialized: '123@c.us' } }) })), true);
    assert.equal(e.control.bloqueado('123@c.us'), true);
    assert.equal(e.control.bloqueado('999@c.us'), false);
    assert.equal(e.control.aceptar(e.mensaje('reanudar-cliente', 101, { body: 'reanudar' })), false);
    const nuevoControl = crearControlConversaciones(e.opciones); nuevoControl.activar();
    assert.equal(nuevoControl.estadoChat('123@c.us').pausado, true);
    nuevoControl.reanudar('123@c.us');
    e.hora(102000);
    assert.equal(nuevoControl.aceptar(e.mensaje('despues', 102)), true);
    nuevoControl.derivar('123@c.us');
    assert.throws(() => nuevoControl.reanudar('123@c.us'), { status: 409 });
    e.solicitudes[0].estado = 'atendido';
    nuevoControl.atendida(e.solicitudes[0]);
    assert.equal(nuevoControl.bloqueado('123@c.us'), false);
    assert.equal(e.clientes['123@c.us'].estado, 'atencion_resuelta');
    nuevoControl.finalizar(); e.control.finalizar();
});

test('Pausar durante la espera cancela el temporizador y bloquea el envío; otros chats siguen habilitados', async () => {
    const e = escenario();
    let enviados = 0;
    const contexto = e.control.contexto('123@c.us');
    const respuesta = crearRespuestaConRetraso({ reply: async () => { enviados += 1; } }, {
        config: { REPLY_DELAY_ENABLED: true, FLOW_REPLY_DELAY_MS: 180000 }, signal: contexto.signal, verificar: contexto.verificar,
    });
    const pendiente = respuesta.mensaje.reply('No debe enviarse');
    e.control.pausar('123@c.us');
    await assert.rejects(pendiente, { code: 'BOT_CANCELADO' });
    assert.equal(enviados, 0);
    const otro = e.control.contexto('456@c.us'); otro.verificar();
    e.control.finalizar();
    assert.throws(otro.verificar, { code: 'BOT_CANCELADO' });
});

test('El cuarto intento incorrecto deriva una sola vez, guarda el contexto y conserva documentos e índice', async () => {
    const e = escenario();
    const cliente = e.clientes['123@c.us'];
    Object.assign(cliente, { estado: 'esperando_documento', expedienteId: 'exp', programa: 'Equipamiento', subprograma: 'Estufas ecológicas',
        requisitos: [{ id: 'INE', nombre: 'INE' }], indiceDocumento: 0, documentos: {} });
    const respuestas = [];
    const procesar = (id) => manejarDocumentos({ type: 'document', body: '', hasMedia: true, id: { _serialized: id },
        reply: async (texto) => respuestas.push(texto), downloadMedia: async () => ({ data: 'TVouLi4=', mimetype: 'application/x-msdownload', filename: 'archivo.exe' }) },
    cliente, (cambios) => e.actualizar('123@c.us', cambios), {
        alDerivar: async (detalle) => { e.control.derivar('123@c.us', 'intentos_documento', id, detalle); },
    });
    for (const id of ['1', '2', '3']) await procesar(id);
    assert.equal(e.solicitudes.length, 0);
    await procesar('3');
    assert.equal(Object.values(cliente.intentosDocumentos)[0].cantidad, 3);
    await procesar('4');
    assert.equal(e.solicitudes.length, 1);
    assert.equal(e.solicitudes[0].detalleDerivacion.cantidad, 4);
    assert.equal(e.solicitudes[0].detalleDerivacion.requisito, 'INE');
    assert.equal(cliente.estado, 'atencion_humana');
    assert.equal(cliente.indiceDocumento, 0);
    assert.deepEqual(cliente.documentos, {});
    assert.equal(respuestas.length, 3);
    assert.equal(e.control.bloqueado('123@c.us'), true);
    e.control.finalizar();
});

test('Los intentos sobreviven a una recarga y aceptar un requisito reinicia solo su contador', () => {
    const cliente = JSON.parse(JSON.stringify({ expedienteId: 'exp', indiceDocumento: 0, requisitos: [{ id: 'INE' }],
        intentosDocumentos: { 'exp/INE': { cantidad: 3, mensajes: ['1', '2', '3'] }, 'exp/CURP': { cantidad: 2 } } }));
    reiniciarIntentos(cliente, (cambios) => Object.assign(cliente, cambios));
    assert.equal(cliente.intentosDocumentos['exp/INE'].cantidad, 0);
    assert.equal(cliente.intentosDocumentos['exp/CURP'].cantidad, 2);
});

test('Un fallo técnico de descarga no penaliza al cliente ni crea atención humana', async () => {
    const cliente = { estado: 'esperando_documento', indiceDocumento: 0, requisitos: [{ id: 'INE' }], documentos: {} };
    let cambios = 0;
    await assert.rejects(manejarDocumentos({ type: 'document', body: '', hasMedia: true, id: { _serialized: 'tecnico' },
        downloadMedia: async () => { throw new Error('Conexión interrumpida'); } }, cliente, () => { cambios += 1; },
    { alDerivar: () => { throw new Error('No debe derivar por un fallo técnico'); } }), /Conexión interrumpida/);
    assert.equal(cambios, 0);
    assert.equal(cliente.intentosDocumentos, undefined);
});

test('Una instancia reserva su control local, rechaza duplicados y libera exclusivamente sus propios archivos', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codesvi-instancia-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const archivo = path.join(dir, 'control.json');
    const instancia = adquirirInstancia(archivo);
    instancia.publicar({ url: 'http://127.0.0.1:3080/' });
    assert.equal(JSON.parse(fs.readFileSync(archivo)).token, instancia.token);
    assert.throws(() => adquirirInstancia(archivo), { code: 'BOT_YA_ACTIVO' });
    instancia.liberar();
    assert.equal(fs.existsSync(archivo), false);
    assert.equal(fs.existsSync(archivo + '.lock'), false);
});

test('Control HTTP exige token local y origen correcto; pausa un chat y confirma antes de apagar', async () => {
    const e = escenario();
    let apagados = 0;
    const server = crearServidorAtencion({ controlBot: { token: 'token-prueba', estado: e.control.estado,
        estadoChat: e.control.estadoChat, accionChat: (id, accion) => e.control[accion === 'pausar' ? 'pausar' : 'reanudar'](id),
        apagar: () => { apagados += 1; e.control.finalizar(); }, mostrar: () => {} } });
    const peticion = (url, method = 'GET', headers = {}) => new Promise((resolve) => {
        let status;
        server.emit('request', { url, method, headers: { host: '127.0.0.1:3080', 'content-type': 'application/json',
            'x-bot-control': 'token-prueba', ...(CONFIG.API_ATENCION.TOKEN ? { authorization: `Bearer ${CONFIG.API_ATENCION.TOKEN}` } : {}), ...headers } },
        { writeHead(code) { status = code; }, end(body) { resolve({ status, data: JSON.parse(body) }); } });
    });
    assert.equal((await peticion('/api/control/estado', 'GET', { 'x-bot-control': '' })).status, 403);
    assert.equal((await peticion('/api/control/apagar', 'POST', { origin: 'https://ajeno.example' })).status, 403);
    assert.equal((await peticion('/api/control/estado', 'GET', { host: 'ajeno.example' })).status, 403);
    assert.equal((await peticion('/api/control/chats/123%40c.us/pausar', 'POST')).data.pausado, true);
    assert.equal((await peticion('/api/control/chats/123%40c.us/reanudar', 'POST')).data.pausado, false);
    assert.equal((await peticion('/api/control/apagar', 'POST')).data.apagando, true);
    assert.equal(apagados, 0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(apagados, 1);
});
