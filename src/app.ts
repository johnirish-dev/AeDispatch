import express from "express";

// The app is built here and started in server.ts, so tests can use it
// without opening a fixed port.
export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}
