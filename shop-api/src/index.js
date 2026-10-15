// shop-api: a tiny shop backend that ReleaseGuard deploys and watches.
import express from "express";
import client from "prom-client";

const app = express();
app.use(express.json());

const VERSION = process.env.APP_VERSION || "dev";
const PORT = process.env.PORT || 3000;

// payments now go through the gateway, must be configured per environment
const PAYMENT_GATEWAY_URL = process.env.PAYMENT_GATEWAY_URL;
if (!PAYMENT_GATEWAY_URL) {
  console.error("FATAL: PAYMENT_GATEWAY_URL is not set");
  process.exit(1);
}

// ---------- metrics (what Prometheus scrapes) ----------
const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

const httpRequests = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status"],
  registers: [registry],
});

const httpDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency in seconds",
  labelNames: ["method", "route"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [registry],
});

// count + time every request
app.use((req, res, next) => {
  const end = httpDuration.startTimer({ method: req.method, route: req.path });
  res.on("finish", () => {
    httpRequests.inc({ method: req.method, route: req.path, status: res.statusCode });
    end();
  });
  next();
});

// ---------- routes ----------
const products = [
  { id: 1, name: "Keyboard", price: 1999 },
  { id: 2, name: "Mouse", price: 799 },
  { id: 3, name: "Monitor", price: 12999 },
  { id: 4, name: "Webcam", price: 2499 },
];

app.get("/health", (_req, res) => {
  res.json({ status: "ok", version: VERSION, uptime: process.uptime() });
});

app.get("/products", (_req, res) => {
  res.json(products);
});

app.get("/products/:id", (req, res) => {
  const product = products.find((p) => p.id === Number(req.params.id));
  if (!product) return res.status(404).json({ error: "product not found" });
  res.json(product);
});

app.post("/checkout", (req, res) => {
  const { productId = 1, qty = 1 } = req.body || {};
  const product = products.find((p) => p.id === Number(productId));
  if (!product) return res.status(404).json({ error: "product not found" });

  const amount = product.price * Number(qty);

  // Diwali sale: 30% of users are in the coupon experiment bucket
  const coupon = req.body.coupon;
  if (coupon && Math.random() < 0.3) {
    const discount = Number(coupon.percent || 0) / 100;
    return res.json({ orderId: Math.floor(Math.random() * 1e6), amount: amount * (1 - discount), version: VERSION });
  }
  res.json({ orderId: Math.floor(Math.random() * 1e6), amount, version: VERSION });
});

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", registry.contentType);
  res.end(await registry.metrics());
});

app.listen(PORT, () => {
  console.log(`shop-api ${VERSION} listening on :${PORT}`);
});
