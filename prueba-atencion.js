const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('./index');
const {
    encontrarOpcion,
    encontrarPrograma,
    formatearOpciones,
} = require('./programas');
const MENSAJES = require('./mensajes');
const CONFIG = require('./configuracion');
require('./entorno').prepararDatos(CONFIG);
const { crearRespuestaConRetraso } = require('./retrasos');
const { crearControlAtencion, registrarSolicitud, leerSolicitudes } = require('./atencion-humana');
const { crearControlConversaciones } = require('./control-conversaciones');
const { adquirirInstancia, solicitarControl } = require('./control-ejecucion');
const { crearFlujoDestino } = require('./flujo-destino');
const { iniciarDashboardLocal } = require('./dashboard-local');
const { resolverTelefono } = require('./telefonos');
const { listarClientes } = require('./datos-dashboard');
const { obtenerInscripciones, programasDisponibles, subprogramasDisponibles } = require('./inscripciones');
const { iniciarDocumentos, manejarDocumentos } = require('./flujo-documentos');

const {
    READY_RECOVERY_INTERVAL_MS,
} = CONFIG;
const CUSTOMER_DATA_FILE = CONFIG.ARCHIVO_CLIENTES;
const activationsInProgress = new Set();

let clientIsReady = false;
let readyRecoveryInProgress = false;
let readyRecoveryTimer = null;
let dashboardLocal = null;
let deteniendo = false;
let instancia = null;
let cierre = null;
const navegadoresVigilados = new WeakSet();
const paginasVigiladas = new WeakSet();

