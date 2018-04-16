const { template } = require('lodash');

/**
* define the path of a file based on the metadata of a granule
*
* @param {string} pathTemplate - the template that defines the path,
* using `{}` for string interpolation
* @param {Object} context - the metadata used in the template
* @returns {string} - the url path for the file
**/
module.exports = function urlPathTemplate(pathTemplate, context) {
  const compiledTemplate = template(pathTemplate, {
    interpolate: /{([\s\S]+?)}/g
  });

  return compiledTemplate(context);
};
