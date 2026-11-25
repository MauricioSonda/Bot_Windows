const $ = (id) => document.getElementById(id);
const config = window.DASHBOARD_CONFIG;
let solicitudes = [];
let token = '';
let actualizacion = null;
let cargaId = 0;
let detalleId = 0;
let urlsArchivos = [];
let contextoRevision = null;
const ESTADOS = {
    pendiente: 'Pendiente',
    validado_personalmente: 'Validado personalmente',
    revisado_con_observaciones: 'Atendida con documentos incompletos / no válidos',
    atendido: 'Atendida',
    completado: 'Recopilación completa',
    esperando_otro_programa: 'Inscripción completa · eligiendo otro programa',
    esperando_nombre: 'Esperando nombre',
    esperando_destino: 'Eligiendo motivo de atención',
    esperando_tramite_certeza: 'Eligiendo trámite de Certeza jurídica',
    esperando_tipo_atencion: 'Eligiendo atención',
    esperando_programa: 'Eligiendo programa',
    esperando_subprograma: 'Eligiendo subprograma',
    pausado_documentos: 'Preparando documentos',
    esperando_documento: 'Recopilando documentos',
    atencion_humana: 'Atención humana pendiente',
    atencion_resuelta: 'Atención humana concluida',
};

function mostrarError(texto = '') {
    $('error').textContent = texto;
    $('error').hidden = !texto;
}

async function consultar(ruta, opciones = {}, comoBlob = false) {
    const response = await fetch(ruta, {
        ...opciones,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...opciones.headers,
        },
    });
    if (response.status === 401) {
        $('acceso').hidden = false;
        throw new Error(
            'Introduzca un token válido para consultar las solicitudes.',
        );
    }
    if (response.ok && comoBlob) return response.blob();
    const data = await response.json();
    if (!response.ok)
        throw new Error(data.error || 'No se pudo completar la consulta.');
    return data;
}

function fecha(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('es-MX');
}

function normalizar(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function boton(texto, accion) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = texto;
    button.addEventListener('click', () => accion(button));
    return button;
}

function etiquetaEstado(texto, estado) {
    const etiqueta = document.createElement('span');
    etiqueta.className = 'estado';
    etiqueta.dataset.estado = estado || '';
    etiqueta.textContent = texto;
    return etiqueta;
}

function esAtencionCerteza(item) {
    return item.destinoAtencion === 'certeza' || item.motivo === 'certeza_juridica' ||
        (!item.inscripciones?.length && normalizar(item.programa).trim() === 'certeza juridica' &&
            (item.validacionPersonal === 'no_aplica' || item.estado === 'atendido'));
}

function descripcionAtencion(item, vistaBot) {
    if (item.atencionesCerteza?.length)
        return item.inscripciones?.length ? 'Programas y atención personal de Certeza jurídica' : 'Atención personal de Certeza jurídica';
    if (!vistaBot) return esAtencionCerteza(item) ? 'Atención personal de Certeza jurídica'
        : item.motivo === 'palabra_ayuda' ? 'Solicitó ayuda' : 'Eligió atención personal';
    return $('vista').value === 'historial' && !item.inscripciones?.length ? 'Atención personal' : 'Recopilación automatizada';
}

function resultadosProgramas(inscripciones, atencionesCerteza = []) {
    const contenedor = document.createElement('div');
    contenedor.className = 'estados-programas';
    const validos = inscripciones.filter((item) => item.revision?.estado === 'validado').length;
    const resumen = document.createElement('span');
    resumen.className = 'resumen-programas-validos';
    resumen.textContent = `${validos} de ${inscripciones.length} programas válidos`;
    if (inscripciones.length) contenedor.append(resumen);
    for (const inscripcion of inscripciones) {
        const estado = inscripcion.revision?.estado;
        const resultado = estado === 'validado' ? 'VÁLIDO' : estado === 'incompleto' ? 'NO VÁLIDO' : 'SIN REVISAR';
        contenedor.append(etiquetaEstado(`${inscripcion.subprograma || inscripcion.programa || 'Programa'} · ${resultado}`,
            estado === 'validado' ? 'validado' : estado === 'incompleto' ? 'rechazado' : 'pendiente'));
    }
    for (const atencion of atencionesCerteza) {
        const nombre = ['Certeza jurídica', atencion.subprograma, 'ATENDIDA'].filter(Boolean).join(' · ');
        contenedor.append(etiquetaEstado(nombre, 'atendido'));
    }
    return contenedor;
}

