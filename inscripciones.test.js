const { test } = require('node:test');
const assert = require('node:assert/strict');
const { obtenerInscripciones, programasDisponibles, subprogramasDisponibles } = require('./inscripciones');
const { manejarDocumentos } = require('./flujo-documentos');
const { listarClientes } = require('./datos-dashboard');
const { crearServidorAtencion } = require('./api-atencion');

test('Conserva dos inscripciones y excluye solo subprogramas completados tras reiniciar', async () => {
    const cliente = { nombreCompleto: 'Cliente Prueba', programa: 'Mejoramiento de vivienda', subprograma: 'Piso firme',
        expedienteId: 'exp1', estado: 'esperando_documento', indiceDocumento: 0,
        requisitos: [{ id: 'Dato', nombre: 'Dato de prueba', tipo: 'texto' }], documentos: {} };
    const respuestas = [];
    const mensaje = { type: 'chat', body: 'dato', id: { _serialized: 'm1' }, reply: async (texto) => respuestas.push(texto) };
    await manejarDocumentos(mensaje, cliente, (cambios) => Object.assign(cliente, cambios));
    assert.equal(cliente.estado, 'esperando_otro_programa');
    assert.deepEqual(subprogramasDisponibles(cliente, 'Mejoramiento de vivienda'), ['Techo firme']);
    assert.match(respuestas.at(-1), /¿Desea inscribirse en otro programa/);
    const reiniciado = JSON.parse(JSON.stringify(cliente));
    Object.assign(reiniciado, { subprograma: 'Techo firme', expedienteId: 'exp2', completadoEn: null,
        estado: 'esperando_documento', indiceDocumento: 0, documentos: {} });
    await manejarDocumentos(mensaje, reiniciado, (cambios) => Object.assign(reiniciado, cambios));
    const inscritos = obtenerInscripciones(reiniciado);
    assert.equal(inscritos.length, 2);
    assert.equal(inscritos[0].documentos.Dato.valor, 'dato');
    assert.equal(programasDisponibles(reiniciado).includes('Mejoramiento de vivienda'), false);
    assert.equal(programasDisponibles(reiniciado).includes('Equipamiento'), true);
});

test('Agrupa por teléfono y conserva personas distintas con igual nombre', () => {
    const base = { nombreCompleto: 'Mauricio Sonda', programa: 'Equipamiento', subprograma: 'Estufas ecológicas',
        completadoEn: '2026-11-19T00:00:00Z', estado: 'completado' };
    const filas = listarClientes({
        'id1@lid': { ...base, telefono: '529811111111', expedienteId: 'exp1' },
        '529811111111@c.us': { ...base, expedienteId: 'exp2', programa: 'Certeza jurídica', subprograma: 'Escrituración' },
        'id2@lid': { ...base, telefono: '529822222222', expedienteId: 'exp3' },
    });
    assert.equal(filas.length, 2);
    assert.equal(filas.find((item) => item.telefono === '529811111111').inscripciones.length, 2);
});

test('Consulta archivos de una inscripción histórica sin mezclarlos con la actual', async () => {
    const server = crearServidorAtencion({
        clientes: () => [{ id: 'id@lid', contactoId: 'id@lid', programa: 'Equipamiento',
            inscripciones: [{ id: 'exp1', documentos: { INE: { archivos: [{ ruta: 'historica.jpg' }] } } }] }],
        leerArchivo: (registro) => registro ? { contenido: Buffer.from(registro.documentos.INE.archivos[0].ruta),
            tipo: 'text/plain', inline: false, nombre: 'archivo.txt' } : null,
    });
    const resultado = await new Promise((resolve) => {
        let status;
        server.emit('request', { method: 'GET', url: '/api/clientes/id%40lid/documentos/INE/0?inscripcion=exp1',
            headers: { authorization: process.env.ATENCION_API_TOKEN ? `Bearer ${process.env.ATENCION_API_TOKEN}` : '' } },
        { writeHead(value) { status = value; }, end(body) { resolve({ status, body: String(body) }); } });
    });
    assert.equal(resultado.status, 200);
    assert.equal(resultado.body, 'historica.jpg');
});
