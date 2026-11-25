const fs = require('fs');
const { createHash, randomUUID } = require('crypto');
const { ARCHIVO_REVISIONES } = require('./configuracion');

function huella(documento) {
    return createHash('sha256').update(JSON.stringify({ valor: documento.valor || '',
        noAplica: documento.estado === 'no_aplica', archivos: (documento.archivos || []).map((item) => {
            let stat;
            try { stat = fs.statSync(item.ruta); } catch (_) { /* Archivo no disponible. */ }
            return [item.ruta, item.mensajeId, item.disponible, stat?.size, stat?.mtimeMs];
        }) })).digest('hex');
}

function errorRevision(mensaje, status = 422) { const error = new Error(mensaje); error.status = status; return error; }

function crearRevisiones({ archivo = ARCHIVO_REVISIONES } = {}) {
    function firmaPersona(persona) {
        return createHash('sha256').update(JSON.stringify(persona.inscripciones.map((item) => [item.id,
            item.resumenDocumentos.requisitos.map((doc) => doc.revision)]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))).digest('hex');
    }
    function leer() {
        try {
            const data = JSON.parse(fs.readFileSync(archivo, 'utf8'));
            if (!data.expedientes || !Array.isArray(data.historial)) throw new Error('Formato de revisiones inválido.');
            return data;
        } catch (error) { if (error.code === 'ENOENT') return { expedientes: {}, historial: [] }; throw error; }
    }
    function preparar(persona, data = leer()) {
        const inscripciones = (persona.inscripciones || []).map((inscripcion) => {
            const requisitos = (inscripcion.resumenDocumentos?.requisitos || []).map((documento) => {
                const firma = huella(documento);
                const guardada = data.expedientes[inscripcion.id]?.documentos?.[documento.id];
                const revision = guardada?.huella === firma ? guardada : { estado: 'pendiente', observacion: '' };
                return { ...documento, huella: firma, revision };
            });
            const estado = requisitos.some((item) => item.revision.estado === 'incompleto') ? 'incompleto'
                : requisitos.length && requisitos.every((item) => item.revision.estado === 'validado') ? 'validado' : 'pendiente';
            return { ...inscripcion, resumenDocumentos: { ...inscripcion.resumenDocumentos, requisitos },
                revision: { estado, completa: requisitos.length > 0 && requisitos.every((item) => ['validado', 'incompleto'].includes(item.revision.estado)),
                    validados: requisitos.filter((item) => item.revision.estado === 'validado').length, total: requisitos.length } };
        });
        const validada = inscripciones.length > 0 && inscripciones.every((item) => item.revision.estado === 'validado');
        const revisada = inscripciones.length > 0 && inscripciones.every((item) => item.revision.completa);
        const resultado = { ...persona, inscripciones, revisionPersonal: revisada ? 'revisado' : 'pendiente',
            validacionPersonal: validada ? 'validado' : revisada ? 'incompleto' : 'pendiente' };
        const cierre = revisada ? data.historial.find((item) => item.firma === firmaPersona(resultado)) : null;
        return { ...resultado, atencionConfirmada: Boolean(cierre), atendidoEn: cierre?.atendidoEn || persona.atendidoEn };
    }
    function guardar(persona, inscripcionId, cambios) {
        const data = leer();
        const actual = preparar(persona, data);
        const inscripcion = actual.inscripciones.find((item) => item.id === inscripcionId);
        if (!inscripcion) throw errorRevision('Inscripción no encontrada.', 404);
        const requisitos = inscripcion.resumenDocumentos.requisitos;
        if (!Array.isArray(cambios) || cambios.length !== requisitos.length || new Set(cambios.map((item) => item.id)).size !== cambios.length)
            throw errorRevision('Debe enviar una revisión por cada requisito de esta inscripción.');
        const revisiones = {};
        for (const cambio of cambios) {
            const requisito = requisitos.find((item) => item.id === cambio.id);
            if (!requisito || !['pendiente', 'validado', 'incompleto'].includes(cambio.estado)) throw errorRevision('Estado o requisito inválido.');
            if (cambio.huella !== requisito.huella) throw errorRevision('Los documentos cambiaron. Cierre la revisión y vuelva a abrirla.', 409);
            if (cambio.estado === 'validado' && !String(requisito.valor || '').trim() &&
                !(requisito.archivosGuardados > 0 && !requisito.archivosFaltantes) &&
                !(requisito.opcional && requisito.estado === 'no_aplica')) throw errorRevision(`No puede validar un documento ausente: ${requisito.nombre}.`);
            const observacion = String(cambio.observacion || '').trim().slice(0, 2000);
            const anterior = data.expedientes[inscripcionId]?.documentos?.[cambio.id];
            revisiones[cambio.id] = anterior?.estado === cambio.estado && anterior.observacion === observacion && anterior.huella === requisito.huella
                ? anterior : { estado: cambio.estado, observacion, huella: requisito.huella, revisadoEn: new Date().toISOString() };
        }
        data.expedientes[inscripcionId] = { documentos: revisiones, actualizadoEn: new Date().toISOString() };
        const resultado = preparar(persona, data);
        fs.writeFileSync(`${archivo}.tmp`, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
        fs.renameSync(`${archivo}.tmp`, archivo);
        return resultado;
    }
    function finalizar(persona) {
        const data = leer();
        const resultado = preparar(persona, data);
        if (resultado.revisionPersonal !== 'revisado') throw errorRevision('Primero revise todos los documentos de todas las inscripciones de esta persona.', 409);
        const firma = firmaPersona(resultado);
        let cierre = data.historial.find((item) => item.firma === firma);
        if (!cierre) {
            cierre = { ...JSON.parse(JSON.stringify(resultado)), id: randomUUID(), firma,
                estado: resultado.validacionPersonal === 'validado' ? 'validado_personalmente' : 'revisado_con_observaciones',
                atencionConfirmada: true, atendidoEn: new Date().toISOString() };
            data.historial.push(cierre);
            fs.writeFileSync(`${archivo}.tmp`, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
            fs.renameSync(`${archivo}.tmp`, archivo);
        }
        return { ...resultado, atencionConfirmada: true, atendidoEn: cierre.atendidoEn };
    }
    function archivarAtencion(persona) {
        const data = leer();
        if (!data.historial.some((item) => item.solicitudOrigenId === persona.id)) {
            data.historial.push({ ...JSON.parse(JSON.stringify(persona)), id: randomUUID(),
                solicitudOrigenId: persona.id, estado: 'atendido', validacionPersonal: 'no_aplica',
                atendidoEn: persona.atendidoEn || new Date().toISOString(), inscripciones: [] });
            fs.writeFileSync(`${archivo}.tmp`, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
            fs.renameSync(`${archivo}.tmp`, archivo);
        }
    }
    return { preparar, guardar, finalizar, archivarAtencion, historial: () => leer().historial };
}

module.exports = { crearRevisiones };
