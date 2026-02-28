// encoding: utf-8
// packSheets.js
import { CUT_AXIS, runTargetPass } from './runTargetPass.js';

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isNonNegativeNumber = (value) => isFiniteNumber(value) && value >= 0;
const isPositiveNumber = (value) => isFiniteNumber(value) && value > 0;
const EPSILON = 1e-6;
const DP_SCALE = 10;
const MAX_DIMENSION = 1e8;
const DIRECTIONAL_GUARD_MIN = 200;
const toDpUnits = (value) => Math.max(0, Math.ceil((value - EPSILON) * DP_SCALE));

const createEmptyResult = (overrides = {}) => ({
    results: [],
    tooBigParts: [],
    unplacedParts: [],
    stopReason: null,
    stats: {
        inputParts: 0,
        placedParts: 0,
        usedAreaTotal: 0,
        efficiency: 0,
        sheetIterations: 0,
        maxSheetIterations: 0,
        directionalPasses: 0,
        maxRecursionDepthReached: false,
        maxRecursionDepthObserved: 0,
        directionalGuardLimitReached: false,
    },
    ...overrides,
});

const buildInputError = (message) => {
    const fullMessage = `[packer] ${message}`;
    return createEmptyResult({
        error: fullMessage,
        stopReason: 'validation_error',
    });
};

const validateSettings = (settings) => {
    if (!settings || typeof settings !== 'object') return { ok: false, error: '`settings` must be an object.' };
    if (!isNonNegativeNumber(settings.sheetTrim)) return { ok: false, error: '`settings.sheetTrim` must be a non-negative number.' };
    if (!isNonNegativeNumber(settings.kerf)) return { ok: false, error: '`settings.kerf` must be a non-negative number.' };
    if (settings.minLeftoverSize != null && !isNonNegativeNumber(settings.minLeftoverSize)) {
        return { ok: false, error: '`settings.minLeftoverSize` must be a non-negative number.' };
    }
    if (settings.maxRecursionDepth != null && (!Number.isInteger(settings.maxRecursionDepth) || settings.maxRecursionDepth < 0)) {
        return { ok: false, error: '`settings.maxRecursionDepth` must be an integer >= 0.' };
    }
    return { ok: true };
};

const validateStock = (stock) => {
    if (!stock || typeof stock !== 'object') return { ok: false, error: '`stock` must be an object.' };
    if (stock.mode !== '2d' && stock.mode !== '1d') return { ok: false, error: '`stock.mode` must be `2d` or `1d`.' };
    if (!isPositiveNumber(stock.width)) return { ok: false, error: '`stock.width` must be a positive number.' };
    if (!isPositiveNumber(stock.height)) return { ok: false, error: '`stock.height` must be a positive number.' };
    if (stock.width > MAX_DIMENSION) return { ok: false, error: '`stock.width` is too large.' };
    if (stock.height > MAX_DIMENSION) return { ok: false, error: '`stock.height` is too large.' };
    if (typeof stock.allowRotation !== 'boolean') return { ok: false, error: '`stock.allowRotation` must be boolean.' };
    return { ok: true };
};

const normalizeAndExpandParts = (parts) => {
    if (!Array.isArray(parts)) return { ok: false, error: '`parts` must be an array.' };

    const expanded = [];
    for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i];
        if (!part || typeof part !== 'object') return { ok: false, error: `parts[${i}] must be an object.` };
        if (part.id == null) return { ok: false, error: `parts[${i}].id is required.` };
        if (!isPositiveNumber(part.width)) return { ok: false, error: `parts[${i}].width must be a positive number.` };
        if (!isPositiveNumber(part.height)) return { ok: false, error: `parts[${i}].height must be a positive number.` };
        if (part.width > MAX_DIMENSION) return { ok: false, error: `parts[${i}].width is too large.` };
        if (part.height > MAX_DIMENSION) return { ok: false, error: `parts[${i}].height is too large.` };

        const count = part.count == null ? 1 : part.count;
        if (!Number.isInteger(count) || count < 1) {
            return { ok: false, error: `parts[${i}].count must be an integer >= 1.` };
        }

        for (let c = 0; c < count; c += 1) {
            expanded.push({
                id: part.id,
                width: part.width,
                height: part.height,
            });
        }
    }

    return { ok: true, parts: expanded };
};

