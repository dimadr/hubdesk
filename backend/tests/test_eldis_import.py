import asyncio
from dataclasses import replace
import hashlib
import os
from pathlib import Path
import sys
from uuid import UUID, uuid4

import asyncpg
import pytest
import pytest_asyncio
from sqlalchemy.engine import make_url

from scripts.eldis_import import (
    ELDIS_OBJECT_URL, STRONG, EldisObject, Location, apply_report, database_locations, plan, report_content,
)
from scripts.eldis_rollback import rollback_batch


UUID_1 = UUID("10000000-0000-4000-8000-000000000001")
UUID_2 = UUID("10000000-0000-4000-8000-000000000002")
UUID_3 = UUID("10000000-0000-4000-8000-000000000003")


def target(uuid, number, name="Ромашка"):
    return EldisObject(uuid, name, f"Ивановская обл., Иваново г, Красных Зорь ул, д. {number}")


def mapping_row(location, eldis, **extra):
    return {
        "abie_id": str(location.id), "abie_name": location.name, "abie_address": location.address,
        "eldis_name": eldis.name, "eldis_address": eldis.address, "eldis_object_uuid": str(eldis.id),
        "eldis_url": f"{ELDIS_OBJECT_URL}{eldis.id}", "match_group": STRONG,
        "in_eldis_objects_csv": "да", "candidate_count": "1",
        "alternate_uuid_2": "", "alternate_uuid_3": "",
        **extra,
    }


@pytest.mark.parametrize(("scenario", "reason"), [
    ("unchanged", "verified"),
    ("weak", "not_strong"),
    ("duplicate_mapping_row", "duplicate_abie_id"),
    ("duplicate_catalogue_uuid", "uuid_conflict"),
    ("alternate_claim", "uuid_conflict"),
    ("already_assigned_elsewhere", "uuid_conflict"),
    ("invalid_link", "invalid_object_candidate"),
    ("missing_object", "invalid_object_candidate"),
    ("other_house", "address_mismatch"),
    ("duplicate_abie_address", "nonunique_address"),
    ("duplicate_eldis_address", "nonunique_address"),
    ("other_organization", "organization_uncertain"),
    ("stale_abie_name", "organization_uncertain"),
    ("already_linked", "existing_link"),
])
def test_dry_run_verifies_strong_matches_against_both_full_sources(scenario, reason):
    home = Location(1, 'ООО «Ромашка»', "г. Иваново, ул. Красных Зорь, д. 15/2", None, 0)
    eldis = target(UUID_1, "15/2")
    mapping, catalogue, locations = [mapping_row(home, eldis)], [eldis], [home]
    other = Location(2, "Ландыш", "г. Иваново, ул. Красных Зорь, 16", None, 0)
    if scenario == "weak":
        mapping[0]["match_group"] = "ВОЗМОЖНО"
    elif scenario == "duplicate_mapping_row":
        mapping.append(mapping[0].copy())
    elif scenario == "duplicate_catalogue_uuid":
        catalogue.append(eldis)
    elif scenario == "alternate_claim":
        mapping.append(mapping_row(other, target(UUID_2, 16), match_group="ВОЗМОЖНО", alternate_uuid_2=str(UUID_1)))
    elif scenario == "already_assigned_elsewhere":
        locations.append(replace(other, eldis_url=f"{ELDIS_OBJECT_URL}{UUID_1}"))
    elif scenario == "invalid_link":
        mapping[0]["eldis_url"] = f"https://example.test/main/object/{UUID_1}"
    elif scenario == "missing_object":
        catalogue.clear()
    elif scenario == "other_house":
        locations[0] = replace(home, address=home.address.replace("15/2", "15"))
    elif scenario == "duplicate_abie_address":
        locations.append(replace(other, address=eldis.address))
    elif scenario == "duplicate_eldis_address":
        catalogue.append(replace(eldis, id=UUID_2))
    elif scenario == "other_organization":
        catalogue[0] = replace(eldis, name="ИП Ромашка")
        mapping[0]["eldis_name"] = catalogue[0].name
    elif scenario == "stale_abie_name":
        locations[0] = replace(home, name="Ландыш")
    elif scenario == "already_linked":
        locations[0] = replace(home, eldis_url=f"{ELDIS_OBJECT_URL}{UUID_2}", revision=4)

    report = plan(mapping, catalogue, locations)
    assert len(report) == len(mapping)
    assert report[0].reason == reason
    assert report[0].decision == ("eligible" if reason == "verified" else "skip")
    assert report[0].new_url == f"{ELDIS_OBJECT_URL}{UUID_1}"


