import path from 'path';
import fs from 'fs';
import express from 'express';
import { create } from 'express-handlebars';
import http from 'http';
import { Server } from 'socket.io';
import logger from './lib/logger';
import controller from './lib/controller';

const PROJECT_ROOT = process.cwd();

if (!fs.existsSync(path.join(PROJECT_ROOT, 'package.json'))) {
  throw new Error(`package.json not found in ${PROJECT_ROOT}. Server must be started from the project root.`);
}

const pkg = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8')
);
const version: string = pkg.version;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const hbs = create({
  defaultLayout: 'main',
  helpers: {
    section(this: any, name: string, options: any) {
      if (!this._sections) this._sections = {};
      this._sections[name] = options.fn(this);
      return null;
    },
  },
});

app.engine('handlebars', hbs.engine);
app.set('view engine', 'handlebars');
app.set('views', path.join(PROJECT_ROOT, 'views'));

app.set('port', process.env.PORT || 3000);
app.use(express.static(path.join(PROJECT_ROOT, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/', (_req, res) => {
  const data = {
    version,
    games: controller.games,
  };
  res.render('index', data);
});

app.post('/game', (req, res) => {
  const gameId = controller.newGame(req.body.gameName);
  res.redirect('/game/' + gameId);
});

app.get('/game/:game', (req, res) => {
  const gameId = Number(req.params.game);
  if (!controller.games[gameId]) {
    logger.verbose('Tried to join game that does not exist');
    res.redirect('/');
  } else {
    res.render('game', { layout: false, game: controller.games[gameId] });
  }
});

app.get('/zombies', (_req, res) => {
  res.render('zombies', { version });
});

io.on('connection', (socket) => {
  controller.setupSocket(socket);
});

io.on('error', (err: Error) => {
  logger.error(err);
});

server.listen(app.get('port'), () => {
  logger.verbose('Example app listening at ' + app.get('port'));
});

server.on('error', (err: Error) => {
  logger.error(err);
});
