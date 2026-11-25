const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { CARPETA_EXPEDIENTES } = require('./configuracion');
const { comandoAbrirCarpeta } = require('./entorno');

function resolverCarpetaExpediente(registro, raiz = CARPETA_EXPEDIENTES) {
    if (!registro?.carpetaExpediente) throw Object.assign(new Error('Esta solicitud todavía no tiene una carpeta de expediente.'), { status: 404 });
    let ruta, base;
    try {
        ruta = fs.realpathSync(registro.carpetaExpediente);
        base = fs.realpathSync(raiz);
    } catch {
        throw Object.assign(new Error('La carpeta del expediente no está disponible en este equipo.'), { status: 404 });
    }
    const relativa = path.relative(base, ruta);
    if (!relativa || relativa.startsWith('..') || path.isAbsolute(relativa) || !fs.statSync(ruta).isDirectory())
        throw Object.assign(new Error('Carpeta de expediente no permitida.'), { status: 403 });
    return ruta;
}

async function abrirCarpetaExpediente(registro) {
    const ruta = resolverCarpetaExpediente(registro);
    const [ejecutable, args] = comandoAbrirCarpeta(ruta);
    try { await promisify(execFile)(ejecutable, args); }
    catch (error) {
        // Explorer puede devolver 1 después de delegar la apertura a una instancia existente.
        if (process.platform !== 'win32' || error.code !== 1) throw error;
    }
}

module.exports = { resolverCarpetaExpediente, abrirCarpetaExpediente };
