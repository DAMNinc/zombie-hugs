'use strict';

var express = require('express');
var exphbs  = require('express-handlebars');
var bodyParser = require('body-parser')

var app = express();
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

var gameId = 0;
var games = {};

app.use(express.static(__dirname + '/public'));

app.use(bodyParser.json());

app.get('/', function (req, res) {
	var gameArray = [];
  for (var key in games) {
  	gameArray.push({ gameId: key, gameName: games[key].id });
  }

	var data = { games: gameArray  };

  res.render('index', data);
});

app.get('/game', function(req, res) {
	var myId = gameId++;
	games[myId] = new Game();
	games[myId].id = myId;
	games[myId].player1 = {x: 1, y: 0};
	games[myId].player2 = {x: 0, y: 1};
	res.redirect('/game/' + myId + '?player=1');
});

app.get('/game/:game', function(req, res) {
	if (!games[req.params.game]) {
		res.redirect('/');
	} else {
		res.send('playing ' + games[req.params.game].id + '!');
	}
});

app.get('/game/:game/get', function(req, res) {
	if (!games[req.params.game]) {
		res.redirect('/');
	} else {
		res.send(games[req.params.game]);
	}
});

app.post('/game/:game/update', function(req, res) {
	if (!games[req.params.game]) {
		res.redirect('/');
	} else {
		console.log(req.body);

		var game = games[req.params.game];
		var updatedGame = req.body;

		var player = req.param("player");
		if (player == 1) {
			game.player1 = updatedGame.player1;
			game.balls1 = updatedGame.balls1;
		}

		res.send(game);
	}
});

app.get('/join/:game', function(req, res) {
	if (!games[req.params.game]) {
		res.redirect('/');
	} else {
		res.redirect('/game/' + games[req.params.game].id + '?player=2');
	}
});

var server = app.listen(3000, function () {

  var host = server.address().address;
  var port = server.address().port;

  console.log('Example app listening at http://%s:%s', host, port);

});


var Game = function() {
	// positions
	var id;
	var player1;
	var player2;

	var balls1 = [];
	var balls2 = [];
};
