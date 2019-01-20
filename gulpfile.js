'use strict';
const { src, dest, parallel, series, task, watch } = require('gulp');
const 
  rename = require('gulp-rename'),
  uglify = require('gulp-uglify'),
  del = require('del'),
  nodemon = require('gulp-nodemon'),
  webpack      = require('webpack'),
  gulpWebpack  = require('webpack-stream'),
  webpackConfig = require('./webpack.config.js');
  
function clean(cb) {
  del(['build/**/*'], cb);
}
task('clean', clean);

function build() {
  return src('./src/client/zombie.js')
    .pipe(gulpWebpack(webpackConfig, webpack))
    .on('error', function(error) {
        console.error(error.message);
        this.emit('end');
    })
    .pipe(dest(webpackConfig.output.path));
}
task('build', series(clean, build));

function css() {
  return src(['./src/css/*'])
    .pipe(dest('./public/css'));
}
task('css', css);

function content() {
  return src(['./src/content/**'])
    .pipe(dest('./public/content'));
}
task('content', content);

function fonts() {
  return src(['./src/fonts/*'])
    .pipe(dest('./public/fonts'));
}
task('fonts', fonts);

const copy = parallel(css, content, fonts);
task('copy', copy);

function compress() {
  return src('./build/*.js')
    .pipe(uglify())
    .pipe(rename({suffix: '.min'}))
    .pipe(dest('./build'));
}
task('compress', series(build, compress));

function dist() {
  return src(['./build/*.js'])
    .pipe(dest('./public/js'));
}
task('dist', series(parallel(build, copy), dist));

function serve() {
  nodemon({
    watch: ['server.js', 'src', 'lib'],
    script: 'server.js',
    ext: 'html js'
  });
}
task('serve', series(dist, serve));
task('watch', () => watch('src/**/*.js', dist)); 
task('default', series(serve, watch));