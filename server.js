'use strict';

var express = require('express');
var exphbs  = require('express-handlebars');
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

app.get('/', function (req, res) {
	var gameArray = [];
  for (var key in games) {
  	gameArray.push({ gameId: key, gameName: games[key] });
  }

	var data = { games: gameArray  };

  res.render('index', data);
});

app.get('/game', function(req, res) {
	var myId = gameId++;
	games[myId] = "hest" + myId;
	res.redirect('/game/' + myId);
});

app.get('/game/:game', function(req, res) {
	if (!games[req.params.game]) {
		res.redirect('/');
	} else {
        res.render('game', {game: games[req.params.game]});
	}
});

var server = app.listen(3000, function () {

  var host = server.address().address;
  var port = server.address().port;

  console.log('Example app listening at http://%s:%s', host, port);

});
