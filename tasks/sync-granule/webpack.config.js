module.exports = {
  entry: ['./index.js'],
  output: {
    libraryTarget: 'commonjs2',
    filename: 'dist/index.js'
  },
  target: 'node',
  devtool: 'source-map',
  module: {
    rules: [{
      test: /\.json$/,
      loader: 'json-loader'
    }]
  }
};
