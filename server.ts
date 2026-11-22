import logger from './lib/logger';
import { createServer } from './lib/app';

const { server } = createServer();
const port = process.env.PORT || 3000;

server.listen(port, () => {
  logger.verbose('Example app listening at ' + port);
});

server.on('error', (err: Error) => {
  logger.error(err);
});
