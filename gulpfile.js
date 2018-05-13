'use strict';

const gulp = require('gulp'),
  rename = require('gulp-rename'),
  uglify = require('gulp-uglify'),
  del = require('del'),
  nodemon = require('gulp-nodemon'),
  args = require('yargs').argv,
  runSequence = require('run-sequence'),
  webpack      = require('webpack'),
  gulpWebpack  = require('webpack-stream'),
  webpackConfig = require('./webpack.config.js');
  
gulp.task('clean', cb => {
  del(['build/**/*'], cb);
});

gulp.task('build', ['clean'], () => {
  return gulp.src('')
      .pipe(gulpWebpack(webpackConfig, webpack))
      .on('error', function(error) {
          console.error(error.message);
          this.emit('end');
      })
      .pipe(gulp.dest(webpackConfig.output.path));
});

gulp.task('css', () => {
  return gulp.src(['./src/css/*'])
    .pipe(gulp.dest('./public/css'));
});

gulp.task('content', () => {
  return gulp.src(['./src/content/**'])
    .pipe(gulp.dest('./public/content'));
});

gulp.task('fonts', () => {
  return gulp.src(['./src/fonts/*'])
    .pipe(gulp.dest('./public/fonts'));
});

gulp.task('copy', ['css', 'content', 'fonts'], () => {});

gulp.task('compress', ['build'], () => {
  return gulp.src('./build/*.js')
    .pipe(uglify())
    .pipe(rename({suffix: '.min'}))
    .pipe(gulp.dest('./build'));
});

gulp.task('dist', ['build', 'copy'], () => {
	return gulp.src(['./build/*.js'])
		.pipe(gulp.dest('./public/js'));
});

gulp.task('watch', () => {
  gulp.watch('src/**/*.js', ['dist']);
});

gulp.task('serve', ['dist'], () => {
  nodemon({
    watch: ['server.js', 'src', 'lib'],
    script: 'server.js',
    ext: 'html js'
  });
})

gulp.task('default', () => {
  runSequence(['serve'], ['watch']);
});
