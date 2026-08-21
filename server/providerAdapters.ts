import { providerDiscoveryReadiness } from "./governance.logic";

export type ProviderName = "aws" | "azure" | "gcp";

const adapterCatalog: Record<ProviderName, { inventoryTargets: string[]; requiredProfile: string }> = {
  aws: { inventoryTargets: ["EC2 instances", "EBS volumes", "ECS services"], requiredProfile: "Scoped IAM inventory role" },
  azure: { inventoryTargets: ["Virtual machines", "Managed disks", "Container apps"], requiredProfile: "Reader at resource-group scope" },
  gcp: { inventoryTargets: ["Compute Engine instances", "Persistent disks", "GKE workloads"], requiredProfile: "Custom inventory service-account role" },
};

/** A connector-gated catalog; it never decrypts browser-sealed credentials or makes provider calls. */
export function getProviderAdapterReadiness(provider: ProviderName, hasClientSealedCredential: boolean) {
  return { ...providerDiscoveryReadiness(provider, hasClientSealedCredential), ...adapterCatalog[provider] };
}
