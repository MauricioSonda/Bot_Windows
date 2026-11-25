const { test } = require('node:test');
const assert = require('node:assert/strict');
const CONFIG = require('./configuracion');
const { crearRespuestaConRetraso } = require('./retrasos');
const { crearFlujoDestino } = require('./flujo-destino');
const { crearControlAtencion } = require('./atencion-humana');
const { manejarDocumentos } = require('./flujo-documentos');

function escenario(body = 'prueba', extra = {}) {
    const esperas = [], respuestas = [];
    const original = { from: '123@c.us', body, type: 'chat', id: { _serialized: body },
        async reply(texto) { assert.equal(this, original); respuestas.push(texto); },
        async downloadMedia() { assert.equal(this, original); return 'archivo'; },
    };
    const control = crearRespuestaConRetraso(original, { esperar: async (ms) => esperas.push(ms),
        ahora: () => 1000, recibidoEn: 1000, aleatorio: () => 0, ...extra });
    return { ...control, esperas, respuestas };
}

test('Retrasos activos: primer mensaje entre 150 y 180 segundos; flujo de 5 segundos', () => {
    assert.equal(CONFIG.REPLY_DELAY_ENABLED, true);
    assert.equal(CONFIG.MIN_REPLY_DELAY_MS, 150000);
    assert.equal(CONFIG.MAX_REPLY_DELAY_MS, 180000);
    assert.equal(CONFIG.FLOW_REPLY_DELAY_MS, 5000);
});

test('Saludo y nombre comparten una sola espera inicial aleatoria; la siguiente interacción usa 5 segundos', async () => {
    for (const [aleatorio, esperado] of [[0, 150000], [0.999999, 180000]]) {
        const e = escenario('prueba', { aleatorio: () => aleatorio });
        e.marcarInicio();
        await e.mensaje.reply('Bienvenida');
        await e.mensaje.reply('Nombre completo');
        assert.deepEqual(e.esperas, [esperado]);
        assert.deepEqual(e.respuestas, ['Bienvenida', 'Nombre completo']);
    }
    const nombre = escenario('Nombre Completo');
    await nombre.mensaje.reply('Elija su atención');
    assert.deepEqual(nombre.esperas, [5000]);
});

test('El primer retraso se cuenta desde la recepción; mensajes ignorados y modo desactivado no esperan', async () => {
    const e = escenario('prueba', { ahora: () => 4000 });
    e.marcarInicio();
    await e.mensaje.reply('Bienvenida');
    assert.deepEqual(e.esperas, [147000]);
    const ignorado = escenario('texto ignorado');
    assert.deepEqual(ignorado.esperas, []);
    const desactivado = escenario('prueba', { config: { ...CONFIG, REPLY_DELAY_ENABLED: false } });
    desactivado.marcarInicio();
    await desactivado.mensaje.reply('Bienvenida');
    assert.deepEqual(desactivado.esperas, []);
    assert.equal(await desactivado.mensaje.downloadMedia(), 'archivo');
});

test('La espera de una persona no bloquea a otra y no hay respuestas antes de finalizar su temporizador', async () => {
    let completar;
    const primero = escenario('prueba', { esperar: () => new Promise((resolve) => { completar = resolve; }) });
    primero.marcarInicio();
    const pendiente = primero.mensaje.reply('Bienvenida');
    assert.deepEqual(primero.respuestas, []);
    const segundo = escenario('1');
    await segundo.mensaje.reply('Subprogramas');
    assert.deepEqual(segundo.esperas, [5000]);
    assert.deepEqual(primero.respuestas, []);
    completar();
    await pendiente;
    assert.deepEqual(primero.respuestas, ['Bienvenida']);
});

test('Destino, atención y documentos utilizan la espera corta, incluidos varios avisos de un mismo paso', async () => {
    const cliente = { nombreCompleto: 'Persona Prueba', estado: 'esperando_destino' };
    const actualizarCliente = (_, cambios) => Object.assign(cliente, cambios);
    const destino = escenario('2');
    await crearFlujoDestino({ actualizarCliente })(destino.mensaje, cliente);
    assert.deepEqual(destino.esperas, [5000]);
    assert.equal(cliente.estado, 'esperando_tipo_atencion');
    const opcionInvalida = escenario('opcion no reconocida');
    await crearControlAtencion({ actualizarCliente, consultar: () => [] })(opcionInvalida.mensaje, cliente);
    assert.equal(opcionInvalida.respuestas.length, 2);
    assert.deepEqual(opcionInvalida.esperas, [5000]);
    Object.assign(cliente, { estado: 'esperando_documento', programa: 'Equipamiento', subprograma: 'Estufas ecológicas',
        expedienteId: 'prueba', indiceDocumento: 0, documentos: {}, requisitos: [{ id: 'Dato', nombre: 'Dato de prueba', tipo: 'texto' }] });
    const documento = escenario('Dato recibido');
    await manejarDocumentos(documento.mensaje, cliente, (cambios) => Object.assign(cliente, cambios));
    assert.equal(documento.respuestas.length, 2);
    assert.deepEqual(documento.esperas, [5000]);
    assert.equal(cliente.documentos.Dato.valor, 'Dato recibido');
});

