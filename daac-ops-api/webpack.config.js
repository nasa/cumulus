module.exports = {
  entry: ['babel-polyfill', './index.js'],
  output: {
    libraryTarget: 'commonjs2',
    filename: 'dist/index.js'
  },
  target: 'node',
  devtool: 'sourcemap',
  externals: ['aws-sdk'],
  module: {
    resolve: {
      alias: {
        'aws-sdk': 'aws-sdk/dist/aws-sdk'
      }
    },
    noParse: [
      /graceful-fs\/fs.js/
    ],
    loaders: [{
      test: /\.js?$/,
      exclude: /node_modules(?!\/@cumulus)/,
      loader: 'babel'
    }, {
      test: /\.json$/,
      loader: 'json'
    }]
  }
};
