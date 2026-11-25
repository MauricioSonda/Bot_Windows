# Atención humana y futura conexión al dashboard

## Revisión personal e historial

Al final del detalle de una inscripción, “Revisar documentos de este programa” abre un segundo modal.
Cada requisito permite guardar sin revisar, validado personalmente o incompleto/no válido, con una
observación opcional. Se pueden guardar revisiones parciales. La recepción del bot no valida nada.
La pestaña del programa aparece verde únicamente al validar todos sus requisitos; si hay un requisito
marcado incompleto/no válido aparece en tono oscuro. Un documento ausente no puede validarse; un
requisito opcional declarado no aplicable debe revisarse expresamente para aprobarlo.

`revision-documentos.js` guarda resultados por expediente en `revisiones-documentos.json`, incluyendo
fecha y huella de los archivos/datos. Un archivo reemplazado o desaparecido requiere nueva revisión.
Al revisar todos los documentos de todas las inscripciones se habilita el botón “Marcar persona como atendida” al final del
modal. Guardar revisiones no cierra la atención. Solo al pulsar ese botón se cierran sus solicitudes
pendientes y se archiva una copia del expediente con sus revisiones. La API verifica nuevamente todos
los programas antes del cierre; confirmar dos veces no duplica el historial. No se envían mensajes por WhatsApp.
La persona podrá volver a iniciar con `prueba` después del cierre de su solicitud.
Tanto “validado” como “incompleto/no válido” cuentan como revisados. Un solo documento “sin revisar”
bloquea el cierre. `revisionPersonal` indica si terminó la revisión, mientras `validacionPersonal`
conserva si todos aprobaron o hubo resultados incompletos. El historial distingue una validación
correcta de una atención cerrada con observaciones; cerrar la atención no convierte rechazos en aprobaciones.

“Historial de atención” es de solo consulta y conserva los expedientes validados anteriormente;
una revisión posterior no sobrescribe esa copia. También registra las atenciones personales cerradas
sin inscripciones documentales, diferenciándolas de una validación de documentos.

- `POST /api/<clientes|atencion-humana>/<id>/inscripciones/<expedienteId>/revision`: guarda una lista
  `documentos` con `id`, `huella`, `estado` y `observacion`. Usa las mismas protecciones de origen y token.
- `GET /api/historial` y `GET /api/historial/<id>`: historial y detalle.
- `POST /api/<clientes|atencion-humana>/<id>/atender`: confirma manualmente la atención de la persona
  tras revisar todos sus documentos, incluso con resultados incompletos/no válidos. Puede utilizarse también para clientes sin solicitudes de ayuda pendientes.
- Los endpoints de archivos y apertura de chat admiten también la fuente `historial`.
- `POST .../atender` rechaza el cierre si queda algún documento sin revisar en cualquier inscripción.

## Carpetas y requisitos pendientes

Los expedientes nuevos se guardan en `Desktop/Bot_Atencion/<nombre>/<id>/<programa>/EXP-.../`.
El nombre del programa general se convierte a un nombre seguro de carpeta, por ejemplo
`Mejoramiento_de_vivienda`. Cada subprograma conserva su expediente independiente.
`migrar-rutas-expedientes.js` comprueba primero las rutas; con `--aplicar` mueve los expedientes
antiguos y actualiza clientes, solicitudes e inscripciones históricas, respaldando primero los JSON
en `respaldos-rutas/`. Debe ejecutarse con el bot detenido y es idempotente.

El modal enumera todos los requisitos de la inscripción, usando su lista guardada o el catálogo
cuando se trata de un registro antiguo. `estado-documentos.js` calcula recibidos, pendientes,
incompletos y no aplicables. Se comprueba la existencia de los archivos registrados: los que tienen
adjuntos pero aún esperan `siguiente` se muestran incompletos; una ruta desaparecida no se cuenta
como archivo guardado. No se valida el contenido ni la autenticidad de los documentos.

## Inscripciones por persona

