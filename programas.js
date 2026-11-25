const PROGRAMAS_DISPONIBLES = Object.freeze({
    'Mejoramiento de vivienda': Object.freeze(['Piso firme', 'Techo firme']),
    'Ampliación de vivienda': Object.freeze(['Recámara', 'Cuarto de baño']),
    'Certeza jurídica': Object.freeze(['Regularización', 'Escrituración']),
    Equipamiento: Object.freeze(['Estufas ecológicas']),
});

const ALIAS_DE_OPCIONES = Object.freeze({
    'Mejoramiento de vivienda': Object.freeze(['mejoramiento', 'mejorar vivienda']),
    'Ampliación de vivienda': Object.freeze(['ampliacion', 'ampliar vivienda']),
    'Certeza jurídica': Object.freeze(['certeza', 'certeza juridica']),
    Equipamiento: Object.freeze(['equipamiento', 'estufa', 'estufas', 'estufa ecologica', 'estufas ecologicas']),
    'Piso firme': Object.freeze(['piso', 'pisos', 'piso firme']),
    'Techo firme': Object.freeze(['techo', 'techos', 'techo firme']),
    Recámara: Object.freeze(['recamara', 'recamaras', 'habitacion', 'dormitorio']),
    'Cuarto de baño': Object.freeze(['bano', 'banos', 'cuarto de bano', 'cuarto para bano', 'cuarto bano']),
    Regularización: Object.freeze(['regularizacion', 'regularizar', 'regularizacion de predio', 'regularizacion de terreno']),
    Escrituración: Object.freeze(['escrituracion', 'escritura', 'escrituras', 'escriturar']),
    'Estufas ecológicas': Object.freeze(['estufa', 'estufas', 'estufa ecologica', 'estufas ecologicas', 'ecologica', 'ecologicas']),
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
        .replace(/\s+/g, ' ');
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
    const trimmedInput = String(input || '').trim();
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
