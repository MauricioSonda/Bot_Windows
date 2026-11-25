const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { crearFlujoDestino } = require('./flujo-destino');
const { crearControlAtencion, registrarSolicitud, leerSolicitudes, marcarAtendida } = require('./atencion-humana');
const { programasDisponibles } = require('./inscripciones');
const { crearServidorAtencion } = require('./api-atencion');
const { crearRevisiones } = require('./revision-documentos');
const { resolverCarpetaExpediente } = require('./carpetas-expedientes');

function escenario(t) {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'codesvi-destino-'));
    t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
    const archivo = path.join(raiz, 'solicitudes.json');
    const cliente = { nombreCompleto: 'Ana Pérez', estado: 'esperando_destino' };
    const respuestas = [];
    const actualizarCliente = (_, cambios) => Object.assign(cliente, cambios);
    const registrar = (...args) => registrarSolicitud(...args, archivo);
    const consultar = () => leerSolicitudes(archivo);
    return { raiz, archivo, cliente, respuestas, consultar,
        flujo: crearFlujoDestino({ actualizarCliente, registrar }),
        atencion: crearControlAtencion({ actualizarCliente, registrar, consultar }),
        mensaje: (body, type = 'chat') => ({ from: '123@c.us', type, body,
            id: { _serialized: body }, reply: async (texto) => respuestas.push(texto) }),
    };
}

test('Destino: no ofrece ayuda antes de clasificar, no acepta medios como opción y separa programas', async (t) => {
    const e = escenario(t);
    for (const estado of ['esperando_nombre', 'esperando_destino', 'esperando_tramite_certeza']) {
        e.cliente.estado = estado;
        assert.equal(await e.atencion(e.mensaje('ayuda'), e.cliente), false);
    }
    assert.equal(e.consultar().length, 0);
    e.cliente.estado = 'esperando_destino';
    await e.flujo(e.mensaje('1', 'image'), e.cliente);
    assert.equal(e.cliente.estado, 'esperando_destino');
    assert.doesNotMatch(e.respuestas.at(-1), /ayuda/);
    await e.flujo(e.mensaje('2'), e.cliente);
    assert.equal(e.cliente.destinoAtencion, 'programas');
    assert.equal(e.cliente.estado, 'esperando_tipo_atencion');
    assert.match(e.respuestas.at(-1), /ayuda/);
    assert.equal(await e.atencion(e.mensaje('1'), e.cliente), 'continuar_programas');
    assert.ok(!programasDisponibles(e.cliente).includes('Certeza jurídica'));
    await e.atencion(e.mensaje('ayuda'), e.cliente);
    assert.equal(e.consultar()[0].destinoAtencion, 'programas');
});

test('Certeza: ambos trámites registran atención personal y bloquean el bot hasta ser atendidos', async (t) => {
    for (const [entrada, esperado] of [['1', 'Escrituración'], ['regularizacion', 'Regularización']]) {
        const e = escenario(t);
        await e.flujo(e.mensaje('certeza juridica'), e.cliente);
        assert.equal(e.cliente.estado, 'esperando_tramite_certeza');
        assert.doesNotMatch(e.respuestas.at(-1), /ayuda/);
        await e.flujo(e.mensaje('otro'), e.cliente);
        assert.equal(e.consultar().length, 0);
        await e.flujo(e.mensaje(entrada), e.cliente);
        const solicitud = e.consultar()[0];
        assert.equal(solicitud.subprograma, esperado);
        assert.equal(solicitud.destinoAtencion, 'certeza');
        assert.equal(solicitud.motivo, 'certeza_juridica');
        assert.equal(e.cliente.estado, 'atencion_humana');
        assert.match(e.respuestas.at(-1), /personalmente/);
        assert.equal(await e.atencion(e.mensaje('prueba'), e.cliente), true);
        assert.equal(e.consultar().length, 1);
        marcarAtendida(solicitud.id, e.archivo);
        assert.equal(await e.atencion(e.mensaje('prueba'), e.cliente), false);
    }
});

