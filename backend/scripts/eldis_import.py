"""Plan an Eldis link import and apply only an explicitly approved plan."""

import argparse
import asyncio
from collections import Counter, defaultdict
import csv
from dataclasses import dataclass
import hashlib
import io
import os
from pathlib import Path
import re
import unicodedata
from uuid import NAMESPACE_URL, UUID, uuid5

import asyncpg


ELDIS_OBJECT_URL = "https://it37.eldis24.ru/main/object/"
STRONG = "СИЛЬНЫЙ КАНДИДАТ — проверить"
FIELDS = (
    "abie_id", "eldis_object_uuid", "previous_url", "new_url", "decision", "reason",
    "previous_revision",
)
ADDRESS_WORDS = {
    "г": "город", "гор": "город", "ул": "улица", "пер": "переулок",
    "просп": "проспект", "пр-т": "проспект", "пл": "площадь",
    "пр-д": "проезд", "ш": "шоссе", "наб": "набережная", "мкр": "микрорайон",
    "с": "село", "дер": "деревня", "пос": "поселок", "п": "поселок",
    "р-н": "район", "корп": "корпус", "стр": "строение",
}
ADDRESS_PREFIXES = set(ADDRESS_WORDS.values()) - {"корпус", "строение"}
LEGAL_FORMS = {"ип", "ао", "ооо", "оао", "пао", "зао", "нко", "тсж", "тсн"}


@dataclass(frozen=True)
class Location:
    id: int
    name: str
    address: str
    eldis_url: str | None
    revision: int


@dataclass(frozen=True)
class EldisObject:
    id: UUID
    name: str
    address: str


@dataclass(frozen=True)
class Decision:
    abie_id: int
    eldis_object_uuid: str
    previous_url: str | None
    new_url: str | None
    decision: str
    reason: str
    previous_revision: int


def read_csv(path, required):
    with path.open(encoding="utf-8-sig", newline="") as source:
        rows = csv.DictReader(source, strict=True)
        if rows.fieldnames is None or not required <= set(rows.fieldnames):
            raise ValueError(f"Missing required columns in {path.name}")
        if len(rows.fieldnames) != len(set(rows.fieldnames)):
            raise ValueError(f"Duplicate column names in {path.name}")
        result = list(rows)
        if not result or any(None in row or None in row.values() for row in result):
            raise ValueError(f"Missing or malformed CSV rows in {path.name}")
        return result


def read_mapping(path):
    return read_csv(path, {
        "abie_id", "abie_name", "abie_address", "match_group", "eldis_object_uuid",
        "eldis_name", "eldis_address", "eldis_url", "in_eldis_objects_csv", "candidate_count",
        "alternate_uuid_2", "alternate_uuid_3",
    })


def read_catalogue(path):
    rows = read_csv(path, {"id", "name", "address"})
    return [EldisObject(UUID(row["id"]), row["name"], row["address"]) for row in rows]


def read_snapshot(path):
    rows = read_csv(path, {"id", "name", "address"})
    columns = set(rows[0])
    if len({"eldis_url", "eldis_url_revision"} & columns) == 1:
        raise ValueError("Snapshot must contain both Eldis state columns or neither")
    return [
        Location(int(row["id"]), row["name"], row["address"], row.get("eldis_url") or None,
                 int(row.get("eldis_url_revision") or 0))
        for row in rows
    ]


def normalized_text(value):
    return " ".join(unicodedata.normalize("NFKC", value).casefold().replace("ё", "е").split())


def address_key(value):
    address = normalized_text(value)
    address = re.sub(r"(?<=\d)\s*([/-])\s*(?=\d)", r"\1", address)
    parts = []
    for part in re.split(r"[,;]", address):
        words = re.findall(r"[a-zа-я0-9]+(?:[-/][a-zа-я0-9]+)*", part)
        if not words or words in (["ивановская", "обл"], ["ивановская", "область"]):
            continue
        if not parts and len(words) == 1 and re.fullmatch(r"\d{6}", words[0]):
            continue
        if len(words) > 1 and words[0] in ("д", "дом") and words[1][0].isdigit():
            words = words[1:]
        words = [ADDRESS_WORDS.get(word, word) for word in words]
        # FIAS exports can place the type at the end of each comma-delimited component.
        if len(words) > 1 and words[0] not in ADDRESS_PREFIXES and words[-1] in ADDRESS_PREFIXES:
            words = words[-1:] + words[:-1]
        parts.append(tuple(words))
    return tuple(parts)


def name_key(name):
    return tuple(re.findall(r"[a-zа-я0-9]+", normalized_text(name)))