test('El procesador real aplica el retraso inicial y los 5 segundos en nombre, programas y documentos', async (t) => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const vm = require('vm');
    const { EventEmitter } = require('events');
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'codesvi-tiempo-flujo-'));
    t.after(() => fs.rmSync(carpeta, { recursive: true, force: true }));
    const config = { ...CONFIG, ARCHIVO_CLIENTES: path.join(carpeta, 'clientes.json'),
        ARCHIVO_ATENCION_HUMANA: path.join(carpeta, 'atencion.json'), ARCHIVO_REVISIONES: path.join(carpeta, 'revisiones.json'),
        CARPETA_DATOS: carpeta, CARPETA_EXPEDIENTES: path.join(carpeta, 'expedientes') };
    let destruido = 0, servidorCerrado = 0;
    class ClienteSimulado extends EventEmitter {
        async initialize() {}
        async destroy() { destruido += 1; }
    }
    const esperas = [], respuestas = [];
    const dependencias = {
        './index': { Client: ClienteSimulado, LocalAuth: class {} },
        './configuracion': config,
        './retrasos': { crearRespuestaConRetraso: (mensaje, opciones) => crearRespuestaConRetraso(mensaje, {
            ...opciones, config, aleatorio: () => 0, ahora: () => 1000, esperar: async (ms) => esperas.push(ms),
        }) },
        './dashboard-local': { iniciarDashboardLocal: async () => ({ cerrar: async () => { servidorCerrado += 1; } }) },
        './control-ejecucion': { adquirirInstancia: () => ({ token: 'prueba', publicar() {}, liberar() {} }) },
        './telefonos': { resolverTelefono: async () => '123' },
        './atencion-humana': { crearControlAtencion: (opciones) => crearControlAtencion({ ...opciones, consultar: () => [],
            registrar: () => { throw new Error('Esta prueba no debe registrar atención real.'); } }) },
    };
    const contexto = vm.createContext({ __dirname, console: { log() {}, error() {} },
        require: (id) => dependencias[id] || require(id),
        setInterval: () => 1, clearInterval() {},
        process: { once() {}, exit() {} },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'prueba-atencion.js'), 'utf8'), contexto);
    vm.runInContext('control.activar()', contexto);
    const procesar = vm.runInContext('procesarMensaje', contexto);
    const enviar = async (body, type = 'chat') => {
        const inicio = esperas.length;
        await procesar({ from: '123@c.us', body, type, fromMe: false, id: { _serialized: body },
            reply: async (texto) => respuestas.push(texto) }, 1000);
        return esperas.slice(inicio);
    };
    assert.deepEqual(await enviar('Hola'), [150000]);
    assert.equal(respuestas.length, 2);
    assert.deepEqual(await enviar('Persona Prueba'), [5000]);
    assert.deepEqual(await enviar('2'), [5000]);
    assert.deepEqual(await enviar('1'), [5000]);
    assert.deepEqual(await enviar('1'), [5000]);
    assert.deepEqual(await enviar('opcion desconocida'), [5000]);
    const clientes = vm.runInContext('customerData', contexto);
    Object.assign(clientes['123@c.us'], { estado: 'esperando_documento', programa: 'Equipamiento', subprograma: 'Estufas ecológicas',
        expedienteId: 'EXP-prueba', indiceDocumento: 0, documentos: {}, requisitos: [{ id: 'Dato', nombre: 'Dato', tipo: 'texto' }] });
    assert.deepEqual(await enviar('Dato de prueba'), [5000]);
    assert.deepEqual(await enviar('', 'sticker'), []);
    const client = vm.runInContext('client', contexto);
    const numeroAntes = respuestas.length;
    client.emit('message', { from: '789@c.us', type: 'chat', body: 'Ayer', timestamp: Math.floor(Date.now() / 1000) - 86400,
        id: { _serialized: 'anterior' }, reply: async (texto) => respuestas.push(texto) });
    assert.equal(vm.runInContext("messageQueues.has('789@c.us')", contexto), false);
    const reciente = { from: '789@c.us', type: 'sticker', body: '', timestamp: Math.floor(Date.now() / 1000) + 2,
        id: { _serialized: 'nuevo' }, reply: async (texto) => respuestas.push(texto) };
    client.emit('message', reciente);
    client.emit('message', { ...reciente, id: { _serialized: 'otro-saludo' } });
    await vm.runInContext("messageQueues.get('789@c.us')", contexto);
    assert.equal(respuestas.length - numeroAntes, 2);
    assert.equal(vm.runInContext("customerData['789@c.us'].nombreCompleto", contexto), null);
    contexto.paginaPrueba = new EventEmitter(); contexto.navegadorPrueba = new EventEmitter();
    vm.runInContext('client.pupPage = paginaPrueba; client.pupBrowser = navegadorPrueba; vigilarNavegador()', contexto);
    contexto.paginaPrueba.emit('close');
    await vm.runInContext('cierre', contexto);
    assert.equal(destruido, 1);
    assert.equal(servidorCerrado, 1);
});
