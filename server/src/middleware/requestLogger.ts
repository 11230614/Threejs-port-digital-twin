import { randomUUID } from "node:crypto";

export function requestLogger(req, res, next) {
  req.requestId = randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  const path = req.originalUrl.split("?", 1)[0];
  const startedAt = process.hrtime.bigint();

  res.once("finish", () => {
    const duration = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log(JSON.stringify({
      requestId: req.requestId,
      method: req.method,
      path,
      status: res.statusCode,
      duration: Number(duration.toFixed(2)),
    }));
  });

  next();
}
