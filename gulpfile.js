'use strict';

const gulp = require('gulp'),
  rename = require('gulp-rename'),
  uglify = require('gulp-uglify'),
  del = require('del'),
  nodemon = require('gulp-nodemon'),
  gutil = require('gulp-util'),
  args = require('yargs').argv,
  browserify = require('browserify'),
  source = require('vinyl-source-stream'),
  runSequence = require('run-sequence');

const mainFile = './src/client/zombie.js';

const browserifyApp = () => {
  return browserify(mainFile)
    .bundle()
    .on('error', gutil.log.bind(gutil, 'Browserify Error'))
    .pipe(source('zombie.js'))
    .pipe(gulp.dest('./build/'));
};

gulp.task('clean', cb => {
  del(['build/**/*'], cb);
});

gulp.task('build', ['clean'], () => {
	return browserifyApp();
});

gulp.task('css', () => {
  return gulp.src(['./src/css/*'])
    .pipe(gulp.dest('./public/css'));
});

gulp.task('content', () => {
  return gulp.src(['./src/content/*'])
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
