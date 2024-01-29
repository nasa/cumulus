const path = require('path');
const { IgnorePlugin } = require('webpack');
// path to module root
const root = path.resolve(__dirname);

const ignoredPackages = [
  'cpu-features',
  'sshcrypto.node'
];

module.exports = {
  plugins: [
    new IgnorePlugin({
      resourceRegExp: new RegExp(`(${ignoredPackages.join('|')})$`)
    }),
  ],
  mode: process.env.PRODUCTION ? 'production' : 'development',
  entry: './index.js',
  output: {
    chunkFormat: false,
    libraryTarget: 'commonjs2',
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist'),
    devtoolModuleFilenameTemplate: (info) => {
      const relativePath = path.relative(root, info.absoluteResourcePath)
      return `webpack://${relativePath}`;
    }
  },
  externals: [
    'aws-sdk',
    'electron',
    {'formidable': 'url'},
    // See https://github.com/knex/knex/issues/1128 re: webpack configuration
    {
      'better-sqlite3': 'better-sqlite3',
      sqlite3: 'sqlite3',
      mysql2: 'mysql2',
      mariasql: 'mariasql',
      mysql: 'mysql',
      mssql: 'mssql',
      oracle: 'oracle',
      'strong-oracle': 'strong-oracle',
      oracledb: 'oracledb',
      pg: 'pg',
      'pg-query-stream': 'pg-query-stream',
      tedious: 'tedious'
    }
  ],
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'babel-loader',
            options: {
              cacheDirectory: true
            },
          },
        ],
      },
    ],
  },
  devtool: 'inline-source-map',
  target: 'node',
  optimization: {
    nodeEnv: false
  }
};
