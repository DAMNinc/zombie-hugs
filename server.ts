import express from 'express';
import { engine } from 'express-handlebars';
import bodyParser from 'body-parser';
import { createServer } from 'http';
import { Server } from 'socket.io';
import logger from './lib/logger';
import { setupSocket, games, newGame } from './lib/controller';

const version = require('./package.json').version;

const app = express();
const server = createServer(app);
const io = new Server(server);

const hbs = engine({
  defaultLayout: 'main',
  helpers: {
    section: function(this: any, name: string, options: any) {
      if(!this._sections) this._sections = {};
      this._sections[name] = options.fn(this);
      return null;
    }
  }
});

app.engine('handlebars', hbs);
app.set('view engine', 'handlebars');

app.set('port', (process.env.PORT || 3000));
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.get('/', function (req, res) {
	const data = {
    version,
    games: games,
  };
  res.render('index', data);
});

app.post('/game', function(req, res) {
  const gameId = newGame(req.body.gameName);
	res.redirect('/game/' + gameId);
});

app.get('/game/:game', function(req, res) {
	if (!games[req.params.game as any]) {
    logger.verbose('Tried to join game that does not exist');
		res.redirect('/');
	} else {
    res.render('game', { layout: false, game: games[req.params.game as any] });
	}
});

app.get('/zombies', function(req, res) {
  res.render('zombies', { version });
});

io.on('connection', function(socket) {
  setupSocket(socket);
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
