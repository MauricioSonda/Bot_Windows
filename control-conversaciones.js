const CONFIG = require('./configuracion');

function cancelado() { return Object.assign(new Error('Respuesta cancelada por control del bot.'), { code: 'BOT_CANCELADO' }); }

function crearControlConversaciones({ clientes, actualizarCliente, registrar, consultar = () => [], ahora = Date.now }) {
    let conectado = false, finalizado = false, desde = Infinity;
    const contextos = new Set(), vistos = new Map();
    function idsRelacionados(id) {
        const telefono = clientes[id]?.telefono || (id.endsWith('@c.us') ? id.split('@')[0] : null);
        return [...new Set([id, ...Object.keys(clientes).filter((otro) => telefono &&
            (clientes[otro]?.telefono === telefono || otro === `${telefono}@c.us`))])];
    }
    function cancelar(id) {
        const ids = id ? idsRelacionados(id) : null;
        for (const contexto of contextos) if (!ids || ids.includes(contexto.id)) contexto.abort.abort();
    }
    function activar() {
        if (finalizado || conectado) return;
        conectado = true;
        // WhatsApp fecha los mensajes por segundos: se excluye el segundo de transición.
        desde = Math.floor(ahora() / 1000) + 1;
    }
    function desactivar() { conectado = false; desde = Infinity; cancelar(); }
    function bloqueado(id) { return idsRelacionados(id).some((otro) => clientes[otro]?.controlBot?.pausado); }
    function aceptar(message) {
        if (!conectado || finalizado || message.fromMe || !/^[0-9]+@(c\.us|lid)$/.test(message.from || '')) return false;
        if (['e2e_notification', 'notification_template', 'gp2', 'protocol', 'notification', 'ciphertext', 'revoked'].includes(message.type)) return false;
        const fecha = Number(message.timestamp), id = message.id?._serialized;
        if (!id || !Number.isFinite(fecha) || fecha < desde || fecha > Math.floor(ahora() / 1000) + 60 || vistos.has(id)) return false;
        vistos.set(id, ahora());
        for (const [key, fechaVista] of vistos) if (fechaVista < ahora() - 86400000 || vistos.size > 20000) vistos.delete(key); else break;
        return !bloqueado(message.from);
    }
    function contexto(id, { notificacion = null } = {}) {
        const c = { id, abort: new AbortController() };
        c.signal = c.abort.signal;
        c.verificar = () => {
            const cliente = clientes[id];
            const permitido = notificacion && cliente?.solicitudAtencionId === notificacion && cliente?.estado === 'atencion_humana';
            if (!conectado || finalizado || c.signal.aborted || (bloqueado(id) && !permitido)) throw cancelado();
        };
        c.liberar = () => contextos.delete(c);
        contextos.add(c);
        return c;
    }
    function pendiente(id) {
        const ids = idsRelacionados(id);
        return consultar().some((item) => item.estado === 'pendiente' && ids.includes(item.contactoId));
    }
    function estadoChat(id) {
        const registro = idsRelacionados(id).map((otro) => clientes[otro]).find((item) => item?.controlBot?.pausado) || clientes[id];
        return { contactoId: id, pausado: bloqueado(id), atencionHumana: pendiente(id),
            puedeReanudar: bloqueado(id) && !pendiente(id), motivo: registro?.controlBot?.motivo || null,
            pausadoEn: registro?.controlBot?.pausadoEn || null };
    }
    function pausar(id, motivo = 'pausa_administrador') {
        cancelar(id);
        for (const otro of idsRelacionados(id)) {
            const cliente = clientes[otro];
            actualizarCliente(otro, { ...(cliente?.estado === 'activando' ? { estado: 'inicio_pendiente' } : {}),
                controlBot: { pausado: true, motivo, pausadoEn: new Date(ahora()).toISOString() } });
        }
        return estadoChat(id);
    }
    function reanudar(id) {
        if (pendiente(id)) throw Object.assign(new Error('Primero marque la atención humana como atendida.'), { status: 409 });
        cancelar(id);
        for (const otro of idsRelacionados(id)) actualizarCliente(otro, { controlBot: { pausado: false, reanudadoEn: new Date(ahora()).toISOString() } });
        return estadoChat(id);
    }
    function derivar(id, motivo = 'derivacion_administrador', mensajeId = null, detalle = null) {
        pausar(id, motivo);
        const cliente = clientes[id] || {};
        const relacionados = idsRelacionados(id);
        const solicitud = consultar().find((item) => item.estado === 'pendiente' && relacionados.includes(item.contactoId)) ||
            registrar(id, { ...cliente, detalleDerivacion: detalle }, motivo, mensajeId);
        for (const otro of idsRelacionados(id)) actualizarCliente(otro, { estado: 'atencion_humana', solicitudAtencionId: solicitud.id,
            atencionHumanaSolicitadaEn: solicitud.solicitadoEn, detalleDerivacion: detalle });
        return solicitud;
    }
    return { activar, desactivar, aceptar, contexto, cancelar, bloqueado, pausar, reanudar, derivar, estadoChat,
        estado: () => ({ conectado, apagando: finalizado, aceptarDesde: Number.isFinite(desde) ? desde : null }),
        finalizar() { finalizado = true; desactivar(); },
        atendida(solicitud) {
            for (const id of idsRelacionados(solicitud.contactoId)) if (clientes[id]?.solicitudAtencionId === solicitud.id) {
                cancelar(id);
                actualizarCliente(id, { estado: 'atencion_resuelta', atendidoEn: solicitud.atendidoEn,
                    controlBot: { pausado: false } });
            }
        },
        async comando(message) {
            if (!conectado || !message.fromMe || message.type !== 'chat') return false;
            const texto = String(message.body || '').trim().toLowerCase();
            const accion = CONFIG.COMANDOS_ADMIN[texto];
            const fecha = Number(message.timestamp), mensajeId = message.id?._serialized;
            if (!accion || !mensajeId || vistos.has(mensajeId) || !Number.isFinite(fecha) || fecha < desde || fecha > Math.floor(ahora() / 1000) + 60) return false;
            vistos.set(mensajeId, ahora());
            const chat = await message.getChat();
            if (!conectado || fecha < desde) return false;
            const id = chat.id?._serialized;
            if (!/^[0-9]+@(c\.us|lid)$/.test(id || '')) return false;
            if (accion === 'pausar') pausar(id);
            if (accion === 'reanudar') reanudar(id);
            if (accion === 'derivar') derivar(id, 'derivacion_administrador', message.id?._serialized);
            return true;
        },
    };
}

module.exports = { crearControlConversaciones, cancelado };
