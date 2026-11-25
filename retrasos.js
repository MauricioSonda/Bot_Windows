const CONFIG = require('./configuracion');

function crearRespuestaConRetraso(message, {
    config = CONFIG,
    esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    aleatorio = Math.random,
    ahora = Date.now,
    recibidoEn = ahora(),
} = {}) {
    let inicio = false;
    let espera = null;
    async function antesDeResponder() {
        if (!config.REPLY_DELAY_ENABLED) return;
        if (!espera) {
            const duracion = inicio
                ? config.MIN_REPLY_DELAY_MS + Math.floor(aleatorio() * (config.MAX_REPLY_DELAY_MS - config.MIN_REPLY_DELAY_MS + 1))
                : config.FLOW_REPLY_DELAY_MS;
            // El saludo inicial cuenta desde la recepción, incluso si resolver el teléfono tardó.
            const restante = inicio ? Math.max(0, duracion - Math.max(0, ahora() - recibidoEn)) : duracion;
            espera = Promise.resolve(esperar(restante));
        }
        await espera;
    }
    const mensaje = new Proxy(message, {
        get(target, propiedad) {
            if (propiedad === 'reply') return async (...args) => {
                await antesDeResponder();
                return target.reply(...args);
            };
            const valor = Reflect.get(target, propiedad, target);
            return typeof valor === 'function' ? valor.bind(target) : valor;
        },
    });
    return {
        mensaje,
        marcarInicio() {
            if (espera) throw new Error('El retraso inicial debe seleccionarse antes de responder.');
            inicio = true;
        },
    };
}

module.exports = { crearRespuestaConRetraso };
