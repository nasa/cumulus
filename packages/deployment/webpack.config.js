module.exports = {
  entry: ['babel-polyfill', 'app/kes.override.js'],
  output: {
    libraryTarget: 'commonjs2',
    filename: 'app/kes.js'
  },
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
