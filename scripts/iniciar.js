const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { spawnSync, spawn } = require('child_process');
const root = path.resolve(__dirname, '..');
process.chdir(root);

function prepararInstalacion() {
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
    const puppeteer = require('puppeteer');
    const navegador = process.env.BOT_CHROME_PATH || puppeteer.executablePath();
    if (!fs.existsSync(navegador)) {
        if (process.env.BOT_CHROME_PATH) throw new Error('BOT_CHROME_PATH no apunta a un navegador existente.');
        ejecutar(process.execPath, [path.join(__dirname, 'preparar-chrome.js')]);
        if (!fs.existsSync(navegador)) throw new Error('No se pudo descargar Chrome. Revise su conexión y repita el comando.');
    }
    guardarInstalacion();
}

function iniciar() {
    prepararInstalacion();
    const config = require('../configuracion');
    require('../entorno').prepararDatos(config);
    console.log(`Expedientes: ${config.CARPETA_EXPEDIENTES}`);
    console.log('Al aparecer el QR, vincule WhatsApp. Espere el mensaje Listo. Ctrl+C detiene el bot.');
    const bot = spawn(process.execPath, [path.join(root, 'prueba-atencion.js')], { cwd: root, stdio: 'inherit' });
    process.on('SIGINT', () => { if (process.platform !== 'win32') bot.kill('SIGINT'); });
    process.on('SIGTERM', () => bot.kill('SIGTERM'));
    bot.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
    bot.on('exit', (code) => { process.exitCode = code || 0; });
}

if (require.main === module) {
    try { iniciar(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepararInstalacion };
