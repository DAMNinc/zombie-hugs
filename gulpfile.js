var gulp = require('gulp');
var rename = require('gulp-rename');
var uglify = require('gulp-uglify');
var rimraf = require('gulp-rimraf');
var nodemon = require('gulp-nodemon');
var args = require('yargs').argv;
var browserify = require('browserify');
var source = require('vinyl-source-stream');
var watchify = require('watchify');

var mainFile = './src/client/zombie.js';

gulp.task('clean', function () {
    return gulp.src(['build/**/*'], {read: false})
        .pipe(rimraf());
});

gulp.task('build', ['clean'], function() {
	var b = browserify({
             entries: [mainFile],
         });
	return browserifyApp(b);
});

gulp.task('watch', function () {
	watchForChangesAndBrowserify();
});

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

function browserifyApp(b) {
  return b.bundle()
    .pipe(source('zombie.js'))
    .pipe(gulp.dest('./build/'));
}

gulp.task('compress', ['build'], function () {
    return gulp.src('./build/*.js')
        .pipe(uglify())
        .pipe(rename({suffix: '.min'}))
        .pipe(gulp.dest('./build'));
});

gulp.task('copy-files', ['build'], function () {
	return gulp.src(['./build/*.js'])
		.pipe(gulp.dest('./js'));
});

gulp.task('serve', ['copy-files'], function () {
    nodemon({
        watch: ['src'],
        script: 'server.js',
        ext: 'html js'
    })
        .on('change', ['copy-files'])
        .on('restart', function () {
            console.log('restarted!')
        })
})

gulp.task('default', ['serve']);
