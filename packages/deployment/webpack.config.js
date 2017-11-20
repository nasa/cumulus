module.exports = {
  entry: ['babel-polyfill', './app/kes.override.js'],
  output: {
    libraryTarget: 'commonjs2',
    filename: 'app/kes.js'
  },
  resolve: {
    symlinks: false,
    alias: {
      'handlebars' : 'handlebars/dist/handlebars.js'
    }
  },
  target: 'node',
  devtool: 'cheap-module-eval-source-map',
  module: {
    loaders: [{
      test: /\.js?$/,
      exclude: /(node_modules)/,
      loader: 'babel-loader'
    }, {
      test: /\.json$/,
      loader: 'json-loader'
    }]
  }
};
