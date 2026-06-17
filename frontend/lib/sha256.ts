/**
 * SHA-256 of a Blob/File in the browser, via Web Crypto.
 *
 * The ingestion lane uses SHA-256 as the content address — the storage key is
 * `cases/{case_id}/{sha256}-{filename}` and `(case_id, sha256)` is the DB
 * uniqueness constraint that makes re-uploads idempotent. The hash MUST be
 * computed client-side (the backend never sees the file directly — it goes
 * straight to B2 via a pre-signed POST policy), so we hash here.
 *
 * Returns a lowercase hex string of length 64.
 */
export async function sha256Hex(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}
