import test from "node:test";
import assert from "node:assert/strict";
import { getHealthDetails } from "../src/services/health.js";

test("health details exposes non-sensitive runtime metadata", () => {
  const details = getHealthDetails();
  assert.equal(details.service, "okaydokki");
  assert.equal(details.status, "ok");
  assert.match(details.nodeVersion, /^v\d+/);
  assert.equal(details.contracts.auditLog, "v1.0");
  assert.ok(Array.isArray(details.sandbox.allowedTestCommands));
  assert.ok(details.sandbox.allowedTestCommands.length > 0);
});

