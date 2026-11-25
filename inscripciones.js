const { obtenerProgramas, obtenerSubprogramas } = require('./programas');
const { CERTEZA } = require('./configuracion');

function obtenerInscripciones(cliente = {}) {
    const registros = [...(cliente.inscripciones || [])];
    if (cliente.completadoEn && cliente.programa && cliente.subprograma) {
        registros.push({
            id: cliente.expedienteId || `${cliente.programa}/${cliente.subprograma}`,
            expedienteId: cliente.expedienteId,
            programa: cliente.programa, subprograma: cliente.subprograma,
            carpetaExpediente: cliente.carpetaExpediente,
            documentos: cliente.documentos || {}, requisitos: cliente.requisitos || [],
            iniciadoEn: cliente.iniciadoEn, completadoEn: cliente.completadoEn, estado: 'completado',
        });
    }
    return [...new Map(registros.map((item) => [item.id || item.expedienteId || `${item.programa}/${item.subprograma}`, item])).values()];
}

function subprogramasDisponibles(cliente, programa) {
    const inscritos = obtenerInscripciones(cliente);
    return obtenerSubprogramas(programa).filter((subprograma) =>
        !inscritos.some((item) => item.programa === programa && item.subprograma === subprograma));
}

function programasDisponibles(cliente) {
    return obtenerProgramas().filter((programa) => programa !== CERTEZA.PROGRAMA && subprogramasDisponibles(cliente, programa).length);
}

function inscripcionesParaDetalle(cliente = {}) {
    const lista = obtenerInscripciones(cliente);
    if (cliente.expedienteId && !lista.some((item) => item.id === cliente.expedienteId)) {
        lista.push({ ...cliente, id: cliente.expedienteId, inscripciones: undefined });
    }
    return lista;
}

module.exports = { obtenerInscripciones, programasDisponibles, subprogramasDisponibles, inscripcionesParaDetalle };
