const fs = require('fs');
const { randomUUID } = require('crypto');
const CONFIG = require('./configuracion');
const MENSAJES = require('./mensajes');
const { obtenerInscripciones } = require('./inscripciones');

function normalizar(texto) {
    return String(texto || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
}

function leerSolicitudes(archivo = CONFIG.ARCHIVO_ATENCION_HUMANA) {
    try {
        const solicitudes = JSON.parse(fs.readFileSync(archivo, 'utf8'));
        if (!Array.isArray(solicitudes))
            throw new Error(
                'El JSON de atención humana debe contener una lista.',
            );
        return solicitudes;
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}

function registrarSolicitud(
    contactoId,
    cliente,
    motivo,
    mensajeId,
    archivo = CONFIG.ARCHIVO_ATENCION_HUMANA,
) {
    const solicitudes = leerSolicitudes(archivo);
    const existente = solicitudes.find(
        (item) => item.contactoId === contactoId && item.estado === 'pendiente',
    );
    if (existente) return existente;
    const solicitud = {
        id: randomUUID(),
        contactoId,
        // Los identificadores @lid no son números telefónicos.
        telefono:
            cliente?.telefono ||
            (contactoId.endsWith('@c.us') ? contactoId.split('@')[0] : null),
        nombreCompleto: cliente?.nombreCompleto || null,
        programa: cliente?.programa || null,
        subprograma: cliente?.subprograma || null,
        estado: 'pendiente',
        motivo,
        detalleDerivacion: cliente?.detalleDerivacion || null,
        destinoAtencion: cliente?.destinoAtencion || 'programas',
        estadoFlujoAnterior: cliente?.estado || null,
        expedienteId: cliente?.expedienteId || null,
        carpetaExpediente: cliente?.carpetaExpediente || null,
        indiceDocumento: cliente?.indiceDocumento ?? null,
        requisitoPendiente:
            cliente?.requisitos?.[cliente.indiceDocumento] || null,
        documentos: cliente?.documentos || {},
        inscripciones: cliente?.destinoAtencion === 'certeza' ? [] : obtenerInscripciones(cliente),
        mensajeOrigenId: mensajeId || null,
        solicitadoEn: new Date().toISOString(),
        asignadoA: null,
        atendidoEn: null,
    };
    solicitudes.push(solicitud);
    fs.writeFileSync(
        `${archivo}.tmp`,
        `${JSON.stringify(solicitudes, null, 2)}\n`,
        { mode: 0o600 },
    );
    fs.renameSync(`${archivo}.tmp`, archivo);
    return solicitud;
}

function marcarAtendida(id, archivo = CONFIG.ARCHIVO_ATENCION_HUMANA) {
    const solicitudes = leerSolicitudes(archivo);
    const solicitud = solicitudes.find((item) => item.id === id);
    if (!solicitud) return null;
    if (solicitud.estado !== 'atendido') {
        solicitud.estado = 'atendido';
        solicitud.atendidoEn = new Date().toISOString();
        fs.writeFileSync(
            `${archivo}.tmp`,
            `${JSON.stringify(solicitudes, null, 2)}\n`,
            { mode: 0o600 },
        );
        fs.renameSync(`${archivo}.tmp`, archivo);
    }
    return solicitud;
}

function crearControlAtencion({
    actualizarCliente,
    registrar = registrarSolicitud,
    consultar = leerSolicitudes,
}) {
    return async function manejarAtencion(message, cliente) {
        const texto = message.type === 'chat' ? normalizar(message.body) : '';
        const solicitudes = consultar();
        if (
            solicitudes.some(
                (item) =>
                    item.contactoId === message.from &&
                    item.estado === 'pendiente',
            )
        )
            return true;
        if (
            ['atencion_humana', 'atencion_resuelta'].includes(cliente?.estado)
        ) {
            const cerrada = solicitudes.find(
                (item) =>
                    item.id === cliente.solicitudAtencionId &&
                    item.estado === 'atendido',
            );
            if (!cerrada) return true;
            if (CONFIG.ACTIVAR_CON_CUALQUIER_MENSAJE || texto === CONFIG.COMANDOS.INICIO) return false;
            if (texto !== CONFIG.COMANDOS.AYUDA) return true;
        }

        const opcion =
            cliente?.estado === 'esperando_tipo_atencion'
                ? CONFIG.OPCIONES_ATENCION.find(
                      (item) =>
                          item.alias.includes(texto) ||
                          normalizar(item.etiqueta) === texto,
                  )
                : null;

        const ayudaPermitida = cliente && !['activando', 'esperando_nombre', 'esperando_destino', 'esperando_tramite_certeza', 'error_activacion'].includes(cliente.estado) && cliente.destinoAtencion !== 'certeza';
        if ((texto === CONFIG.COMANDOS.AYUDA && ayudaPermitida) || opcion?.id === 'personal') {
            const solicitud = registrar(
                message.from,
                cliente,
                texto === CONFIG.COMANDOS.AYUDA
                    ? 'palabra_ayuda'
                    : 'eleccion_personal',
                message.id?._serialized,
            );
            actualizarCliente(message.from, {
                estado: 'atencion_humana',
                estadoAntesDeAyuda: solicitud.estadoFlujoAnterior,
                solicitudAtencionId: solicitud.id,
                atencionHumanaSolicitadaEn: solicitud.solicitadoEn,
            });
            await message.reply(
                MENSAJES.ATENCION_PERSONAL_CONFIRMADA(cliente?.nombreCompleto),
            );
            return true;
        }

        if (cliente?.estado !== 'esperando_tipo_atencion') return false;
        if (opcion?.id === 'automatizada') {
            actualizarCliente(message.from, {
                estado: 'esperando_programa',
                modalidadAtencion: 'automatizada',
                automatizacionAceptadaEn: new Date().toISOString(),
            });
            return 'continuar_programas';
        }
        await message.reply(MENSAJES.OPCION_ATENCION_INVALIDA);
        await message.reply(MENSAJES.ELEGIR_ATENCION(cliente.nombreCompleto));
        return true;
    };
}

module.exports = {
    leerSolicitudes,
    registrarSolicitud,
    marcarAtendida,
    crearControlAtencion,
};
