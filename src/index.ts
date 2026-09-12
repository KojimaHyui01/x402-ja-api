import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { ENDPOINTS } from "./x402/catalog.js";

function main(): void {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      console.error("Copy .env.example to .env and fill in PAY_TO_ADDRESS at minimum.");
      process.exit(1);
    }
    throw err;
  }

  const app = createApp(cfg);
  app.listen(cfg.PORT, () => {
    console.log(`x402-ja-api listening on http://localhost:${cfg.PORT}`);
    console.log(`  network : ${cfg.X402_NETWORK} (${cfg.networkId})`);
    console.log(`  payTo   : ${cfg.PAY_TO_ADDRESS}`);
    console.log(`  hojin   : ${cfg.HOJIN_APP_ID ? "enabled" : "disabled (HOJIN_APP_ID missing)"}`);
    for (const e of ENDPOINTS) console.log(`  ${e.price.padStart(6)}  ${e.method} ${e.path}`);
  });
}

main();
