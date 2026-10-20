import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { checkDatabaseConnection, closeDatabasePool } from "./db/pool.js";
import { TelemetryService } from "./telemetry/TelemetryService.js";

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3002);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const app = createApp();
const server = createServer(app);
const telemetryService = new TelemetryService(server);
app.locals.telemetryService = telemetryService;
server.listen(port, host);

checkDatabaseConnection().then((result) => {
  if (result.connected) console.log("PostgreSQL connection established.");
  else console.warn(`PostgreSQL is not connected: ${result.message}. Existing in-memory APIs remain available.`);
});

server.on("listening", () => {
  console.log(`Port backend listening at http://${host}:${port}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Cannot start backend: ${host}:${port} is already in use.`);
  } else {
    console.error("Cannot start backend:", error);
  }
  process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close((error) => {
      if (error) {
        console.error("Error while shutting down backend:", error);
        process.exitCode = 1;
      }
      closeDatabasePool().catch((poolError) => {
        console.error("Error while closing PostgreSQL pool:", poolError);
        process.exitCode = 1;
      });
      telemetryService.stop();
    });
  });
}
