"""Object-storage adapter for raw uploaded files.

The default backend is Backblaze B2 via the S3-compatible API. boto3 with a
custom `endpoint_url` works unchanged. Three operations the ingestion
pipeline actually uses:

    sign_upload(key, mime_type, ...)  -> SignedUpload (pre-signed POST policy)
    sign_download(key, ...)           -> short-lived GET URL
    head(key)                         -> object metadata or None if not found
    download(key)                     -> bytes (worker fetches files this way)

We use sync boto3 (not aioboto3) on purpose:
  - boto3 calls are fast (HEAD, presign, get_object).
  - The extraction worker uses sync libraries (pdfplumber, python-docx) anyway.
  - aioboto3 has fewer maintainers and more bugs.
  - Bridging into async happens via `asyncio.to_thread(...)` at the call site.

Credentials come from env (see backend/.env section 6):
  B2_KEY_ID, B2_APPLICATION_KEY, B2_REGION, B2_BUCKET, B2_ENDPOINT_URL.
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any, Optional

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError


@dataclass(frozen=True)
class StorageConfig:
    """Storage configuration sourced from environment variables."""

    key_id: str
    application_key: str
    region: str
    bucket: str
    endpoint_url: str

    @classmethod
    def from_env(cls) -> "StorageConfig":
        required = ("B2_KEY_ID", "B2_APPLICATION_KEY", "B2_BUCKET")
        missing = [name for name in required if not os.environ.get(name)]
        if missing:
            raise RuntimeError(
                f"Missing storage env vars: {missing}. See backend/.env section 6."
            )
        return cls(
            key_id=os.environ["B2_KEY_ID"],
            application_key=os.environ["B2_APPLICATION_KEY"],
            region=os.environ.get("B2_REGION", "us-east-005"),
            bucket=os.environ["B2_BUCKET"],
            endpoint_url=os.environ.get(
                "B2_ENDPOINT_URL",
                "https://s3.us-east-005.backblazeb2.com",
            ),
        )


@dataclass(frozen=True)
class SignedUpload:
    """Everything the browser needs to POST a file directly to object storage."""

    url: str
    fields: dict[str, str]   # form fields the browser must include
    key: str
    expires_at_unix: int


class ObjectStorage:
    """Thin wrapper over the S3-compatible Backblaze client."""

    def __init__(self, config: Optional[StorageConfig] = None) -> None:
        self._config = config or StorageConfig.from_env()
        # Path-style addressing is required for B2's S3 endpoint.
        self._client = boto3.client(
            "s3",
            aws_access_key_id=self._config.key_id,
            aws_secret_access_key=self._config.application_key,
            region_name=self._config.region,
            endpoint_url=self._config.endpoint_url,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )

    @property
    def bucket(self) -> str:
        return self._config.bucket

    def sign_upload(
        self,
        key: str,
        mime_type: str,
        *,
        expires_in: int = 300,
        max_size_bytes: int = 50 * 1024 * 1024,
    ) -> SignedUpload:
        """Return a pre-signed POST policy so the browser can upload directly.

        The browser must POST as multipart/form-data with `fields` first and the
        file as the last form field named "file". Conditions enforce size limit
        and exact content-type match — uploads outside these are rejected by B2.
        """
        response = self._client.generate_presigned_post(
            Bucket=self._config.bucket,
            Key=key,
            Fields={"Content-Type": mime_type},
            Conditions=[
                {"Content-Type": mime_type},
                ["content-length-range", 1, max_size_bytes],
            ],
            ExpiresIn=expires_in,
        )
        return SignedUpload(
            url=response["url"],
            fields=response["fields"],
            key=key,
            expires_at_unix=int(time.time()) + expires_in,
        )

    def sign_download(self, key: str, *, expires_in: int = 3600) -> str:
        """Return a short-lived GET URL for reading a stored object."""
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._config.bucket, "Key": key},
            ExpiresIn=expires_in,
        )

    def head(self, key: str) -> Optional[dict[str, Any]]:
        """Return object metadata, or None if the object doesn't exist.

        Used by the commit endpoint to confirm a file was actually uploaded
        before transitioning its status from 'pending' to 'uploaded'.
        """
        try:
            response = self._client.head_object(
                Bucket=self._config.bucket, Key=key
            )
            return {
                "content_length": response.get("ContentLength"),
                "content_type": response.get("ContentType"),
                "etag": response.get("ETag"),
                "last_modified": response.get("LastModified"),
            }
        except ClientError as e:
            # B2 returns 404 for missing objects.
            if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return None
            raise

    def download(self, key: str) -> bytes:
        """Fetch the full object bytes. Used by the extraction worker."""
        response = self._client.get_object(
            Bucket=self._config.bucket, Key=key
        )
        return response["Body"].read()