@pytest_asyncio.fixture
async def eldis_database():
    raw = os.getenv("HUBDESK_HIGH_TEST_DATABASE_URL")
    if not raw:
        pytest.skip("Requires isolated HUBDESK_HIGH_TEST_DATABASE_URL")
    url = make_url(raw)
    if url.host not in {"localhost", "127.0.0.1", "::1"} or url.database != "hubdesk_high_test":
        pytest.fail("Refusing to create an Eldis test database outside the local test server")
    test_name = f"hubdesk_eldis_test_{uuid4().hex}"
    control = await asyncpg.connect(url.set(drivername="postgresql").render_as_string(hide_password=False))
    await control.execute(f'CREATE DATABASE "{test_name}"')
    test_url = url.set(database=test_name)
    try:
        process = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "alembic", "upgrade", "head",
            cwd=Path(__file__).resolve().parent.parent,
            env={**os.environ, "DATABASE_URL": test_url.render_as_string(hide_password=False),
                 "SECRET_KEY": "test-only-eldis-isolated"},
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
        output, _ = await process.communicate()
        assert process.returncode == 0, output.decode()
        database = await asyncpg.connect(test_url.set(drivername="postgresql").render_as_string(hide_password=False))
        try:
            yield database
        finally:
            await database.close()
    finally:
        await control.execute(f'DROP DATABASE "{test_name}"')
        await control.close()


@pytest.mark.asyncio
async def test_approved_import_repeat_and_conditional_rollback(eldis_database):
    conn = eldis_database
    customer = await conn.fetchval("INSERT INTO customers(name, type) VALUES ('Test', 'company') RETURNING id")
    for number in range(1, 4):
        await conn.execute(
            "INSERT INTO asset_locations(customer_id, name, address, eldis_url) VALUES ($1, $2, $3, $4)",
            customer, "Ромашка", f"г. Иваново, ул. Красных Зорь, {number}",
            f"{ELDIS_OBJECT_URL}{UUID_3}" if number == 3 else None,
        )
    catalogue = [target(uuid, number) for number, uuid in enumerate((UUID_1, UUID_2, UUID_3), start=1)]
    locations = await database_locations(conn)
    mapping = [mapping_row(location, eldis) for location, eldis in zip(locations, catalogue)]
    content = report_content(plan(mapping, catalogue, locations))
    digest = hashlib.sha256(content).hexdigest()

    with pytest.raises(ValueError, match="SHA-256"):
        await apply_report(conn, mapping, catalogue, content + b"\n", digest)
    await conn.execute("UPDATE asset_locations SET name = 'Другая организация' WHERE id = $1", locations[0].id)
    with pytest.raises(ValueError, match="stale"):
        await apply_report(conn, mapping, catalogue, content, digest)
    assert await conn.fetchval("SELECT count(*) FROM eldis_link_import_changes") == 0
    await conn.execute("UPDATE asset_locations SET name = $2 WHERE id = $1", locations[0].id, locations[0].name)

    batch, applied = await apply_report(conn, mapping, catalogue, content, digest)
    assert applied == 2
    assert await apply_report(conn, mapping, catalogue, content, digest) == (batch, 0)
    assert await conn.fetchval("SELECT count(*) FROM eldis_link_import_changes WHERE batch_id = $1", batch) == 2
    assert await rollback_batch(conn, batch) == (2, 0)

    # An unrelated edit must survive rollback. A manual link edited away and
    # back must survive too, even though its current URL again equals the imported one.
    await conn.execute("UPDATE asset_locations SET name = 'Manual name' WHERE id = $1", locations[0].id)
    await conn.execute("UPDATE asset_locations SET eldis_url = NULL WHERE id = $1", locations[1].id)
    await conn.execute("UPDATE asset_locations SET eldis_url = $2 WHERE id = $1",
                       locations[1].id, f"{ELDIS_OBJECT_URL}{UUID_2}")
    assert await rollback_batch(conn, batch) == (1, 1)
    assert await rollback_batch(conn, batch, apply=True) == (1, 1)
    assert await rollback_batch(conn, batch, apply=True) == (0, 2)
    after = await database_locations(conn)
    assert after[0].name == "Manual name"
    assert after[0].eldis_url is None and after[0].revision == 2
    assert after[1].eldis_url == f"{ELDIS_OBJECT_URL}{UUID_2}" and after[1].revision == 3
    assert after[2] == locations[2]