const getEffectiveWidth = (part) => part.width;
const getEffectiveHeight = (part) => part.height;
const getEffectiveArea = (part) => getEffectiveWidth(part) * getEffectiveHeight(part);
const canFitPart = (partWidth, partHeight, maxWidth, maxHeight) =>
    partWidth <= maxWidth + EPSILON && partHeight <= maxHeight + EPSILON;

const getUsedAreaFromPlacements = (placements) => {
    if (!Array.isArray(placements) || placements.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < placements.length; i += 1) {
        const item = placements[i];
        if (item?.type !== 'parts') continue;
        sum += getEffectiveArea(item);
    }
    return sum;
};

const canFitPartOnSheet = (part, sheetWidth, sheetHeight, allowRotation) => {
    const width = getEffectiveWidth(part);
    const height = getEffectiveHeight(part);
    if (canFitPart(width, height, sheetWidth, sheetHeight)) return true;
    return allowRotation && canFitPart(height, width, sheetWidth, sheetHeight);
};

const splitPartsByFit = (parts, sheetWidth, sheetHeight, allowRotation) => {
    const oversizedParts = [];
    const placeableParts = [];
    for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i];
        if (canFitPartOnSheet(part, sheetWidth, sheetHeight, allowRotation)) placeableParts.push(part);
        else oversizedParts.push(part);
    }
    return { oversizedParts, placeableParts };
};

const createCutMap = ({ stock, items, partsCount, sheetArea, outputWidth, outputHeight }) => {
    const usedArea = getUsedAreaFromPlacements(items);
    const percentage = sheetArea > 0 ? ((usedArea / sheetArea) * 100).toFixed(1) : '0.0';

    return {
        ...stock,
        width: outputWidth,
        height: outputHeight,
        partsCount,
        percentage,
        usedArea,
        items,
    };
};

/**
 * 0/1 knapsack for 1D profile mode.
 * Maximizes consumed length (with kerf) within available profile length.
 */
const pickBestPartsFor1DLength = (parts, targetLength, cuttingTool) => {
    const capacity = toDpUnits(targetLength);
    if (capacity <= 0 || !Array.isArray(parts) || parts.length === 0) return [];

    const kerf = toDpUnits(cuttingTool);
    const dpLength = new Int32Array(capacity + 1);
    const prevCap = new Int32Array(capacity + 1);
    const pickedIdx = new Int32Array(capacity + 1);

    for (let i = 0; i <= capacity; i += 1) {
        dpLength[i] = -1;
        prevCap[i] = -1;
        pickedIdx[i] = -1;
    }
    dpLength[0] = 0;

    for (let idx = 0; idx < parts.length; idx += 1) {
        const length = toDpUnits(parts[idx].height);
        const size = length + kerf;
        if (size <= 0 || size > capacity) continue;

        for (let c = capacity; c >= size; c -= 1) {
            const sourceCap = c - size;
            const prev = dpLength[sourceCap];
            if (prev < 0) continue;

            const candidate = prev + size;
            if (candidate > dpLength[c]) {
                dpLength[c] = candidate;
                prevCap[c] = sourceCap;
                pickedIdx[c] = idx;
            }
        }
    }

    let bestCap = 0;
    for (let c = 1; c <= capacity; c += 1) {
        if (dpLength[c] > dpLength[bestCap]) bestCap = c;
    }
    if (dpLength[bestCap] <= 0) return [];

    const resultIndexes = [];
    let cursor = bestCap;
    while (cursor > 0 && pickedIdx[cursor] >= 0) {
        resultIndexes.push(pickedIdx[cursor]);
        cursor = prevCap[cursor];
    }
    resultIndexes.reverse();

    return resultIndexes.map((idx) => parts[idx]);
};

