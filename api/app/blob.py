import asyncio

from vercel import blob


def upload_private_pdf(pathname: str, data: bytes) -> str:
    result = asyncio.run(
        blob.put_blob(
            pathname,
            data,
            access="private",
            content_type="application/pdf",
            add_random_suffix=False,
            allow_overwrite=False,
        )
    )
    return result.url


def download_private(url: str) -> tuple[bytes, str]:
    result = asyncio.run(blob.get_blob(url, access="private"))
    content_type = getattr(result.metadata, "content_type", None) or "application/pdf"
    return result.body, content_type
