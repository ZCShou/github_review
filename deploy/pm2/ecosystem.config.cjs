module.exports = {
  apps: [
    {
      name: "tgos-review-bot",
      cwd: "/opt/tgos-review-bot",
      script: "npm",
      args: "start",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: "3456",
      },
      error_file: "/var/log/pm2/tgos-review-bot-error.log",
      out_file: "/var/log/pm2/tgos-review-bot-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
