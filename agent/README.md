# Mainframe Cloud Governor Local Agent

This operator-run agent keeps AWS and SIEM credentials **only on the operator-controlled machine**. It receives a short-lived manifest from the application, rejects expired or mutating manifests, then returns a signed receipt for manual upload. The hosted application stores the public key, manifest, and receipt but never receives a usable credential.

## Generate an Agent Identity

```bash
node agent/mainframe-local-agent.mjs keygen ~/.config/mainframe-governor/agent-private.pem
```

Copy the printed `publicKeyJwk` object into **Production Gate → Zero-Trust Local Agent Bridge**. Keep the private PEM file local and restrict its permissions.

## Agent Configuration

Create a local-only `agent-config.json` file. Do not commit it or upload it to the application.

```json
{
  "aws": { "region": "us-east-1", "profile": "mainframe-governor-readonly" },
  "siem": {
    "endpoint": "https://siem.example.com/ingest",
    "tokenHeader": "Authorization",
    "token": "Bearer replace-locally-only"
  }
}
```

The AWS profile must grant only the actions in the issued manifest: `ec2:DescribeInstances`, `ec2:DescribeVolumes`, `ecs:ListClusters`, `ecs:ListServices`, and `ecs:DescribeServices`.

## Execute a Manifest

Copy the application manifest into a local `manifest.json` file, then run:

```bash
node agent/mainframe-local-agent.mjs execute manifest.json agent-config.json ~/.config/mainframe-governor/agent-private.pem
```

Copy the `receipt` and `receiptSignature` fields from standard output into **Production Gate** to verify and store the outcome.

> The agent performs no deletion or teardown action. AWS discovery is read-only, and SIEM delivery performs a single HTTPS `POST` using the local configuration.
