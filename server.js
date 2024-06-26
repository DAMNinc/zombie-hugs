'use strict';

const version = require('./package.json').version;
var express = require('express');
var exphbs  = require('express-handlebars');
var bodyParser = require('body-parser');
var app = express();
var server = require('http').Server(app);
var io = require('socket.io')(server);

var logger = require('./lib/logger');
var controller = require('./lib/controller');

var hbs = exphbs.create({
  defaultLayout: 'main',
    helpers: {
      section: function(name, options) {
        if(!this._sections) this._sections = {};
        this._sections[name] = options.fn(this);
        return null;
      }
    }
});

app.engine('handlebars', hbs.engine);
app.set('view engine', 'handlebars');

app.set('port', (process.env.PORT || 3000));
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.get('/', function (req, res) {
	var data = {
    version,
    games: controller.games,
  };
  res.render('index', data);
});

app.post('/game', function(req, res) {
  var gameId = controller.newGame(req.body.gameName);
	res.redirect('/game/' + gameId);
});

app.get('/game/:game', function(req, res) {
	if (!controller.games[req.params.game]) {
    logger.verbose('Tried to join game that does not exist');
		res.redirect('/');
	} else {
    res.render('game', { layout: false, game: controller.games[req.params.game] });
	}
});

app.get('/zombies', function(req, res) {
  res.render('zombies', { version });
});

io.on('connection', function(socket) {
  controller.setupSocket(socket);
});

io.on('error', function(err) {
  logger.error(err);
});

server.listen(app.get('port'), function() {
  logger.verbose('Example app listening at ' + app.get('port'));
});

server.on('error', function(err) {
  logger.error(err);
});
