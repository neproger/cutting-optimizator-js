// encoding: utf-8
// packSheets.js
import { CUT_AXIS, runTargetPass } from './runTargetPass.js';

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isNonNegativeNumber = (value) => isFiniteNumber(value) && value >= 0;
const isPositiveNumber = (value) => isFiniteNumber(value) && value > 0;

const buildInputError = (message, payload = null) => {
    const fullMessage = `[packer] ${message}`;
    if (payload) console.error(fullMessage, payload);
    else console.error(fullMessage);
    return { results: [], tooBigParts: [], error: fullMessage };
};

const validateSettings = (settings) => {
    if (!settings || typeof settings !== 'object') return { ok: false, error: '`settings` must be an object.' };
    if (!isNonNegativeNumber(settings.sheetTrim)) return { ok: false, error: '`settings.sheetTrim` must be a non-negative number.' };
    if (!isNonNegativeNumber(settings.kerf)) return { ok: false, error: '`settings.kerf` must be a non-negative number.' };
    return { ok: true };
};

const validateStock = (stock) => {
    if (!stock || typeof stock !== 'object') return { ok: false, error: '`stock` must be an object.' };
    if (stock.mode !== '2d' && stock.mode !== '1d') return { ok: false, error: '`stock.mode` must be `2d` or `1d`.' };
    if (!isPositiveNumber(stock.width)) return { ok: false, error: '`stock.width` must be a positive number.' };
    if (!isPositiveNumber(stock.height)) return { ok: false, error: '`stock.height` must be a positive number.' };
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
    partWidth <= maxWidth && partHeight <= maxHeight;

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

const pickBestPartsFor1DLength = (parts, targetLength, cuttingTool) => {
    const capacity = Math.max(0, Math.floor(targetLength));
    if (capacity <= 0 || !Array.isArray(parts) || parts.length === 0) return [];

    const kerf = Math.max(0, Math.floor(cuttingTool));
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
        const length = Math.max(0, Math.floor(parts[idx].height));
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

const packLinearProfiles = ({ stock, parts, sheetTrim, kerf }) => {
    const results = [];
    const oversizedParts = [];

    const profileWidth = 200;
    const profileSideOffset = 10;
    const profileInnerWidth = Math.max(0, profileWidth - profileSideOffset * 2);

    const maxLength = stock.height - sheetTrim * 2;
    if (maxLength <= 0) return { results: [], oversizedParts: parts };

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
                x: profileSideOffset,
                y: yCursor,
                width: profileInnerWidth > 0 ? profileInnerWidth : stock.width,
                height: partLength,
            });
            usedLength += partLength;
            yCursor += partLength + kerf;
        }

        const endY = stock.height - sheetTrim;
        const leftoverHeight = endY - yCursor;
        if (leftoverHeight > 0) {
            sheetItems.push({
                ...stock,
                type: 'materials',
                x: profileSideOffset,
                y: yCursor,
                width: profileInnerWidth,
                height: leftoverHeight,
            });
        }

        const percentage = maxLength > 0 ? ((usedLength / maxLength) * 100).toFixed(1) : '0.0';
        results.push({
            ...stock,
            width: profileWidth,
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

const runDirectionalPacking = ({ axis, sheetPiece, placeableParts, kerf, allowRotation }) => {
    let remainingParts = [...placeableParts];
    let currentPiece = { ...sheetPiece, id: `${sheetPiece.id}_${axis}` };
    const placements = [];
    const leftovers = [];
    let guard = 0;

    while (remainingParts.length > 0 && currentPiece && currentPiece.width > 0 && currentPiece.height > 0) {
        guard += 1;
        if (guard > placeableParts.length * 2 + 20) break;

        const targetCandidates = getSortedTargetCandidates(remainingParts);
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
        });

        if (!passResult.success) {
            leftovers.push(currentPiece);
            break;
        }

        placements.push(...passResult.placements);
        remainingParts = passResult.remainingParts;

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
    };
};

export const packSheets = async (stockInput, parts, settings) => {
    const settingsValidation = validateSettings(settings);
    if (!settingsValidation.ok) return buildInputError(settingsValidation.error, settings);

    const stockValidation = validateStock(stockInput);
    if (!stockValidation.ok) return buildInputError(stockValidation.error, stockInput);

    const partsNormalization = normalizeAndExpandParts(parts);
    if (!partsNormalization.ok) return buildInputError(partsNormalization.error, parts);

    const preparedParts = partsNormalization.parts;
    if (preparedParts.length === 0) return { results: [], tooBigParts: [] };

    const stock = {
        id: stockInput.id ?? null,
        mode: stockInput.mode,
        width: stockInput.width,
        height: stockInput.height,
        allowRotation: stockInput.allowRotation,
    };
    const sheetTrim = settings.sheetTrim;
    const kerf = settings.kerf;

    if (stock.mode === '1d') {
        const oneDimensional = packLinearProfiles({
            stock,
            parts: preparedParts,
            sheetTrim,
            kerf,
        });
        return {
            results: oneDimensional.results,
            tooBigParts: oneDimensional.oversizedParts,
        };
    }

    const sheetWidth = stock.width - sheetTrim * 2;
    const sheetHeight = stock.height - sheetTrim * 2;
    if (sheetWidth <= 0 || sheetHeight <= 0) {
        return { results: [], tooBigParts: preparedParts };
    }

    const allowRotation = stock.allowRotation;
    const { oversizedParts, placeableParts } = splitPartsByFit(preparedParts, sheetWidth, sheetHeight, allowRotation);
    if (placeableParts.length === 0) {
        return { results: [], tooBigParts: oversizedParts };
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
    let remainingParts = [...placeableParts];
    let sheetIndex = 0;
    let guard = 0;

    while (remainingParts.length > 0) {
        guard += 1;
        if (guard > placeableParts.length + 20) break;

        const verticalResult = runDirectionalPacking({
            axis: CUT_AXIS.VERTICAL,
            sheetPiece: { ...sheetPiece, id: `${sheetPiece.id}_v_${sheetIndex}` },
            placeableParts: remainingParts,
            kerf,
            allowRotation,
        });
        const horizontalResult = runDirectionalPacking({
            axis: CUT_AXIS.HORIZONTAL,
            sheetPiece: { ...sheetPiece, id: `${sheetPiece.id}_h_${sheetIndex}` },
            placeableParts: remainingParts,
            kerf,
            allowRotation,
        });

        const verticalUsedArea = getUsedAreaFromPlacements(verticalResult.placements);
        const horizontalUsedArea = getUsedAreaFromPlacements(horizontalResult.placements);

        const isVerticalBetter = verticalUsedArea > horizontalUsedArea ||
            (verticalUsedArea === horizontalUsedArea && verticalResult.placements.length >= horizontalResult.placements.length);

        const bestAxis = isVerticalBetter ? CUT_AXIS.VERTICAL : CUT_AXIS.HORIZONTAL;
        const bestResult = isVerticalBetter ? verticalResult : horizontalResult;

        if (!bestResult || bestResult.placements.length === 0 || bestResult.remainingParts.length >= remainingParts.length) {
            oversizedParts.push(...remainingParts);
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

        remainingParts = bestResult.remainingParts;
        sheetIndex += 1;
    }

    return {
        results,
        tooBigParts: oversizedParts,
    };
};
