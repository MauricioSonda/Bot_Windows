const CONFIG = require('./configuracion');
const MENSAJES = require('./mensajes');
const { encontrarOpcion } = require('./programas');
const { registrarSolicitud } = require('./atencion-humana');

function crearFlujoDestino({ actualizarCliente, registrar = registrarSolicitud }) {
    return async (message, cliente) => {
        if (!['esperando_destino', 'esperando_tramite_certeza'].includes(cliente?.estado)) return false;
        const texto = message.type === 'chat' ? String(message.body || '').trim() : '';
        const normal = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (cliente.estado === 'esperando_destino') {
            let opcion = encontrarOpcion(texto, CONFIG.OPCIONES_DESTINO);
            if (['certeza', 'certeza juridica'].includes(normal)) opcion = CONFIG.OPCIONES_DESTINO[0];
            if (['programa', 'programas', 'inscribirse'].includes(normal)) opcion = CONFIG.OPCIONES_DESTINO[1];
            if (!opcion) { await message.reply(MENSAJES.ELEGIR_DESTINO(cliente.nombreCompleto)); return true; }
            const certeza = opcion === CONFIG.OPCIONES_DESTINO[0];
            actualizarCliente(message.from, {
                destinoAtencion: certeza ? 'certeza' : 'programas',
                estado: certeza ? 'esperando_tramite_certeza' : 'esperando_tipo_atencion',
                programa: certeza ? CONFIG.CERTEZA.PROGRAMA : null,
                subprograma: null,
            });
            await message.reply(certeza ? MENSAJES.ELEGIR_CERTEZA : MENSAJES.ELEGIR_ATENCION(cliente.nombreCompleto));
            return true;
        }
        const tramite = encontrarOpcion(texto, CONFIG.CERTEZA.OPCIONES);
        if (!tramite) { await message.reply(MENSAJES.ELEGIR_CERTEZA); return true; }
        const solicitud = registrar(message.from, { ...cliente, programa: CONFIG.CERTEZA.PROGRAMA,
            subprograma: tramite, destinoAtencion: 'certeza' }, 'certeza_juridica', message.id?._serialized);
        actualizarCliente(message.from, { subprograma: tramite, estado: 'atencion_humana',
            solicitudAtencionId: solicitud.id, atencionHumanaSolicitadaEn: solicitud.solicitadoEn });
        await message.reply(MENSAJES.CERTEZA_CONFIRMADA(cliente.nombreCompleto, tramite));
        return true;
    };
}

module.exports = { crearFlujoDestino };
