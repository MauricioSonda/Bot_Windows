const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function obtenerEscritorio({ plataforma = process.platform, ejecutar = execFileSync, home = os.homedir() } = {}) {
    if (plataforma === 'win32') {
        const escritorio = ejecutar('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)"],
        { encoding: 'utf8', windowsHide: true }).replace(/^\uFEFF/, '').trim();
        if (!escritorio || !path.win32.isAbsolute(escritorio)) throw new Error('No se pudo localizar el Escritorio de Windows. Configure BOT_EXPEDIENTES_DIR.');
        return escritorio;
    }
    return path.join(home, 'Desktop');
}

function comandoAbrirCarpeta(ruta, plataforma = process.platform, env = process.env) {
    if (plataforma === 'win32') {
        const raiz = env.SystemRoot || 'C:\\Windows';
        return [path.win32.join(raiz, 'explorer.exe'), [ruta]];
    }
    return plataforma === 'darwin' ? ['/usr/bin/open', [ruta]] : ['xdg-open', [ruta]];
}

function prepararDatos(config) {
    fs.mkdirSync(config.CARPETA_DATOS, { recursive: true });
    for (const [archivo, inicial] of [[config.ARCHIVO_CLIENTES, {}], [config.ARCHIVO_ATENCION_HUMANA, []],
        [config.ARCHIVO_REVISIONES, { expedientes: {}, historial: [] }]]) {
        try { fs.writeFileSync(archivo, JSON.stringify(inicial, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        JSON.parse(fs.readFileSync(archivo, 'utf8'));
    }
    fs.mkdirSync(config.CARPETA_EXPEDIENTES, { recursive: true });
}

module.exports = { obtenerEscritorio, comandoAbrirCarpeta, prepararDatos };
