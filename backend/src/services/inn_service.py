import logging
import httpx
from ..config import settings

logger = logging.getLogger(__name__)


async def lookup_inn(inn: str, client: httpx.AsyncClient | None = None) -> dict:
    if not settings.dadata_api_key:
        return {"error": "DaData API key not configured"}

    url = "https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party"
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Token {settings.dadata_api_key}",
    }

    local_client = client or httpx.AsyncClient(timeout=10)

    try:
        response = await local_client.post(url, json={"query": inn}, headers=headers)

        if response.status_code != 200:
            logger.error(f"DaData вернул статус {response.status_code}: {response.text}")
            return {"error": f"DaData API error: {response.status_code}"}

        data = response.json()

    except httpx.HTTPError as e:
        logger.error(f"Ошибка сети при запросе к DaData: {e}", exc_info=True)
        return {"error": "Не удалось связаться с сервисом проверки ИНН"}
    finally:
        if client is None:
            await local_client.aclose()

    suggestions = data.get("suggestions", [])
    if not suggestions:
        return {"error": "Компания с таким ИНН не найдена"}

    company = suggestions[0].get("data", {})
    if not company:
        return {"error": "Не удалось прочитать данные о компании"}

    phones = company.get("phones")
    phone = phones[0].get("value") if isinstance(phones, list) and len(phones) > 0 else None

    management = company.get("management") or {}
    state = company.get("state") or {}
    name_data = company.get("name") or {}

    return {
        "name": name_data.get("full_with_opf") or company.get("value") or "Наименование не указано",
        "short_name": name_data.get("short_with_opf") or name_data.get("short") or "",
        "address": company.get("address", {}).get("value"),
        "kpp": company.get("kpp"),
        "ogrn": company.get("ogrn"),
        "phone": phone,
        "management_name": management.get("name"),
        "status": state.get("status"),
    }
