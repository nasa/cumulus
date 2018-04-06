module.exports = {
  entry: ['./index.js'],
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
      test: /\.json$/,
      loader: 'json'
    }]
  }
};
