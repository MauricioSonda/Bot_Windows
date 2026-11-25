const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { migrarRutas } = require('./migrar-rutas-expedientes');
const { resumirDocumentos } = require('./estado-documentos');
const { crearExpediente } = require('./documentos');
const { leerArchivoRegistrado } = require('./datos-dashboard');

test('Crea expedientes con una carpeta intermedia del programa', () => {
    const expediente = crearExpediente('Persona Prueba', 'id@lid', 'Mejoramiento de vivienda');
    assert.equal(path.basename(path.dirname(expediente.carpetaExpediente)), 'Mejoramiento_de_vivienda');
    assert.equal(path.basename(path.dirname(path.dirname(expediente.carpetaExpediente))), 'id_lid');
    assert.throws(() => crearExpediente('Persona', 'id'));
});

test('Migra archivos y todas sus referencias con respaldo, conservando la vista previa', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codesvi-rutas-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const raiz = path.join(dir, 'Bot_Atencion');
    const carpeta = path.join(raiz, 'Persona', 'id', 'EXP-1');
    fs.mkdirSync(carpeta, { recursive: true });
    const ruta = path.join(carpeta, 'INE.jpg');
    fs.writeFileSync(ruta, Buffer.from('imagen-prueba'));
    const registro = { expedienteId: 'EXP-1', programa: 'Mejoramiento de vivienda', carpetaExpediente: carpeta,
        documentos: { INE: { archivos: [{ ruta }] } } };
    const clientes = path.join(dir, 'clientes.json');
    const solicitudes = path.join(dir, 'solicitudes.json');
    fs.writeFileSync(clientes, JSON.stringify({ persona: { ...registro, inscripciones: [{ ...registro, id: 'EXP-1' }] } }));
    fs.writeFileSync(solicitudes, JSON.stringify([registro]));
    const options = { raiz, archivos: [clientes, solicitudes], respaldos: path.join(dir, 'respaldos') };
    assert.equal(migrarRutas(options).expedientes, 1);
    assert.ok(fs.existsSync(ruta));
    const resultado = migrarRutas({ ...options, aplicar: true });
    assert.ok(fs.existsSync(resultado.respaldo));
    const nuevo = JSON.parse(fs.readFileSync(clientes, 'utf8')).persona;
    assert.match(nuevo.carpetaExpediente, /Mejoramiento_de_vivienda/);
    assert.equal(nuevo.documentos.INE.archivos[0].ruta, nuevo.inscripciones[0].documentos.INE.archivos[0].ruta);
    assert.equal(nuevo.carpetaExpediente, JSON.parse(fs.readFileSync(solicitudes, 'utf8'))[0].carpetaExpediente);
    assert.equal(leerArchivoRegistrado(nuevo, 'INE', '0', raiz).contenido.toString(), 'imagen-prueba');
    assert.equal(migrarRutas({ ...options, aplicar: true }).expedientes, 0);
});

test('Enumera TODOS los requisitos: recibidos, parciales, faltantes, texto y no aplica', () => {
    const resumen = resumirDocumentos({
        requisitos: ['INE', 'CURP', 'Acta', 'Domicilio', 'Contacto', 'Opcional'].map((id) => ({ id, nombre: id, opcional: id === 'Opcional' })),
        documentos: {
            INE: { estado: 'recibido', archivos: [{ ruta: 'existe' }] },
            CURP: { estado: 'recibiendo', archivos: [{ ruta: 'existe' }] },
            Domicilio: { estado: 'recibido', archivos: [{ ruta: 'no-existe' }] },
            Contacto: { estado: 'recibido', valor: 'dato' },
            Opcional: { estado: 'no_aplica' },
        },
    }, (ruta) => ruta === 'existe');
    assert.equal(resumen.requisitos.length, 6);
    assert.equal(resumen.recibidos, 2);
    assert.equal(resumen.pendientes, 3);
    assert.equal(resumen.noAplican, 1);
    assert.deepEqual(resumen.requisitos.filter((item) => ['pendiente', 'incompleto'].includes(item.estado)).map((item) => item.id), ['CURP', 'Acta', 'Domicilio']);
    assert.equal(resumen.requisitos.find((item) => item.id === 'Domicilio').archivosFaltantes, 1);
});
