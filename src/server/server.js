var express = require('express')
var app = express()

var gameId = 0;
var games = {};

app.get('/', function (req, res) {
  res.send('<a href="/game">New game</a>');
});

app.get('/game', function(req, res) {
	var myId = gameId++;
	games[myId] = "hest" + myId;
	res.redirect('/game/' + myId);
});

app.get('/game/:game', function(req, res) {
	res.send('playing ' + req.params.game + '!');
});

var server = app.listen(3000, function () {

  var host = server.address().address
  var port = server.address().port

  console.log('Example app listening at http://%s:%s', host, port)

});