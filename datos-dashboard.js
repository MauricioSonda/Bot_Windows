const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const CONFIG = require('./configuracion');
const { numeroTelefono } = require('./telefonos');
const { inscripcionesParaDetalle } = require('./inscripciones');

function leerClientes() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG.ARCHIVO_CLIENTES, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return {};
        throw error;
    }
}

function listarClientes(datos = leerClientes()) {
    const registros = Object.entries(datos)
        .filter(
            ([, cliente]) =>
                cliente.nombreCompleto ||
                cliente.iniciadoEn ||
                cliente.modalidadAtencion === 'automatizada',
        )
        .map(([contactoId, cliente]) => ({
            ...cliente,
            id: contactoId,
            contactoId,
            telefono:
                cliente.telefono ||
                (contactoId.endsWith('@c.us')
                    ? numeroTelefono(contactoId)
                    : null),
            solicitadoEn:
                cliente.iniciadoEn ||
                cliente.guardadoEn ||
                cliente.actualizadoEn,
            requisitoPendiente:
                cliente.requisitos?.[cliente.indiceDocumento] || null,
            inscripciones: inscripcionesParaDetalle(cliente),
        }));
    const grupos = new Map();
    for (const registro of registros.sort((a, b) => String(a.actualizadoEn || '').localeCompare(String(b.actualizadoEn || '')))) {
        const clave = registro.telefono || registro.contactoId;
        const anterior = grupos.get(clave);
        grupos.set(clave, { ...anterior, ...registro,
            contactosIds: [...new Set([...(anterior?.contactosIds || []), registro.contactoId])],
            inscripciones: [...new Map([...(anterior?.inscripciones || []), ...registro.inscripciones].map((item) => [item.id, item])).values()],
        });
    }
    return [...grupos.values()];
}

function leerArchivoRegistrado(
    registro,
    documentoId,
    indice,
    raiz = CONFIG.CARPETA_EXPEDIENTES,
) {
    const file = registro?.documentos?.[documentoId]?.archivos?.[indice];
    if (!file?.ruta || !/^\d+$/.test(String(indice))) return null;
    try {
        const ruta = fs.realpathSync(file.ruta);
        const base = fs.realpathSync(raiz);
        const relative = path.relative(base, ruta);
        if (
            !relative ||
            relative.startsWith('..') ||
            path.isAbsolute(relative) ||
            !fs.statSync(ruta).isFile()
        )
            return null;
        const tipo = mime.lookup(ruta) || 'application/octet-stream';
        const inline = [
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp',
            'image/bmp',
            'image/avif',
            'application/pdf',
        ].includes(tipo);
        return {
            contenido: fs.readFileSync(ruta),
            tipo: inline ? tipo : 'application/octet-stream',
            nombre: path.basename(ruta),
            inline,
        };
    } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null;
        throw error;
    }
}

module.exports = { leerClientes, listarClientes, leerArchivoRegistrado };
