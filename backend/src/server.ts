
import dotenv from "dotenv";
import path from "node:path";
import express from "express";
import webhookRouter from "./webhook.js";
import dashboardRouter from "./dashboard.js";
import { jsonBodyParser } from "./json-body.js";

dotenv.config({
  path: path.resolve(process.cwd(), "../.env"),
});

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(jsonBodyParser);

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "hubspot-order-sync",
  });
});

app.use("/webhooks", webhookRouter);
app.use("/api", dashboardRouter);

app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
  console.log(
    `Webhook secret configured: ${Boolean(process.env.WEBHOOK_SECRET)}`,
  );
});
