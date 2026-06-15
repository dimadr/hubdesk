import httpx
from ..config import settings


async def lookup_inn(inn: str) -> dict:
    if not settings.dadata_api_key:
        return {"error": "DaData API key not configured"}

    url = "https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party"
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Token {settings.dadata_api_key}",
    }

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(url, json={"query": inn}, headers=headers)

    if response.status_code != 200:
        return {"error": f"DaData API error: {response.status_code}"}

    data = response.json()
    suggestions = data.get("suggestions", [])
    if not suggestions:
        return {"error": "Компания с таким ИНН не найдена"}

    company = suggestions[0]["data"]
    phones = company.get("phones")
    phone = phones[0].get("value") if phones else None
    return {
        "name": company.get("name", {}).get("full_with_opf") or company.get("value"),
        "address": company.get("address", {}).get("value"),
        "kpp": company.get("kpp"),
        "ogrn": company.get("ogrn"),
        "phone": phone,
        "management_name": company.get("management", {}).get("name") if company.get("management") else None,
        "status": company.get("state", {}).get("status") if company.get("state") else None,
    }
