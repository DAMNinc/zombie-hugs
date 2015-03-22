'use strict';

var gulp = require('gulp');
var rename = require('gulp-rename');
var uglify = require('gulp-uglify');
var del = require('del');
var nodemon = require('gulp-nodemon');
var args = require('yargs').argv;
var browserify = require('browserify');
var source = require('vinyl-source-stream');
var watchify = require('watchify');

var mainFile = './src/client/zombie.js';

function browserifyApp(b) {
  return b.bundle()
    .pipe(source('zombie.js'))
    .pipe(gulp.dest('./build/'));
}

function watchForChangesAndBrowserify(){
  // you need to pass these three config option to browserify
  var b = browserify({
    cache: {},
    packageCache: {},
    fullPaths: true
  });
  b = watchify(b);
  b.on('update', function(){
    browserifyApp(b);
  });
  
  b.add(mainFile);
  browserifyApp(b);
}

gulp.task('clean', function (cb) {
    del(['build/**/*'], cb);
});

gulp.task('build', ['clean'], function() {
	var b = browserify({
        entries: [mainFile],
    });
	return browserifyApp(b);
});

gulp.task('css', function () {
  return gulp.src(['./src/css/*'])
    .pipe(gulp.dest('./public/css'));
});
gulp.task('content', function () {
  return gulp.src(['./src/content/*'])
    .pipe(gulp.dest('./public/content'));
});
gulp.task('fonts', function () {
  return gulp.src(['./src/fonts/*'])
    .pipe(gulp.dest('./public/fonts'));
});
gulp.task('copy', ['css','content','fonts'], function(){});

gulp.task('watch', function () {
	watchForChangesAndBrowserify();
});

gulp.task('compress', ['build'], function () {
    return gulp.src('./build/*.js')
        .pipe(uglify())
        .pipe(rename({suffix: '.min'}))
        .pipe(gulp.dest('./build'));
});

gulp.task('dist', ['build','copy'], function () {
	return gulp.src(['./build/*.js'])
		.pipe(gulp.dest('./public/js'));
});

gulp.task('serve', ['dist'], function () {
    nodemon({
        watch: ['server.js', 'src', 'lib'],
        script: 'server.js',
        ext: 'html js'
    })
    .on('change', ['dist']);
})

gulp.task('default', ['serve']);
