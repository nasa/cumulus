'use strict';

const path = require('path');

module.exports = {
  mode: process.env.PRODUCTION ? 'production' : 'development',
  entry: './index.js',
  output: {
    libraryTarget: 'commonjs2',
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist')
  },
  externals: [
    'electron',
    {'formidable': 'url'}
  ],
  devtool: process.env.PRODUCTION ? false : 'inline-source-map',
  target: 'node'
};
