function numeroTelefono(valor) {
    if (typeof valor !== 'string' || valor.endsWith('@lid')) return null;
    const numero = valor.replace(/@c\.us$/, '').replace(/^\+/, '');
    return /^\d{6,15}$/.test(numero) ? numero : null;
}

async function resolverTelefono(client, contactoId) {
    const directo = contactoId.endsWith('@c.us')
        ? numeroTelefono(contactoId)
        : null;
    if (directo) return directo;
    try {
        const datos = await client.getContactLidAndPhone([contactoId]);
        const numero = numeroTelefono(datos?.[0]?.pn);
        if (numero) return numero;
    } catch {
        /* Se intenta el modelo del contacto como alternativa. */
    }
    try {
        const contacto = await client.getContactById(contactoId);
        // En contactos LID, number puede ser el LID; se usa solo un ID telefónico confirmado.
        return contacto?.id?._serialized?.endsWith('@c.us')
            ? numeroTelefono(contacto.id._serialized)
            : null;
    } catch {
        return null;
    }
}

module.exports = { numeroTelefono, resolverTelefono };
