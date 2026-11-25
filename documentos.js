const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { validarArchivo } = require('./formatos-archivos');

const { CARPETA_EXPEDIENTES } = require('./configuracion');

function nombreSeguro(value) {
    return (
        String(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9_-]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 90) || 'Cliente'
    );
}

function crearExpediente(nombre, contactId, programa) {
    if (!programa) throw new Error('Se requiere el programa para crear el expediente.');
    const expedienteId = `EXP-${randomUUID()}`;
    return {
        expedienteId,
        carpetaExpediente: path.join(
            CARPETA_EXPEDIENTES,
            nombreSeguro(nombre),
            nombreSeguro(contactId),
            nombreSeguro(programa),
            expedienteId,
        ),
    };
}

async function guardarDocumento(message, customer, requirement, { raiz = CARPETA_EXPEDIENTES } = {}) {
    const media = await message.downloadMedia();
    if (!media?.data)
        throw new Error('El archivo no está disponible para descargar.');
    const { contenido, extension, mimetype } = await validarArchivo(media);
    const directory = customer.carpetaExpediente;
    const relative = path.relative(raiz, directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
        throw new Error('Ruta de expediente inválida.');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const base = `${nombreSeguro(requirement.id)}_${nombreSeguro(customer.nombreCompleto)}`;
    let sequence = 1;
    let ruta;
    while (true) {
        ruta = path.join(
            directory,
            `${base}_${String(sequence).padStart(2, '0')}.${extension}`,
        );
        try {
            fs.writeFileSync(ruta, contenido, {
                flag: 'wx',
                mode: 0o600,
            });
            break;
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            sequence += 1;
        }
    }
    return {
        ruta,
        mensajeId: message.id._serialized,
        mimetype,
        recibidoEn: new Date().toISOString(),
    };
}

module.exports = { crearExpediente, guardarDocumento };
