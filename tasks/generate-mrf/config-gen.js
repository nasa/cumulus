const fs = require('fs');
const path = require('path');
const Mustache = require('mustache');

const projectionTemplate = (templateDir, type, projection) => {
  const projectionFilename = `_${projection.toLowerCase().replace(':', '')}.xml`;
  return fs.readFileSync(path.join(templateDir, `${type}-projections`, projectionFilename), 'utf8');
};

// Naively extracts the string value of a tag. Assumes no sub-tags
const extractTag = (partial, name) =>
  partial.match(`<${name}>([^<]*)`)[1];

const extForCompression = (compression) => {
  if (compression.substring(0, 1).toLowerCase() === 'j') {
    return 'jpg';
  }
  return 'png';
};

const mrfgenConfigToXml = (config) => {
  const result = [];
  for (const key of Object.keys(config)) {
    result.push(`  <${key}>${config[key]}</${key}>`);
  }
  result.push('');
  return result.join("\n");
};

exports.generateConfig = (projection, date, zoomLevels, mrfgenConfig, paths) => {
  const templateDir = paths.templates;
  const productPartial = mrfgenConfigToXml(mrfgenConfig);
  const sourceProjection = `EPSG:${extractTag(productPartial, 'source_epsg')}`;

  const partials = {
    product: productPartial,
    sourceProjection: projectionTemplate(templateDir, 'source', sourceProjection),
    targetProjection: projectionTemplate(templateDir, 'target', projection)
  };

  const tileSize = parseInt(extractTag(partials.targetProjection, 'mrf_blocksize'), 10);

  const overviewLevels = [];
  for (let i = 1; i <= zoomLevels; i++) {
    overviewLevels.push(Math.pow(2, i));
  }

  const fileExt = extForCompression(extractTag(partials.product, 'mrf_compression_type'));

  const width = projection === 'EPSG:4326' ? 5 : 8;
  const height = projection === 'EPSG:4326' ? 2.5 : 8;
  const calculated = {
    target_x: width * Math.pow(2, zoomLevels - 3) * tileSize,
    target_y: height * Math.pow(2, zoomLevels - 3) * tileSize,
    overview_levels: overviewLevels.join(' ')
  };

  if (!mrfgenConfig.mrf_empty_tile_filename) {
    calculated.mrf_empty_tile_filename = `${paths.emptyTiles}/empty${tileSize}.${fileExt}`;
  }
  partials.calculated = mrfgenConfigToXml(calculated);

  const templateParams = {
    paths: paths,
    productDate: date.year + date.month + date.day,
    isReprojection: sourceProjection !== projection,
    tileSize: tileSize,
    fileExt: fileExt
  };

  return Mustache.render(
    fs.readFileSync(path.join(__dirname, 'templates', 'mrfgen_config.xml'), 'utf8'),
    templateParams,
    partials
  );
};
