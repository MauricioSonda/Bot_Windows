const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { crearServidorAtencion } = require('./api-atencion');
const { crearRevisiones } = require('./revision-documentos');
const {
    registrarSolicitud,
    leerSolicitudes,
    marcarAtendida,
} = require('./atencion-humana');

test('El dashboard sirve HTML, CSS y JS; atiende una solicitud sin borrar su contexto', (t) => {
    const carpeta = fs.mkdtempSync(
        path.join(os.tmpdir(), 'codesvi-dashboard-'),
    );
    t.after(() => fs.rmSync(carpeta, { recursive: true, force: true }));
    const archivo = path.join(carpeta, 'solicitudes.json');
    const solicitud = registrarSolicitud(
        '123@lid',
        { nombreCompleto: 'Cliente Prueba', estado: 'esperando_documento' },
        'palabra_ayuda',
        'm1',
        archivo,
    );
    const server = crearServidorAtencion({
        revisiones: crearRevisiones({ archivo: path.join(carpeta, 'revisiones.json') }),
        listar: () => leerSolicitudes(archivo),
        atender: (id) => marcarAtendida(id, archivo),
    });
    function consultar(url, method = 'GET', extraHeaders = {}) {
        let status, body;
        const response = {
            setHeader() {},
            writeHead(value) {
                status = value;
            },
            end(value) {
                body = String(value);
            },
        };
        server.emit(
            'request',
            {
                url,
                method,
                headers: {
                    host: '127.0.0.1:3080',
                    origin: 'http://127.0.0.1:3080',
                    'content-type': 'application/json',
                    authorization: process.env.ATENCION_API_TOKEN
                        ? `Bearer ${process.env.ATENCION_API_TOKEN}`
                        : '',
                    ...extraHeaders,
                },
            },
            response,
        );
        return { status, body };
    }
    for (const route of [
        '/',
        '/dashboard.css',
        '/dashboard.js',
        '/dashboard-config.js',
    ]) {
        assert.equal(consultar(route).status, 200);
    }
    assert.match(consultar('/').body, /dashboard.css/);
    assert.equal(
        consultar('/api/atencion-humana/ausente/atender', 'POST').status,
        404,
    );
    const route = `/api/atencion-humana/${solicitud.id}/atender`;
    assert.equal(
        consultar(route, 'POST', { origin: 'https://otro-sitio.test' }).status,
        403,
    );
    assert.equal(consultar(route, 'POST').status, 200);
    const fecha = leerSolicitudes(archivo)[0].atendidoEn;
    assert.ok(fecha);
    assert.equal(consultar(route, 'POST').status, 200);
    const guardado = leerSolicitudes(archivo)[0];
    assert.equal(guardado.atendidoEn, fecha);
    assert.equal(guardado.estadoFlujoAnterior, 'esperando_documento');
    assert.equal(
        JSON.parse(consultar('/api/atencion-humana?estado=pendiente').body)
            .total,
        0,
    );
    assert.equal(
        JSON.parse(consultar('/api/atencion-humana?estado=atendido').body)
            .total,
        1,
    );
});