const packLinearProfiles = ({
    stock,
    parts,
    sheetTrim,
    kerf,
    minLeftoverSize = 0,
}) => {
    const results = [];
    const oversizedParts = [];

    // 1D mode tracks only length (Y axis). Width offset is always zero.
    const widthOffset = 0;
    const outputProfileWidth = stock.width;
    const profileInnerWidth = outputProfileWidth;
    const minRemainder = Math.max(0, minLeftoverSize);

    const maxLength = stock.height - sheetTrim * 2;
    if (maxLength <= EPSILON) return { results: [], oversizedParts: parts };

    let remainingParts = [];
    for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i];
        const length = part.height;
        if (length > maxLength) oversizedParts.push(part);
        else remainingParts.push(part);
    }

    remainingParts.sort((left, right) => right.height - left.height);

    while (remainingParts.length > 0) {
        let usedParts = pickBestPartsFor1DLength(remainingParts, maxLength, kerf);
        if (usedParts.length === 0) usedParts = [remainingParts[0]];

        let yCursor = sheetTrim;
        const sheetItems = [];
        let usedLength = 0;

        for (let i = 0; i < usedParts.length; i += 1) {
            const part = usedParts[i];
            const partLength = part.height;
            sheetItems.push({
                ...part,
                type: 'parts',
                x: widthOffset,
                y: yCursor,
                width: profileInnerWidth > EPSILON ? profileInnerWidth : outputProfileWidth,
                height: partLength,
            });
            usedLength += partLength;
            yCursor += partLength + kerf;
        }

        const endY = stock.height - sheetTrim;
        const leftoverHeight = endY - yCursor;
        if (leftoverHeight > minRemainder + EPSILON) {
            sheetItems.push({
                ...stock,
                type: 'materials',
                x: widthOffset,
                y: yCursor,
                width: profileInnerWidth > EPSILON ? profileInnerWidth : outputProfileWidth,
                height: leftoverHeight,
            });
        }

        const percentage = maxLength > 0 ? ((usedLength / maxLength) * 100).toFixed(1) : '0.0';
        results.push({
            ...stock,
            width: outputProfileWidth,
            height: stock.height,
            partsCount: usedParts.length,
            percentage,
            usedArea: usedLength,
            items: sheetItems,
        });

        const usedPartsSet = new Set(usedParts);
        remainingParts = remainingParts.filter((part) => !usedPartsSet.has(part));
    }

    return { results, oversizedParts };
};

const getSortedTargetCandidates = (parts) => {
    if (!Array.isArray(parts) || parts.length === 0) return [];
    const sorted = [...parts];
    sorted.sort((left, right) => {
        const primaryDiff = getEffectiveWidth(right) - getEffectiveWidth(left);
        if (primaryDiff !== 0) return primaryDiff;
        const secondaryDiff = getEffectiveHeight(right) - getEffectiveHeight(left);
        if (secondaryDiff !== 0) return secondaryDiff;
        return 0;
    });
    return sorted;
};

const pickTargetForPiece = (piece, targetCandidates, allowRotation) => {
    if (!piece || !Array.isArray(targetCandidates) || targetCandidates.length === 0) return null;
    for (let i = 0; i < targetCandidates.length; i += 1) {
        const candidate = targetCandidates[i];
        if (canFitPartOnSheet(candidate, piece.width, piece.height, allowRotation)) return candidate;
    }
    return null;
};

const splitMainAndSideLeftovers = (leftovers) => {
    if (!Array.isArray(leftovers) || leftovers.length === 0) return { mainRemainder: null, sideLeftovers: [] };

    let mainRemainder = null;
    const sideLeftovers = [];
    for (let i = 0; i < leftovers.length; i += 1) {
        const item = leftovers[i];
        if (!mainRemainder && typeof item?.id === 'string' && item.id.includes('_remainder_main')) {
            mainRemainder = item;
            continue;
        }
        sideLeftovers.push(item);
    }
    return { mainRemainder, sideLeftovers };
};

const createStats = ({
    inputParts = 0,
    placedParts = 0,
    usedAreaTotal = 0,
    capacityTotal = 0,
    sheetIterations = 0,
    maxSheetIterations = 0,
    directionalPasses = 0,
    maxRecursionDepthReached = false,
    maxRecursionDepthObserved = 0,
    directionalGuardLimitReached = false,
}) => ({
    inputParts,
    placedParts,
    usedAreaTotal,
    efficiency: capacityTotal > 0 ? Number(((usedAreaTotal / capacityTotal) * 100).toFixed(1)) : 0,
    sheetIterations,
    maxSheetIterations,
    directionalPasses,
    maxRecursionDepthReached,
    maxRecursionDepthObserved,
    directionalGuardLimitReached,
});

/**
 * Executes one directional sheet fill (`vertical` or `horizontal`) until no progress.
 * Returns placements, leftovers, remaining parts and diagnostics.
 */
