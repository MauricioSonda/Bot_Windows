const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    leerSolicitudes,
    registrarSolicitud,
    marcarAtendida,
    crearControlAtencion,
} = require('./atencion-humana');
const MENSAJES = require('./mensajes');
const { crearServidorAtencion } = require('./api-atencion');

function escenario(t, cliente) {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'codesvi-atencion-'));
    t.after(() => fs.rmSync(carpeta, { recursive: true, force: true }));
    const archivo = path.join(carpeta, 'solicitudes.json');
    const respuestas = [];
    const manejar = crearControlAtencion({
        actualizarCliente: (_, cambios) => Object.assign(cliente, cambios),
        registrar: (...args) => registrarSolicitud(...args, archivo),
        consultar: () => leerSolicitudes(archivo),
    });
    const mensaje = (body) => ({
        from: '123@lid',
        type: 'chat',
        body,
        id: { _serialized: body },
        reply: async (texto) => respuestas.push(texto),
    });
    return {
        manejar,
        mensaje,
        respuestas,
        leer: () => leerSolicitudes(archivo),
        archivo,
    };
}

test('La elección automatizada avanza a programas y no crea solicitudes humanas', async (t) => {
    const cliente = {
        nombreCompleto: 'Ana Pérez',
        estado: 'esperando_tipo_atencion',
    };
    const e = escenario(t, cliente);
    assert.equal(
        await e.manejar(e.mensaje('1'), cliente),
        'continuar_programas',
    );
    assert.equal(cliente.estado, 'esperando_programa');
    assert.ok(cliente.automatizacionAceptadaEn);
    assert.equal(e.leer().length, 0);
    assert.match(
        MENSAJES.ELEGIR_ATENCION('Ana Pérez'),
        /\*Ana Pérez,.*automatizado.*ayuda.*\*/,
    );
});

test('Atención personal persiste el contexto y bloquea mensajes posteriores', async (t) => {
    const cliente = {
        nombreCompleto: 'Ana Pérez',
        estado: 'esperando_tipo_atencion',
    };
    const e = escenario(t, cliente);
    assert.equal(
        await e.manejar(e.mensaje('Atención personal'), cliente),
        true,
    );
    assert.equal(cliente.estado, 'atencion_humana');
    assert.equal(e.leer()[0].estadoFlujoAnterior, 'esperando_tipo_atencion');
    assert.equal(e.leer()[0].telefono, null);
    for (const texto of ['prueba', 'reanudar', 'ayuda', '1'])
        await e.manejar(e.mensaje(texto), cliente);
    assert.equal(e.respuestas.length, 1);
    assert.equal(e.leer().length, 1);
    // Simula un cliente con estado desactualizado después de reiniciar.
    assert.equal(
        await e.manejar(e.mensaje('prueba'), { estado: 'esperando_programa' }),
        true,
    );
});

test('Ayuda tiene prioridad durante la pausa y la recopilación; conserva documentos', async (t) => {
    for (const estado of ['pausado_documentos', 'esperando_documento']) {
        const cliente = {
            nombreCompleto: 'Ana Pérez',
            estado,
            programa: 'Equipamiento',
            subprograma: 'Estufas ecológicas',
            documentos: { INE: { archivos: [{ ruta: 'INE.jpg' }] } },
        };
        const e = escenario(t, cliente);
        await e.manejar(e.mensaje(' AYUDA '), cliente);
        assert.equal(e.leer()[0].estadoFlujoAnterior, estado);
        assert.deepEqual(e.leer()[0].documentos, cliente.documentos);
        assert.equal(cliente.estado, 'atencion_humana');
    }
});

test('Una opción inválida no avanza ni crea una solicitud', async (t) => {
    const cliente = {
        nombreCompleto: 'Ana Pérez',
        estado: 'esperando_tipo_atencion',
    };
    const e = escenario(t, cliente);
    await e.manejar(e.mensaje('3'), cliente);
    assert.equal(cliente.estado, 'esperando_tipo_atencion');
    assert.equal(e.leer().length, 0);
});

test('Al marcar atendida, cualquier mensaje nuevo puede iniciar sin retomar automáticamente documentos anteriores', async (t) => {
    const cliente = {
        nombreCompleto: 'Cliente Prueba',
        estado: 'esperando_documento',
    };
    const e = escenario(t, cliente);
    await e.manejar(e.mensaje('ayuda'), cliente);
    assert.equal(await e.manejar(e.mensaje('prueba'), cliente), true);
    marcarAtendida(cliente.solicitudAtencionId, e.archivo);
    assert.equal(await e.manejar(e.mensaje('reanudar'), cliente), false);
    assert.equal(await e.manejar(e.mensaje('prueba'), cliente), false);
    assert.equal(e.respuestas.length, 1);
});

test('La API ofrece listado, filtro, detalle y rechaza escrituras sin abrir un puerto', () => {
    const server = crearServidorAtencion();
    function consultar(url, method = 'GET') {
        let status, body;
        const response = {
            setHeader() {},
            writeHead(value) {
                status = value;
            },
            end(value) {
                body = JSON.parse(value);
            },
        };
        server.emit(
            'request',
            {
                url,
                method,
                headers: {
                    authorization: process.env.ATENCION_API_TOKEN
                        ? `Bearer ${process.env.ATENCION_API_TOKEN}`
                        : '',
                },
            },
            response,
        );
        return { status, body };
    }
    assert.equal(consultar('/api/salud').status, 200);
    assert.equal(
        consultar('/api/atencion-humana?estado=pendiente').status,
        200,
    );
    assert.equal(consultar('/api/atencion-humana/no-existe').status, 404);
    assert.equal(consultar('/api/atencion-humana', 'POST').status, 405);
});
