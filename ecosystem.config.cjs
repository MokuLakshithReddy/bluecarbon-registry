module.exports = {
  apps: [
    {
      name: "bluecarbon-outbox-worker",
      script: "src/workers/outbox-worker.ts",
      interpreter: "node",
      interpreter_args: "--experimental-strip-types",
      instances: 1, // FOR UPDATE SKIP LOCKED supports horizontal scaling; start with 1 per node
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
        WORKER_HEALTH_PORT: 9090,
      },
    },
  ],
};