Al completar la recopilación se guarda una copia del expediente en `inscripciones` dentro del JSON
del cliente y se ofrecen los programas que todavía tienen subopciones disponibles. `0` o `terminar`
cierra la atención. Una subopción completada no se vuelve a ofrecer; el resto de su categoría sí.
`prueba` conserva el historial de inscripciones anteriores. Los registros anteriores con fecha de
finalización se incorporan al consultar o continuar el flujo, sin borrar sus archivos.

La tabla agrupa por teléfono confirmado o identificador, nunca por nombre. El detalle es un modal con
botones para consultar cada inscripción y sus documentos. El selector `inscripcion` en la URL de un
archivo identifica el expediente histórico. En atención humana, marcar atendida una fila agrupada
cierra las solicitudes pendientes de esa persona.

Después del nombre se clasifica el motivo entre Certeza jurídica y programas. Si elige programas, el cliente recibe un aviso en negritas y elige:

1. Recopilación automatizada: continúa a programas y documentos.
2. Atención personal: registra una solicitud y detiene las respuestas del bot para ese chat.

La palabra `ayuda` solicita atención personal a partir de elegir la rama de programas, incluyendo la pausa de documentos; antes de clasificar el motivo no crea solicitudes.
Los stickers continúan ignorándose. Una solicitud pendiente impide reiniciar con `prueba` o `reanudar`.
Al marcar atendida, el cliente puede iniciar nuevamente con `prueba`. Marcar atendida no envía mensajes
ni retoma documentos automáticamente. `reanudar` no recupera una recopilación ya derivada y cerrada.
El registro persiste entre reinicios; el bot no avisa a un encargado por otro canal.

## Archivos editables

- `configuracion.js`: comandos, opciones de atención, rutas y configuración de la API.
- `mensajes.js`: advertencia personalizada y respuestas al cliente. WhatsApp usa un asterisco para negritas.
- `solicitudes-atencion.json`: solicitudes pendientes y contexto guardado al derivar.
- `datos-clientes.json`: estado `atencion_humana`, identificador de solicitud y estado anterior.

Cada solicitud incluye identificador, chat, teléfono si está disponible, nombre, programa,
subprograma, motivo, fechas, estado anterior, expediente y documentos recibidos. Un ID de WhatsApp
terminado en `@lid` no se trata como teléfono. `asignadoA` y `atendidoEn` quedan preparados para el dashboard.

## Dashboard local y API

El comando habitual `/usr/local/bin/node prueba-atencion.js` inicia el servidor local y abre
el dashboard en otra pestaña del Chrome utilizado por el bot. `Control + C` cierra el servidor
y el navegador del bot. No ejecute simultáneamente la API independiente en el mismo puerto.

El dashboard tiene dos apartados: Atención humana y Clientes del bot. Este último muestra clientes
que eligieron recopilación automatizada y registros anteriores que ya tienen programa o documentos.
Se muestra el registro actual de cada chat. Incluye filtros, búsqueda, detalle y actualización automática.
El detalle muestra las imágenes descargadas y su ruta en letra pequeña; los PDF se pueden abrir.
Solo se sirven archivos registrados que están dentro de `Desktop/Bot_Atencion`, validando su ruta real.

El bot consulta el teléfono de los contactos `@lid` al conectarse y cuando recibe mensajes. El teléfono
confirmado se guarda en clientes y se usa para enriquecer las solicitudes del dashboard, sin tratar un
LID como número. Si WhatsApp no permite obtenerlo, se indica que aún no está disponible. El botón
Abrir chat siempre abre el ID en la pestaña de WhatsApp ya vinculada y la trae al frente.
Necesita el bot conectado y no envía mensajes ni abre otra pestaña de WhatsApp.

Los archivos de la interfaz son `dashboard/index.html`, `dashboard/dashboard.css` y
`dashboard/dashboard.js`. El estilo solo define estructura y espaciado. `configuracion.js` controla
la apertura automática, el intervalo de actualización y el puerto.

Para abrir solo el dashboard sin activar WhatsApp, ejecutar desde el proyecto:

```sh
/usr/local/bin/node api-atencion.js
```

Escucha solo en `127.0.0.1:3080`. Puede consultar las solicitudes aunque el bot esté apagado.

- `GET /api/salud`: estado de la API, no indica conexión del bot a WhatsApp.
- `GET /api/atencion-humana`: todas las solicitudes.
- `GET /api/atencion-humana?estado=pendiente`: pendientes.
- `GET /api/atencion-humana/<id>`: detalle por identificador.
- `POST /api/atencion-humana/<id>/atender`: marca atendida y guarda `atendidoEn`.
  Requiere `Content-Type: application/json` y un origen local coincidente cuando se envía `Origin`.
- `GET /api/clientes`: clientes que iniciaron la recopilación automatizada.
- `GET /api/clientes/<contactoId>`: detalle del cliente.
- `GET /api/<clientes|atencion-humana>/<id>/documentos/<requisito>/<indice>`: archivo registrado.
- `POST /api/<clientes|atencion-humana>/<id>/abrir-chat`: abre el chat en la sesión del bot.
  Los identificadores y nombres de requisito deben codificarse con `encodeURIComponent`.

`ATENCION_API_PORT` cambia el puerto. Si se configura `ATENCION_API_TOKEN`, las consultas
requieren `Authorization: Bearer <token>`. El dashboard permite introducirlo y lo mantiene solo en memoria.
La API no envía mensajes. No se implementa aún asignación de encargados.
La interfaz futura podrá usar `contactoId` para identificar el chat; solo debe generar un enlace por
número cuando `telefono` esté disponible.

## Verificación local sin WhatsApp

```sh
/usr/local/bin/node --test atencion-humana.test.js dashboard.test.js dashboard-clientes.test.js
```
## Separación de Certeza jurídica y programas

Después del nombre se pide el motivo de atención (`esperando_destino`). Las opciones y los trámites se centralizan en `configuracion.js`; los textos se encuentran en `mensajes.js` y las transiciones en `flujo-destino.js`.

- **Certeza jurídica:** pide Escrituración o Regularización (`esperando_tramite_certeza`) y registra una solicitud con `destinoAtencion: "certeza"` y `motivo: "certeza_juridica"` en `solicitudes-atencion.json`. Informa que una persona encargada atenderá en cuanto sea posible. No inicia la recopilación de documentos. Se consulta en el apartado **Certeza jurídica**, mediante `GET /api/certeza`, `GET /api/certeza/:id`, y se cierra con `POST /api/certeza/:id/atender`. Conserva el historial y permite iniciar nuevamente con `prueba` después del cierre.
- **Programas disponibles:** presenta el aviso de automatización y las opciones de continuar o pedir atención personal. A partir de esta rama se puede escribir `ayuda` para interrumpir la recopilación. Certeza ya no se ofrece entre los programas ni entre las inscripciones adicionales; las inscripciones históricas se conservan.
- La palabra `ayuda` no crea solicitudes antes de clasificar el motivo ni durante la selección del trámite de Certeza. La cola general de atención humana excluye las nuevas solicitudes de Certeza y cerrar un expediente de programas no cierra solicitudes de Certeza.

## Abrir la carpeta del expediente

En los detalles, **Abrir carpeta del expediente** abre en Finder la carpeta de la inscripción seleccionada. Está deshabilitado cuando no hay una ruta registrada; si la ruta aún no existe, se informa sin crear carpetas vacías. También funciona en el historial mientras la carpeta siga disponible. Abre en la Mac que ejecuta el servidor, no en el equipo de un visitante remoto.

`POST /api/(clientes|atencion-humana|certeza|historial)/:id/abrir-carpeta?inscripcion=<id>` busca la ruta registrada en el servidor; no admite rutas arbitrarias del navegador. `carpetas-expedientes.js` comprueba la ruta real y su pertenencia a `CARPETA_EXPEDIENTES`, y ejecuta `/usr/bin/open` con argumentos separados. Conserva las comprobaciones de origen y token de las demás acciones.
