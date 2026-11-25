const { OPCIONES_ATENCION, OPCIONES_DESTINO, CERTEZA, COMANDOS } = require('./configuracion');

const MENSAJES = Object.freeze({
    INTENTO_DOCUMENTO: (cantidad, maximo) => `Intento incorrecto ${cantidad}. Si supera ${maximo} intentos incorrectos en este requisito, una persona encargada continuará la atención.`,
    DERIVACION_POR_INTENTOS: (nombre) => `${nombre || 'Estimado cliente'}, encontramos dificultades para recibir su documento. Registramos su solicitud de atención personal y conservamos su avance. Una persona encargada continuará por este chat en cuanto sea posible.`,
    ELEGIR_DESTINO: (nombre) => `${nombre}, ¿por qué motivo se comunica?\n\n${OPCIONES_DESTINO.map((opcion, i) => `${i + 1}. ${opcion}`).join('\n')}\n\nResponda con el número o nombre de su elección.`,
    ELEGIR_CERTEZA: `¿Qué trámite de Certeza jurídica necesita?\n\n${CERTEZA.OPCIONES.map((opcion, i) => `${i + 1}. ${opcion}`).join('\n')}`,
    CERTEZA_CONFIRMADA: (nombre, tramite) => `${nombre}, registramos su solicitud de ${tramite}. En la medida de lo posible, una persona encargada le atenderá personalmente por este chat en cuanto esté disponible.`,
    OTRO_PROGRAMA: (opciones) => `¿Desea inscribirse en otro programa? Estas son las opciones que aún tiene disponibles:\n\n${opciones}\n\n0. Terminar\n\nResponda con el número o nombre del programa.`,
    SIN_PROGRAMAS: 'Ya completó la recopilación de todos los programas disponibles. Gracias por su participación.',
    FIN_INSCRIPCIONES: 'Gracias. Sus inscripciones quedaron guardadas y sus documentos están pendientes de revisión.',
    ELEGIR_ATENCION: (nombre) =>
        `Hola *${nombre}, está conversando con un bot automatizado para mejorar la eficiencia en la recopilación de sus datos y documentos. Si necesita ayuda en cualquier momento, escriba "${COMANDOS.AYUDA}" para solicitar atención humana en cuanto sea posible.*\n\n¿Cómo desea continuar?\n\n${OPCIONES_ATENCION.map((opcion, index) => `${index + 1}. ${opcion.etiqueta}`).join('\n')}\n\nResponda con el número de su elección.`,
    OPCION_ATENCION_INVALIDA:
        'Por favor, elija una de las dos opciones de atención.',
    ATENCION_PERSONAL_CONFIRMADA: (nombre) =>
        `${nombre ? `${nombre}, registramos` : 'Registramos'} su solicitud de atención personal. Una persona encargada le atenderá por este chat en cuanto sea posible.`,
    PREPARAR_DOCUMENTOS: (programa) =>
        `Le compartimos la información de ${programa}. Lea detenidamente los requisitos y prepare sus documentos para agilizar la recopilación.\n\nLa atención queda pausada. Cuando tenga sus documentos listos, escriba *"reanudar"* para continuar.`,
    PEDIR_DOCUMENTO: (requisito, indice, total) =>
        `Requisito ${indice + 1} de ${total}: ${requisito.nombre}.\n\n${requisito.tipo === 'texto' ? 'Escriba el dato solicitado.' : 'Envíe una imagen o un PDF. Puede enviar varias páginas; cuando termine este requisito, escriba "siguiente".'}${requisito.opcional ? '\nSi no corresponde a su caso, escriba "no aplica".' : ''}`,
    ARCHIVO_NO_PERMITIDO:
        'Solo se aceptan imágenes (JPG, PNG, WEBP, GIF, BMP, TIFF, HEIC, HEIF o AVIF) y archivos PDF. El archivo no se guardó. Envíe nuevamente el documento solicitado en uno de esos formatos.',
    ARCHIVO_RECIBIDO:
        'Archivo guardado. Puede enviar otra página de este mismo requisito o escribir "siguiente" para continuar.',
    FALTA_ARCHIVO:
        'Primero envíe una imagen o un PDF del requisito solicitado. Después escriba "siguiente".',
    FALTA_TEXTO: 'Por favor, escriba el dato solicitado como texto.',
    ERROR_DOCUMENTOS:
        'No se pudo guardar o enviar la información. Su avance se conserva. Intente nuevamente con el mismo archivo o escriba "reanudar" para ver el requisito pendiente.',
    ERROR_FICHA:
        'No se pudo enviar la ficha del programa. Escriba "reanudar" para volver a intentarlo.',
    FLUJO_EN_CURSO:
        'Ya tiene una recopilación en curso. Escriba "reanudar" para continuar con su expediente.',
    DOCUMENTOS_COMPLETOS: (nombre, programa) =>
        `Gracias, ${nombre}. Recibimos los requisitos de su solicitud para ${programa}. Quedan pendientes de revisión; la recepción no significa que estén validados.`,
    BOT_ACTIVO: 'Bienvenido al bot de prueba de CODESVI.',

    SOLICITAR_NOMBRE: '¿Cuál es tu nombre completo?',

    NOMBRE_INCOMPLETO:
        'Por favor, escribe tu nombre completo, incluyendo al menos nombre y apellido.',

    MOSTRAR_PROGRAMAS: (nombreCompleto, opciones) =>
        `Hola ${nombreCompleto}, es un gusto atenderle. Dígame por cuál de nuestros programas se comunica:\n\n${opciones}`,

    PROGRAMA_NO_RECONOCIDO: (opciones) =>
        `No reconocí esa opción. Elija uno de estos programas:\n\n${opciones}`,

    MOSTRAR_SUBPROGRAMAS: (programa, opciones) =>
        `Dentro de ${programa}, ¿por cuál opción se comunica?\n\n${opciones}`,

    SUBPROGRAMA_NO_RECONOCIDO: (opciones) =>
        `No reconocí esa opción. Elija una de las siguientes:\n\n${opciones}`,

    CONFIRMAR_REGISTRO: (nombreCompleto, programa, subprograma) =>
        `Gracias, ${nombreCompleto}. Guardamos su solicitud para ${programa} - ${subprograma}.`,
});

module.exports = MENSAJES;