function peticion(server, url, method = 'GET', origen) {
    return new Promise((resolve) => {
        let status;
        server.emit('request', { method, url, headers: {
            'content-type': 'application/json', host: 'localhost', ...(origen ? { origin: origen } : {}),
            authorization: process.env.ATENCION_API_TOKEN ? `Bearer ${process.env.ATENCION_API_TOKEN}` : '',
        } }, { writeHead(value) { status = value; }, end(body) { resolve({ status, body: JSON.parse(body) }); } });
    });
}

test('API: cola exclusiva de Certeza, cierre humano sin validar requisitos automáticos y archivo de historial', async (t) => {
    const e = escenario(t);
    await e.flujo(e.mensaje('1'), e.cliente);
    await e.flujo(e.mensaje('1'), e.cliente);
    registrarSolicitud('456@c.us', { nombreCompleto: 'Otro Cliente' }, 'palabra_ayuda', 'otro', e.archivo);
    const revisiones = crearRevisiones({ archivo: path.join(e.raiz, 'revisiones.json') });
    const server = crearServidorAtencion({ listar: e.consultar, atender: (id) => marcarAtendida(id, e.archivo),
        clientes: () => [{ ...e.cliente, id: '123@c.us', contactoId: '123@c.us' }], revisiones });
    const certeza = await peticion(server, '/api/certeza?estado=pendiente');
    assert.equal(certeza.body.total, 1);
    const persona = certeza.body.solicitudes[0];
    assert.equal(persona.resumenDocumentos.requisitos.length, 0);
    assert.equal((await peticion(server, '/api/atencion-humana')).body.total, 1);
    assert.equal((await peticion(server, '/api/clientes')).body.total, 0);
    assert.equal((await peticion(server, `/api/certeza/${persona.id}/atender`, 'POST')).status, 200);
    assert.equal((await peticion(server, '/api/certeza?estado=pendiente')).body.total, 0);
    assert.equal(revisiones.historial()[0].subprograma, 'Escrituración');
    assert.equal(e.consultar().find((item) => item.contactoId === '456@c.us').estado, 'pendiente');
});

test('Carpetas: resuelve solo directorios dentro de la raíz, rechaza ausentes y enlaces externos', (t) => {
    const e = escenario(t);
    const carpeta = path.join(e.raiz, 'persona', 'id', 'programa', 'EXP-1');
    fs.mkdirSync(carpeta, { recursive: true });
    assert.equal(resolverCarpetaExpediente({ carpetaExpediente: carpeta }, e.raiz), fs.realpathSync(carpeta));
    assert.throws(() => resolverCarpetaExpediente({}, e.raiz), /todavía no tiene/);
    assert.throws(() => resolverCarpetaExpediente({ carpetaExpediente: e.raiz }, e.raiz), /no permitida/);
    const enlace = path.join(e.raiz, 'escape');
    fs.symlinkSync(os.tmpdir(), enlace);
    assert.throws(() => resolverCarpetaExpediente({ carpetaExpediente: enlace }, e.raiz), /no permitida/);
    assert.throws(() => resolverCarpetaExpediente({ carpetaExpediente: path.join(e.raiz, 'no-existe') }, e.raiz), /no está disponible/);
});

test('API: abrir carpeta selecciona la inscripción registrada, no acepta rutas del navegador ni otro origen', async () => {
    let abierto;
    const server = crearServidorAtencion({ clientes: () => [{ id: 'persona', contactoId: 'persona', inscripciones: [
        { id: 'exp1', carpetaExpediente: '/registrada/uno' }, { id: 'exp2', carpetaExpediente: '/registrada/dos' },
    ] }], abrirCarpeta: async (registro) => { abierto = registro.carpetaExpediente; } });
    assert.equal((await peticion(server, '/api/clientes/persona/abrir-carpeta?inscripcion=exp2', 'POST')).status, 200);
    assert.equal(abierto, '/registrada/dos');
    assert.equal((await peticion(server, '/api/clientes/persona/abrir-carpeta?inscripcion=inventada', 'POST')).status, 404);
    assert.equal((await peticion(server, '/api/clientes/persona/abrir-carpeta', 'POST', 'https://externo.example')).status, 403);
});
