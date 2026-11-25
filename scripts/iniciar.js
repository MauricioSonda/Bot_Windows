const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { spawnSync, spawn } = require('child_process');
const root = path.resolve(__dirname, '..');
process.chdir(root);

async function prepararInstalacion() {
    if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Se requiere Node.js 24 o superior.');
    const firma = createHash('sha256').update(fs.readFileSync('package-lock.json')).update(fs.readFileSync('package.json'))
        .update(`${process.platform}/${process.arch}/${process.versions.node.split('.')[0]}`).digest('hex');
    let guardada;
    try { guardada = JSON.parse(fs.readFileSync('.instalacion-local.json', 'utf8')).firma; } catch (_) { /* Primera ejecución. */ }
    const guardarInstalacion = () => fs.writeFileSync('.instalacion-local.json', JSON.stringify({ firma }, null, 2) + '\n');
    const ejecutar = (programa, args, extra = {}) => {
        const resultado = spawnSync(programa, args, { cwd: root, stdio: 'inherit', ...extra });
        if (resultado.error || resultado.status !== 0) throw new Error(resultado.error?.message || `Falló la preparación (${resultado.status}). Revise el mensaje anterior y vuelva a ejecutar iniciar-bot.cmd.`);
    };
    if (guardada !== firma || !fs.existsSync('node_modules/puppeteer/package.json') || !fs.existsSync('node_modules/qrcode-terminal/package.json')) {
        console.log('Instalando dependencias para este equipo. Chrome se preparará por separado...');
        // Argumentos constantes: npm.cmd necesita un intérprete en Windows.
        const env = { ...process.env, HUSKY: '0', PUPPETEER_SKIP_DOWNLOAD: 'true',
            PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH };
        const argumentosNpm = ['ci', '--ignore-scripts', '--no-audit', '--no-fund'];
        const npmCli = process.env.npm_execpath || path.resolve(path.dirname(process.execPath),
            process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js');
        if (fs.existsSync(npmCli)) ejecutar(process.execPath, [npmCli, ...argumentosNpm], { env });
        else ejecutar(process.platform === 'win32' ? 'npm.cmd' : 'npm', argumentosNpm, { shell: process.platform === 'win32', env });
        // Una descarga de Chrome fallida no debe obligar a reinstalar node_modules.
        guardarInstalacion();
    }
    let navegador = process.env.BOT_CHROME_PATH;
    if (navegador && !fs.statSync(navegador, { throwIfNoEntry: false })?.isFile()) throw new Error('BOT_CHROME_PATH no apunta a un navegador existente.');
    if (!navegador) navegador = await require('./preparar-chrome').prepararChrome({
        instalarChromeSistema: process.platform === 'win32' ? async () => {
            console.log('Windows puede solicitar autorización para instalar Google Chrome.');
            ejecutar('winget.exe', ['install', '--id', 'Google.Chrome', '--exact', '--source', 'winget', '--accept-source-agreements', '--accept-package-agreements']);
        } : undefined,
    });
    if (!navegador || !fs.statSync(navegador, { throwIfNoEntry: false })?.isFile())
        throw new Error(`El navegador preparado no tiene un ejecutable disponible: ${navegador || '(sin ruta)'}`);
    // El bot debe utilizar exactamente la ruta que se verificó, no otra calculada antes de instalar.
    process.env.BOT_CHROME_PATH = navegador;
    guardarInstalacion();
    return navegador;
}

async function iniciar() {
    const config = require('../configuracion');
    const { adquirirInstancia, solicitarControl } = require('../control-ejecucion');
    try {
        const datos = JSON.parse(fs.readFileSync(config.ARCHIVO_CONTROL, 'utf8'));
        await solicitarControl(datos, 'mostrar');
        console.log('El bot ya estaba iniciado. Se abrió su dashboard.');
        return;
    } catch (_) { /* No hay una instancia disponible todavía. */ }
    let inicio;
    try { inicio = adquirirInstancia(path.join(config.CARPETA_DATOS, '.iniciador.json')); }
    catch (error) { if (error.code === 'BOT_YA_ACTIVO') { console.log('El bot ya está iniciándose. Espere a que aparezca Chrome.'); return; } throw error; }
    process.once('exit', () => inicio.liberar());
    try {
        await prepararInstalacion();
        require('../entorno').prepararDatos(config);
        if (process.platform === 'win32') {
            const accesos = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'crear-accesos.ps1'),
                '-ArchivoControl', config.ARCHIVO_CONTROL, '-DatosDir', config.CARPETA_DATOS, '-ExpedientesDir', config.CARPETA_EXPEDIENTES,
                '-ChromePath', process.env.BOT_CHROME_PATH, '-Puerto', String(config.API_ATENCION.PUERTO)], { stdio: 'inherit', windowsHide: true });
            if (accesos.error || accesos.status !== 0) console.warn('No se pudieron crear los accesos directos. Puede usar iniciar-bot.cmd y el botón Apagar bot del dashboard.');
        }
    } catch (error) { inicio.liberar(); throw error; }
    console.log(`Expedientes: ${config.CARPETA_EXPEDIENTES}`);
    console.log('Al aparecer el QR, vincule WhatsApp. Espere Listo para recibir mensajes nuevos.');
    const bot = spawn(process.execPath, [path.join(root, 'prueba-atencion.js')], { cwd: root, stdio: 'inherit' });
    process.on('SIGINT', () => { if (process.platform !== 'win32') bot.kill('SIGINT'); });
    process.on('SIGTERM', () => bot.kill('SIGTERM'));
    bot.on('error', (error) => { inicio.liberar(); console.error(error.message); process.exitCode = 1; });
    bot.on('exit', (code) => { inicio.liberar(); process.exitCode = code || 0; });
}

if (require.main === module) {
    iniciar().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { prepararInstalacion };
