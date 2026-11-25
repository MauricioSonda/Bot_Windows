const fs = require('fs');
const path = require('path');

async function prepararChrome({ puppeteer = require('puppeteer'), browsers, log = console.log } = {}) {
    browsers ||= require(require.resolve('@puppeteer/browsers', {
        paths: [path.dirname(require.resolve('puppeteer/package.json'))],
    }));
    const config = puppeteer.default.configuration;
    if (config.executablePath) {
        if (!fs.existsSync(config.executablePath)) throw new Error('El ejecutable configurado de Chrome no existe. Revise PUPPETEER_EXECUTABLE_PATH.');
        return config.executablePath;
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
    try {
        await browsers.install({ ...opciones, downloadProgressCallback: 'default', baseUrl: config.chrome?.downloadBaseUrl });
    } catch (error) {
        throw new Error('No se pudo descargar Chrome. Las dependencias ya instaladas se conservaron; repita iniciar-bot.cmd. ' + error.message);
    }
    if (!fs.existsSync(ejecutable)) throw new Error('La descarga terminó sin chrome.exe. Revise el historial de protección de Windows y reintente; no desactive el antivirus.');
    return ejecutable;
}

if (require.main === module) prepararChrome().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { prepararChrome };
