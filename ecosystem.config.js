module.exports = {
  apps: [
    {
      name: "gozz-frontend",
      cwd: "/root/gozz-crm/apps/frontend",
      script: "/root/gozz-crm/apps/frontend/.next/standalone/apps/frontend/server.js",
      interpreter: "node",
      env: { NODE_ENV: "production", PORT: "3100", HOSTNAME: "0.0.0.0" },
      max_memory_restart: "800M",
      min_uptime: "15s",
      max_restarts: 10,
      error_file: "/root/gozz-crm/logs/frontend-err.log",
      out_file: "/root/gozz-crm/logs/frontend-out.log"
    },
    {
      name: "gozz-api",
      cwd: "/root/gozz-crm/apps/api",
      script: "pnpm",
      args: "start",
      interpreter: "none",
      env: { NODE_ENV: "production", PORT: "4100" },
      max_memory_restart: "1G",
      error_file: "/root/gozz-crm/logs/api-err.log",
      out_file: "/root/gozz-crm/logs/api-out.log"
    },
    {
      // email-sync aislado: un flap del mailserver NO puede tumbar gozz-api. Ver apps/api/src/email-worker.ts
      name: "gozz-email-worker",
      cwd: "/root/gozz-crm/apps/api",
      script: "/root/gozz-crm/apps/api/dist/email-worker.js",
      interpreter: "node",
      env: { NODE_ENV: "production" },
      max_memory_restart: "400M",
      min_uptime: "15s",
      max_restarts: 10,
      error_file: "/root/gozz-crm/logs/email-worker-err.log",
      out_file: "/root/gozz-crm/logs/email-worker-out.log"
    },
    {
      name: "gozz-ai",
      cwd: "/root/gozz-crm/apps/ai",
      script: "/root/gozz-crm/apps/ai/venv/bin/uvicorn",
      args: "main:app --host 0.0.0.0 --port 8100",
      interpreter: "none",
      env: { PYTHONUNBUFFERED: "1" },
      max_memory_restart: "800M",
      error_file: "/root/gozz-crm/logs/ai-err.log",
      out_file: "/root/gozz-crm/logs/ai-out.log"
    },
    {
      name: "gozz-livekit",
      script: "/usr/local/bin/livekit-server",
      args: "--config /root/gozz-crm/livekit.yaml",
      interpreter: "none",
      env: { GIN_MODE: "release" },
      max_memory_restart: "800M",
      error_file: "/root/gozz-crm/logs/livekit-err.log",
      out_file: "/root/gozz-crm/logs/livekit-out.log"
    }
  ]
};
