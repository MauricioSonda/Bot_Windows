const PROGRAMAS_DISPONIBLES = Object.freeze({
    'Mejoramiento de vivienda': Object.freeze(['Piso firme', 'Techo firme']),
    'Ampliación de vivienda': Object.freeze(['Recámara', 'Cuarto de baño']),
    'Certeza jurídica': Object.freeze(['Regularización', 'Escrituración']),
    Equipamiento: Object.freeze(['Estufas ecológicas']),
});

const ALIAS_DE_OPCIONES = Object.freeze({
    'Mejoramiento de vivienda': Object.freeze(['mejoramiento', 'mejora', 'mejoras', 'mejora de vivienda', 'mejoras de vivienda', 'mejoramiento vivienda', 'mejorar vivienda']),
    'Ampliación de vivienda': Object.freeze(['ampliacion', 'ampliaciones', 'ampliar', 'ampliacion vivienda', 'ampliar vivienda']),
    'Certeza jurídica': Object.freeze(['certeza', 'certeza juridica', 'certeza legal', 'tramite juridico']),
    Equipamiento: Object.freeze(['equipamiento', 'equipar', 'equipo', 'estufa', 'estufas', 'estufa ecologica', 'estufas ecologicas', 'estufa de lena', 'estufas de lena', 'estufa ahorradora', 'estufas ahorradoras']),
    'Piso firme': Object.freeze(['piso', 'pisos', 'piso firme', 'pisos firmes']),
    'Techo firme': Object.freeze(['techo', 'techos', 'techo firme', 'techos firmes', 'techado', 'techado firme']),
    Recámara: Object.freeze(['recamara', 'recamaras', 'habitacion', 'habitaciones', 'dormitorio', 'dormitorios', 'cuarto de dormir', 'cuarto para dormir', 'cuarto dormitorio']),
    'Cuarto de baño': Object.freeze(['cuarto', 'cuartos', 'bano', 'banos', 'cuarto de bano', 'cuartos de bano', 'cuarto para bano', 'cuarto bano', 'cuarto del bano', 'cuarto para el bano', 'sanitario', 'sanitarios', 'cuarto sanitario']),
    Regularización: Object.freeze(['regularizacion', 'regularizaciones', 'regularizar', 'regularizar predio', 'regularizar terreno', 'regularizacion de predio', 'regularizacion de terreno', 'regularizacion del predio', 'regularizacion del terreno', 'regularizacion predio', 'regularizacion terreno']),
    Escrituración: Object.freeze(['escrituracion', 'escrituraciones', 'escritura', 'escrituras', 'escriturar', 'escriturar predio', 'escriturar terreno', 'escritura de predio', 'escritura de terreno', 'escrituracion de predio', 'escrituracion de terreno']),
    'Estufas ecológicas': Object.freeze(['estufa', 'estufas', 'estufa ecologica', 'estufas ecologicas', 'ecologica', 'ecologicas', 'estufa de lena', 'estufas de lena', 'estufa ahorradora', 'estufas ahorradoras', 'estufa ahorradora de lena']),
});

const ETIQUETAS_DE_PROGRAMAS = Object.freeze({
    Equipamiento: 'Equipamiento (estufas ecologicas)',
});

function normalizarOpcion(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[¿?¡!.,;:()/_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizarEntrada(value) {
    let texto = normalizarOpcion(value).trim().replace(/\s+por favor$/, '');
    const prefijos = [
        /^(?:hola|buenos dias|buenas tardes|buenas noches|por favor)\s+/,
        /^(?:quiero|quisiera|necesito|solicito|me interesa|vengo por|es por|estoy interesado en|estoy interesada en|me comunico por)\s+/,
        /^(?:inscribirme|registrarme|inscribir|registrar)(?:\s+(?:en|a|al))?\s+/,
        /^(?:(?:el|la|los|las|un|una)\s+)?(?:programa|subprograma|opcion)(?:\s+(?:de|del|para))?\s+/,
        /^(?:el|la|los|las|un|una|a|al|en|para)\s+/,
    ];
    for (let i = 0; i < 6; i += 1) {
        const anterior = texto;
        for (const prefijo of prefijos) texto = texto.replace(prefijo, '');
        if (texto === anterior) break;
    }
    return texto.trim();
}

function obtenerProgramas() {
    return Object.keys(PROGRAMAS_DISPONIBLES);
}

function obtenerSubprogramas(programa) {
    return PROGRAMAS_DISPONIBLES[programa] || [];
}

function formatearOpciones(options) {
    return options
        .map(
            (option, index) =>
                `${index + 1}. ${ETIQUETAS_DE_PROGRAMAS[option] || option}`,
        )
        .join('\n');
}

function encontrarOpcion(input, options) {
    const trimmedInput = normalizarEntrada(input);
    if (!trimmedInput) return undefined;
    const optionNumber = Number.parseInt(trimmedInput, 10);

    if (
        /^\d+$/.test(trimmedInput) &&
        optionNumber >= 1 &&
        optionNumber <= options.length
    ) {
        return options[optionNumber - 1];
    }

    const normalizedInput = normalizarOpcion(trimmedInput);
    const exacta = options.find((option) => normalizarOpcion(option) === normalizedInput);
    if (exacta) return exacta;
    const coincidencias = options.filter((option) =>
        normalizarOpcion(ETIQUETAS_DE_PROGRAMAS[option]) === normalizedInput ||
        (ALIAS_DE_OPCIONES[option] || []).some((alias) => normalizarOpcion(alias) === normalizedInput));
    return coincidencias.length === 1 ? coincidencias[0] : undefined;
}

function encontrarPrograma(input) {
    return encontrarOpcion(input, obtenerProgramas());
}

module.exports = {
    ALIAS_DE_OPCIONES,
    encontrarOpcion,
    encontrarPrograma,
    formatearOpciones,
    obtenerProgramas,
    obtenerSubprogramas,
};
