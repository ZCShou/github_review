const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");

module.exports = {
  apps: [
    {
      name: "tgos-review-bot",
      cwd: projectRoot,
      script: "/usr/bin/env",
      args: "start",
      interpreter: "none",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: "3456",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
