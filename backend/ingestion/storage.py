"""Object-storage adapter for raw uploaded files.

The default backend is Backblaze B2 via the S3-compatible API. Surfaces only
two operations the ingestion pipeline needs:

    sign_upload(key, mime_type, expires_in=300)  -> dict for direct browser upload
    sign_download(key, expires_in=3600)          -> short-lived URL for reading

Implementation note: Backblaze B2 supports the S3 API at
    https://s3.<region>.backblazeb2.com
which means boto3 (or aioboto3) with custom `endpoint_url` works unchanged.
Credentials come from env: B2_KEY_ID, B2_APPLICATION_KEY, B2_REGION, B2_BUCKET,
B2_ENDPOINT_URL.

This is a stub — the real client is wired in once credentials arrive.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional


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
        return cls(
            key_id=os.environ["B2_KEY_ID"],
            application_key=os.environ["B2_APPLICATION_KEY"],
            region=os.environ.get("B2_REGION", "us-west-002"),
            bucket=os.environ["B2_BUCKET"],
            endpoint_url=os.environ.get(
                "B2_ENDPOINT_URL",
                "https://s3.us-west-002.backblazeb2.com",
            ),
        )


@dataclass(frozen=True)
class SignedUpload:
    """Everything the browser needs to POST a file directly to object storage."""

    url: str
    fields: dict[str, str]  # form-data fields if the upload uses POST policy
    key: str
    expires_at_unix: int


class ObjectStorage:
    """Thin wrapper over the S3-compatible Backblaze client.

    Stubbed in this commit; real boto3 wiring lands once B2 credentials exist.
    Each method documents the intended behavior so callers can be written first.
    """

    def __init__(self, config: Optional[StorageConfig] = None) -> None:
        self._config = config or StorageConfig.from_env()

    def sign_upload(
        self,
        key: str,
        mime_type: str,
        *,
        expires_in: int = 300,
        max_size_bytes: int = 50 * 1024 * 1024,
    ) -> SignedUpload:
        """Return a pre-signed POST policy so the browser can PUT directly.

        TODO: implement with boto3 generate_presigned_post().
        """
        raise NotImplementedError("Object storage not yet wired — pending B2 credentials.")

    def sign_download(self, key: str, *, expires_in: int = 3600) -> str:
        """Return a short-lived GET URL for reading a stored object.

        TODO: implement with boto3 generate_presigned_url('get_object').
        """
        raise NotImplementedError("Object storage not yet wired — pending B2 credentials.")

    def head(self, key: str) -> Optional[dict]:
        """Return metadata for an object, or None if it does not exist.

        Used by the commit endpoint to confirm a file was actually uploaded
        before transitioning its status from 'pending' to 'uploaded'.
        """
        raise NotImplementedError("Object storage not yet wired — pending B2 credentials.")
