module.exports = {
  entry: ['babel-polyfill', './index.js'],
  output: {
    libraryTarget: 'commonjs2',
    filename: 'dist/index.js'
  },
  externals: [
    'electron'
  ],
  target: 'node',
  devtool: 'sourcemap',
  module: {
    loaders: [{
      test: /\.js?$/,
      exclude: /(node_modules)/,
      loader: 'babel'
    }, {
      test: /\.json$/,
      loader: 'json'
    }]
  }
};
