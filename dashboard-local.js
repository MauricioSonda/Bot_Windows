const { iniciarServidorAtencion } = require('./api-atencion');
const { API_ATENCION, DASHBOARD } = require('./configuracion');

async function iniciarDashboardLocal(client, opciones = {}) {
    const server = await iniciarServidorAtencion({
        ...opciones,
        abrirChat: async (contactoId) => {
            if (
                !client.interface ||
                !client.pupPage ||
                client.pupPage.isClosed()
            )
                throw new Error('WhatsApp no está listo.');
            await client.interface.openChatWindow(contactoId);
            await client.pupPage.bringToFront();
        },
    });
    const url = `http://${API_ATENCION.HOST}:${API_ATENCION.PUERTO}/`;
    console.log(`Dashboard: ${url}`);
    let abriendo = false;
    let cerrado = false;
    let timer;

    async function abrirPestana() {
        if (cerrado || abriendo || !client.pupBrowser || !client.pupPage)
            return;
        abriendo = true;
        let page;
        try {
            page = await client.pupBrowser.newPage();
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 15000,
            });
            clearInterval(timer);
            if (cerrado) await page.close();
        } catch (error) {
            if (page) await page.close().catch(() => {});
            console.error(
                `No se pudo abrir la pestaña del dashboard. Puede abrir ${url} manualmente:`,
                error.message,
            );
            clearInterval(timer);
        }
    }

    if (DASHBOARD.ABRIR_AL_INICIAR) {
        timer = setInterval(abrirPestana, 1000);
    }

    return {
        url,
        cerrar() {
            cerrado = true;
            clearInterval(timer);
            return new Promise((resolve) => {
                server.close(resolve);
                server.closeAllConnections();
            });
        },
    };
}

module.exports = { iniciarDashboardLocal };
