const MAX_PLATES = 24;

const PRESET_POSITIONS = {
  1: [[0, 0]],
  2: [[0, 0], [0, 1]],
  3: [[0, 0], [0, 1], [1, 0]],
  4: [[0, 0], [0, 1], [1, 0], [1, 1]],
  5: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]],
  6: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]],
  7: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]],
  8: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1]],
  9: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]],
  10: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [1, 3], [2, 0], [2, 1], [2, 2]],
  11: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [1, 3], [2, 0], [2, 1], [2, 2], [2, 3]],
  12: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [2, 0], [2, 1], [2, 2], [2, 3]]
};

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function clampPlateCount(value) {
  return Math.max(1, Math.min(MAX_PLATES, toInt(value, 1)));
}

function firstArray(record, names) {
  for (const name of names) {
    if (Array.isArray(record && record[name])) return record[name];
  }
  return [];
}

function firstMap(record) {
  const candidates = [record && record.plate_map, record && record.plateMap, record && record.panel_map, record && record.panelMap];
  return candidates.find(map => map && typeof map === 'object' && !Array.isArray(map) && Array.isArray(map.positions)) || null;
}

function normalisePositions(positions) {
  return (Array.isArray(positions) ? positions : [])
    .map(pos => ({
      row: toInt(pos && pos.row, 0),
      col: toInt(pos && pos.col, 0)
    }))
    .filter(pos => Number.isFinite(pos.row) && Number.isFinite(pos.col));
}

function clampNumber(value, min, max, fallback) {
  const n = toNumber(value, fallback);
  return Math.max(min, Math.min(max, n));
}

function normaliseTransforms(transforms, count) {
  const safeCount = clampPlateCount(count);
  const source = Array.isArray(transforms) ? transforms : [];
  const result = [];

  for (let i = 0; i < safeCount; i += 1) {
    const item = source[i] && typeof source[i] === 'object' ? source[i] : {};
    const fit = item.fit === 'cover' ? 'cover' : 'contain';
    result.push({
      fit,
      x: clampNumber(item.x ?? item.positionX, 0, 100, 50),
      y: clampNumber(item.y ?? item.positionY, 0, 100, 50),
      scale: clampNumber(item.scale ?? item.zoom, 0.2, 3, 1)
    });
  }

  return result;
}

function smartPlatePositions(count) {
  const safeCount = clampPlateCount(count);
  const preset = PRESET_POSITIONS[safeCount];
  if (preset) return preset.map(([row, col]) => ({ row, col }));

  const cols = Math.max(3, Math.ceil(Math.sqrt(safeCount)));
  const rows = Math.ceil(safeCount / cols);
  const positions = [];
  let placed = 0;

  for (let row = 0; row < rows && placed < safeCount; row += 1) {
    const remaining = safeCount - placed;
    const rowCols = Math.min(cols, remaining);
    const offset = Math.floor((cols - rowCols) / 2);
    for (let col = 0; col < rowCols; col += 1) {
      positions.push({ row, col: col + offset });
      placed += 1;
    }
  }

  return positions;
}

function inferPlateCount(record) {
  const mapped = firstMap(record);
  if (mapped && mapped.positions.length) return clampPlateCount(mapped.positions.length);

  const explicit = toInt(
    record && (record.plate_count ?? record.plateCount ?? record.pieces ?? record.panel_count ?? record.tile_count),
    0
  );
  if (explicit > 0) return clampPlateCount(explicit);

  const names = firstArray(record, ['plate_names', 'plateNames', 'panel_names', 'panelNames']);
  if (names.length) return clampPlateCount(names.length);

  const images = firstArray(record, ['plate_images', 'plateImages', 'panel_images', 'panelImages']);
  if (images.length) return clampPlateCount(images.length);

  return 3;
}

function normalisePlateMap(record, count) {
  const safeCount = clampPlateCount(count || inferPlateCount(record));
  const sourceMap = firstMap(record);
  const sourcePositions = sourceMap ? normalisePositions(sourceMap.positions) : [];
  const positions = sourcePositions.length ? sourcePositions.slice(0, safeCount) : smartPlatePositions(safeCount);

  return {
    version: 2,
    geometry: 'pointy_hex',
    positions,
    transforms: normaliseTransforms(sourceMap && sourceMap.transforms, safeCount),
    mockup: (sourceMap && sourceMap.mockup && typeof sourceMap.mockup === 'object') ? sourceMap.mockup : {}
  };
}

function normaliseStringArray(record, names, count) {
  const arr = firstArray(record, names).map(value => (value == null ? '' : String(value)));
  const safeCount = clampPlateCount(count);
  while (arr.length < safeCount) arr.push('');
  return arr.slice(0, safeCount);
}

function resolvePlatePricing(record, count) {
  const safeCount = clampPlateCount(count);
  const setPrice = toNumber(record && (record.plate_set_price ?? record.plateSetPrice ?? record.price), 0);
  const explicitUnit = toNumber(record && (record.plate_unit_price ?? record.plateUnitPrice), NaN);
  const unitPrice = Number.isFinite(explicitUnit) && explicitUnit > 0
    ? explicitUnit
    : (safeCount > 0 ? Number((setPrice / safeCount).toFixed(2)) : 34.99);

  return {
    setPrice: Number(setPrice.toFixed(2)),
    unitPrice: Number(unitPrice.toFixed(2))
  };
}

function isMissingColumnError(error) {
  const text = `${error && error.code ? error.code : ''} ${error && error.message ? error.message : ''}`;
  return /PGRST204|schema cache|column|plate_count|plate_unit_price|plate_set_price|plate_names|plate_images|plate_map|panel_names|panel_images|panel_map|wall_source_image|is_bundle/i.test(text);
}

function stripAdvancedPlateFields(payload) {
  const copy = { ...payload };
  [
    'plate_count',
    'plate_unit_price',
    'plate_set_price',
    'plate_names',
    'plate_images',
    'plate_map',
    'panel_names',
    'panel_images',
    'panel_map',
    'is_bundle',
    'wall_source_image'
  ].forEach(key => delete copy[key]);
  return copy;
}

module.exports = {
  MAX_PLATES,
  clampPlateCount,
  inferPlateCount,
  isMissingColumnError,
  normalisePlateMap,
  normaliseTransforms,
  normaliseStringArray,
  resolvePlatePricing,
  smartPlatePositions,
  stripAdvancedPlateFields,
  toNumber
};
