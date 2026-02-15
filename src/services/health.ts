export interface HealthDetails {
  service: string;
  status: "ok";
  nodeVersion: string;
  timestamp: string;
  contracts: {
    taskLifecycle: string;
    gatewayApi: string;
    agentAdapter: string;
    auditLog: string;
  };
  sandbox: {
    image: string;
    defaultTestCommand: string;
    allowedTestCommands: string[];
  };
}

export function getHealthDetails(): HealthDetails {
  const sandboxImage = process.env.SANDBOX_IMAGE ?? "node:22-bookworm-slim";
  const defaultTestCommand = process.env.DEFAULT_TEST_COMMAND ?? "npm test";
  const allowedTestCommands = (process.env.ALLOWED_TEST_COMMANDS ?? "npm test")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  return {
    service: "okaydokki",
    status: "ok",
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
    contracts: {
      taskLifecycle: "v1",
      gatewayApi: "v1",
      agentAdapter: "v1",
      auditLog: "v1.0"
    },
    sandbox: {
      image: sandboxImage,
      defaultTestCommand,
      allowedTestCommands
    }
  };
}
