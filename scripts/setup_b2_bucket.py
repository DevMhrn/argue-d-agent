"""One-shot Backblaze B2 setup: create the bucket if missing + apply CORS rules.

Browser-direct uploads via pre-signed PUT URLs require CORS on the bucket;
B2 buckets ship with NO CORS by default, which causes the browser to silently
block the upload (XHR onerror fires with no useful detail). This script wires
everything correctly, idempotently.

Run after configuring backend/.env with B2_KEY_ID / B2_APPLICATION_KEY / etc:

    .venv/bin/python -m scripts.setup_b2_bucket

Set LUMEN_FRONTEND_ORIGINS as a comma-separated env var to add production
origins (e.g. "https://lumen.vercel.app,https://app.lumen.example").
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / "backend" / ".env")

DEFAULT_DEV_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]


def make_client():
    return boto3.client(
        "s3",
        aws_access_key_id=os.environ["B2_KEY_ID"],
        aws_secret_access_key=os.environ["B2_APPLICATION_KEY"],
        region_name=os.environ["B2_REGION"],
        endpoint_url=os.environ["B2_ENDPOINT_URL"],
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
        ),
    )


def ensure_bucket(client, bucket: str) -> None:
    try:
        client.head_bucket(Bucket=bucket)
        print(f"  ✓ bucket exists: {bucket}")
    except ClientError as e:
        code = str(e.response.get("Error", {}).get("Code", ""))
        if code in ("404", "NoSuchBucket", "NotFound"):
            client.create_bucket(Bucket=bucket)
            print(f"  ✓ bucket created: {bucket}")
        else:
            raise


def ensure_cors(client, bucket: str, origins: list[str]) -> None:
    rules = {
        "CORSRules": [
            {
                "AllowedOrigins": origins,
                "AllowedMethods": ["PUT", "GET", "HEAD"],
                "AllowedHeaders": ["*"],
                "ExposeHeaders": ["ETag"],
                "MaxAgeSeconds": 3600,
            }
        ]
    }
    client.put_bucket_cors(Bucket=bucket, CORSConfiguration=rules)
    current = client.get_bucket_cors(Bucket=bucket)
    print(f"  ✓ CORS applied — origins: {origins}")
    for r in current.get("CORSRules", []):
        print(f"     {r}")


def main() -> int:
    if not os.environ.get("B2_KEY_ID"):
        print("✗ B2_KEY_ID missing — fill in backend/.env first.", file=sys.stderr)
        return 1
    bucket = os.environ["B2_BUCKET"]
    extra = os.environ.get("LUMEN_FRONTEND_ORIGINS", "").strip()
    origins = list(DEFAULT_DEV_ORIGINS)
    if extra:
        origins.extend(o.strip() for o in extra.split(",") if o.strip())

    client = make_client()
    print(f"--- Configuring bucket {bucket} ---")
    ensure_bucket(client, bucket)
    ensure_cors(client, bucket, origins)
    print("✓ B2 setup complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
