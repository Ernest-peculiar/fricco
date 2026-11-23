import { config, validateConfig } from './src/config.js';
import { createApp } from './src/app.js';

validateConfig();
const { app } = await createApp(config);

const server = app.listen(config.port, () => {
  console.log(`${config.siteName} is running at http://localhost:${config.port}`);
  console.log(`Payments: ${config.paymentProvider}${config.paymentProvider === 'simulated' ? ' (no real money moves)' : ''}`);
  console.log(`Admin login: ${config.adminEmail}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
