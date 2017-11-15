const WebpackSourceMapSupport = require("webpack-source-map-support");

module.exports = {
  entry: ['babel-polyfill', './index.js'],
  output: {
    libraryTarget: 'commonjs2',
    filename: 'dist/index.js'
  },
  target: 'node',
  devtool: 'source-map',
  plugins: [
    new WebpackSourceMapSupport()
  ],
  module: {
    rules: [{
      test: /\.js?$/,
      exclude: /(node_modules)/,
      loader: 'babel-loader'
    }, {
      test: /\.json$/,
      loader: 'json-loader'
    }]
  }
};
