const path = require('path');

const { CARPETA_IMAGENES, FORMATO_SOLICITUD } = require('./configuracion');
const requisito = (id, nombre, extra = {}) => ({ id, nombre, ...extra });
const vivienda = [
    requisito('INE', 'Credencial INE (frente y reverso)'),
    requisito('CURP', 'CURP del solicitante'),
    requisito('Acta_Nacimiento', 'Acta de nacimiento'),
    requisito('Fotografia_Predio', 'Fotografía del predio'),
    requisito('Comprobante_Domicilio', 'Comprobante de domicilio'),
    requisito(
        'Propiedad_Predio',
        'Documento que acredite la propiedad del predio',
    ),
    requisito('Solicitud_Programa', 'Escrito de solicitud del programa'),
    requisito('Formato_Solicitud', 'Formato de solicitud CODESVI 2026 llenado'),
];

const REQUISITOS = {
    'Piso firme': { imagen: 'Piso-Firme-2024.jpeg', documentos: vivienda },
    'Techo firme': { imagen: 'Techo-Firme-2024.jpeg', documentos: vivienda },
    Recámara: { imagen: 'Recamara-2024.jpeg', documentos: vivienda },
    'Cuarto de baño': {
        imagen: 'Cuarto-para-Bano-2024.jpeg',
        documentos: vivienda,
    },
    'Estufas ecológicas': {
        imagen: 'Estufa-Ecologica-2024.jpeg',
        documentos: vivienda,
    },
    Regularización: {
        imagen: 'Regularizacion.png',
        documentos: [
            requisito(
                'Actas_Nacimiento',
                'Actas de nacimiento del solicitante y, si corresponde, cónyuge e hijos',
            ),
            requisito(
                'Estado_Civil',
                'Documento de matrimonio, divorcio, soltería o separación, según su caso',
                { opcional: true },
            ),
            requisito(
                'INE',
                'Identificaciones INE del solicitante y, si corresponde, cónyuge e hijos mayores',
            ),
            requisito(
                'CURP',
                'CURP del solicitante y, si corresponde, cónyuge e hijos',
            ),
            requisito(
                'Certificados_No_Propiedad',
                'Certificados negativos de propiedad actuales de todos los mayores de edad',
            ),
            requisito(
                'Domicilio_Antiguo',
                'Comprobante de domicilio antiguo a nombre del solicitante o cónyuge',
            ),
            requisito(
                'Domicilio_Reciente',
                'Comprobante de domicilio reciente a nombre del solicitante o cónyuge',
            ),
            requisito('Ingresos', 'Comprobante de ingresos actual'),
            requisito('Croquis', 'Croquis de ubicación'),
        ],
    },
    Escrituración: {
        imagen: 'Escrituracion.png',
        documentos: [
            requisito('Carta_Liberacion', 'Carta de liberación'),
            requisito(
                'Actas_Nacimiento',
                'Actas de nacimiento de las personas que aparecen en la carta de liberación',
            ),
            requisito(
                'Identificaciones',
                'Identificaciones personales de quienes aparecen en la carta de liberación',
            ),
            requisito(
                'CURP',
                'CURP de quienes aparecen en la carta de liberación',
            ),
            requisito('Asignacion_Predio', 'Carta de asignación del predio'),
            requisito(
                'Predial',
                'Comprobante de pago del impuesto predial al día',
            ),
            requisito(
                'Comprobante_Catastral',
                'Comprobante domiciliario catastral',
            ),
            requisito(
                'Contacto',
                'Teléfono o dirección donde se pueda localizar al posesionario del predio',
                { tipo: 'texto' },
            ),
            requisito(
                'Pago_Escrituracion',
                'Comprobante de pago del derecho de escrituración',
            ),
            requisito(
                'Cesion_Derechos',
                'Documentación del cesionario, si tiene cesión de derechos',
                { opcional: true },
            ),
            requisito(
                'Liberacion_Credito_Alterno',
                'Copia de la carta de liberación de crédito alterno, si cuenta con uno',
                { opcional: true },
            ),
        ],
    },
};

function obtenerRequisitos(subprograma) {
    const config = REQUISITOS[subprograma];
    if (!config)
        throw new Error('No hay requisitos configurados para el subprograma.');
    return {
        imagen: path.join(CARPETA_IMAGENES, config.imagen),
        formatoSolicitud: config.documentos.some((item) => item.id === 'Formato_Solicitud') ? FORMATO_SOLICITUD : null,
        documentos: config.documentos.map((item) => ({ ...item })),
    };
}

module.exports = { obtenerRequisitos };
