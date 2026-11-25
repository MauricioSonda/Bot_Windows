const fs = require('fs');
const { obtenerRequisitos } = require('./requisitos');

function resumirDocumentos(registro = {}, existe = fs.existsSync) {
    if (registro.destinoAtencion === 'certeza' && !registro.expedienteId)
        return { requisitos: [], recibidos: 0, pendientes: 0, noAplican: 0 };
    let requisitos = registro.requisitos || [];
    if (!requisitos.length && registro.subprograma) {
        try { requisitos = obtenerRequisitos(registro.subprograma).documentos; } catch (_) { /* Programa antiguo sin catálogo. */ }
    }
    const documentos = registro.documentos || {};
    const extras = Object.keys(documentos).filter((id) => !requisitos.some((item) => item.id === id));
    const detalle = [...requisitos, ...extras.map((id) => ({ id, nombre: id }))].map((requisito) => {
        const documento = documentos[requisito.id] || {};
        const archivos = (documento.archivos || []).map((archivo) => ({ ...archivo, disponible: Boolean(archivo.ruta && existe(archivo.ruta)) }));
        const disponibles = archivos.filter((archivo) => archivo.disponible).length;
        const textoRecibido = Boolean(String(documento.valor || '').trim());
        let estado = 'pendiente';
        if (requisito.opcional && documento.estado === 'no_aplica') estado = 'no_aplica';
        else if (textoRecibido || (documento.estado === 'recibido' && archivos.length > 0 && disponibles === archivos.length)) estado = 'recibido';
        else if (disponibles > 0) estado = 'incompleto';
        return { ...requisito, ...documento, id: requisito.id, nombre: requisito.nombre, archivos, estado,
            archivosGuardados: disponibles, archivosFaltantes: archivos.length - disponibles };
    });
    return {
        requisitos: detalle,
        recibidos: detalle.filter((item) => item.estado === 'recibido').length,
        pendientes: detalle.filter((item) => ['pendiente', 'incompleto'].includes(item.estado)).length,
        noAplican: detalle.filter((item) => item.estado === 'no_aplica').length,
    };
}

function prepararEstadoDocumentos(registro) {
    return { ...registro, resumenDocumentos: resumirDocumentos(registro),
        inscripciones: (registro.inscripciones || []).map((item) => ({ ...item, resumenDocumentos: resumirDocumentos(item) })),
    };
}

module.exports = { resumirDocumentos, prepararEstadoDocumentos };
