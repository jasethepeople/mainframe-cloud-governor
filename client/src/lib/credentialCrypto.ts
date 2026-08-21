const encoder = new TextEncoder();

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let value = "";
  bytes.forEach(byte => { value += String.fromCharCode(byte); });
  return window.btoa(value);
}

/** Encrypts a provider credential in the browser; only cipher text and metadata leave the client. */
export async function encryptCloudCredential(credential: string, passphrase: string) {
  if (!window.crypto?.subtle) throw new Error("Web Crypto is unavailable in this browser");
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await window.crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" }, baseKey,
    { name: "AES-GCM", length: 256 }, false, ["encrypt"],
  );
  const cipherText = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(credential));
  return {
    encryptedCredential: toBase64(cipherText),
    cryptoMetadata: JSON.stringify({ algorithm: "AES-GCM", kdf: "PBKDF2", hash: "SHA-256", iterations: 250000, salt: toBase64(salt.buffer), iv: toBase64(iv.buffer) }),
  };
}
