export type MockResourceBlueprint = {
  accountAlias: string;
  provider: "aws" | "azure" | "gcp";
  resourceType: "idle_container" | "unattached_volume";
  resourceName: string;
  region: string;
  idleHours: number;
  monthlyCostCents: number;
};

export const DEFAULT_FEE_RATE_BPS = 1500;
export const DEFAULT_MIN_MONTHLY_COST_CENTS = 2500;

export const MOCK_RESOURCE_BLUEPRINTS: MockResourceBlueprint[] = [
  { accountAlias: "ATLAS-PROD", provider: "aws", resourceType: "idle_container", resourceName: "atlas-api-canary-72", region: "us-east-1", idleHours: 386, monthlyCostCents: 12840 },
  { accountAlias: "ATLAS-PROD", provider: "aws", resourceType: "unattached_volume", resourceName: "vol-0a7c9e31", region: "us-east-1", idleHours: 784, monthlyCostCents: 7620 },
  { accountAlias: "ORBIT-ANALYTICS", provider: "gcp", resourceType: "idle_container", resourceName: "orbit-etl-shadow", region: "us-central1", idleHours: 267, monthlyCostCents: 9440 },
  { accountAlias: "ORBIT-ANALYTICS", provider: "gcp", resourceType: "unattached_volume", resourceName: "pd-orbit-cache-08", region: "us-central1", idleHours: 199, monthlyCostCents: 2180 },
  { accountAlias: "NOVA-OPS", provider: "azure", resourceType: "idle_container", resourceName: "nova-agent-dr-04", region: "eastus2", idleHours: 502, monthlyCostCents: 10600 },
  { accountAlias: "NOVA-OPS", provider: "azure", resourceType: "unattached_volume", resourceName: "disk-nova-archive-13", region: "eastus2", idleHours: 931, monthlyCostCents: 4870 },
  { accountAlias: "ATLAS-STAGE", provider: "aws", resourceType: "idle_container", resourceName: "atlas-preview-ephemeral", region: "us-west-2", idleHours: 96, monthlyCostCents: 3310 },
  { accountAlias: "ORBIT-ANALYTICS", provider: "gcp", resourceType: "unattached_volume", resourceName: "pd-orbit-scratch-22", region: "europe-west1", idleHours: 422, monthlyCostCents: 6950 },
];

export function isWastefulResource(resource: Pick<MockResourceBlueprint, "idleHours" | "monthlyCostCents">, minimumMonthlyCostCents: number) {
  return resource.idleHours >= 72 && resource.monthlyCostCents >= minimumMonthlyCostCents;
}

export function calculateFeeCents(savedCents: number, feeRateBps: number) {
  return Math.round((Math.max(savedCents, 0) * Math.max(feeRateBps, 0)) / 10_000);
}

export function selectApprovedActiveItems<T extends { decision: string; resourceStatus: string }>(items: T[]) {
  return items.filter(item => item.decision === "approved" && item.resourceStatus === "active");
}

export function formatResourceType(resourceType: MockResourceBlueprint["resourceType"]) {
  return resourceType === "idle_container" ? "Idle Container" : "Unattached Volume";
}
