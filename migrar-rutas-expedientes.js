const fs = require('fs');
const path = require('path');
const CONFIG = require('./configuracion');

function nombreSeguro(value) {
    return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 90);
}

function migrarRutas({ aplicar = false, raiz = CONFIG.CARPETA_EXPEDIENTES,
    archivos = [CONFIG.ARCHIVO_CLIENTES, CONFIG.ARCHIVO_ATENCION_HUMANA],
    respaldos = path.join(__dirname, 'respaldos-rutas') } = {}) {
    const fuentes = archivos.filter((archivo) => fs.existsSync(archivo)).map((archivo) =>
        ({ archivo, original: fs.readFileSync(archivo, 'utf8') }));
    const movimientos = new Map();
    function buscar(objeto) {
        if (!objeto || typeof objeto !== 'object') return;
        if (objeto.expedienteId && objeto.carpetaExpediente && objeto.programa) {
            const origen = path.resolve(objeto.carpetaExpediente);
            const relative = path.relative(raiz, origen);
            const partes = relative.split(path.sep);
            if (!relative.startsWith('..') && !path.isAbsolute(relative) && partes.length === 3 && partes[2] === objeto.expedienteId) {
                const programa = nombreSeguro(objeto.programa);
                if (!programa) throw new Error('Nombre de programa vacío.');
                const destino = path.join(path.dirname(origen), programa, objeto.expedienteId);
                if (movimientos.has(origen) && movimientos.get(origen) !== destino) throw new Error('Un expediente tiene programas contradictorios.');
                movimientos.set(origen, destino);
            }
        }
        for (const valor of Object.values(objeto)) if (valor && typeof valor === 'object') buscar(valor);
    }
    const datos = fuentes.map((fuente) => JSON.parse(fuente.original));
    datos.forEach(buscar);
    for (const [origen, destino] of movimientos) {
        if (!fs.existsSync(origen)) throw new Error('Falta una carpeta de expediente. No se modifica ninguna ruta.');
        const real = fs.realpathSync(origen);
        const relative = path.relative(fs.realpathSync(raiz), real);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Expediente fuera de la carpeta permitida.');
        if (fs.existsSync(destino)) throw new Error('El destino ya existe; no se sobrescribirá.');
        const padre = path.dirname(destino);
        if (fs.existsSync(padre) && fs.realpathSync(padre) !== padre) throw new Error('La carpeta del programa es un enlace no permitido.');
    }
    if (!aplicar || !movimientos.size) return { expedientes: movimientos.size, aplicado: false };
    const respaldo = path.join(respaldos, new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(respaldo, { recursive: true, mode: 0o700 });
    fuentes.forEach((fuente, index) => fs.writeFileSync(path.join(respaldo, `${index}-${path.basename(fuente.archivo)}`), fuente.original, { flag: 'wx', mode: 0o600 }));
    const realizados = [];
    try {
        for (const [origen, destino] of movimientos) {
            fs.mkdirSync(path.dirname(destino), { recursive: true, mode: 0o700 });
            fs.renameSync(origen, destino);
            realizados.push([origen, destino]);
        }
        function reemplazar(valor) {
            if (typeof valor === 'string') {
                for (const [origen, destino] of movimientos) if (valor === origen || valor.startsWith(`${origen}${path.sep}`)) return destino + valor.slice(origen.length);
                return valor;
            }
            if (Array.isArray(valor)) return valor.map(reemplazar);
            if (valor && typeof valor === 'object') return Object.fromEntries(Object.entries(valor).map(([clave, item]) => [clave, reemplazar(item)]));
            return valor;
        }
        fuentes.forEach((fuente, index) => {
            fs.writeFileSync(`${fuente.archivo}.tmp`, `${JSON.stringify(reemplazar(datos[index]), null, 2)}\n`, { mode: 0o600 });
            fs.renameSync(`${fuente.archivo}.tmp`, fuente.archivo);
        });
    } catch (error) {
        for (const [origen, destino] of realizados.reverse()) fs.renameSync(destino, origen);
        for (const fuente of fuentes) fs.writeFileSync(fuente.archivo, fuente.original, { mode: 0o600 });
        throw error;
    }
    return { expedientes: movimientos.size, aplicado: true, respaldo };
}

if (require.main === module) console.log(JSON.stringify(migrarRutas({ aplicar: process.argv.includes('--aplicar') })));
module.exports = { migrarRutas };
