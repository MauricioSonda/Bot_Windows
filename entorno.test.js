const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { obtenerEscritorio, comandoAbrirCarpeta, prepararDatos } = require('./entorno');
const { obtenerRequisitos } = require('./requisitos');

test('Windows detecta el Escritorio redirigido y pasa la ruta al Explorador sin shell', () => {
    const escritorio = 'C:\\Users\\Persona Prueba\\OneDrive\\Escritorio';
    let args;
    assert.equal(obtenerEscritorio({ plataforma: 'win32', ejecutar: (...params) => { args = params; return '\uFEFF' + escritorio + '\r\n'; } }), escritorio);
    assert.equal(args[0], 'powershell.exe');
    assert.match(args[1].at(-1), /DesktopDirectory/);
    const carpeta = escritorio + '\\Bot_Atencion\\Nombre con acentos\\EXP-1';
    assert.deepEqual(comandoAbrirCarpeta(carpeta, 'win32', { SystemRoot: 'C:\\Windows' }), ['C:\\Windows\\explorer.exe', [carpeta]]);
    assert.deepEqual(comandoAbrirCarpeta('/tmp/prueba', 'darwin'), ['/usr/bin/open', ['/tmp/prueba']]);
    assert.throws(() => obtenerEscritorio({ plataforma: 'win32', ejecutar: () => '' }), /localizar/);
});

test('La instalación incluye las siete fichas informativas', () => {
    for (const programa of ['Piso firme', 'Techo firme', 'Recámara', 'Cuarto de baño', 'Estufas ecológicas', 'Regularización', 'Escrituración'])
        assert.equal(fs.statSync(obtenerRequisitos(programa).imagen).isFile(), true);
});

test('Los datos nuevos se inicializan sin sobrescribir clientes ni historial existentes', (t) => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'codesvi-inicio-'));
    t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
    const config = { CARPETA_DATOS: path.join(raiz, 'datos'), CARPETA_EXPEDIENTES: path.join(raiz, 'expedientes') };
    for (const [clave, archivo] of [['ARCHIVO_CLIENTES', 'clientes.json'], ['ARCHIVO_ATENCION_HUMANA', 'atencion.json'], ['ARCHIVO_REVISIONES', 'revisiones.json']])
        config[clave] = path.join(config.CARPETA_DATOS, archivo);
    prepararDatos(config);
    assert.deepEqual(JSON.parse(fs.readFileSync(config.ARCHIVO_CLIENTES)), {});
    fs.writeFileSync(config.ARCHIVO_CLIENTES, '{"persona":{"nombreCompleto":"Nombre Existente"}}');
    prepararDatos(config);
    assert.equal(JSON.parse(fs.readFileSync(config.ARCHIVO_CLIENTES)).persona.nombreCompleto, 'Nombre Existente');
});