function dibujar() {
    const busqueda = normalizar($('buscar').value);
    const vistaBot = !['atencion-humana', 'certeza'].includes($('vista').value);
    const estado = $('estado').value;
    const grupos = new Map();
    for (const registro of solicitudes) {
        const clave = registro.telefono || registro.contactoId || registro.id;
        const previo = grupos.get(clave);
        const registros = [...(previo?.registros || []), registro];
        const principal = registros.find((item) => item.estado === 'pendiente') || registro;
        grupos.set(clave, { ...principal, registros,
            inscripciones: [...new Map(registros.flatMap((item) => item.inscripciones || []).map((item) => [item.id, item])).values()],
            atencionesCerteza: $('vista').value === 'historial' ? [...new Map(registros.filter(esAtencionCerteza)
                .map((item) => [normalizar(item.subprograma).trim(), item])).values()] : [],
        });
    }
    const visibles = [...grupos.values()].filter((item) => {
        const coincideEstado =
            !estado ||
            (estado === 'en_curso'
                ? ![
                      'completado',
                      'atencion_humana',
                      'atencion_resuelta',
                  ].includes(item.estado)
                : item.estado === estado);
        return (
            coincideEstado &&
            normalizar(
                [
                    item.nombreCompleto,
                    item.telefono,
                    item.contactoId,
                    item.programa,
                    item.subprograma,
                    ...(item.inscripciones || []).map((i) => `${i.programa} ${i.subprograma}`),
                    ...(item.atencionesCerteza || []).map((atencion) => `Certeza jurídica ${atencion.subprograma || ''}`),
                ].join(' '),
            ).includes(busqueda)
        );
    });
    const tbody = $('solicitudes');
    tbody.replaceChildren();
    for (const item of visibles) {
        const tr = document.createElement('tr');
        for (const [columna, value] of [
            fecha($('vista').value === 'historial' ? item.atendidoEn : item.solicitadoEn),
            item.nombreCompleto || 'Nombre no registrado',
            item.telefono ? `+${item.telefono}` : 'Número aún no disponible',
            [...new Set((item.inscripciones || []).map((i) => i.programa).concat(item.programa || [], item.atencionesCerteza?.length ? ['Certeza jurídica'] : []).filter(Boolean))].join(', '),
            [...new Set((item.inscripciones || []).map((i) => i.subprograma).concat(item.subprograma || [], (item.atencionesCerteza || []).map((i) => i.subprograma)).filter(Boolean))].join(', '),
            descripcionAtencion(item, vistaBot),
            item.validacionPersonal === 'validado' ? 'Validado personalmente' : ESTADOS[item.estado] || item.estado,
        ].entries()) {
            const td = document.createElement('td');
            if (columna === 6 && $('vista').value === 'historial' && (item.inscripciones?.length || item.atencionesCerteza?.length))
                td.append(resultadosProgramas(item.inscripciones || [], item.atencionesCerteza));
            else if (columna === 6) td.append(etiquetaEstado(value || '—', item.validacionPersonal === 'validado' ? 'validado_personalmente' : item.estado));
            else td.textContent = value || '—';
            tr.append(td);
        }
        const td = document.createElement('td');
        const actions = document.createElement('div');
        actions.className = 'acciones';
        actions.append(boton('Ver detalle', () => mostrarDetalle(item.id)));
        actions.append(
            boton('Abrir chat', (button) => abrirChat(item.id, button)),
        );
        if (!vistaBot && item.estado === 'pendiente' && !item.inscripciones?.length)
            actions.append(boton('Marcar atendida', (button) => atender(item.id, button, item.registros.filter((registro) => registro.estado === 'pendiente').map((registro) => registro.id))));
        td.append(actions);
        tr.append(td);
        tbody.append(tr);
    }
    if (!visibles.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 8;
        td.textContent = 'No hay solicitudes para esta selección.';
        tr.append(td);
        tbody.append(tr);
    }
    $('resumen').textContent =
        `${visibles.length} ${visibles.length === 1 ? 'persona visible' : 'personas visibles'}. Última actualización: ${fecha(actualizacion)}.`;
}

