const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ALIAS_DE_OPCIONES, encontrarOpcion, encontrarPrograma, obtenerProgramas, obtenerSubprogramas } = require('./programas');
const { crearFlujoDestino } = require('./flujo-destino');

test('Todos los programas y subprogramas admiten sus nombres, alias y mayúsculas', () => {
    const programas = obtenerProgramas();
    for (const programa of programas) {
        assert.equal(encontrarPrograma(programa.toUpperCase()), programa);
        for (const opcion of [programa, ...obtenerSubprogramas(programa)]) {
            for (const entrada of [opcion, ...(ALIAS_DE_OPCIONES[opcion] || [])]) {
                assert.equal(encontrarOpcion(`  ${entrada.toUpperCase()}  `, [opcion]), opcion, entrada);
            }
        }
    }
    for (const entrada of ['piso', 'Piso', 'Piso Firme', 'PISO FIRME', '1'])
        assert.equal(encontrarOpcion(entrada, obtenerSubprogramas('Mejoramiento de vivienda')), 'Piso firme');
    for (const entrada of ['baño', 'BANO', 'cuarto para baño', '2'])
        assert.equal(encontrarOpcion(entrada, obtenerSubprogramas('Ampliación de vivienda')), 'Cuarto de baño');
});

test('Números y alias respetan las opciones disponibles; no se adivinan opciones ambiguas', () => {
    for (const programa of obtenerProgramas())
        obtenerSubprogramas(programa).forEach((opcion, indice, opciones) => assert.equal(encontrarOpcion(String(indice + 1), opciones), opcion));
    assert.equal(encontrarOpcion('piso', ['Techo firme']), undefined);
    assert.equal(encontrarOpcion('1', ['Techo firme']), 'Techo firme');
    assert.equal(encontrarOpcion('estufa', obtenerProgramas()), 'Equipamiento');
    assert.equal(encontrarOpcion('estufa', ['Estufas ecológicas']), 'Estufas ecológicas');
    assert.equal(encontrarOpcion('estufa', ['Equipamiento', 'Estufas ecológicas']), undefined);
    assert.equal(encontrarOpcion('cuarto', obtenerSubprogramas('Ampliación de vivienda')), undefined);
    for (const entrada of ['', ' ', '9', '1abc', 'pisox'])
        assert.equal(encontrarOpcion(entrada, ['Piso firme']), undefined);
});

test('El flujo separado de Certeza jurídica acepta escrituras y regularizar', async () => {
    for (const [entrada, tramite] of [['escrituras', 'Escrituración'], ['REGULARIZAR', 'Regularización']]) {
        const cliente = { nombreCompleto: 'Persona Prueba', estado: 'esperando_tramite_certeza', destinoAtencion: 'certeza' };
        let registrado;
        const flujo = crearFlujoDestino({ actualizarCliente: (_, cambios) => Object.assign(cliente, cambios),
            registrar: (_, datos) => { registrado = datos; return { id: 'solicitud', solicitadoEn: 'fecha' }; } });
        await flujo({ body: entrada, type: 'chat', from: '123@c.us', reply: async () => {} }, cliente);
        assert.equal(registrado.subprograma, tramite);
        assert.equal(cliente.estado, 'atencion_humana');
    }
});
