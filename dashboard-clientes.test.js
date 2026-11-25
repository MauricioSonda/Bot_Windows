const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolverTelefono } = require('./telefonos');
const { leerArchivoRegistrado } = require('./datos-dashboard');
const { crearServidorAtencion } = require('./api-atencion');

test('Resuelve un teléfono confirmado y no confunde un LID numérico con un teléfono', async () => {
    assert.equal(
        await resolverTelefono({}, '529811234567@c.us'),
        '529811234567',
    );
    assert.equal(
        await resolverTelefono(
            {
                getContactLidAndPhone: async () => [
                    { pn: '529811234567@c.us' },
                ],
            },
            '999@lid',
        ),
        '529811234567',
    );
    assert.equal(
        await resolverTelefono(
            {
                getContactLidAndPhone: async () => [],
                getContactById: async () => ({
                    id: { _serialized: '123456789@lid' },
                    number: '123456789',
                }),
            },
            '999@lid',
        ),
        null,
    );
});

test('Sirve solo archivos registrados dentro de la carpeta permitida, sin seguir escapes por enlaces', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codesvi-media-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const root = path.join(dir, 'expedientes');
    fs.mkdirSync(root);
    const ruta = path.join(root, 'INE.png');
    fs.writeFileSync(ruta, Buffer.from('imagen de prueba'));
    const registro = { documentos: { INE: { archivos: [{ ruta }] } } };
    assert.equal(
        leerArchivoRegistrado(registro, 'INE', '0', root).tipo,
        'image/png',
    );
    assert.equal(leerArchivoRegistrado(registro, 'INE', '1', root), null);
    const fuera = path.join(dir, 'privado.txt');
    fs.writeFileSync(fuera, 'no publicar');
    fs.symlinkSync(fuera, path.join(root, 'enlace.txt'));
    registro.documentos.INE.archivos[0].ruta = path.join(root, 'enlace.txt');
    assert.equal(leerArchivoRegistrado(registro, 'INE', '0', root), null);
});

test('Lista los clientes de recopilación, enriquece teléfono y abre el chat por ID', async () => {
    let abierto;
    const server = crearServidorAtencion({
        listar: () => [
            { id: 's1', contactoId: '999@lid', estado: 'pendiente' },
        ],
        clientes: () => [
            {
                id: '999@lid',
                contactoId: '999@lid',
                telefono: '529811234567',
                programa: 'Equipamiento',
            },
            {
                id: 'otro@lid',
                contactoId: 'otro@lid',
                nombreCompleto: 'Solo atención personal',
            },
        ],
        abrirChat: async (id) => {
            abierto = id;
        },
    });
    const consultar = (url, method = 'GET') =>
        new Promise((resolve) => {
            let status;
            server.emit(
                'request',
                {
                    url,
                    method,
                    headers: {
                        host: '127.0.0.1:3080',
                        'content-type': 'application/json',
                        authorization: process.env.ATENCION_API_TOKEN
                            ? `Bearer ${process.env.ATENCION_API_TOKEN}`
                            : '',
                    },
                },
                {
                    setHeader() {},
                    writeHead(value) {
                        status = value;
                    },
                    end(body) {
                        resolve({ status, body: JSON.parse(body) });
                    },
                },
            );
        });
    const listado = await consultar('/api/clientes');
    assert.equal(listado.body.total, 1);
    assert.equal(
        (await consultar('/api/atencion-humana')).body.solicitudes[0].telefono,
        '529811234567',
    );
    assert.equal(
        (await consultar('/api/clientes/999%40lid/abrir-chat', 'POST')).status,
        200,
    );
    assert.equal(abierto, '999@lid');
});