def comparable_names(abie_name, eldis_name):
    abie_words = name_key(abie_name)
    eldis_words = name_key(eldis_name)
    abie_forms, eldis_forms = set(abie_words) & LEGAL_FORMS, set(eldis_words) & LEGAL_FORMS
    if abie_forms and eldis_forms and abie_forms != eldis_forms:
        return False
    abie_identity = tuple(word for word in abie_words if word not in LEGAL_FORMS)
    eldis_identity = tuple(word for word in eldis_words if word not in LEGAL_FORMS)
    return bool(abie_identity) and abie_identity == eldis_identity


def snapshot_name_matches(expected, actual):
    marker = "[фио скрыто]"
    expected, actual = normalized_text(expected), normalized_text(actual)
    if marker not in expected:
        return expected == actual
    # The supplied ABIE export redacts personal names. Match all its public text
    # and verify the actual organization name separately against the catalogue.
    pattern = ".+".join(re.escape(part) for part in expected.split(marker))
    return re.fullmatch(pattern, actual) is not None


def object_uuid(value):
    if not re.fullmatch(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", value.strip()):
        return None
    value = UUID(value.strip())
    return value if value.int else None


def assess(row, location, target, target_id, unique_ids, unique_uuid, unique_address, assigned_elsewhere):
    if row["match_group"].strip() != STRONG:
        return "skip", "not_strong"
    if not unique_ids:
        return "skip", "duplicate_abie_id"
    if location is None:
        return "skip", "abie_not_found"
    if location.eldis_url and location.eldis_url.strip():
        return "skip", "existing_link"
    if (
        target_id is None or target is None
        or normalized_text(row["in_eldis_objects_csv"]) != "да"
        or row["candidate_count"].strip() != "1"
        or any(row[key].strip() for key in ("alternate_uuid_2", "alternate_uuid_3"))
        or row["eldis_url"].strip() != f"{ELDIS_OBJECT_URL}{target_id}"
    ):
        return "skip", "invalid_object_candidate"
    if not unique_uuid or assigned_elsewhere:
        return "skip", "uuid_conflict"
    key = address_key(location.address)
    if (
        not key or not re.fullmatch(r"\d+[а-яa-z]?(?:[-/]\d+[а-яa-z]?)*", key[-1][0])
        or key != address_key(target.address)
        or key != address_key(row["abie_address"])
        or key != address_key(row["eldis_address"])
    ):
        return "skip", "address_mismatch"
    if not unique_address:
        return "skip", "nonunique_address"
    if (
        not snapshot_name_matches(row["abie_name"], location.name)
        or normalized_text(row["eldis_name"]) != normalized_text(target.name)
        or not comparable_names(location.name, target.name)
    ):
        return "skip", "organization_uncertain"
    return "eligible", "verified"


def plan(mapping, catalogue, locations):
    location_by_id = {location.id: location for location in locations}
    if len(location_by_id) != len(locations) or any(location.id <= 0 or location.revision < 0 for location in locations):
        raise ValueError("Nonunique or invalid IDs or revisions in the ABIE source")
    eldis_by_id = {target.id: target for target in catalogue}
    eldis_ids = Counter(target.id for target in catalogue)
    abie_addresses = Counter(address_key(location.address) for location in locations)
    eldis_addresses = Counter(address_key(target.address) for target in catalogue)
    mapping_ids = Counter(int(row["abie_id"]) for row in mapping)
    if any(location_id <= 0 for location_id in mapping_ids):
        raise ValueError("Invalid ABIE ID in the mapping")
    uuid_claims = defaultdict(set)
    assigned = defaultdict(set)
    for row in mapping:
        for field in ("eldis_object_uuid", "alternate_uuid_2", "alternate_uuid_3"):
            if candidate_id := object_uuid(row[field]):
                uuid_claims[candidate_id].add(int(row["abie_id"]))
    for location in locations:
        if location.eldis_url and location.eldis_url.strip().lower().startswith(ELDIS_OBJECT_URL):
            if assigned_id := object_uuid(location.eldis_url.strip()[len(ELDIS_OBJECT_URL):]):
                assigned[assigned_id].add(location.id)

    decisions = []
    for row in mapping:
        location_id = int(row["abie_id"])
        location = location_by_id.get(location_id)
        target_id = object_uuid(row["eldis_object_uuid"])
        target = eldis_by_id.get(target_id)
        key = address_key(location.address) if location else ()
        decision, reason = assess(
            row, location, target, target_id,
            mapping_ids[location_id] == 1,
            eldis_ids[target_id] == 1 and uuid_claims[target_id] == {location_id},
            abie_addresses[key] == 1 and eldis_addresses[key] == 1,
            bool(assigned[target_id] - {location_id}),
        )
        decisions.append(Decision(
            location_id, str(target_id) if target_id else "",
            location.eldis_url if location else None,
            f"{ELDIS_OBJECT_URL}{target_id}" if target_id else None,
            decision, reason, location.revision if location else 0,
        ))
    return sorted(decisions, key=lambda decision: decision.abie_id)


def report_content(decisions):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=FIELDS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(vars(decision) for decision in decisions)
    return stream.getvalue().encode("utf-8")


def open_report(path, content):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(content)


async def connection():
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn:
        raise ValueError("Set DATABASE_URL for a PostgreSQL connection")
    return await asyncpg.connect(dsn.replace("postgresql+asyncpg://", "postgresql://", 1))


async def database_locations(conn):
    rows = await conn.fetch("""
        SELECT id, name, address, to_jsonb(loc)->>'eldis_url' AS url,
               COALESCE((to_jsonb(loc)->>'eldis_url_revision')::bigint, 0) AS revision
        FROM public.asset_locations AS loc
        ORDER BY id
    """)
    return [Location(row["id"], row["name"], row["address"], row["url"], row["revision"]) for row in rows]


async def apply_report(conn, mapping, catalogue, approved_content, approved_sha):
    if hashlib.sha256(approved_content).hexdigest() != approved_sha:
        raise ValueError("The approved report does not match the supplied SHA-256")
    batch_id = uuid5(NAMESPACE_URL, f"abie-eldis-import:{approved_sha}")
    async with conn.transaction():
        await conn.execute("SET LOCAL lock_timeout = '5s'")
        await conn.execute("LOCK TABLE public.asset_locations IN SHARE ROW EXCLUSIVE MODE")
        existing = await conn.fetchval(
            "SELECT count(*) FROM public.eldis_link_import_changes WHERE batch_id = $1", batch_id
        )
        if existing:
            return batch_id, 0
        decisions = plan(mapping, catalogue, await database_locations(conn))
        if report_content(decisions) != approved_content:
            raise ValueError("The approved report is stale. Generate and review a new dry-run")
        eligible = [entry for entry in decisions if entry.decision == "eligible"]
        for entry in eligible:
            changed = await conn.fetchrow("""
                UPDATE public.asset_locations SET eldis_url = $2
                WHERE id = $1 AND NULLIF(BTRIM(eldis_url), '') IS NULL
                  AND eldis_url_revision = $3 AND eldis_url IS NOT DISTINCT FROM $4
                RETURNING eldis_url_revision
            """, entry.abie_id, entry.new_url, entry.previous_revision, entry.previous_url)
            if changed is None or changed["eldis_url_revision"] != entry.previous_revision + 1:
                raise RuntimeError(f"Cannot safely update ABIE object {entry.abie_id}")
            await conn.execute("""
                INSERT INTO public.eldis_link_import_changes
                    (batch_id, location_id, previous_url, imported_url, imported_revision)
                VALUES ($1, $2, $3, $4, $5)
            """, batch_id, entry.abie_id, entry.previous_url, entry.new_url, changed["eldis_url_revision"])
    return batch_id, len(eligible)


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mapping", type=Path, required=True)
    parser.add_argument("--catalogue", type=Path, required=True)
    parser.add_argument("--snapshot", type=Path, help="ABIE objects from a verified read-only snapshot")
    parser.add_argument("--report", type=Path, help="New CSV file to create in dry-run mode")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--approved-report", type=Path)
    parser.add_argument("--sha256")
    args = parser.parse_args()
    if args.apply:
        if args.snapshot or args.report or not args.approved_report or not args.sha256:
            parser.error("--apply requires --approved-report and --sha256 and reads live rows")
    elif not args.report or args.approved_report or args.sha256:
        parser.error("dry-run requires --report and accepts neither --approved-report nor --sha256")

    mapping = read_mapping(args.mapping)
    catalogue = read_catalogue(args.catalogue)
    if args.apply:
        conn = await connection()
        try:
            batch, changed = await apply_report(
                conn, mapping, catalogue, args.approved_report.read_bytes(), args.sha256
            )
        finally:
            await conn.close()
        print(f"batch={batch} changed={changed}")
        return
    if args.snapshot:
        locations = read_snapshot(args.snapshot)
    else:
        conn = await connection()
        try:
            async with conn.transaction(isolation="repeatable_read", readonly=True):
                locations = await database_locations(conn)
        finally:
            await conn.close()
    decisions = plan(mapping, catalogue, locations)
    content = report_content(decisions)
    open_report(args.report, content)
    eligible = sum(entry.decision == "eligible" for entry in decisions)
    print(f"rows={len(decisions)} eligible={eligible} sha256={hashlib.sha256(content).hexdigest()}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (ValueError, OSError, asyncpg.PostgresError) as error:
        raise SystemExit(f"Import stopped: {error}") from None