async function cargar() {
    const estaCarga = ++cargaId;
    $('actualizar').disabled = true;
    try {
        const data = await consultar(`/api/${$('vista').value}`);
        if (estaCarga !== cargaId) return;
        solicitudes = data.solicitudes;
        actualizacion = new Date().toISOString();
        mostrarError();
        dibujar();
    } catch (error) {
        if (estaCarga !== cargaId) return;
        mostrarError(
            `No se pudo actualizar. ${error.message} Los datos mostrados pueden estar desactualizados.`,
        );
        if (!actualizacion)
            $('resumen').textContent = 'Sin conexión con el servidor.';
    } finally {
        if (estaCarga === cargaId) {
            $('actualizar').disabled = false;
        }
    }
}

async function mostrarDetalle(id, enfocar = true, inscripcionId = null) {
    const esteDetalle = ++detalleId;
    const source = $('vista').value;
    try {
        let item = await consultar(
            `/api/${source}/${encodeURIComponent(id)}`,
        );
        if (esteDetalle !== detalleId) return;
        liberarArchivos();
        const personaValidada = item.validacionPersonal === 'validado';
        const personaRevisada = item.revisionPersonal === 'revisado' || personaValidada;
        const atencionConfirmada = Boolean(item.atencionConfirmada);
        const totalInscripciones = item.inscripciones?.length || 0;
        const inscripcionesRevisadas = (item.inscripciones || []).filter((inscripcion) => inscripcion.revision?.completa || inscripcion.revision?.estado === 'validado').length;
        const soloAtencion = source === 'historial' && item.validacionPersonal === 'no_aplica';
        if (!inscripcionId && item.inscripciones?.length) inscripcionId = item.inscripciones[0].id;
        const opciones = $('inscripciones-detalle');
        opciones.replaceChildren();
        for (const inscripcion of item.inscripciones || []) {
            const button = boton(`${inscripcion.programa} · ${inscripcion.subprograma}`, () => mostrarDetalle(id, false, inscripcion.id));
            button.setAttribute('aria-pressed', String(inscripcion.id === inscripcionId));
            if (inscripcion.revision?.estado) button.classList.add(`revision-${inscripcion.revision.estado}`);
            if (inscripcion.revision?.estado === 'validado') button.append(' · Validado');
            else if (inscripcion.revision?.estado === 'incompleto') button.append(' · Incompleto / no válido');
            opciones.append(button);
        }
        if (!opciones.children.length) opciones.textContent = 'Todavía no hay inscripciones registradas.';
        if (inscripcionId) {
            const inscripcion = item.inscripciones?.find((registro) => registro.id === inscripcionId);
            if (inscripcion) item = { ...item, ...inscripcion, id: item.id };
        }
        $('resultado-carpeta').textContent = '';
        $('abrir-carpeta').disabled = !item.carpetaExpediente;
        $('abrir-carpeta').title = item.carpetaExpediente || 'La carpeta estará disponible cuando se hayan guardado documentos.';
        $('abrir-carpeta').onclick = async () => {
            $('abrir-carpeta').disabled = true;
            try {
                await consultar(`/api/${source}/${encodeURIComponent(id)}/abrir-carpeta${inscripcionId ? `?inscripcion=${encodeURIComponent(inscripcionId)}` : ''}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
                });
            } catch (error) {
                if (esteDetalle === detalleId) $('resultado-carpeta').textContent = error.message;
            } finally { if (esteDetalle === detalleId) $('abrir-carpeta').disabled = !item.carpetaExpediente; }
        };
        const lista = $('datos-detalle');
        lista.replaceChildren();
        for (const [nombre, valor] of [
            ['Solicitud', item.id],
            ['Nombre', item.nombreCompleto],
            ['Teléfono', item.telefono],
            ['Identificador del chat', item.contactoId],
            ['Programa', item.programa],
            ['Subprograma', item.subprograma],
            ['Estado', ESTADOS[item.estado] || item.estado],
            ['Solicitado', fecha(item.solicitadoEn)],
            ['Atendido', fecha(item.atendidoEn)],
            ['Etapa anterior', item.estadoFlujoAnterior],
            ['Requisitos pendientes', item.resumenDocumentos?.requisitos
                .filter((requisito) => ['pendiente', 'incompleto'].includes(requisito.estado) || requisito.revision?.estado === 'incompleto')
                .map((requisito) => requisito.nombre).join('\n') || 'Ninguno'],
            ['Requisitos por validar', item.resumenDocumentos?.requisitos
                .filter((requisito) => requisito.revision?.estado !== 'validado')
                .map((requisito) => requisito.nombre).join('\n') || 'Ninguno'],
            ['Expediente', item.expedienteId],
            ['Carpeta local', item.carpetaExpediente],
        ]) {
            const dt = document.createElement('dt');
            dt.textContent = nombre;
            const dd = document.createElement('dd');
            dd.textContent = valor || '—';
            lista.append(dt, dd);
        }
        const archivos = $('documentos-detalle');
        archivos.replaceChildren();
        const resumen = item.resumenDocumentos;
        $('resumen-documentos').textContent = resumen
            ? `${resumen.requisitos.length} requisitos: ${resumen.recibidos} recibidos, ${resumen.pendientes} pendientes o incompletos, ${resumen.noAplican} no aplican. La recepción no significa validación.`
            : '';
        const requisitos = resumen?.requisitos || Object.entries(item.documentos || {}).map(([id, documento]) => ({ ...documento, id, nombre: id }));
        const estadosDocumentos = { pendiente: 'PENDIENTE', incompleto: 'INCOMPLETO', recibido: 'RECIBIDO', no_aplica: 'NO APLICA' };
        for (const documento of requisitos) {
            const nombre = documento.id;
            const li = document.createElement('li');
            const titulo = document.createElement('strong');
            titulo.className = 'titulo-documento';
            titulo.textContent = `${documento.nombre}: `;
            li.append(titulo, etiquetaEstado(estadosDocumentos[documento.estado] || documento.estado || 'Registrado', documento.estado));
            if (documento.revision?.estado === 'validado') li.append(' ', etiquetaEstado('VALIDADO PERSONALMENTE', 'validado'));
            if (documento.revision?.estado === 'incompleto') li.append(' ', etiquetaEstado('INCOMPLETO / NO VÁLIDO', 'rechazado'));
            const descripcion = document.createElement('p');
            descripcion.className = 'descripcion-documento';
            const explicacion = documento.estado === 'incompleto' ? 'Falta confirmar con «siguiente» o reenviar los archivos faltantes. '
                : documento.estado === 'pendiente' ? 'Aún falta recibir este requisito. ' : '';
            descripcion.textContent = `${explicacion}${documento.valor || ''}${resumen && documento.tipo !== 'texto' ? `${documento.archivosGuardados} archivo(s) guardado(s)${documento.archivosFaltantes ? `; ${documento.archivosFaltantes} no disponible(s)` : ''}` : ''}`;
            if (descripcion.textContent) li.append(descripcion);
            if (documento.revision?.observacion) {
                const observacion = document.createElement('p');
                observacion.className = 'descripcion-documento';
                observacion.textContent = `Revisión: ${documento.revision.observacion}`;
                li.append(observacion);
            }
            const ul = document.createElement('ul');
            for (const [indice, archivo] of (
                documento.archivos || []
            ).entries()) {
                const file = document.createElement('li');
                file.className = 'archivo-documento';
                const ruta = document.createElement('small');
                ruta.className = 'ruta-archivo';
                ruta.textContent = archivo.ruta;
                file.append(ruta);
                const endpoint = `/api/${source}/${encodeURIComponent(id)}/documentos/${encodeURIComponent(nombre)}/${indice}${inscripcionId ? `?inscripcion=${encodeURIComponent(inscripcionId)}` : ''}`;
                if (archivo.disponible !== false) cargarArchivo(endpoint, file, nombre, esteDetalle);
                ul.append(file);
            }
            li.append(ul);
            archivos.append(li);
            li.dataset.requisito = documento.id;
        }
        if (!archivos.children.length) {
            const li = document.createElement('li');
            li.textContent = 'No hay documentos registrados en esta solicitud.';
            archivos.append(li);
        }
        $('detalle').dataset.id = id;
        contextoRevision = { id, source, inscripcionId, requisitos, programa: `${item.programa} · ${item.subprograma}` };
        $('abrir-revision').hidden = source === 'historial' || !inscripcionId || !requisitos.length;
        const cerrarPersona = $('marcar-persona-atendida');
        cerrarPersona.hidden = source === 'historial' || !totalInscripciones;
        cerrarPersona.disabled = !personaRevisada || atencionConfirmada;
        cerrarPersona.textContent = atencionConfirmada ? 'Persona atendida' : 'Marcar persona como atendida';
        cerrarPersona.title = personaRevisada ? '' : `Faltan documentos sin revisar (${inscripcionesRevisadas} de ${totalInscripciones} inscripciones revisadas).`;
        $('estado-validacion-persona').textContent = !totalInscripciones && source !== 'historial'
            ? 'Solicitud de atención personal. No requiere validación automatizada de documentos; puede marcarla como atendida desde el listado.'
            : soloAtencion ? 'Atención personal concluida. Esta atención no incluyó validación de documentos.' : personaRevisada
            ? atencionConfirmada || source === 'historial' ? 'Atención confirmada. El historial conserva los resultados válidos e incompletos/no válidos.' : 'Todas las inscripciones están revisadas. Puede marcar a la persona como atendida aunque existan documentos incompletos/no válidos.'
            : `${inscripcionesRevisadas} de ${totalInscripciones} inscripciones revisadas. Revise cada documento para habilitar el cierre de atención.`;
        $('detalle').hidden = false;
        if (!$('detalle').open) $('detalle').showModal();
        if (enfocar) $('titulo-detalle').focus();
    } catch (error) {
        mostrarError(error.message);
    }
}

function abrirRevision() {
    if (!contextoRevision || contextoRevision.source === 'historial') return;
    $('programa-revision').textContent = contextoRevision.programa;
    $('error-revision').hidden = true;
    const contenedor = $('requisitos-revision');
    contenedor.replaceChildren();
    for (const [indice, requisito] of contextoRevision.requisitos.entries()) {
        const fieldset = document.createElement('fieldset');
        fieldset.className = 'requisito-revision';
        fieldset.dataset.requisito = requisito.id;
        const legend = document.createElement('legend');
        legend.textContent = requisito.nombre;
        fieldset.append(legend);
        const descripcion = document.createElement('p');
        descripcion.textContent = requisito.valor || (requisito.estado === 'no_aplica' ? 'Declarado como no aplicable.' : `${requisito.archivosGuardados || 0} archivo(s) disponible(s).`);
        fieldset.append(descripcion);
        for (const li of $('documentos-detalle').children) {
            if (li.dataset.requisito === requisito.id) {
                const archivos = li.querySelector('ul');
                if (archivos) fieldset.append(archivos.cloneNode(true));
            }
        }
        const opciones = document.createElement('fieldset');
        opciones.className = 'opciones-revision';
        const tituloOpciones = document.createElement('legend');
        tituloOpciones.textContent = 'Resultado de revisión';
        opciones.append(tituloOpciones);
        for (const [valor, texto] of [['pendiente', 'Sin revisar'], ['validado', 'Válido'], ['incompleto', 'Incompleto / no válido']]) {
            const label = document.createElement('label');
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = `revision-documento-${indice}`;
            radio.value = valor;
            radio.className = 'estado-revision';
            radio.required = true;
            radio.checked = valor === (requisito.revision?.estado || 'pendiente');
            label.append(radio, document.createTextNode(texto));
            opciones.append(label);
        }
        const nota = document.createElement('label');
        nota.textContent = 'Observación (opcional)';
        const textarea = document.createElement('textarea');
        textarea.className = 'observacion-revision';
        textarea.maxLength = 2000;
        textarea.value = requisito.revision?.observacion || '';
        nota.append(textarea);
        fieldset.append(opciones, nota);
        contenedor.append(fieldset);
    }
    $('revision-documentos').hidden = false;
    $('revision-documentos').showModal();
}

$('abrir-revision').addEventListener('click', abrirRevision);
$('marcar-persona-atendida').addEventListener('click', async () => {
    const contexto = contextoRevision;
    if (!contexto || contexto.source === 'historial' || $('marcar-persona-atendida').disabled) return;
    $('marcar-persona-atendida').disabled = true;
    try {
        await consultar(`/api/${contexto.source}/${encodeURIComponent(contexto.id)}/atender`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        });
        await cargar();
        await mostrarDetalle(contexto.id, false, contexto.inscripcionId);
    } catch (error) {
        mostrarError(error.message);
        await mostrarDetalle(contexto.id, false, contexto.inscripcionId);
    }
});
$('cerrar-revision').addEventListener('click', () => $('revision-documentos').close());
$('revision-documentos').addEventListener('close', () => { $('revision-documentos').hidden = true; });
$('formulario-revision').addEventListener('submit', async (event) => {
    event.preventDefault();
    const contexto = contextoRevision;
    if (!contexto || contexto.source === 'historial') return;
    $('guardar-revision').disabled = true;
    try {
        const documentos = [...$('requisitos-revision').children].map((fieldset) => ({
            id: fieldset.dataset.requisito,
            huella: contexto.requisitos.find((item) => item.id === fieldset.dataset.requisito).huella,
            estado: fieldset.querySelector('input[type="radio"]:checked').value,
            observacion: fieldset.querySelector('textarea').value,
        }));
        await consultar(`/api/${contexto.source}/${encodeURIComponent(contexto.id)}/inscripciones/${encodeURIComponent(contexto.inscripcionId)}/revision`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentos }),
        });
        $('revision-documentos').close();
        await cargar();
        await mostrarDetalle(contexto.id, false, contexto.inscripcionId);
    } catch (error) {
        $('error-revision').textContent = error.message;
        $('error-revision').hidden = false;
    } finally { $('guardar-revision').disabled = false; }
});

function liberarArchivos() {
    for (const url of urlsArchivos) URL.revokeObjectURL(url);
    urlsArchivos = [];
}

async function cargarArchivo(endpoint, contenedor, nombre, esteDetalle) {
    try {
        const blob = await consultar(endpoint, {}, true);
        if (esteDetalle !== detalleId) return;
        const url = URL.createObjectURL(blob);
        urlsArchivos.push(url);
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener';
        if (blob.type.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = url;
            img.alt = `Documento ${nombre}`;
            img.className = 'vista-documento';
            link.append(img);
        } else {
            link.textContent =
                blob.type === 'application/pdf'
                    ? 'Abrir PDF'
                    : 'Descargar archivo';
            if (blob.type !== 'application/pdf') link.download = nombre;
        }
        contenedor.prepend(link);
    } catch {
        if (esteDetalle !== detalleId) return;
        const aviso = document.createElement('span');
        aviso.textContent =
            'Vista previa no disponible: el archivo no se pudo leer.';
        contenedor.prepend(aviso);
    }
}

async function abrirChat(id, button) {
    button.disabled = true;
    try {
        await consultar(
            `/api/${$('vista').value}/${encodeURIComponent(id)}/abrir-chat`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            },
        );
    } catch (error) {
        mostrarError(error.message);
    } finally {
        button.disabled = false;
    }
}

async function atender(id, button, ids = [id]) {
    button.disabled = true;
    try {
        for (const pendiente of ids) await consultar(
            `/api/${$('vista').value}/${encodeURIComponent(pendiente)}/atender`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            },
        );
        await cargar();
        if (!$('detalle').hidden && $('detalle').dataset.id === id)
            await mostrarDetalle(id, false);
    } catch (error) {
        mostrarError(error.message);
    } finally {
        button.disabled = false;
    }
}

$('actualizar').addEventListener('click', cargar);
$('estado').addEventListener('change', cargar);
$('vista').addEventListener('change', () => {
    for (const button of document.querySelectorAll('[data-vista]')) {
        if (button.dataset.vista === $('vista').value) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
    }
    detalleId += 1;
    liberarArchivos();
    $('detalle').hidden = true;
    $('detalle').close();
    const historial = $('vista').value === 'historial';
    const bot = !['atencion-humana', 'certeza'].includes($('vista').value);
    $('titulo-tabla').textContent = $('vista').value === 'certeza' ? 'Atención personal de Certeza jurídica' : historial ? 'Historial de atención y validación personal' : bot
        ? 'Clientes atendidos por el bot'
        : 'Solicitudes de atención humana';
    $('columna-motivo').textContent = bot ? 'Atención' : 'Motivo';
    const opciones = historial ? [['', 'Todas las personas atendidas']] : bot
        ? [
              ['', 'Todos'],
              ['en_curso', 'En curso'],
              ['completado', 'Recopilación completa'],
              ['atencion_humana', 'Derivados a una persona'],
              ['atencion_resuelta', 'Atención personal concluida'],
          ]
        : [
              ['pendiente', 'Pendientes'],
              ['atendido', 'Atendidas'],
              ['', 'Todas'],
          ];
    $('estado').replaceChildren(
        ...opciones.map(([valor, texto]) => new Option(texto, valor)),
    );
    solicitudes = [];
    dibujar();
    cargar();
});
for (const button of document.querySelectorAll('[data-vista]')) button.addEventListener('click', () => {
    if ($('vista').value === button.dataset.vista) return;
    $('vista').value = button.dataset.vista;
    $('vista').dispatchEvent(new Event('change'));
});
$('buscar').addEventListener('input', dibujar);
$('cerrar-detalle').addEventListener('click', () => {
    detalleId += 1;
    liberarArchivos();
    $('detalle').hidden = true;
    $('detalle').close();
});
$('detalle').addEventListener('close', () => { detalleId += 1; liberarArchivos(); $('detalle').hidden = true; });
$('acceso').hidden = !config.requiereToken;
$('acceso').addEventListener('submit', (event) => {
    event.preventDefault();
    token = $('token').value;
    $('token').value = '';
    cargar();
});
if (!config.requiereToken) cargar();
setInterval(() => {
    if (!document.hidden && (!config.requiereToken || token)) cargar();
}, config.actualizacionMs);
