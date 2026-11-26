const { MessageMedia } = require('./index');
const { obtenerRequisitos } = require('./requisitos');
const { crearExpediente, guardarDocumento } = require('./documentos');
const MENSAJES = require('./mensajes');
const { obtenerInscripciones, programasDisponibles } = require('./inscripciones');
const { formatearOpciones } = require('./programas');
const { registrarIntentoIncorrecto, reiniciarIntentos } = require('./intentos-documentos');

async function enviarFicha(message, customer, update) {
    const config = obtenerRequisitos(customer.subprograma);
    update({ estado: 'enviando_ficha' });
    try {
        await message.reply(MessageMedia.fromFilePath(config.imagen));
        if (config.formatoSolicitud) {
            await message.reply(MessageMedia.fromFilePath(config.formatoSolicitud), undefined, { sendMediaAsDocument: true });
        }
        await message.reply(MENSAJES.PREPARAR_DOCUMENTOS(customer.subprograma));
        update({ estado: 'pausado_documentos' });
    } catch (error) {
        update({ estado: 'error_ficha' });
        throw error;
    }
}

async function iniciarDocumentos(message, customer, update) {
    const config = obtenerRequisitos(customer.subprograma);
    const expediente = crearExpediente(customer.nombreCompleto, message.from, customer.programa);
    update({
        ...expediente,
        requisitos: config.documentos,
        documentos: {},
        indiceDocumento: 0,
    });
    await enviarFicha(message, customer, update);
}

async function manejarDocumentos(message, customer, update, { alDerivar, verificar = () => {} } = {}) {
    if (
        ![
            'enviando_ficha',
            'error_ficha',
            'pausado_documentos',
            'esperando_documento',
        ].includes(customer?.estado)
    )
        return false;
    const text = (message.body || '').trim().toLowerCase();
    const isText = message.type === 'chat';
    if (customer.estado !== 'esperando_documento') {
        if (isText && text === 'reanudar') {
            if (
                customer.estado === 'error_ficha' ||
                customer.estado === 'enviando_ficha'
            ) {
                await enviarFicha(message, customer, update);
            } else {
                update({ estado: 'esperando_documento' });
                await pedirPendiente(message, customer);
            }
        }
        return true;
    }

    const requirement = customer.requisitos[customer.indiceDocumento];
    const entry = customer.documentos[requirement.id] || { archivos: [] };
    if (isText && ['reanudar', 'prueba'].includes(text)) {
        await pedirPendiente(message, customer);
        return true;
    }
    if (isText && text === 'no aplica' && requirement.opcional) {
        reiniciarIntentos(customer, update);
        update({
            documentos: {
                ...customer.documentos,
                [requirement.id]: { ...entry, estado: 'no_aplica' },
            },
        });
        await avanzar(message, customer, update);
        return true;
    }
    if (requirement.tipo === 'texto') {
        if (!isText || !text || ['siguiente', 'no aplica'].includes(text)) {
            await message.reply(MENSAJES.FALTA_TEXTO);
            return true;
        }
        reiniciarIntentos(customer, update);
        update({
            documentos: {
                ...customer.documentos,
                [requirement.id]: {
                    estado: 'recibido',
                    valor: message.body.trim(),
                    mensajeId: message.id._serialized,
                    recibidoEn: new Date().toISOString(),
                },
            },
        });
        await avanzar(message, customer, update);
        return true;
    }
    if (isText && text === 'siguiente') {
        if (!entry.archivos.length) await registrarIntentoIncorrecto(message, customer, update, 'siguiente_sin_archivo', MENSAJES.FALTA_ARCHIVO, alDerivar);
        else {
            update({
                documentos: {
                    ...customer.documentos,
                    [requirement.id]: { ...entry, estado: 'recibido' },
                },
            });
            await avanzar(message, customer, update);
        }
        return true;
    }
    if (!['image', 'document'].includes(message.type) || !message.hasMedia) {
        await registrarIntentoIncorrecto(message, customer, update, 'documento_no_enviado', MENSAJES.FALTA_ARCHIVO, alDerivar);
        return true;
    }
    const alreadySaved = Object.values(customer.documentos).some((item) =>
        item.archivos?.some(
            (file) => file.mensajeId === message.id._serialized,
        ),
    );
    if (alreadySaved) return true;
    let file;
    try { file = await guardarDocumento(message, customer, requirement, { verificar }); }
    catch (error) {
        if (error.code !== 'ARCHIVO_NO_PERMITIDO') throw error;
        await registrarIntentoIncorrecto(message, customer, update, 'formato_no_permitido', MENSAJES.ARCHIVO_NO_PERMITIDO, alDerivar);
        return true;
    }
    reiniciarIntentos(customer, update);
    update({
        documentos: {
            ...customer.documentos,
            [requirement.id]: {
                ...entry,
                estado: 'recibiendo',
                archivos: [...entry.archivos, file],
            },
        },
    });
    await message.reply(MENSAJES.ARCHIVO_RECIBIDO);
    return true;
}

async function pedirPendiente(message, customer) {
    await message.reply(
        MENSAJES.PEDIR_DOCUMENTO(
            customer.requisitos[customer.indiceDocumento],
            customer.indiceDocumento,
            customer.requisitos.length,
        ),
    );
}

async function avanzar(message, customer, update) {
    const next = customer.indiceDocumento + 1;
    if (next >= customer.requisitos.length) {
        update({
            estado: 'completado',
            indiceDocumento: next,
            completadoEn: new Date().toISOString(),
        });
        update({ inscripciones: JSON.parse(JSON.stringify(obtenerInscripciones(customer))) });
        await message.reply(
            MENSAJES.DOCUMENTOS_COMPLETOS(
                customer.nombreCompleto,
                customer.subprograma,
            ),
        );
        const disponibles = programasDisponibles(customer);
        if (disponibles.length) {
            update({ estado: 'esperando_otro_programa' });
            await message.reply(MENSAJES.OTRO_PROGRAMA(formatearOpciones(disponibles)));
        } else await message.reply(MENSAJES.SIN_PROGRAMAS);
    } else {
        update({ indiceDocumento: next });
        await pedirPendiente(message, customer);
    }
}

module.exports = { iniciarDocumentos, manejarDocumentos };
