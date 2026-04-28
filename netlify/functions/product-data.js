const PRODUCT_IMAGE_BASE = 'https://vielrzftnfcitdidktgg.supabase.co/storage/v1/object/public/product-images/';

const PRODUCT_SELECT = [
  'id',
  'slug',
  'name',
  'category_id',
  'price',
  'price_label',
  'short_description',
  'short',
  'description',
  'note',
  'accent',
  'size',
  'material',
  'panel_hint',
  'image',
  'wall_image',
  'wall_source_image',
  'is_collection',
  'is_bundle',
  'is_published',
  'in_stock',
  'deleted_at',
  'plate_count',
  'plate_unit_price',
  'plate_set_price',
  'plate_map',
  'created_at',
  'updated_at',
  'categories(id,slug,name)',
  'product_plates(id,position,name,image)'
].join(',');

function getProductImageUrl(path) {
  if (!path) return null;
  if (String(path).startsWith('http')) return path;
  return `${PRODUCT_IMAGE_BASE}${path}`;
}

function mapProductPlates(product, fallbackCount) {
  const fromRelation = Array.isArray(product && product.product_plates)
    ? product.product_plates
        .slice()
        .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
    : [];

  if (fromRelation.length) {
    return {
      names: fromRelation.map(plate => plate && plate.name ? String(plate.name) : ''),
      images: fromRelation.map(plate => getProductImageUrl(plate && plate.image)),
      rows: fromRelation
    };
  }

  const count = Math.max(1, Number(fallbackCount || 0) || 1);
  return {
    names: Array.from({ length: count }, () => ''),
    images: Array.from({ length: count }, () => ''),
    rows: []
  };
}

module.exports = {
  PRODUCT_SELECT,
  getProductImageUrl,
  mapProductPlates
};
