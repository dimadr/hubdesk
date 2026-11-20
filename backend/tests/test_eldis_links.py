import pytest
from sqlalchemy import select

from src.models.ticket import Ticket
from tests.test_dispatcher_assignment import dispatcher_case


pytestmark = pytest.mark.asyncio
OBJECT_UUID = "a3ce01b4-95f3-4292-a4f6-82634c30f4e7"
ELDIS_URL = f"https://it37.eldis24.ru/main/object/{OBJECT_UUID}"
OTHER_ELDIS_URL = "https://it37.eldis24.ru/main/object/3eac5ed9-4ee2-45f4-97dd-cc7185d56be1"


async def test_location_link_create_update_preserve_clear_and_list(dispatcher_case):
    case = dispatcher_case
    headers = case.headers(6)
    payload = {"name": "New location", "address": "Example address", "customer_id": case.customers[0].id}

    legacy = await case.client.post("/api/locations", headers=headers, json=payload)
    assert legacy.status_code == 200, legacy.text
    assert legacy.json()["eldis_url"] is None

    created = await case.client.post("/api/locations", headers=headers, json={**payload, "eldis_url": ELDIS_URL})
    assert created.status_code == 200, created.text
    assert created.json()["eldis_url"] == ELDIS_URL
    location_id = created.json()["id"]

    url = f"/api/locations/{location_id}"
    for patch, expected in (
        ({"name": "Renamed location"}, ELDIS_URL),
        ({"eldis_url": OTHER_ELDIS_URL}, OTHER_ELDIS_URL),
        ({"eldis_url": None}, None),
    ):
        updated = await case.client.patch(url, headers=headers, json=patch)
        assert updated.status_code == 200, updated.text
        assert updated.json()["eldis_url"] == expected

        listed = await case.client.get("/api/locations", headers=headers)
        assert listed.status_code == 200, listed.text
        assert next(row for row in listed.json() if row["id"] == location_id)["eldis_url"] == expected


@pytest.mark.parametrize("invalid_url", [
    f"http://it37.eldis24.ru/main/object/{OBJECT_UUID}",
    f"https://it37.eldis24.ru.evil.test/main/object/{OBJECT_UUID}",
    f"https://it37.eldis24.ru@example.test/main/object/{OBJECT_UUID}",
    f"https://it37.eldis24.ru/main/meteringPoint/{OBJECT_UUID}",
    "https://it37.eldis24.ru/main/object/12345",
    f"{ELDIS_URL}?objectID={OBJECT_UUID}",
])
async def test_location_rejects_noncanonical_eldis_urls(dispatcher_case, invalid_url):
    case = dispatcher_case
    headers = case.headers(6)
    created = await case.client.post("/api/locations", headers=headers, json={
        "name": "New location", "customer_id": case.customers[0].id, "eldis_url": invalid_url,
    })
    updated = await case.client.patch(
        f"/api/locations/{case.locations[0].id}", headers=headers, json={"eldis_url": invalid_url},
    )
    assert created.status_code == 422, created.text
    assert updated.status_code == 422, updated.text


async def test_editing_eldis_uses_existing_location_acl(dispatcher_case):
    case = dispatcher_case
    url = f"/api/locations/{case.locations[0].id}"
    data = {"eldis_url": ELDIS_URL}
    created_by_viewer = await case.client.post("/api/locations", headers=case.headers(7), json={
        "name": "New location", "customer_id": case.customers[0].id, **data,
    })
    viewer = await case.client.patch(url, headers=case.headers(7), json=data)
    other_engineer = await case.client.patch(url, headers=case.headers(3), json=data)
    assigned_engineer = await case.client.patch(url, headers=case.headers(2), json=data)
    assert created_by_viewer.status_code == 403, created_by_viewer.text
    assert viewer.status_code == 403, viewer.text
    assert other_engineer.status_code == 404, other_engineer.text
    assert assigned_engineer.status_code == 200, assigned_engineer.text
    assert assigned_engineer.json()["eldis_url"] == ELDIS_URL


async def test_ticket_reads_current_location_link_without_updating_ticket(dispatcher_case):
    case = dispatcher_case
    headers = case.headers()
    payload = case.payload(2)
    created = await case.client.post("/api/tickets", headers=headers, json=payload)
    assert created.status_code == 201, created.text
    ticket_id = created.json()["id"]
    query = select(Ticket.__table__).where(Ticket.id == ticket_id)
    async with case.factory() as db:
        before = (await db.execute(query)).one()

    for link in (None, ELDIS_URL, OTHER_ELDIS_URL, None):
        updated = await case.client.patch(
            f'/api/locations/{payload["location_id"]}', headers=headers, json={"eldis_url": link},
        )
        assert updated.status_code == 200, updated.text
        ticket = await case.client.get(f"/api/tickets/{ticket_id}", headers=headers)
        assert ticket.status_code == 200, ticket.text
        assert ticket.json()["eldis_url"] == link

    async with case.factory() as db:
        assert (await db.execute(query)).one() == before

    internal = await case.client.post("/api/tickets", headers=headers, json=case.payload(2, internal=True))
    assert internal.status_code == 201, internal.text
    detail = await case.client.get(f'/api/tickets/{internal.json()["id"]}', headers=headers)
    assert detail.status_code == 200, detail.text
    assert detail.json()["eldis_url"] is None
