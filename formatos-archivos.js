const path = require('path');

// Lista cerrada: no SVG, ejecutables, scripts, archivos comprimidos ni documentos Office.
const FORMATOS_PERMITIDOS = Object.freeze([
    { mimetype: 'image/jpeg', extension: 'jpg', extensiones: ['jpg', 'jpeg', 'jpe', 'jfif'], tipos: ['image/jpeg', 'image/jpg', 'image/pjpeg'] },
    { mimetype: 'image/png', extension: 'png', extensiones: ['png', 'apng'], tipos: ['image/png', 'image/apng'] },
    { mimetype: 'image/webp', extension: 'webp', extensiones: ['webp'], tipos: ['image/webp'] },
    { mimetype: 'image/gif', extension: 'gif', extensiones: ['gif'], tipos: ['image/gif'] },
    { mimetype: 'image/bmp', extension: 'bmp', extensiones: ['bmp'], tipos: ['image/bmp', 'image/x-ms-bmp'] },
    { mimetype: 'image/tiff', extension: 'tif', extensiones: ['tif', 'tiff'], tipos: ['image/tiff'] },
    { mimetype: 'image/heic', extension: 'heic', extensiones: ['heic'], tipos: ['image/heic'] },
    { mimetype: 'image/heif', extension: 'heif', extensiones: ['heif'], tipos: ['image/heif'] },
    { mimetype: 'image/avif', extension: 'avif', extensiones: ['avif'], tipos: ['image/avif'] },
    { mimetype: 'application/pdf', extension: 'pdf', extensiones: ['pdf'], tipos: ['application/pdf'] },
].map((formato) => Object.freeze({ ...formato, extensiones: Object.freeze(formato.extensiones), tipos: Object.freeze(formato.tipos) })));

function archivoNoPermitido() {
    return Object.assign(new Error('Solo se permiten imágenes y PDF con un formato reconocido.'), { code: 'ARCHIVO_NO_PERMITIDO' });
}

async function validarArchivo(media) {
    const declarado = String(media.mimetype || '').split(';')[0].trim().toLowerCase();
    const generico = ['', 'application/octet-stream', 'binary/octet-stream'].includes(declarado);
    const porTipo = FORMATOS_PERMITIDOS.find((formato) => formato.tipos.includes(declarado));
    if (!generico && !porTipo) throw archivoNoPermitido();
    const nombre = String(media.filename || '').normalize('NFKC').trim();
    const extension = path.win32.extname(nombre).slice(1).toLowerCase();
    const porExtension = extension ? FORMATOS_PERMITIDOS.find((formato) => formato.extensiones.includes(extension)) : null;
    if (extension && !porExtension) throw archivoNoPermitido();
    const contenido = Buffer.from(media.data, 'base64');
    if (!contenido.length) throw archivoNoPermitido();
    const { fileTypeFromBuffer } = await import('file-type');
    let tipoReal;
    try { tipoReal = await fileTypeFromBuffer(contenido); }
    catch (_) { throw archivoNoPermitido(); }
    const formato = FORMATOS_PERMITIDOS.find((item) => item.tipos.includes(tipoReal?.mime));
    if (!formato || (porTipo && porTipo !== formato) || (porExtension && porExtension !== formato)) throw archivoNoPermitido();
    return { contenido, extension: formato.extension, mimetype: formato.mimetype };
}

module.exports = { FORMATOS_PERMITIDOS, validarArchivo };
