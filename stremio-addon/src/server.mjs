import { createServer } from 'node:http';
import { handleRequest } from './addon.mjs';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number.parseInt(process.env.PORT ?? '7000', 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

const server = createServer(handleRequest);

server.listen(port, host, () => {
  const publicUrl = process.env.PUBLIC_URL ?? `http://127.0.0.1:${port}`;
  console.log(`Kazumi Bridge Test: ${publicUrl}/manifest.json`);
});

function shutdown(signal) {
  console.log(`Received ${signal}; shutting down.`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
