const fs = require('fs');
const http = require('http');
const path = require('path');
const { randomBytes } = require('crypto');

function solicitarControl(datos, accion = 'estado') {
    return new Promise((resolve, reject) => {
        const url = new URL(`/api/control/${accion}`, datos.url);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:') return reject(new Error('Dirección de control local inválida.'));
        const req = http.request(url, { method: accion === 'estado' ? 'GET' : 'POST', timeout: 4000,
            headers: { 'Content-Type': 'application/json', 'X-Bot-Control': datos.token,
                ...(datos.apiToken ? { Authorization: `Bearer ${datos.apiToken}` } : {}) } }, (res) => {
            let body = ''; res.on('data', (c) => { body += c; });
            res.on('end', () => {
                if (res.statusCode !== 200) { reject(new Error('El control del bot no está disponible.')); return; }
                try { resolve(JSON.parse(body)); } catch (_) { reject(new Error('La respuesta del control local es inválida.')); }
            });
        });
        req.on('timeout', () => req.destroy(new Error('El bot no respondió al control local.')));
        req.on('error', reject); req.end(accion === 'estado' ? undefined : '{}');
    });
}

function adquirirInstancia(archivo) {
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    const lock = `${archivo}.lock`, token = randomBytes(32).toString('hex');
    let adquirido = false;
    for (let intento = 0; intento < 2; intento += 1) {
        try { fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, token }), { flag: 'wx', mode: 0o600 }); adquirido = true; break; }
        catch (error) {
            if (error.code !== 'EEXIST') throw error;
            const anterior = JSON.parse(fs.readFileSync(lock, 'utf8'));
            let vivo = false;
            try { process.kill(anterior.pid, 0); vivo = true; } catch (e) { if (e.code !== 'ESRCH') vivo = true; }
            if (vivo) throw Object.assign(new Error('El bot ya está encendido o iniciándose.'), { code: 'BOT_YA_ACTIVO' });
            fs.unlinkSync(lock);
        }
    }
    if (!adquirido) throw new Error('No se pudo reservar una instancia única del bot. Reintente.');
    return { token,
        publicar(datos) {
            fs.writeFileSync(`${archivo}.tmp`, JSON.stringify({ ...datos, pid: process.pid, token }, null, 2), { mode: 0o600 });
            fs.renameSync(`${archivo}.tmp`, archivo);
        },
        liberar() {
            let propio = false;
            try { propio = JSON.parse(fs.readFileSync(lock, 'utf8')).token === token; } catch (_) { /* Ya cerrado. */ }
            if (propio) { for (const ruta of [archivo, lock]) { try { fs.unlinkSync(ruta); } catch (e) { if (e.code !== 'ENOENT') throw e; } } }
        },
    };
}

module.exports = { adquirirInstancia, solicitarControl };