const runDirectionalPacking = ({ axis, sheetPiece, placeableParts, kerf, allowRotation, maxRecursionDepth }) => {
    let remainingParts = [...placeableParts];
    let targetCandidates = getSortedTargetCandidates(remainingParts);
    let currentPiece = { ...sheetPiece, id: `${sheetPiece.id}_${axis}` };
    const placements = [];
    const leftovers = [];
    let passesCount = 0;
    let maxRecursionDepthReached = false;
    let maxRecursionDepthObserved = 0;
    let guard = 0;
    const maxDirectionalIterations = Math.max(placeableParts.length * 2, DIRECTIONAL_GUARD_MIN);
    let guardLimitReached = false;

    while (remainingParts.length > 0 && currentPiece && currentPiece.width > 0 && currentPiece.height > 0) {
        guard += 1;
        if (guard > maxDirectionalIterations) {
            guardLimitReached = true;
            break;
        }

        const targetPart = pickTargetForPiece(currentPiece, targetCandidates, allowRotation);
        if (!targetPart) {
            leftovers.push(currentPiece);
            break;
        }

        const passResult = runTargetPass({
            piece: currentPiece,
            targetPart,
            partsPool: remainingParts,
            cuttingTool: kerf,
            axis,
            allowRotation,
            maxRecursionDepth,
        });

        if (!passResult.success) {
            leftovers.push(currentPiece);
            break;
        }

        passesCount += 1;
        maxRecursionDepthReached = maxRecursionDepthReached || passResult.maxRecursionDepthReached;
        if (passResult.maxRecursionDepthObserved > maxRecursionDepthObserved) {
            maxRecursionDepthObserved = passResult.maxRecursionDepthObserved;
        }
        placements.push(...passResult.placements);
        remainingParts = passResult.remainingParts;
        const remainingSet = new Set(remainingParts);
        targetCandidates = targetCandidates.filter((candidate) => remainingSet.has(candidate));

        const { mainRemainder, sideLeftovers } = splitMainAndSideLeftovers(passResult.leftovers);
        if (sideLeftovers.length > 0) leftovers.push(...sideLeftovers);
        currentPiece = mainRemainder || null;
    }

    if (currentPiece && (remainingParts.length === 0 || currentPiece.width <= 0 || currentPiece.height <= 0)) {
        leftovers.push(currentPiece);
    }

    return {
        placements,
        leftovers,
        remainingParts,
        passesCount,
        maxRecursionDepthReached,
        maxRecursionDepthObserved,
        guardLimitReached,
    };
};

