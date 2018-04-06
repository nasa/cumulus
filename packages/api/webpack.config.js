module.exports = {
  entry: ['./index.js'],
  output: {
    libraryTarget: 'commonjs2',
    filename: 'dist/index.js'
  },
  target: 'node',
  externals: [
    'aws-sdk',
    'electron'
  ],
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
      test: /\.json$/,
      loader: 'json'
    }]
  }
};
