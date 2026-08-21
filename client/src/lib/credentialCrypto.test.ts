import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptCloudCredential } from "./credentialCrypto";

describe("encryptCloudCredential", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns AES-GCM cipher text and metadata without exposing the plain credential", async () => {
    vi.stubGlobal("window", {
      crypto: webcrypto,
      btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
    });
    const result = await encryptCloudCredential("mock-provider-secret-123", "operator-passphrase");
    expect(result.encryptedCredential).not.toContain("mock-provider-secret-123");
    expect(JSON.parse(result.cryptoMetadata)).toMatchObject({ algorithm: "AES-GCM", kdf: "PBKDF2", iterations: 250000 });
  });
});
