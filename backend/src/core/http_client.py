import httpx

_client: httpx.AsyncClient | None = None


def set_http_client(client: httpx.AsyncClient):
    global _client
    _client = client


async def get_http_client() -> httpx.AsyncClient:
    if _client is None:
        raise RuntimeError("HTTP client is not initialized")
    return _client
