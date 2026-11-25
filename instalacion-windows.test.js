const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const browsers = require(require.resolve('@puppeteer/browsers', { paths: [path.dirname(require.resolve('puppeteer/package.json'))] }));
const { prepararChrome, detectarChromeWindows, describirError } = require('./scripts/preparar-chrome');

function escenario(t, instalador) {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'codesvi-cache-chrome-'));
    t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
    const config = { cacheDirectory: raiz };
    const opciones = { browser: 'chrome', platform: 'win64', buildId: '146.0.7680.31', cacheDir: raiz };
    const ejecutable = browsers.computeExecutablePath(opciones);
    const carpeta = new browsers.Cache(raiz).installationDir('chrome', 'win64', opciones.buildId);
    const llamadas = [];
    const api = { ...browsers, detectBrowserPlatform: () => 'win64', resolveBuildId: async (_, __, build) => build,
        install: async (opciones) => {
            llamadas.push(opciones);
            if (instalador) return instalador({ opciones, ejecutable, carpeta, llamadas });
            fs.mkdirSync(path.dirname(ejecutable), { recursive: true }); fs.writeFileSync(ejecutable, 'chrome de prueba');
        } };
    const preparar = (extra = {}) => prepararChrome({ puppeteer: { default: { configuration: config },
        PUPPETEER_REVISIONS: { chrome: opciones.buildId } }, browsers: api, log: () => {}, ...extra });
    return { raiz, config, opciones, ejecutable, carpeta, llamadas, preparar };
}

test('Un Chrome instalado se reutiliza; headless-shell y Firefox están desactivados', async (t) => {
    const e = escenario(t);
    fs.mkdirSync(path.dirname(e.ejecutable), { recursive: true }); fs.writeFileSync(e.ejecutable, 'chrome');
    assert.equal(await e.preparar(), e.ejecutable);
    assert.equal(e.llamadas.length, 0);
    const config = require('./.puppeteerrc.cjs');
    assert.equal(config['chrome-headless-shell'].skipDownload, true);
    assert.equal(config.firefox.skipDownload, true);
});

test('Reproduce el fallo de Windows y repara solo la carpeta Chrome de esa versión', async (t) => {
    const e = escenario(t);
    fs.mkdirSync(e.carpeta, { recursive: true }); fs.writeFileSync(path.join(e.carpeta, 'descarga-incompleta'), 'restos');
    const otros = [path.join(e.raiz, 'chrome-headless-shell', 'win64-146.0.7680.31', 'restos'),
        path.join(e.raiz, 'chrome', 'win64-otra-version', 'chrome.exe'), path.join(e.raiz, 'datos-locales', 'clientes.json')];
    for (const archivo of otros) { fs.mkdirSync(path.dirname(archivo), { recursive: true }); fs.writeFileSync(archivo, 'conservar'); }
    assert.equal(await e.preparar(), e.ejecutable);
    assert.equal(fs.existsSync(path.join(e.carpeta, 'descarga-incompleta')), false);
    assert.equal(fs.existsSync(e.ejecutable), true);
    assert.equal(e.llamadas.length, 1);
    assert.equal(e.llamadas[0].browser, 'chrome');
    for (const archivo of otros) assert.equal(fs.readFileSync(archivo, 'utf8'), 'conservar');
});

test('Una descarga interrumpida puede reintentarse sin quedar atrapada en una caché incompleta', async (t) => {
    const e = escenario(t, ({ ejecutable, carpeta, llamadas }) => {
        fs.mkdirSync(carpeta, { recursive: true });
        if (llamadas.length === 1) throw new Error('Descarga interrumpida de prueba');
        fs.mkdirSync(path.dirname(ejecutable), { recursive: true }); fs.writeFileSync(ejecutable, 'chrome');
    });
    await assert.rejects(e.preparar(), /dependencias ya instaladas se conservaron/);
    assert.equal(await e.preparar(), e.ejecutable);
    assert.equal(e.llamadas.length, 2);
});

test('No elimina ni sustituye un ejecutable configurado por el usuario', async (t) => {
    const e = escenario(t);
    e.config.executablePath = path.join(e.raiz, 'chrome-personalizado.exe');
    await assert.rejects(e.preparar(), /configurado de Chrome no existe/);
    fs.writeFileSync(e.config.executablePath, 'personalizado');
    assert.equal(await e.preparar(), e.config.executablePath);
    assert.equal(e.llamadas.length, 0);
});