export const packSheets = (stockInput, parts, settings) => {
    const settingsValidation = validateSettings(settings);
    if (!settingsValidation.ok) return buildInputError(settingsValidation.error);

    const stockValidation = validateStock(stockInput);
    if (!stockValidation.ok) return buildInputError(stockValidation.error);

    const partsNormalization = normalizeAndExpandParts(parts);
    if (!partsNormalization.ok) return buildInputError(partsNormalization.error);

    const preparedParts = partsNormalization.parts;
    if (preparedParts.length === 0) return createEmptyResult();

    const stock = {
        id: stockInput.id ?? null,
        mode: stockInput.mode,
        width: stockInput.width,
        height: stockInput.height,
        allowRotation: stockInput.allowRotation,
    };
    const sheetTrim = settings.sheetTrim;
    const kerf = settings.kerf;
    const minLeftoverSize = settings.minLeftoverSize ?? 0;
    const maxRecursionDepth = settings.maxRecursionDepth ?? 64;
    const inputPartsCount = preparedParts.length;

    if (stock.mode === '1d') {
        const oneDimensional = packLinearProfiles({
            stock,
            parts: preparedParts,
            sheetTrim,
            kerf,
            minLeftoverSize,
        });
        return {
            results: oneDimensional.results,
            tooBigParts: oneDimensional.oversizedParts,
            unplacedParts: [],
            stopReason: null,
            stats: createStats({
                inputParts: inputPartsCount,
                placedParts: oneDimensional.results.reduce((sum, map) => sum + map.partsCount, 0),
                usedAreaTotal: oneDimensional.results.reduce((sum, map) => sum + map.usedArea, 0),
                capacityTotal: oneDimensional.results.length * Math.max(0, stock.height - sheetTrim * 2),
            }),
        };
    }

    const sheetWidth = stock.width - sheetTrim * 2;
    const sheetHeight = stock.height - sheetTrim * 2;
    if (sheetWidth <= EPSILON || sheetHeight <= EPSILON) {
        return createEmptyResult({ tooBigParts: preparedParts });
    }

    const allowRotation = stock.allowRotation;
    const { oversizedParts, placeableParts } = splitPartsByFit(preparedParts, sheetWidth, sheetHeight, allowRotation);
    if (placeableParts.length === 0) {
        return createEmptyResult({ tooBigParts: oversizedParts });
    }

    const sheetPiece = {
        id: `new_js_sheet_${stock.id ?? '0'}`,
        type: 'materials',
        x: sheetTrim,
        y: sheetTrim,
        width: sheetWidth,
        height: sheetHeight,
    };

    const sheetArea = sheetWidth * sheetHeight;
    const results = [];
    const unplacedParts = [];
    let remainingParts = [...placeableParts];
    let sheetIndex = 0;
    let guard = 0;
    let stopReason = null;
    const maxSheetIterations = Math.max(placeableParts.length * 2, 1000);
    let directionalPasses = 0;
    let maxRecursionDepthReached = false;
    let maxRecursionDepthObserved = 0;
    let directionalGuardLimitReached = false;

    while (remainingParts.length > 0) {
        guard += 1;
        if (guard > maxSheetIterations) {
            unplacedParts.push(...remainingParts);
            stopReason = 'max_sheet_iterations_reached';
            break;
        }

        const verticalResult = runDirectionalPacking({
            axis: CUT_AXIS.VERTICAL,
            sheetPiece: { ...sheetPiece, id: `${sheetPiece.id}_v_${sheetIndex}` },
            placeableParts: remainingParts,
            kerf,
            allowRotation,
            maxRecursionDepth,
        });
        const horizontalResult = runDirectionalPacking({
            axis: CUT_AXIS.HORIZONTAL,
            sheetPiece: { ...sheetPiece, id: `${sheetPiece.id}_h_${sheetIndex}` },
            placeableParts: remainingParts,
            kerf,
            allowRotation,
            maxRecursionDepth,
        });

        const verticalUsedArea = getUsedAreaFromPlacements(verticalResult.placements);
        const horizontalUsedArea = getUsedAreaFromPlacements(horizontalResult.placements);

        const isVerticalBetter = verticalUsedArea > horizontalUsedArea ||
            (verticalUsedArea === horizontalUsedArea && verticalResult.placements.length >= horizontalResult.placements.length);

        const bestAxis = isVerticalBetter ? CUT_AXIS.VERTICAL : CUT_AXIS.HORIZONTAL;
        const bestResult = isVerticalBetter ? verticalResult : horizontalResult;

        if (!bestResult || bestResult.placements.length === 0 || bestResult.remainingParts.length >= remainingParts.length) {
            unplacedParts.push(...remainingParts);
            stopReason = bestResult?.guardLimitReached ? 'directional_guard_limit_reached' : 'no_progress';
            break;
        }

        const bestMap = createCutMap({
            stock,
            items: [...bestResult.placements, ...bestResult.leftovers],
            partsCount: bestResult.placements.length,
            sheetArea,
            outputWidth: sheetWidth + sheetTrim * 2,
            outputHeight: sheetHeight + sheetTrim * 2,
        });
        bestMap.runDirection = bestAxis;
        results.push(bestMap);
        directionalPasses += bestResult.passesCount;
        maxRecursionDepthReached = maxRecursionDepthReached || bestResult.maxRecursionDepthReached;
        directionalGuardLimitReached = directionalGuardLimitReached || bestResult.guardLimitReached;
        if (bestResult.maxRecursionDepthObserved > maxRecursionDepthObserved) {
            maxRecursionDepthObserved = bestResult.maxRecursionDepthObserved;
        }

        remainingParts = bestResult.remainingParts;
        sheetIndex += 1;
    }

    return {
        results,
        tooBigParts: oversizedParts,
        unplacedParts,
        stopReason,
        stats: createStats({
            inputParts: inputPartsCount,
            placedParts: results.reduce((sum, map) => sum + map.partsCount, 0),
            usedAreaTotal: results.reduce((sum, map) => sum + map.usedArea, 0),
            capacityTotal: results.length * sheetArea,
            sheetIterations: guard,
            maxSheetIterations,
            directionalPasses,
            maxRecursionDepthReached,
            maxRecursionDepthObserved,
            directionalGuardLimitReached,
        }),
    };
};
