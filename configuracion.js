const path = require('path');
const { obtenerEscritorio } = require('./entorno');
const CARPETA_DATOS = path.resolve(process.env.BOT_DATA_DIR || path.join(__dirname, 'datos-locales'));
const CARPETA_EXPEDIENTES = process.env.BOT_EXPEDIENTES_DIR
    ? path.resolve(process.env.BOT_EXPEDIENTES_DIR)
    : path.join(obtenerEscritorio(), 'Bot_Atencion');

module.exports = Object.freeze({
    MIN_REPLY_DELAY_MS: 2.5 * 60 * 1000,
    MAX_REPLY_DELAY_MS: 3 * 60 * 1000,
    REPLY_DELAY_ENABLED: true,
    FLOW_REPLY_DELAY_MS: 5 * 1000,
    ACTIVAR_CON_CUALQUIER_MENSAJE: true,
    MAX_INTENTOS_DOCUMENTO: 3,
    COMANDOS_ADMIN: Object.freeze({ '!bot pausa': 'pausar', '!bot reanudar': 'reanudar', '!bot humano': 'derivar' }),
    ARCHIVO_CONTROL: path.join(CARPETA_DATOS, '.control-bot.json'),
    READY_RECOVERY_INTERVAL_MS: 5000,
    TELEFONO_REINTENTO_MS: 60000,
    DASHBOARD: Object.freeze({
        ABRIR_AL_INICIAR: true,
        ACTUALIZACION_MS: 5000,
    }),
    CARPETA_DATOS,
    CARPETA_SESION: path.join(CARPETA_DATOS, 'sesion-whatsapp'),
    CARPETA_CACHE: path.join(CARPETA_DATOS, 'cache-whatsapp'),
    CARPETA_IMAGENES: path.join(__dirname, 'assets', 'programas'),
    CHROME_EXECUTABLE_PATH: process.env.BOT_CHROME_PATH || null,
    ARCHIVO_CLIENTES: path.join(CARPETA_DATOS, 'datos-clientes.json'),
    ARCHIVO_ATENCION_HUMANA: path.join(CARPETA_DATOS, 'solicitudes-atencion.json'),
    ARCHIVO_REVISIONES: path.join(CARPETA_DATOS, 'revisiones-documentos.json'),
    CARPETA_EXPEDIENTES,
    COMANDOS: Object.freeze({ INICIO: 'prueba', AYUDA: 'ayuda' }),
    CERTEZA: Object.freeze({ PROGRAMA: 'Certeza jurídica', OPCIONES: Object.freeze(['Escrituración', 'Regularización']) }),
    OPCIONES_DESTINO: Object.freeze(['Certeza jurídica (Escrituración/Regularización)', 'Inscribirse a un programa disponible']),
    OPCIONES_ATENCION: Object.freeze([
        Object.freeze({
            id: 'automatizada',
            etiqueta: 'Continuar con la recopilación automatizada',
            alias: [
                '1',
                'bot',
                'continuar',
                'automatizada',
                'atencion automatizada',
            ],
        }),
        Object.freeze({
            id: 'personal',
            etiqueta: 'Atención personal',
            alias: [
                '2',
                'personal',
                'atencion personal',
                'atencion humana',
                'humano',
                'persona',
            ],
        }),
    ]),
    API_ATENCION: Object.freeze({
        HOST: '127.0.0.1',
        PUERTO: Number(process.env.ATENCION_API_PORT || 3080),
        TOKEN: process.env.ATENCION_API_TOKEN || '',
    }),
});
