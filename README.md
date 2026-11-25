# Bot de atención CODESVI para Windows

Copia independiente del bot y dashboard local, preparada para un repositorio nuevo. Conserva el flujo por `prueba`, Certeza jurídica, atención humana, inscripciones, documentos, vistas previas, revisiones e historial.

## Ejecutar

En PowerShell, dentro de la carpeta descargada o clonada:

```powershell
.\iniciar-bot.cmd
```

El mismo comando sirve para el primer inicio y los posteriores. Necesita Internet para instalar las dependencias y para WhatsApp. Use Windows nativo con sesión gráfica, no WSL ni un servicio sin escritorio.

1. Si falta Node.js 24 o superior, intenta instalar Node.js LTS mediante WinGet. Windows puede solicitar autorización. Si WinGet no está disponible, instale Node.js desde https://nodejs.org y repita el comando.
2. Instala las dependencias fijadas y Chrome compatible con Puppeteer. El primer inicio puede tardar varios minutos; después reutiliza la instalación salvo que cambien las dependencias.
3. Crea los datos locales y abre WhatsApp con el dashboard en otra pestaña.
4. Escanee el QR desde WhatsApp > Dispositivos vinculados. Espere **Listo** en la terminal.
5. Desde otro teléfono, envíe `prueba` al número vinculado.

**Ctrl+C** detiene el bot. Espere su cierre; si Windows pregunta si desea terminar el proceso por lotes, confirme después. No ejecute dos instancias con los mismos datos.

Con Node y las dependencias instaladas también puede usar `npm start`.

## Archivos y dashboard

- Dashboard: http://127.0.0.1:3080/
- Datos, revisiones, historial y sesión: `datos-locales/`, creados al ejecutar y excluidos de Git.
- Las siete fichas informativas están incluidas en `assets/programas/`.
- Expedientes: Escritorio real del usuario, dentro de `Bot_Atencion/nombre/id/programa/EXP-.../`. Detecta ubicaciones redirigidas del Escritorio como OneDrive.
- Las vistas previas usan el servidor local; no dependen de rutas de la Mac ni de enlaces `file://`.
- **Abrir carpeta del expediente** abre el Explorador en la carpeta seleccionada, en el equipo donde corre el bot. Conserva el control de rutas permitidas.
- **Abrir chat** utiliza la pestaña de WhatsApp vinculada al bot.

Esta copia inicia con datos nuevos. No incluye clientes, expedientes personales, revisiones ni sesiones de la Mac. Para trasladar expedientes anteriores se necesita una migración separada de archivos, rutas y revisiones; no se trasladan mediante Git.

## Subir a Git

Cree un repositorio remoto vacío propio, sin README inicial, y ejecute aquí:

```powershell
git init -b main
git add .
git commit -m "Version Windows del bot CODESVI"
git remote add origin URL_DE_SU_REPOSITORIO
git push -u origin main
```

Reemplace `URL_DE_SU_REPOSITORIO`. Si Git lo pide, configure su nombre y correo. No se incluyen el historial Git del proyecto original ni remotos anteriores. Se conserva su licencia y documentación original en `README-LIBRERIA.md`.

En Windows, clone el repositorio, entre en su carpeta y ejecute ` .\iniciar-bot.cmd `.

El `.gitignore` excluye dependencias, sesiones, credenciales y datos personales. `package-lock.json` sí se incluye para reproducir la instalación. No fuerce la inclusión de archivos ignorados.

## Configuración opcional

Para el uso normal no hace falta configurar rutas. Si desea otras ubicaciones, defina las variables antes de iniciar:

```powershell
$env:BOT_EXPEDIENTES_DIR = 'D:\CODESVI\Expedientes'
$env:BOT_DATA_DIR = 'D:\CODESVI\DatosBot'
# Solo si desea usar un Chrome ya instalado:
$env:BOT_CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
.\iniciar-bot.cmd
```

No cambie las ubicaciones después de guardar documentos sin migrar sus rutas. Si cambia `BOT_DATA_DIR`, elija una carpeta privada fuera del repositorio. Las variables se leen del entorno; no se carga `.env` automáticamente.

Para otro puerto: `$env:ATENCION_API_PORT = '3081'`. Textos y programas siguen centralizados en `mensajes.js`, `programas.js` y `configuracion.js`.

## Comprobaciones

Después de instalar:

```powershell
npm run test:bot
```

Las pruebas usan datos temporales y no envían mensajes. La comprobación final en Windows debe verificar QR, conexión, mensajes, descarga de documentos, imágenes/PDF, Explorador, apertura del chat y cierre con Ctrl+C.

Si falla una descarga, revise Internet y repita el mismo comando. Si el puerto está ocupado, cierre la otra instancia o cambie `ATENCION_API_PORT`.

El iniciador prefiere Google Chrome ya instalado en Windows (Program Files o AppData del usuario). Si no existe, prepara el Chrome de Puppeteer; repara solo su versión incompleta y no descarga `chrome-headless-shell`. Si la descarga o extracción falla, muestra la causa concreta e intenta instalar Google Chrome mediante WinGet, que puede solicitar autorización de Windows. El bot recibe exactamente la ruta de Chrome que fue verificada. También puede configurar `BOT_CHROME_PATH` para una instalación en otra ubicación.

Las dependencias se instalan por separado y se conservan al reintentar la descarga. No necesita borrar `datos-locales`, sesiones ni expedientes. Los avisos de dependencias antiguas o de auditoría de npm son independientes de los errores de descarga; no ejecute `npm audit fix --force` como reparación de Chrome.
