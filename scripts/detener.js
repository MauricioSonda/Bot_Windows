const fs = require('fs');
const ARCHIVO_CONTROL = process.argv[2] || require('../configuracion').ARCHIVO_CONTROL;
const { solicitarControl } = require('../control-ejecucion');

(async () => {
    let datos;
    try { datos = JSON.parse(fs.readFileSync(ARCHIVO_CONTROL, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') { console.log('El bot no está iniciado.'); return; } throw error; }
    await solicitarControl(datos, 'apagar');
    console.log('Apagado solicitado. Se cerrará el Chrome del bot y se conservarán sus datos.');
})().catch((error) => { console.error('No se pudo contactar con el bot: ' + error.message); process.exitCode = 1; });