test('El iniciador separa npm de Chrome y transmite al bot la ruta real sin recalcularla', async (t) => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'codesvi-bootstrap-'));
    t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
    for (const name of ['package.json', 'package-lock.json']) fs.writeFileSync(path.join(raiz, name), '{}');
    const npmCli = path.join(raiz, 'npm-cli.js'); fs.writeFileSync(npmCli, '');
    const ejecutable = path.join(raiz, 'chrome.exe');
    const fsAislado = new Proxy(fs, { get(target, propiedad) {
        if (['readFileSync', 'writeFileSync', 'existsSync', 'statSync'].includes(propiedad))
            return (archivo, ...args) => target[propiedad](path.isAbsolute(archivo) ? archivo : path.join(raiz, archivo), ...args);
        return target[propiedad];
    } });
    const llamadas = [];
    let descargas = 0;
    const contexto = vm.createContext({ __dirname: path.join(raiz, 'scripts'), module: { exports: {} }, console: { log() {} },
        process: { chdir() {}, platform: 'win32', arch: 'x64', execPath: '/node/node.exe', versions: { node: '26.13.1' }, env: { PATH: '', npm_execpath: npmCli } },
        require: (id) => {
            if (id === 'fs') return fsAislado;
            if (id === './preparar-chrome') return { prepararChrome: async () => {
                descargas += 1;
                if (descargas === 1) throw new Error('Extracción fallida de prueba');
                fs.writeFileSync(ejecutable, 'chrome'); return ejecutable;
            } };
            if (id === 'child_process') return { spawnSync: (_, args, opciones) => {
                llamadas.push({ args, opciones });
                if (args.includes('ci')) {
                    for (const paquete of ['puppeteer', 'qrcode-terminal']) {
                        const dir = path.join(raiz, 'node_modules', paquete); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'package.json'), '{}');
                    }
                    return { status: 0 };
                }
                throw new Error('No se esperaba este comando: ' + args.join(' '));
            } };
            return require(id);
        },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'scripts', 'iniciar.js'), 'utf8'), contexto);
    const iniciar = contexto.module.exports.prepararInstalacion;
    await assert.rejects(iniciar(), /Extracción fallida/);
    assert.equal(fs.existsSync(path.join(raiz, '.instalacion-local.json')), true);
    assert.equal(await iniciar(), ejecutable);
    assert.equal(vm.runInContext('process.env.BOT_CHROME_PATH', contexto), ejecutable);
    const npm = llamadas.filter((item) => item.args.includes('ci'));
    assert.equal(npm.length, 1);
    assert.equal(npm[0].args.includes('--ignore-scripts'), true);
    assert.equal(npm[0].opciones.env.PUPPETEER_SKIP_DOWNLOAD, 'true');
    assert.equal(descargas, 2);
});

test('Detecta Chrome de Windows instalado para el usuario y lo utiliza sin descargar ni reparar cachés', async (t) => {
    const esperado = 'C:\\Users\\Persona Prueba\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
    assert.equal(detectarChromeWindows({ plataforma: 'win32', env: { ProgramFiles: 'C:\\Program Files',
        'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\Persona Prueba\\AppData\\Local' },
    esArchivo: (ruta) => ruta === esperado }), esperado);
    const e = escenario(t);
    assert.equal(await e.preparar({ plataforma: 'win32', detectarSistema: () => esperado }), esperado);
    assert.equal(e.llamadas.length, 0);
    assert.equal(fs.existsSync(e.carpeta), false);
});

test('Usa la ruta devuelta por la instalación aunque sea diferente de la calculada inicialmente', async (t) => {
    let otraRuta;
    const e = escenario(t, ({ carpeta }) => {
        otraRuta = path.join(carpeta, 'otra-ubicacion', 'chrome.exe');
        fs.mkdirSync(path.dirname(otraRuta), { recursive: true }); fs.writeFileSync(otraRuta, 'chrome');
        return { executablePath: otraRuta };
    });
    assert.equal(await e.preparar(), otraRuta);
    assert.equal(fs.existsSync(e.ejecutable), false);
});

test('Una extracción fallida muestra la causa y permite usar Chrome instalado por WinGet', async (t) => {
    const causa = Object.assign(new Error('No se pudo extraer chrome.exe'), { code: 'EPERM' });
    const error = new Error('Extracción interrumpida', { cause: causa });
    assert.match(describirError(error), /EPERM: No se pudo extraer chrome\.exe/);
    const e = escenario(t, () => { throw error; });
    let disponible = false, instalaciones = 0;
    const ruta = path.join(e.raiz, 'chrome-sistema.exe');
    const mensajes = [];
    assert.equal(await e.preparar({ plataforma: 'win32', detectarSistema: () => disponible ? ruta : null,
        instalarChromeSistema: async () => { instalaciones += 1; fs.writeFileSync(ruta, 'chrome'); disponible = true; },
        log: (mensaje) => mensajes.push(mensaje) }), ruta);
    assert.equal(instalaciones, 1);
    assert.ok(mensajes.some((mensaje) => mensaje.includes('EPERM')));
});
