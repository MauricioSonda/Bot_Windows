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
const { crearRespuestaConRetraso } = require('./retrasos');
require('./entorno').prepararDatos(CONFIG);
const { crearControlAtencion } = require('./atencion-humana');
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
    authStrategy: new LocalAuth({
        dataPath: CONFIG.CARPETA_SESION,
    }),
    webVersionCache: { type: 'local', path: CONFIG.CARPETA_CACHE },
    puppeteer: {
        ...(CONFIG.CHROME_EXECUTABLE_PATH ? { executablePath: CONFIG.CHROME_EXECUTABLE_PATH } : {}),
        headless: false,
        args: ['--disable-crash-reporter', '--disable-breakpad'],
    },
});

client.on('qr', (qr) => {
    console.log('\nEscanea este QR con WhatsApp > Dispositivos vinculados:\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    clientIsReady = true;
    if (readyRecoveryTimer) {
        clearInterval(readyRecoveryTimer);
        readyRecoveryTimer = null;
    }
    console.log('Listo. Esperando el mensaje "prueba" para iniciar el flujo.');
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
client.on('auth_failure', (message) =>
    console.error('Falló la autenticación:', message),
);
client.on('disconnected', (reason) =>
    console.log('WhatsApp se desconectó:', reason),
);

function startReadyRecovery() {
    readyRecoveryTimer = setInterval(async () => {
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
    if (!message.fromMe) {
        console.log('Evento de mensaje entrante detectado:', {
            tipo: message.type,
            chatGrupal: message.from.endsWith('@g.us'),
            coincidePrueba:
                (message.body || '').trim().toLowerCase() ===
                CONFIG.COMANDOS.INICIO,
        });
    }
});

const messageQueues = new Map();
client.on('message', (message) => {
    const recibidoEn = Date.now();
    const previous = messageQueues.get(message.from) || Promise.resolve();
    const pending = previous
        .then(() => procesarMensaje(message, recibidoEn))
        .catch((error) => {
            console.error('No se pudo procesar el mensaje:', error.message);
        });
    messageQueues.set(message.from, pending);
    pending.finally(() => {
        if (messageQueues.get(message.from) === pending)
            messageQueues.delete(message.from);
    });
});

async function procesarMensaje(message, recibidoEn = Date.now()) {
    if (message.fromMe) return;
    if (
        message.from.endsWith('@g.us') ||
        message.from.endsWith('@broadcast') ||
        message.from.includes('@newsletter')
    ) {
        console.log('Mensaje de grupo, estado o canal ignorado.');
        return;
    }

    if (message.type === 'sticker') {
        console.log('Sticker ignorado.');
        return;
    }

    const respuesta = crearRespuestaConRetraso(message, { recibidoEn });
    message = respuesta.mensaje;
    const fullText = (message.body || '').trim().replace(/\s+/g, ' ');
    const messageText = fullText.toLowerCase();
    await actualizarTelefono(message.from);
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
        updateCustomer(message.from, changes);
        Object.assign(customer, customerData[message.from]);
    };
    try {
        if (await manejarDocumentos(message, customer, updateDocumentCustomer))
            return;
    } catch (error) {
        console.error('Error durante la recopilación:', error.message);
        await message.reply(
            currentState === 'error_ficha' || customer?.estado === 'error_ficha'
                ? MENSAJES.ERROR_FICHA
                : MENSAJES.ERROR_DOCUMENTOS,
        );
        return;
    }

    if (message.type === 'chat' && messageText === CONFIG.COMANDOS.INICIO) {
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
            updateCustomer(message.from, { estado: 'esperando_nombre' });
            console.log('Solicitud de nombre enviada correctamente.');
        } catch (error) {
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
        dashboardLocal = await iniciarDashboardLocal(client, {
            clientes: () => listarClientes(customerData),
            alAtender: (solicitud) => {
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
        if (deteniendo) {
            await dashboardLocal.cerrar();
            return;
        }
        startReadyRecovery();
        await client.initialize();
    } catch (error) {
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
    deteniendo = true;
    if (readyRecoveryTimer) clearInterval(readyRecoveryTimer);
    if (dashboardLocal) await dashboardLocal.cerrar();
    await client.destroy().catch(() => {});
}

for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
        await detenerBot();
        process.exit(0);
    });

iniciarBot();
