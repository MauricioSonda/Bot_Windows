const { test } = require('node:test');
const assert = require('node:assert/strict');
const Client = require('./src/Client');
const CONFIG = require('./configuracion');

function preparar({ timeout = CONFIG.INICIO_SESION_TIMEOUT_MS, necesitaAutenticacion = false } = {}) {
    const cliente = new Client({ authTimeoutMs: timeout, qrMaxRetries: 0, webVersionCache: { type: 'none' } });
    const esperas = [];
    const funciones = {};
    cliente.setDeviceName = async () => {};
    cliente.getWWebVersion = async () => 'version-prueba';
    cliente.attachEventListeners = async () => {};
    cliente.info = {};
    cliente.interface = {};
    cliente.pupPage = {
        waitForFunction: async (_, opciones) => {
            esperas.push(opciones.timeout);
            return { jsonValue: async () => ({ need: necesitaAutenticacion }) };
        },
        evaluate: async () => false,
        exposeFunction: async (nombre, funcion) => { funciones[nombre] = funcion; },
    };
    return { cliente, esperas, funciones };
}

test('Windows conserva cero en las esperas de autenticación y de sincronización final', async () => {
    assert.equal(CONFIG.INICIO_SESION_TIMEOUT_MS, 0);
    const { cliente, esperas, funciones } = preparar();
    let listo = false;
    cliente.on('ready', () => { listo = true; });
    await cliente.inject();
    assert.deepEqual(esperas, [0, 0]);
    assert.equal(listo, false);
    await funciones.onAppStateHasSyncedEvent();
    assert.deepEqual(esperas, [0, 0, 0]);
    assert.equal(listo, true);
});

test('Si se configura un límite explícito, se respeta en todas las fases de inicio', async () => {
    const { cliente, esperas, funciones } = preparar({ timeout: 12345 });
    await cliente.inject();
    await funciones.onAppStateHasSyncedEvent();
    assert.deepEqual(esperas, [12345, 12345, 12345]);
});

test('El QR puede renovarse repetidamente sin cerrar el cliente mientras espera el escaneo', async () => {
    const { cliente, funciones } = preparar({ necesitaAutenticacion: true });
    let cierres = 0;
    let codigos = 0;
    cliente.destroy = async () => { cierres += 1; };
    cliente.on('qr', () => { codigos += 1; });
    await cliente.inject();
    for (let i = 0; i < 100; i += 1) await funciones.onQRChangedEvent(`qr-${i}`);
    assert.equal(codigos, 100);
    assert.equal(cierres, 0);
});
