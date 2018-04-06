module.exports = {
  entry: ['./index.js'],
  output: {
    libraryTarget: 'commonjs2',
    filename: 'dist/index.js'
  },
  target: 'node',
  module: {
    loaders: [{
      test: /\.json$/,
      loader: 'json'
    }]
  }
};
