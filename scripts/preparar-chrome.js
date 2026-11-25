const fs = require('fs');
const path = require('path');

function detectarChromeWindows({ plataforma = process.platform, env = process.env, esArchivo = (ruta) => {
    try { return fs.statSync(ruta).isFile(); } catch (_) { return false; }
} } = {}) {
    if (plataforma !== 'win32') return null;
    return [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA]
        .filter(Boolean).map((base) => path.win32.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'))
        .find(esArchivo) || null;
}

function describirError(error) {
    const mensajes = [];
    const visitados = new Set();
    function visitar(actual) {
        if (!actual || visitados.has(actual)) return;
        visitados.add(actual);
        mensajes.push([actual.code, actual.message || String(actual)].filter(Boolean).join(': '));
        visitar(actual.cause);
        if (Array.isArray(actual.errors)) actual.errors.forEach(visitar);
    }
    visitar(error);
    return mensajes.join('\nCausa: ');
}

async function prepararChrome({ puppeteer = require('puppeteer'), browsers, log = console.log,
    plataforma = process.platform, detectarSistema = () => detectarChromeWindows({ plataforma }), instalarChromeSistema } = {}) {
    browsers ||= require(require.resolve('@puppeteer/browsers', {
        paths: [path.dirname(require.resolve('puppeteer/package.json'))],
    }));
    const config = puppeteer.default.configuration;
    if (config.executablePath) {
        if (!fs.existsSync(config.executablePath)) throw new Error('El ejecutable configurado de Chrome no existe. Revise PUPPETEER_EXECUTABLE_PATH.');
        return config.executablePath;
    }
    const sistema = detectarSistema();
    if (sistema) {
        log(`Usando Google Chrome instalado: ${sistema}`);
        return sistema;
    }
    async function alternativa(error) {
        log('Detalle del fallo al preparar Chrome:\n' + describirError(error));
        if (plataforma === 'win32' && instalarChromeSistema) {
            log('Intentando instalar Google Chrome mediante WinGet...');
            try {
                await instalarChromeSistema();
                const instalado = detectarSistema();
                if (instalado) { log(`Usando Google Chrome instalado: ${instalado}`); return instalado; }
                throw new Error('WinGet terminó, pero no se encontró chrome.exe en las ubicaciones habituales.');
            } catch (segundoError) {
                throw new Error('No se pudo preparar Chrome. Instale Google Chrome o configure BOT_CHROME_PATH.\n' + describirError(error) + '\nWinGet: ' + describirError(segundoError));
            }
        }
        throw new Error('No se pudo preparar Chrome. Las dependencias ya instaladas se conservaron.\n' + describirError(error));
    }
    const platform = browsers.detectBrowserPlatform();
    if (!platform) throw new Error('Esta plataforma no admite la descarga automática de Chrome.');
    const buildId = await browsers.resolveBuildId(browsers.Browser.CHROME, platform,
        config.chrome?.version || puppeteer.PUPPETEER_REVISIONS.chrome);
    const opciones = { browser: browsers.Browser.CHROME, platform, buildId, cacheDir: config.cacheDirectory };
    const ejecutable = browsers.computeExecutablePath(opciones);
    if (fs.existsSync(ejecutable)) return ejecutable;
    const carpeta = new browsers.Cache(config.cacheDirectory).installationDir(opciones.browser, platform, buildId);
    if (fs.existsSync(carpeta)) {
        log('Se encontró una descarga incompleta de Chrome. Reparando únicamente esa versión de la caché...');
        try { await browsers.uninstall(opciones); }
        catch (error) { throw new Error('No se pudo reparar la caché de Chrome. Cierre el Chrome del bot y reintente. ' + error.message); }
    }
    log(`Descargando Chrome ${buildId}. No se instalará chrome-headless-shell.`);
    let instalado;
    try {
        instalado = await browsers.install({ ...opciones, downloadProgressCallback: 'default', baseUrl: config.chrome?.downloadBaseUrl });
    } catch (error) {
        return alternativa(error);
    }
    const rutaReal = instalado?.executablePath || ejecutable;
    if (!fs.existsSync(rutaReal)) return alternativa(new Error(`La descarga terminó sin ejecutable: ${rutaReal}`));
    return rutaReal;
}

if (require.main === module) prepararChrome().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { prepararChrome, detectarChromeWindows, describirError };
