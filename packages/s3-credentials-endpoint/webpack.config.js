'use strict';

module.exports = {
  mode: process.env.PRODUCTION ? 'production' : 'development',
  entry: './index.js',
  output: {
    libraryTarget: 'commonjs2',
    filename: 'index.js'
  },
  externals: [
    'aws-sdk',
    'electron',
    { formidable: 'url' }
  ],
  devtool: process.env.PRODUCTION ? false : 'inline-source-map',
  target: 'node'
};
