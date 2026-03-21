import { createServer } from './server';
import { formatDate, parseConfig, debounce } from './utils';
import { AppConfig, ServerOptions } from './types';

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';

function loadConfig(): AppConfig {
  const env = process.env.NODE_ENV || 'development';
  const port = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
  const host = process.env.HOST || DEFAULT_HOST;

  return {
    env: env,
    port: port,
    host: host,
    debug: env === 'development',
    version: '1.0.0',
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  console.log(`Starting app in ${config.env} mode`);
  console.log(`Server will listen on ${config.host}:${config.port}`);

  const options: ServerOptions = {
    port: config.port,
    host: config.host,
    cors: config.env === 'development',
    logging: config.debug,
  };

  const server = createServer(options);

  process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    server.close();
    process.exit(0);
  });

  const startTime = formatDate(new Date());
  console.log(`Server started at ${startTime}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
