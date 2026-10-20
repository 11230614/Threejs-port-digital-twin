export function errorHandler(error, req, res, _next) {
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
    ? error.status
    : 500;

  if (status >= 500) {
    console.error(`[${req.requestId}]`, error);
  }

  const code = error.code
    ?? (status === 400 ? "BAD_REQUEST" : status === 413 ? "PAYLOAD_TOO_LARGE" : "INTERNAL_ERROR");
  const message = error.message
    ?? (status === 404
      ? "接口不存在"
      : status === 400
        ? "请求参数无效"
      : status === 413
        ? "请求体过大"
        : status >= 500
          ? "服务器内部错误"
          : "请求失败");

  res.status(status).json({
    error: {
      code,
      message,
      requestId: req.requestId,
    },
  });
}
