const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Readable } = require('stream');
const { crearRevisiones } = require('./revision-documentos');
const { prepararEstadoDocumentos } = require('./estado-documentos');
const { crearServidorAtencion } = require('./api-atencion');

function escenario(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codesvi-revision-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const ruta = path.join(dir, 'INE.jpg');
    fs.writeFileSync(ruta, 'archivo de prueba');
    const inscripciones = ['exp1', 'exp2'].map((id) => ({ id, expedienteId: id, programa: id,
        requisitos: [{ id: 'INE', nombre: 'INE' }], documentos: { INE: { estado: 'recibido', archivos: [{ ruta }] } } }));
    const persona = { id: 'persona', contactoId: '123@lid', nombreCompleto: 'Persona Prueba', inscripciones };
    const archivo = path.join(dir, 'revisiones.json');
    return { persona, archivo, ruta, revisiones: crearRevisiones({ archivo }) };
}

function cambios(persona, id, estado) {
    return persona.inscripciones.find((item) => item.id === id).resumenDocumentos.requisitos.map((doc) => ({
        id: doc.id, huella: doc.huella, estado, observacion: estado === 'incompleto' ? 'Falta reverso.' : '',
    }));
}

test('Validación independiente y cierre explícito solo al validar todos los programas', (t) => {
    const { persona, revisiones, archivo } = escenario(t);
    const preparada = () => revisiones.preparar(prepararEstadoDocumentos(persona));
    let actual = revisiones.guardar(preparada(), 'exp1', cambios(preparada(), 'exp1', 'validado'));
    assert.equal(actual.inscripciones[0].revision.estado, 'validado');
    assert.equal(actual.validacionPersonal, 'pendiente');
    assert.equal(revisiones.historial().length, 0);
    assert.throws(() => revisiones.finalizar(preparada()), /todas las inscripciones/);
    actual = revisiones.guardar(preparada(), 'exp2', cambios(preparada(), 'exp2', 'incompleto'));
    assert.equal(actual.inscripciones[1].revision.estado, 'incompleto');
    assert.equal(actual.validacionPersonal, 'incompleto');
    assert.equal(actual.revisionPersonal, 'revisado');
    actual = revisiones.guardar(preparada(), 'exp2', cambios(preparada(), 'exp2', 'validado'));
    assert.equal(actual.validacionPersonal, 'validado');
    assert.equal(revisiones.historial().length, 0);
    revisiones.finalizar(preparada());
    assert.equal(revisiones.historial().length, 1);
    revisiones.guardar(preparada(), 'exp2', cambios(preparada(), 'exp2', 'validado'));
    revisiones.finalizar(preparada());
    assert.equal(revisiones.historial().length, 1);
    assert.equal(crearRevisiones({ archivo }).preparar(prepararEstadoDocumentos(persona)).validacionPersonal, 'validado');
    revisiones.guardar(preparada(), 'exp1', cambios(preparada(), 'exp1', 'incompleto'));
    assert.equal(revisiones.historial()[0].inscripciones[0].revision.estado, 'validado');
});

test('Rechaza formularios obsoletos; un archivo desaparecido requiere revisión y puede validarse manualmente', (t) => {
    const { persona, revisiones, ruta } = escenario(t);
    const preparada = () => revisiones.preparar(prepararEstadoDocumentos(persona));
    const anterior = preparada();
    revisiones.guardar(anterior, 'exp1', cambios(anterior, 'exp1', 'validado'));
    fs.writeFileSync(ruta, 'archivo reemplazado con contenido distinto');
    assert.equal(preparada().inscripciones[0].revision.estado, 'pendiente');
    assert.throws(() => revisiones.guardar(preparada(), 'exp1', cambios(anterior, 'exp1', 'validado')), /cambiaron/);
    fs.unlinkSync(ruta);
    const actual = revisiones.guardar(preparada(), 'exp1', cambios(preparada(), 'exp1', 'validado'));
    assert.equal(actual.inscripciones[0].resumenDocumentos.requisitos[0].revision.validadoSinDocumentoDigital, true);
});

test('Validar sin adjunto conserva el comentario y no inventa archivos recibidos; el comentario sigue siendo opcional', (t) => {
    const { persona, revisiones, ruta, archivo } = escenario(t);
    fs.unlinkSync(ruta);
    const preparada = () => revisiones.preparar(prepararEstadoDocumentos(persona));
    const revision = cambios(preparada(), 'exp1', 'validado');
    revision[0].observacion = 'Revisado y guardado manualmente en expediente físico.';
    const actual = revisiones.guardar(preparada(), 'exp1', revision);
    const requisito = actual.inscripciones[0].resumenDocumentos.requisitos[0];
    assert.equal(requisito.revision.estado, 'validado');
    assert.equal(requisito.revision.validadoSinDocumentoDigital, true);
    assert.equal(requisito.revision.observacion, revision[0].observacion);
    assert.equal(requisito.archivosGuardados, 0);
    assert.equal(requisito.estado, 'pendiente');
    assert.equal(fs.existsSync(ruta), false);
    const otro = revisiones.guardar(preparada(), 'exp2', cambios(preparada(), 'exp2', 'validado'));
    assert.equal(otro.revisionPersonal, 'revisado');
    revisiones.finalizar(preparada());
    const historial = crearRevisiones({ archivo }).historial();
    assert.equal(historial[0].inscripciones[0].resumenDocumentos.requisitos[0].revision.observacion, revision[0].observacion);
    assert.equal(historial[0].inscripciones[1].resumenDocumentos.requisitos[0].revision.validadoSinDocumentoDigital, true);
});

