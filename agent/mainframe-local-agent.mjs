#!/usr/bin/env node
import { createPrivateKey, createSign, generateKeyPairSync } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

const [command, ...args] = process.argv.slice(2);

function usage() {
  console.error("Usage: mainframe-local-agent.mjs keygen <private-key.pem> | execute <manifest.json> <agent-config.json> <private-key.pem>");
  process.exit(1);
}

function createIdentity(privateKeyPath) {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1", privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  writeFileSync(privateKeyPath, keys.privateKey, { mode: 0o600 });
  chmodSync(privateKeyPath, 0o600);
  const publicKeyJwk = createPrivateKey(keys.privateKey).export({ format: "jwk" });
  process.stdout.write(`${JSON.stringify({ publicKeyJwk }, null, 2)}\n`);
}

async function executeAwsDiscovery(manifest, config) {
  if (!config.aws?.region) throw new Error("agent-config.json requires aws.region for AWS discovery");
  if (config.aws.profile) process.env.AWS_PROFILE = config.aws.profile;
  const { EC2Client, DescribeInstancesCommand, DescribeVolumesCommand } = await import("@aws-sdk/client-ec2");
  const { ECSClient, ListClustersCommand, ListServicesCommand } = await import("@aws-sdk/client-ecs");
  const ec2 = new EC2Client({ region: config.aws.region });
  const ecs = new ECSClient({ region: config.aws.region });
  const [instances, volumes, clusters] = await Promise.all([
    ec2.send(new DescribeInstancesCommand({})),
    ec2.send(new DescribeVolumesCommand({})),
    ecs.send(new ListClustersCommand({})),
  ]);
  const clustersArns = clusters.clusterArns ?? [];
  const serviceCounts = await Promise.all(clustersArns.map(async cluster => {
    const response = await ecs.send(new ListServicesCommand({ cluster }));
    return { cluster, serviceCount: response.serviceArns?.length ?? 0 };
  }));
  return {
    jobId: manifest.jobId,
    jobType: manifest.jobType,
    status: "completed",
    completedAt: new Date().toISOString(),
    region: config.aws.region,
    inventory: {
      ec2InstanceCount: (instances.Reservations ?? []).reduce((total, reservation) => total + (reservation.Instances?.length ?? 0), 0),
      ebsVolumeCount: volumes.Volumes?.length ?? 0,
      ecsClusterCount: clustersArns.length,
      ecsServices: serviceCounts,
    },
  };
}

async function executeGenericSiemDelivery(manifest, config) {
  const endpoint = config.siem?.endpoint;
  if (!endpoint || !endpoint.startsWith("https://")) throw new Error("agent-config.json requires a HTTPS siem.endpoint");
  const body = config.siem.auditPayload ?? { schema: "mainframe-cloud-governor.audit.v1", source: "mainframe-local-agent", event_type: "agent_delivery_test", occurred_at: new Date().toISOString(), job_id: manifest.jobId };
  const headers = { "content-type": "application/json", ...(config.siem.token ? { [config.siem.tokenHeader || "Authorization"]: config.siem.token } : {}) };
  const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  return { jobId: manifest.jobId, jobType: manifest.jobType, status: response.ok ? "completed" : "failed", completedAt: new Date().toISOString(), delivery: { endpointHost: new URL(endpoint).host, httpStatus: response.status } };
}

async function executeSealedRouteEscalation(manifest, config) {
  const route = config.escalation;
  if (!manifest.incident?.alertId || !manifest.incident?.escalationProfileId || !manifest.incident?.endpointHost) throw new Error("Sealed-route manifest is missing its incident context");
  if (!route?.endpoint || !route.endpoint.startsWith("https://")) throw new Error("agent-config.json requires a HTTPS escalation.endpoint for sealed-route delivery");
  if (Number(route.profileId) !== Number(manifest.incident.escalationProfileId)) throw new Error("Refusing a sealed-route manifest for an unconfigured escalation profile");
  if (new URL(route.endpoint).host !== manifest.incident.endpointHost) throw new Error("Refusing a sealed-route manifest whose endpoint host differs from local configuration");
  const payload = { schema: "mainframe-cloud-governor.sla-breach.v1", event_type: "sla_breach_dispatch", occurred_at: new Date().toISOString(), incident_id: manifest.incident.alertId, escalation_profile_id: manifest.incident.escalationProfileId, source: "mainframe-local-agent" };
  const headers = { "content-type": "application/json", ...(route.token ? { [route.tokenHeader || "Authorization"]: route.token } : {}) };
  const response = await fetch(route.endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
  return { jobId: manifest.jobId, jobType: manifest.jobType, status: response.ok ? "completed" : "failed", completedAt: new Date().toISOString(), delivery: { endpointHost: manifest.incident.endpointHost, escalationProfileId: manifest.incident.escalationProfileId, httpStatus: response.status }, incidentId: manifest.incident.alertId };
}

function executeHealthCheck(manifest) {
  return { jobId: manifest.jobId, jobType: manifest.jobType, status: "completed", completedAt: new Date().toISOString(), health: { nodeVersion: process.version, agentIdentity: "available", manifestExpiry: "valid", signing: "available" } };
}

async function execute(manifestPath, configPath, privateKeyPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if (new Date(manifest.expiresAt).getTime() < Date.now()) throw new Error("The job manifest has expired");
  if (manifest.credentialHandling !== "agent-local-only" || manifest.mutatingActionsProhibited !== true) throw new Error("Refusing a manifest outside the zero-trust, read-only contract");
  const receipt = manifest.jobType === "health_check" ? executeHealthCheck(manifest) : manifest.jobType === "aws_read_only_discovery" ? await executeAwsDiscovery(manifest, config) : manifest.jobType === "sealed_route_escalation" ? await executeSealedRouteEscalation(manifest, config) : await executeGenericSiemDelivery(manifest, config);
  const receiptText = JSON.stringify(receipt);
  const signer = createSign("sha256"); signer.update(receiptText); signer.end();
  const receiptSignature = signer.sign(readFileSync(privateKeyPath)).toString("base64");
  process.stdout.write(`${JSON.stringify({ receipt: receiptText, receiptSignature }, null, 2)}\n`);
}

if (command === "keygen" && args.length === 1) createIdentity(args[0]);
else if (command === "execute" && args.length === 3) await execute(...args);
else usage();