function loadCustomerData() {
    try {
        return JSON.parse(fs.readFileSync(CUSTOMER_DATA_FILE, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error(
                'No se pudieron leer los nombres guardados:',
                error.message,
            );
        }
        return {};
    }
}

const customerData = loadCustomerData();

function saveCustomerData() {
    const temporaryFile = `${CUSTOMER_DATA_FILE}.tmp`;
    fs.writeFileSync(
        temporaryFile,
        `${JSON.stringify(customerData, null, 2)}\n`,
        'utf8',
    );
    fs.renameSync(temporaryFile, CUSTOMER_DATA_FILE);
}

function updateCustomer(contactId, changes) {
    customerData[contactId] = {
        ...customerData[contactId],
        ...changes,
        actualizadoEn: new Date().toISOString(),
    };
    saveCustomerData();
}

const manejarAtencion = crearControlAtencion({
    actualizarCliente: updateCustomer,
});
const control = crearControlConversaciones({ clientes: customerData, actualizarCliente: updateCustomer,
    registrar: registrarSolicitud, consultar: leerSolicitudes });
const manejarDestino = crearFlujoDestino({ actualizarCliente: updateCustomer });
const telefonosConsultados = new Map();

async function actualizarTelefono(contactoId) {
    if (
        customerData[contactoId]?.telefono ||
        Date.now() - (telefonosConsultados.get(contactoId) || 0) <
            CONFIG.TELEFONO_REINTENTO_MS
    )
        return;
    telefonosConsultados.set(contactoId, Date.now());
    try {
        const telefono = await resolverTelefono(client, contactoId);
        if (telefono) updateCustomer(contactoId, { telefono });
    } catch (error) {
        console.error(
            'No se pudo guardar el teléfono del contacto:',
            error.message,
        );
    }
}

const client = new Client({
    userAgent: false,
    authTimeoutMs: CONFIG.INICIO_SESION_TIMEOUT_MS,
    qrMaxRetries: 0,
    authStrategy: new LocalAuth({
        dataPath: CONFIG.CARPETA_SESION,
    }),
    webVersionCache: { type: 'local', path: CONFIG.CARPETA_CACHE },
    puppeteer: {
        ...(CONFIG.CHROME_EXECUTABLE_PATH ? { executablePath: CONFIG.CHROME_EXECUTABLE_PATH } : {}),
        headless: false,
        timeout: CONFIG.INICIO_SESION_TIMEOUT_MS,
        protocolTimeout: CONFIG.INICIO_SESION_TIMEOUT_MS,
        args: ['--disable-crash-reporter', '--disable-breakpad'],
    },
});

client.on('qr', (qr) => {
    console.log('\nEscanea este QR con WhatsApp > Dispositivos vinculados:\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    clientIsReady = true;
    control.activar();
    vigilarNavegador();
    if (readyRecoveryTimer) {
        clearInterval(readyRecoveryTimer);
        readyRecoveryTimer = null;
    }
    console.log('Listo. Solo se atenderán mensajes nuevos recibidos desde este momento.');
    (async () => {
        for (const contactoId of Object.keys(customerData))
            await actualizarTelefono(contactoId);
    })().catch((error) =>
        console.error(
            'No se pudieron actualizar los teléfonos:',
            error.message,
        ),
    );
});
client.on('auth_failure', (message) => {
    clientIsReady = false; control.desactivar();
    console.error('Falló la autenticación:', message);
});
client.on('disconnected', (reason) => {
    clientIsReady = false; control.desactivar();
    console.log('WhatsApp se desconectó:', reason);
});
client.on('change_state', (state) => {
    if (state !== 'CONNECTED') control.desactivar();
    else if (clientIsReady) control.activar();
});

function vigilarNavegador() {
    if (client.pupPage?.isClosed?.() || client.pupBrowser?.isConnected?.() === false) {
        if (!deteniendo) apagarBot();
        return;
    }
    if (client.pupBrowser && !navegadoresVigilados.has(client.pupBrowser)) {
        navegadoresVigilados.add(client.pupBrowser);
        client.pupBrowser.once('disconnected', () => { if (!deteniendo) apagarBot(); });
    }
    if (client.pupPage && !paginasVigiladas.has(client.pupPage)) {
        paginasVigiladas.add(client.pupPage);
        client.pupPage.once('close', () => { if (!deteniendo) apagarBot(); });
    }
}

function startReadyRecovery() {
    readyRecoveryTimer = setInterval(async () => {
        vigilarNavegador();
        if (deteniendo) return;
        if (clientIsReady || readyRecoveryInProgress || !client.pupPage) return;

        readyRecoveryInProgress = true;
        try {
            const canRecover = await client.pupPage.evaluate(() => {
                if (typeof window.require !== 'function') return false;

                try {
                    const socket = window.require('WAWebSocketModel').Socket;
                    return (
                        socket.state === 'CONNECTED' &&
                        socket.hasSynced === true &&
                        typeof window.onAppStateHasSyncedEvent === 'function'
                    );
                } catch {
                    return false;
                }
            });

            if (canRecover) {
                console.log(
                    'WhatsApp está sincronizado. Completando la inicialización del bot...',
                );
                await client.pupPage.evaluate(() =>
                    window.onAppStateHasSyncedEvent(),
                );
            }
        } catch (error) {
            if (!clientIsReady) {
                console.error(
                    'No se pudo comprobar la sincronización:',
                    error.message,
                );
            }
        } finally {
            readyRecoveryInProgress = false;
        }
    }, READY_RECOVERY_INTERVAL_MS);
}

client.on('message_create', (message) => {
    if (message.fromMe) {
        control.comando(message).catch((error) => console.error('No se pudo ejecutar el comando de control:', error.message));
        return;
    }
    if (!message.fromMe) {
        console.log('Evento de mensaje entrante detectado:', {
            tipo: message.type,
            chatGrupal: message.from.endsWith('@g.us'),
            recepcionActiva: control.estado().conectado,
        });
    }
});

const messageQueues = new Map();
const iniciosReservados = new Set();
function esEstadoInicio(cliente) {
    return !cliente?.estado || ['completado', 'error_activacion', 'inicio_pendiente', 'atencion_resuelta'].includes(cliente.estado);
}
client.on('message', (message) => {
    if (!control.aceptar(message) || iniciosReservados.has(message.from) || customerData[message.from]?.estado === 'activando') return;
    const reserva = esEstadoInicio(customerData[message.from]);
    if (reserva) iniciosReservados.add(message.from);
    const contexto = control.contexto(message.from);
    const recibidoEn = Date.now();
    const previous = messageQueues.get(message.from) || Promise.resolve();
    const pending = previous
        .then(() => procesarMensaje(message, recibidoEn, contexto))
        .catch((error) => {
            if (error.code === 'BOT_CANCELADO') return;
            console.error('No se pudo procesar el mensaje:', error.message);
        });
    messageQueues.set(message.from, pending);
    pending.finally(() => {
        contexto.liberar();
        if (reserva) iniciosReservados.delete(message.from);
        if (messageQueues.get(message.from) === pending)
            messageQueues.delete(message.from);
    });
});

async function procesarMensaje(message, recibidoEn = Date.now(), contexto = control.contexto(message.from)) {
    contexto.verificar();
    if (message.fromMe) return;
    if (
        message.from.endsWith('@g.us') ||
        message.from.endsWith('@broadcast') ||
        message.from.includes('@newsletter')
    ) {
        console.log('Mensaje de grupo, estado o canal ignorado.');
        return;
    }

    if (message.type === 'sticker' && !esEstadoInicio(customerData[message.from])) {
        console.log('Sticker ignorado.');
        return;
    }

    const original = message;
    const respuesta = crearRespuestaConRetraso(message, { recibidoEn, signal: contexto.signal, verificar: contexto.verificar });
    message = respuesta.mensaje;
    const fullText = (message.body || '').trim().replace(/\s+/g, ' ');
    const messageText = fullText.toLowerCase();
    await actualizarTelefono(message.from);
    contexto.verificar();
    const customer = customerData[message.from];
    const currentState = customer?.estado;

    // Ayuda tiene prioridad una vez clasificada la atención de programas.
    const attentionResult = await manejarAtencion(message, customer);
    if (attentionResult === 'continuar_programas') {
        if (!programasDisponibles(customer).length) {
            updateCustomer(message.from, { estado: 'completado' });
            await message.reply(MENSAJES.SIN_PROGRAMAS);
            return;
        }
        await message.reply(
            MENSAJES.MOSTRAR_PROGRAMAS(
                customer.nombreCompleto,
                formatearOpciones(programasDisponibles(customer)),
            ),
        );
        return;
    }
    if (attentionResult) return;
    if (await manejarDestino(message, customer)) return;

    const updateDocumentCustomer = (changes) => {
        contexto.verificar();
        updateCustomer(message.from, changes);
        Object.assign(customer, customerData[message.from]);
    };
    try {
        if (await manejarDocumentos(message, customer, updateDocumentCustomer, { verificar: contexto.verificar, alDerivar: async (detalle) => {
            const solicitud = control.derivar(message.from, 'intentos_documento', message.id?._serialized, detalle);
            const notificacion = control.contexto(message.from, { notificacion: solicitud.id });
            try {
                const salida = crearRespuestaConRetraso(original, { signal: notificacion.signal, verificar: notificacion.verificar });
                await salida.mensaje.reply(MENSAJES.DERIVACION_POR_INTENTOS(customer.nombreCompleto));
            } finally { notificacion.liberar(); }
        } }))
            return;
    } catch (error) {
        if (error.code === 'BOT_CANCELADO') throw error;
        console.error('Error durante la recopilación:', error.message);
        await message.reply(
            currentState === 'error_ficha' || customer?.estado === 'error_ficha'
                ? MENSAJES.ERROR_FICHA
                : MENSAJES.ERROR_DOCUMENTOS,
        );
        return;
    }

    if (esEstadoInicio(customer) && (CONFIG.ACTIVAR_CON_CUALQUIER_MENSAJE || (message.type === 'chat' && messageText === CONFIG.COMANDOS.INICIO))) {
        if (activationsInProgress.has(message.from)) {
            console.log('La activación de este chat ya está en proceso.');
            return;
        }

        activationsInProgress.add(message.from);
        updateCustomer(message.from, {
            inscripciones: obtenerInscripciones(customer),
            nombreCompleto: null,
            programa: null,
            subprograma: null,
            estado: 'activando',
            iniciadoEn: new Date().toISOString(),
            completadoEn: null,
            solicitudAtencionId: null,
            destinoAtencion: null,
            documentos: {},
            requisitos: [],
            indiceDocumento: null,
            expedienteId: null,
            carpetaExpediente: null,
        });
        console.log('Mensaje de activación recibido.');

        try {
            respuesta.marcarInicio();
            await message.reply(MENSAJES.BOT_ACTIVO);
            await message.reply(MENSAJES.SOLICITAR_NOMBRE);
            contexto.verificar();
            updateCustomer(message.from, { estado: 'esperando_nombre' });
            console.log('Solicitud de nombre enviada correctamente.');
        } catch (error) {
            if (error.code === 'BOT_CANCELADO') throw error;
            updateCustomer(message.from, { estado: 'error_activacion' });
            console.error('No se pudo iniciar el flujo:', error.message);
        } finally {
            activationsInProgress.delete(message.from);
        }
        return;
    }

    if (
        !currentState ||
        ['activando', 'completado', 'error_activacion'].includes(currentState)
    ) {
        console.log('Mensaje directo ignorado: no activa el bot.');
        return;
    }

    if (currentState === 'esperando_nombre') {
        if (message.type !== 'chat' || fullText.split(' ').length < 2 || messageText === CONFIG.COMANDOS.AYUDA) {
            console.log('El nombre recibido no parece estar completo.');
            try {
                await message.reply(MENSAJES.NOMBRE_INCOMPLETO);
            } catch (error) {
                console.error(
                    'No se pudo solicitar nuevamente el nombre:',
                    error.message,
                );
            }
            return;
        }

        try {
            updateCustomer(message.from, {
                nombreCompleto: fullText,
                estado: 'esperando_destino',
                modalidadAtencion: null,
                automatizacionAceptadaEn: null,
            });
            console.log('Nombre completo guardado localmente.');
            await message.reply(MENSAJES.ELEGIR_DESTINO(fullText));
            console.log(
                'Opciones de Certeza jurídica o programas enviadas.',
            );
        } catch (error) {
            console.error(
                'No se pudo guardar el nombre o enviar el aviso de atención:',
                error.message,
            );
        }
        return;
    }

    if (['esperando_programa', 'esperando_otro_programa'].includes(currentState)) {
        if (currentState === 'esperando_otro_programa' && message.type === 'chat' && ['0', 'no', 'terminar'].includes(messageText)) {
            updateCustomer(message.from, { estado: 'completado' });
            await message.reply(MENSAJES.FIN_INSCRIPCIONES);
            return;
        }
        const programs = programasDisponibles(customer);
        const selectedProgram = encontrarOpcion(fullText, programs) ||
            (!/^\d+$/.test(fullText) && programs.includes(encontrarPrograma(fullText)) ? encontrarPrograma(fullText) : null);

        if (!selectedProgram) {
            console.log('Programa no reconocido.');
            try {
                await message.reply(
                    MENSAJES.PROGRAMA_NO_RECONOCIDO(
                        formatearOpciones(programs),
                    ),
                );
            } catch (error) {
                console.error(
                    'No se pudo repetir la lista de programas:',
                    error.message,
                );
            }
            return;
        }

        const subprograms = subprogramasDisponibles(customer, selectedProgram);
        try {
            updateCustomer(message.from, {
                programa: selectedProgram,
                estado: 'esperando_subprograma',
                subprograma: null,
                completadoEn: null,
                documentos: {},
                expedienteId: null,
                carpetaExpediente: null,
            });
            console.log('Programa seleccionado y guardado localmente.');
            await message.reply(
                MENSAJES.MOSTRAR_SUBPROGRAMAS(
                    selectedProgram,
                    formatearOpciones(subprograms),
                ),
            );
            console.log('Lista de subprogramas enviada correctamente.');
        } catch (error) {
            console.error(
                'No se pudo guardar el programa o enviar sus opciones:',
                error.message,
            );
        }
        return;
    }

    if (currentState === 'esperando_subprograma') {
        const subprograms = subprogramasDisponibles(customer, customer.programa);
        const selectedSubprogram = encontrarOpcion(fullText, subprograms);

        if (!selectedSubprogram) {
            console.log('Subprograma no reconocido.');
            try {
                await message.reply(
                    MENSAJES.SUBPROGRAMA_NO_RECONOCIDO(
                        formatearOpciones(subprograms),
                    ),
                );
            } catch (error) {
                console.error(
                    'No se pudo repetir la lista de subprogramas:',
                    error.message,
                );
            }
            return;
        }

        try {
            updateCustomer(message.from, {
                subprograma: selectedSubprogram,
                estado: 'enviando_ficha',
                completadoEn: null,
            });
            Object.assign(customer, customerData[message.from]);
            console.log(
                'Subprograma seleccionado. Enviando ficha informativa.',
            );
            await iniciarDocumentos(message, customer, updateDocumentCustomer);
            console.log('Ficha enviada. Flujo pausado hasta recibir reanudar.');
        } catch (error) {
            console.error('No se pudo enviar la ficha:', error.message);
            await message.reply(MENSAJES.ERROR_FICHA);
        }
    }
}

async function iniciarBot() {
    try {
        instancia = adquirirInstancia(CONFIG.ARCHIVO_CONTROL);
        dashboardLocal = await iniciarDashboardLocal(client, {
            controlBot: { token: instancia.token, estado: control.estado, apagar: apagarBot,
                mostrar: () => dashboardLocal?.mostrar(),
                estadoChat: control.estadoChat,
                accionChat: (id, accion) => accion === 'pausar' ? control.pausar(id) : accion === 'reanudar' ? control.reanudar(id)
                    : (control.derivar(id), control.estadoChat(id)) },
            clientes: () => listarClientes(customerData),
            alAtender: (solicitud) => {
                control.atendida(solicitud);
                const cliente = customerData[solicitud.contactoId];
                if (
                    cliente?.solicitudAtencionId === solicitud.id &&
                    cliente.estado === 'atencion_humana'
                ) {
                    updateCustomer(solicitud.contactoId, {
                        estado: 'atencion_resuelta',
                        atendidoEn: solicitud.atendidoEn,
                    });
                }
            },
        });
        instancia.publicar({ url: dashboardLocal.url, apiToken: CONFIG.API_ATENCION.TOKEN });
        if (deteniendo) {
            await dashboardLocal.cerrar();
            return;
        }
        startReadyRecovery();
        await client.initialize();
    } catch (error) {
        if (error.code === 'BOT_YA_ACTIVO') {
            console.log(error.message);
            try { await solicitarControl(JSON.parse(fs.readFileSync(CONFIG.ARCHIVO_CONTROL, 'utf8')), 'mostrar'); }
            catch (_) { console.log('La instancia existente aún puede estar iniciándose.'); }
            return;
        }
        console.error(
            'No se pudo iniciar el bot y su dashboard:',
            error.message || error,
        );
        if (error.code === 'EADDRINUSE') {
            console.error(
                'El puerto del dashboard está ocupado. Cierre la otra instancia de api-atencion.js o del bot antes de volver a ejecutar.',
            );
        }
        await detenerBot();
        process.exitCode = 1;
    }
}

async function detenerBot() {
    if (cierre) return cierre;
    deteniendo = true;
    control.finalizar();
    cierre = (async () => {
        if (readyRecoveryTimer) clearInterval(readyRecoveryTimer);
        await client.destroy().catch(() => {});
        if (dashboardLocal) await dashboardLocal.cerrar();
        instancia?.liberar();
    })();
    return cierre;
}

async function apagarBot() { await detenerBot(); process.exit(0); }

for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
        await detenerBot();
        process.exit(0);
    });

iniciarBot();