test('API: revisión mixta permite cierre explícito, conserva rechazos y no duplica historial', async (t) => {
    const { persona, revisiones } = escenario(t);
    const pendientes = [{ id: 's1', contactoId: '123@lid', estado: 'pendiente' }];
    let notificaciones = 0;
    const server = crearServidorAtencion({ clientes: () => [persona], listar: () => pendientes, revisiones,
        atender: (id) => { const item = pendientes.find((item) => item.id === id); item.estado = 'atendido'; return item; },
        alAtender: () => { notificaciones += 1; },
    });
    const consultar = (url, method = 'GET', body) => new Promise((resolve) => {
        const request = Readable.from(body ? [JSON.stringify(body)] : []);
        Object.assign(request, { url, method, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080',
            'content-type': 'application/json', authorization: process.env.ATENCION_API_TOKEN ? `Bearer ${process.env.ATENCION_API_TOKEN}` : '' } });
        let status;
        server.emit('request', request, { setHeader() {}, writeHead(value) { status = value; },
            end(value) { resolve({ status, data: JSON.parse(value) }); } });
    });
    assert.equal((await consultar('/api/atencion-humana/s1/atender', 'POST')).status, 409);
    let actual = (await consultar('/api/clientes/persona')).data;
    assert.equal((await consultar('/api/clientes/persona/inscripciones/exp1/revision', 'POST', { documentos: cambios(actual, 'exp1', 'validado') })).status, 200);
    assert.equal(pendientes[0].estado, 'pendiente');
    assert.equal(notificaciones, 0);
    actual = (await consultar('/api/clientes/persona')).data;
    assert.equal((await consultar('/api/clientes/persona/inscripciones/exp2/revision', 'POST', { documentos: cambios(actual, 'exp2', 'incompleto') })).status, 200);
    assert.equal(pendientes[0].estado, 'pendiente');
    assert.equal(notificaciones, 0);
    assert.equal((await consultar('/api/historial')).data.total, 0);
    assert.equal((await consultar('/api/clientes/persona/atender', 'POST')).status, 200);
    assert.equal(pendientes[0].estado, 'atendido');
    assert.equal(notificaciones, 1);
    assert.equal((await consultar('/api/historial')).data.total, 1);
    assert.equal((await consultar('/api/historial')).data.solicitudes[0].estado, 'revisado_con_observaciones');
    assert.equal((await consultar('/api/clientes/persona/atender', 'POST')).status, 200);
    assert.equal(notificaciones, 1);
    assert.equal((await consultar('/api/historial')).data.total, 1);
});

test('Con 1 o 4 programas, un solo documento sin revisar bloquea; todos rechazados permiten atender', (t) => {
    for (const cantidad of [1, 4]) {
        const { persona, revisiones, ruta } = escenario(t);
        persona.inscripciones = Array.from({ length: cantidad }, (_, index) => ({
            id: `programa-${index}`, requisitos: [{ id: 'INE', nombre: 'INE' }, { id: 'CURP', nombre: 'CURP' }],
            documentos: { INE: { archivos: [{ ruta }] }, CURP: { archivos: [{ ruta }] } },
        }));
        const preparada = () => revisiones.preparar(prepararEstadoDocumentos(persona));
        for (const inscripcion of persona.inscripciones) {
            const items = cambios(preparada(), inscripcion.id, 'incompleto');
            items[1].estado = 'pendiente';
            revisiones.guardar(preparada(), inscripcion.id, items);
        }
        assert.equal(preparada().revisionPersonal, 'pendiente');
        assert.throws(() => revisiones.finalizar(preparada()), /revise todos los documentos/);
        for (const inscripcion of persona.inscripciones) revisiones.guardar(preparada(), inscripcion.id, cambios(preparada(), inscripcion.id, 'incompleto'));
        assert.equal(preparada().revisionPersonal, 'revisado');
        assert.equal(preparada().validacionPersonal, 'incompleto');
        assert.equal(revisiones.finalizar(preparada()).atencionConfirmada, true);
        assert.equal(revisiones.historial()[0].estado, 'revisado_con_observaciones');
    }
});
