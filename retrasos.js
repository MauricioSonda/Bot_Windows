const CONFIG = require('./configuracion');

function esperarCancelable(ms, signal) {
    return new Promise((resolve, reject) => {
        const cancelar = () => { clearTimeout(timer); reject(Object.assign(new Error('Respuesta cancelada.'), { code: 'BOT_CANCELADO' })); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', cancelar); resolve(); }, ms);
        if (signal?.aborted) cancelar();
        else signal?.addEventListener('abort', cancelar, { once: true });
    });
}

function crearRespuestaConRetraso(message, {
    config = CONFIG,
    esperar = esperarCancelable,
    aleatorio = Math.random,
    ahora = Date.now,
    recibidoEn = ahora(),
    signal,
    verificar = () => {},
} = {}) {
    let inicio = false;
    let espera = null;
    async function antesDeResponder() {
        verificar();
        if (signal?.aborted) throw Object.assign(new Error('Respuesta cancelada.'), { code: 'BOT_CANCELADO' });
        if (!config.REPLY_DELAY_ENABLED) return;
        if (!espera) {
            const duracion = inicio
                ? config.MIN_REPLY_DELAY_MS + Math.floor(aleatorio() * (config.MAX_REPLY_DELAY_MS - config.MIN_REPLY_DELAY_MS + 1))
                : config.FLOW_REPLY_DELAY_MS;
            // El saludo inicial cuenta desde la recepción, incluso si resolver el teléfono tardó.
            const restante = inicio ? Math.max(0, duracion - Math.max(0, ahora() - recibidoEn)) : duracion;
            espera = new Promise((resolve, reject) => {
                const cancelar = () => reject(Object.assign(new Error('Respuesta cancelada.'), { code: 'BOT_CANCELADO' }));
                signal?.addEventListener('abort', cancelar, { once: true });
                Promise.resolve(esperar(restante, signal)).then(resolve, reject).finally(() => signal?.removeEventListener('abort', cancelar));
            });
        }
        await espera;
        if (signal?.aborted) throw Object.assign(new Error('Respuesta cancelada.'), { code: 'BOT_CANCELADO' });
        verificar();
    }
    const mensaje = new Proxy(message, {
        get(target, propiedad) {
            if (propiedad === 'reply') return async (...args) => {
                await antesDeResponder();
                if (signal?.aborted) throw Object.assign(new Error('Respuesta cancelada.'), { code: 'BOT_CANCELADO' });
                verificar();
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
