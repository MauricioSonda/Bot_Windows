const http = require('http');
const { timingSafeEqual } = require('crypto');
const fs = require('fs');
const path = require('path');
const { API_ATENCION, DASHBOARD } = require('./configuracion');
const { leerSolicitudes, marcarAtendida } = require('./atencion-humana');
const { listarClientes, leerArchivoRegistrado } = require('./datos-dashboard');
const { inscripcionesParaDetalle } = require('./inscripciones');
const { prepararEstadoDocumentos } = require('./estado-documentos');
const { crearRevisiones } = require('./revision-documentos');
const { abrirCarpetaExpediente } = require('./carpetas-expedientes');

function crearServidorAtencion({
    listar = leerSolicitudes,
    atender = marcarAtendida,
    clientes = listarClientes,
    alAtender = () => {},
    abrirChat = null,
    abrirCarpeta = abrirCarpetaExpediente,
    leerArchivo = leerArchivoRegistrado,
    revisiones = crearRevisiones(),
    controlBot = null,
} = {}) {
    return http.createServer(async (request, response) => {
        const responder = (status, data) => {
            response.writeHead(status, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
            });
            response.end(JSON.stringify(data));
        };
        const url = new URL(request.url, `http://${API_ATENCION.HOST}`);
        const publicFiles = {
            '/': ['index.html', 'text/html; charset=utf-8'],
            '/dashboard.css': ['dashboard.css', 'text/css; charset=utf-8'],
            '/dashboard.js': ['dashboard.js', 'text/javascript; charset=utf-8'],
        };
        if (
            request.method === 'GET' &&
            (publicFiles[url.pathname] ||
                url.pathname === '/dashboard-config.js')
        ) {
            try {
                const entry = publicFiles[url.pathname];
                const content = entry
                    ? fs.readFileSync(
                          path.join(__dirname, 'dashboard', entry[0]),
                      )
                    : `window.DASHBOARD_CONFIG = ${JSON.stringify({ actualizacionMs: DASHBOARD.ACTUALIZACION_MS, requiereToken: Boolean(API_ATENCION.TOKEN), controlToken: controlBot?.token || null })};`;
                response.writeHead(200, {
                    'Content-Type': entry
                        ? entry[1]
                        : 'text/javascript; charset=utf-8',
                    'Cache-Control': 'no-store',
                    'X-Content-Type-Options': 'nosniff',
                    'Content-Security-Policy':
                        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'",
                });
                response.end(content);
            } catch {
                responder(500, { error: 'No se pudo cargar el dashboard' });
            }
            return;
        }
        if (API_ATENCION.TOKEN) {
            const expected = Buffer.from(`Bearer ${API_ATENCION.TOKEN}`);
            const actual = Buffer.from(request.headers.authorization || '');
            if (
                actual.length !== expected.length ||
                !timingSafeEqual(actual, expected)
            ) {
                responder(401, { error: 'No autorizado' });
                return;
            }
        }
        function registros(source) {
            if (source === 'historial') return revisiones.historial();
            const botClientes = clientes();
            if (source === 'clientes')
                return botClientes.filter(
                    (item) =>
                        (item.destinoAtencion !== 'certeza' && (item.modalidadAtencion === 'automatizada' ||
                        (item.iniciadoEn && ['activando', 'esperando_nombre', 'esperando_destino', 'esperando_tipo_atencion', 'inicio_pendiente'].includes(item.estado)) ||
                        item.programa ||
                        Object.keys(item.documentos || {}).length)) ||
                        item.inscripciones?.length || item.controlBot?.pausado || item.estado === 'activando' || item.estado === 'esperando_nombre',
                ).map(prepararEstadoDocumentos).map((item) => revisiones.preparar(item));
            const solicitudes = listar();
            return solicitudes.filter((item) => source === 'certeza'
                ? item.destinoAtencion === 'certeza' || item.motivo === 'certeza_juridica'
                : item.destinoAtencion !== 'certeza' && item.motivo !== 'certeza_juridica').map((item) => {
                const cliente = botClientes.find((cliente) => cliente.contactoId === item.contactoId || cliente.contactosIds?.includes(item.contactoId));
                return ({
                ...item,
                contactosIds: cliente?.contactosIds || [item.contactoId],
                telefono:
                    item.telefono ||
                    cliente?.telefono ||
                    null,
                inscripciones: item.destinoAtencion === 'certeza' || item.motivo === 'certeza_juridica' ? [] : [...new Map([
                    ...solicitudes.filter((otra) => otra.contactoId === item.contactoId ||
                        (item.telefono && otra.telefono === item.telefono) || cliente?.contactosIds?.includes(otra.contactoId))
                        .flatMap(inscripcionesParaDetalle),
                    ...(cliente?.inscripciones || []),
                ].map((registro) => [registro.id, registro])).values()],
            }); }).map(prepararEstadoDocumentos).map((item) => revisiones.preparar(item));
        }
        function escrituraPermitida() {
            return (!request.headers.origin || request.headers.origin === `http://${request.headers.host}`) &&
                request.headers['sec-fetch-site'] !== 'cross-site' &&
                String(request.headers['content-type'] || '').startsWith('application/json');
        }
        if (url.pathname.startsWith('/api/control/')) {
            const host = String(request.headers.host || '').split(':')[0];
            const token = Buffer.from(String(request.headers['x-bot-control'] || ''));
            const esperado = Buffer.from(String(controlBot?.token || ''));
            if (!controlBot || !['127.0.0.1', 'localhost'].includes(host) || !esperado.length || token.length !== esperado.length || !timingSafeEqual(token, esperado)) {
                responder(403, { error: 'Control local no autorizado.' }); return;
            }
            if (request.method !== 'GET' && !escrituraPermitida()) { responder(403, { error: 'Solicitud de origen no permitido.' }); return; }
            try {
                if (url.pathname === '/api/control/estado' && request.method === 'GET') responder(200, controlBot.estado());
                else if (url.pathname === '/api/control/apagar' && request.method === 'POST') {
                    responder(200, { apagando: true });
                    setTimeout(() => Promise.resolve(controlBot.apagar()).catch(console.error), 150);
                } else if (url.pathname === '/api/control/mostrar' && request.method === 'POST') {
                    await controlBot.mostrar(); responder(200, { abierto: true });
                } else {
                    const ruta = url.pathname.match(/^\/api\/control\/chats\/([^/]+)(?:\/(pausar|reanudar|derivar))?$/);
                    const id = ruta && decodeURIComponent(ruta[1]);
                    if (!ruta || !/^[0-9]+@(c\.us|lid)$/.test(id)) { responder(404, { error: 'Chat no encontrado.' }); return; }
                    if (request.method === 'GET' && !ruta[2]) responder(200, controlBot.estadoChat(id));
                    else if (request.method === 'POST' && ruta[2]) responder(200, await controlBot.accionChat(id, ruta[2]));
                    else responder(405, { error: 'Acción no permitida.' });
                }
            } catch (error) { responder(error.status || 500, { error: error.message }); }
            return;
        }
        function cerrarSolicitudes(resultado) {
            const ids = new Set([resultado.contactoId, ...(resultado.contactosIds || [])]);
            for (const solicitud of registros('atencion-humana')) {
                if (solicitud.estado === 'pendiente' && (ids.has(solicitud.contactoId) ||
                    (resultado.telefono && resultado.telefono === solicitud.telefono))) {
                    const cerrada = atender(solicitud.id);
                    if (cerrada) alAtender(cerrada);
                }
            }
        }
        const revisionRoute = url.pathname.match(/^\/api\/(atencion-humana|clientes)\/([^/]+)\/inscripciones\/([^/]+)\/revision$/);
        if (request.method === 'POST' && revisionRoute) {
            if (!escrituraPermitida()) { responder(403, { error: 'Solicitud de origen no permitido' }); return; }
            try {
                let body = '';
                for await (const chunk of request) {
                    body += chunk;
                    if (Buffer.byteLength(body) > 65536) { responder(413, { error: 'La revisión excede el tamaño permitido' }); return; }
                }
                let datos;
                try { datos = JSON.parse(body); } catch (_) { responder(400, { error: 'JSON inválido' }); return; }
                const [, source, id, inscripcion] = revisionRoute;
                const persona = registros(source).find((item) => item.id === decodeURIComponent(id));
                if (!persona) { responder(404, { error: 'Persona no encontrada' }); return; }
                const resultado = revisiones.guardar(persona, decodeURIComponent(inscripcion), datos.documentos);
                responder(200, resultado);
            } catch (error) { responder(error.status || 500, { error: error.status ? error.message : 'No se pudo guardar la revisión.' }); }
            return;
        }
        const action = url.pathname.match(
            /^\/api\/(atencion-humana|certeza|clientes|historial)\/([^/]+)\/(atender|abrir-chat|abrir-carpeta)$/,
        );
        if (request.method === 'POST' && action) {
            const expectedOrigin = `http://${request.headers.host}`;
            if (
                (request.headers.origin &&
                    request.headers.origin !== expectedOrigin) ||
                request.headers['sec-fetch-site'] === 'cross-site' ||
                !String(request.headers['content-type'] || '').startsWith(
                    'application/json',
                )
            ) {
                responder(403, { error: 'Solicitud de origen no permitido' });
                return;
            }
            try {
                const [, source, encodedId, operacion] = action;
                const id = decodeURIComponent(encodedId);
                if (operacion === 'abrir-carpeta') {
                    let item = registros(source).find((registro) => registro.id === id);
                    if (!item) { responder(404, { error: 'Persona no encontrada' }); return; }
                    const inscripcionId = url.searchParams.get('inscripcion');
                    if (inscripcionId) item = item.inscripciones?.find((registro) => registro.id === inscripcionId);
                    if (!item) { responder(404, { error: 'Inscripción no encontrada' }); return; }
                    await abrirCarpeta(item);
                    responder(200, { abierto: true });
                } else if (operacion === 'atender' && ['atencion-humana', 'certeza', 'clientes'].includes(source)) {
                    const persona = registros(source).find((item) => item.id === id);
                    if (!persona) { responder(404, { error: 'Persona no encontrada' }); return; }
                    if (persona?.inscripciones?.length && persona.revisionPersonal !== 'revisado') {
                        responder(409, { error: 'Primero revise todos los documentos de todas las inscripciones de la persona.' });
                        return;
                    }
                    if (persona.inscripciones?.length) {
                        const resultado = revisiones.finalizar(persona);
                        cerrarSolicitudes(resultado);
                        responder(200, resultado);
                        return;
                    }
                    if (source === 'clientes') { responder(409, { error: 'La persona no tiene inscripciones revisadas.' }); return; }
                    const solicitud = atender(id);
                    if (solicitud) alAtender(solicitud);
                    if (solicitud && !persona?.inscripciones?.length) revisiones.archivarAtencion({ ...persona, ...solicitud });
                    responder(
                        solicitud ? 200 : 404,
                        solicitud || { error: 'Solicitud no encontrada' },
                    );
                } else if (operacion === 'abrir-chat') {
                    const item = registros(source).find(
                        (registro) => registro.id === id,
                    );
                    if (!item)
                        responder(404, { error: 'Cliente no encontrado' });
                    else if (!abrirChat)
                        responder(503, {
                            error: 'Inicie el bot para abrir el chat en la sesión vinculada.',
                        });
                    else {
                        await abrirChat(item.contactoId);
                        responder(200, { abierto: true });
                    }
                } else responder(405, { error: 'Acción no permitida' });
            } catch (error) {
                responder(error.status || 500, {
                    error: error.status ? error.message : 'No se pudo completar la acción. Revise que WhatsApp esté conectado.',
                });
            }
            return;
        }
        if (request.method !== 'GET') {
            response.setHeader('Allow', 'GET');
            responder(405, { error: 'Solo se permiten consultas GET' });
            return;
        }
        try {
            if (url.pathname === '/api/salud') {
                responder(200, {
                    servicio: 'atencion-humana',
                    estado: 'disponible',
                });
                return;
            }
            const base = '/api/atencion-humana';
            const archivoRoute = url.pathname.match(
                /^\/api\/(atencion-humana|certeza|clientes|historial)\/([^/]+)\/documentos\/([^/]+)\/(\d+)$/,
            );
            if (archivoRoute) {
                const [, source, id, documento, indice] = archivoRoute;
                let item = registros(source).find(
                    (registro) => registro.id === decodeURIComponent(id),
                );
                const inscripcionId = url.searchParams.get('inscripcion');
                if (inscripcionId) item = item?.inscripciones?.find((registro) => registro.id === inscripcionId);
                const archivo = leerArchivo(
                    item,
                    decodeURIComponent(documento),
                    indice,
                );
                if (!archivo) {
                    responder(404, { error: 'Archivo no disponible' });
                    return;
                }
                response.writeHead(200, {
                    'Content-Type': archivo.tipo,
                    'Cache-Control': 'no-store',
                    'X-Content-Type-Options': 'nosniff',
                    'Content-Disposition': `${archivo.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(archivo.nombre)}`,
                });
                response.end(archivo.contenido);
                return;
            }
            if (
                url.pathname === '/api/clientes' ||
                url.pathname.startsWith('/api/clientes/') ||
                url.pathname === '/api/historial' || url.pathname.startsWith('/api/historial/')
                || url.pathname === '/api/certeza' || url.pathname.startsWith('/api/certeza/')
            ) {
                const source = url.pathname.startsWith('/api/historial') ? 'historial' : url.pathname.startsWith('/api/certeza') ? 'certeza' : 'clientes';
                const baseSource = `/api/${source}`;
                const items = registros(source).filter((item) => !url.searchParams.get('estado') || item.estado === url.searchParams.get('estado'));
                if (url.pathname === baseSource)
                    responder(200, { total: items.length, solicitudes: items });
                else {
                    const id = decodeURIComponent(
                        url.pathname.slice(baseSource.length + 1),
                    );
                    const item = items.find((cliente) => cliente.id === id);
                    responder(
                        item ? 200 : 404,
                        item || { error: 'Cliente no encontrado' },
                    );
                }
                return;
            }
            if (url.pathname === base) {
                const estado = url.searchParams.get('estado');
                const solicitudes = registros('atencion-humana').filter(
                    (item) => !estado || item.estado === estado,
                );
                responder(200, { total: solicitudes.length, solicitudes });
            } else if (url.pathname.startsWith(`${base}/`)) {
                const id = decodeURIComponent(
                    url.pathname.slice(base.length + 1),
                );
                const solicitud = registros('atencion-humana').find(
                    (item) => item.id === id,
                );
                responder(
                    solicitud ? 200 : 404,
                    solicitud || { error: 'Solicitud no encontrada' },
                );
            } else {
                responder(404, { error: 'Ruta no encontrada' });
            }
        } catch (error) {
            console.error(
                'Error de consulta de atención humana:',
                error.message,
            );
            responder(500, { error: 'No se pudo consultar la información' });
        }
    });
}

function iniciarServidorAtencion(opciones) {
    const server = crearServidorAtencion(opciones);
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(API_ATENCION.PUERTO, API_ATENCION.HOST, () => {
            server.removeListener('error', reject);
            resolve(server);
        });
    });
}

if (require.main === module) {
    const server = crearServidorAtencion();
    server.on('error', (error) => {
        console.error('No se pudo iniciar la API:', error.message);
        process.exitCode = 1;
    });
    server.listen(API_ATENCION.PUERTO, API_ATENCION.HOST, () => {
        console.log(
            `Dashboard: http://${API_ATENCION.HOST}:${API_ATENCION.PUERTO}/`,
        );
    });
}

module.exports = { crearServidorAtencion, iniciarServidorAtencion };
