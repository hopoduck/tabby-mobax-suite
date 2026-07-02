const path = require('path');

module.exports = (_env, argv) => ({
  target: 'node',
  entry: './src/index.ts',
  // production(npm 배포)에서는 소스맵 미생성(용량↓), watch=development에서는 유지
  devtool: argv.mode === 'production' ? false : 'source-map',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js',
    libraryTarget: 'commonjs2',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  externals: [
    '@angular/animations',
    '@angular/common',
    '@angular/compiler',
    '@angular/core',
    '@angular/forms',
    '@angular/platform-browser',
    '@angular/platform-browser-dynamic',
    '@angular/cdk',
    '@angular/cdk/drag-drop',
    /^@angular\/cdk\/.*$/,
    '@ng-bootstrap/ng-bootstrap',
    'rxjs',
    'rxjs/operators',
    'tabby-core',
    'tabby-terminal',
    'tabby-ssh',
    'tabby-settings',
    'electron',
    /^electron\/.*$/,
    /^@electron\/.*$/,
  ],
});
