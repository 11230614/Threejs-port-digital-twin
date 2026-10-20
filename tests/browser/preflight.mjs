const frontendUrl = process.env.FRONTEND_URL ?? "http://127.0.0.1:5173";
const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:3002";

async function check(label, url) {
  try {
    const response = await fetch(url);
    const body = await response.text();
    console.log(`${label}: HTTP ${response.status} ${url}`);
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    console.error(`${label}: connection failed ${url}: ${error.message}`);
    return { ok: false, status: 0, body: "" };
  }
}

const frontend = await check("frontend", frontendUrl);
const backendHealth = await check("backend health", `${backendUrl}/api/health`);
const proxyHealth = await check("vite proxy health", `${frontendUrl}/api/health`);
const devices = await check("devices API", `${frontendUrl}/api/devices`);
const tasks = await check("tasks API", `${frontendUrl}/api/tasks?page=1&pageSize=50`);

const result = { frontend: frontend.ok, backendHealth: backendHealth.ok, proxyHealth: proxyHealth.ok, devices: devices.ok, tasks: tasks.ok };
console.log(`preflight summary: ${JSON.stringify(result)}`);
if (!frontend.ok || !backendHealth.ok || !proxyHealth.ok || !devices.ok || !tasks.ok) process.exitCode = 1;
