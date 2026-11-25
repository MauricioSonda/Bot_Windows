const { MAX_INTENTOS_DOCUMENTO } = require('./configuracion');
const MENSAJES = require('./mensajes');

async function registrarIntentoIncorrecto(message, cliente, actualizar, motivo, aviso, alDerivar) {
    const requisito = cliente.requisitos[cliente.indiceDocumento];
    const clave = `${cliente.expedienteId || cliente.subprograma}/${requisito.id}`;
    const previo = cliente.intentosDocumentos?.[clave] || { cantidad: 0, mensajes: [] };
    const id = message.id?._serialized;
    if (id && previo.mensajes.includes(id)) return;
    const intento = { cantidad: previo.cantidad + 1, mensajes: [...previo.mensajes, ...(id ? [id] : [])], motivo,
        ultimoEn: new Date().toISOString(), requisito: requisito.nombre };
    actualizar({ intentosDocumentos: { ...cliente.intentosDocumentos, [clave]: intento } });
    if (intento.cantidad > MAX_INTENTOS_DOCUMENTO && alDerivar) {
        await alDerivar({ ...intento, requisitoId: requisito.id, expedienteId: cliente.expedienteId, programa: cliente.programa, subprograma: cliente.subprograma });
        return;
    }
    await message.reply(`${aviso}\n\n${MENSAJES.INTENTO_DOCUMENTO(intento.cantidad, MAX_INTENTOS_DOCUMENTO)}`);
}

function reiniciarIntentos(cliente, actualizar) {
    const requisito = cliente.requisitos[cliente.indiceDocumento];
    const clave = `${cliente.expedienteId || cliente.subprograma}/${requisito.id}`;
    if (cliente.intentosDocumentos?.[clave]) actualizar({ intentosDocumentos: { ...cliente.intentosDocumentos,
        [clave]: { cantidad: 0, mensajes: [] } } });
}

module.exports = { registrarIntentoIncorrecto, reiniciarIntentos };
