#!/usr/bin/env python3
"""Restore only into new labelled containers; never accepts a target database."""
import argparse
import json
from pathlib import Path
import secrets
import subprocess
import time

from backup import run, output, verify


def probe(directory, require_complete=True):
    directory = Path(directory).resolve()
    manifest = verify(directory, require_complete=require_complete)
    suffix = secrets.token_hex(6)
    prefix = "hubdesk-restore-" + suffix
    label = "hubdesk.restore=" + suffix
    network, pg, app, volume = [prefix + "-" + name for name in ("net", "pg", "app", "uploads")]
    created = []
    password = secrets.token_urlsafe(24)
    try:
        output(["docker", "network", "create", "--internal", "--label", label, network])
        created.append(("network", network))
        output(["docker", "volume", "create", "--label", label, volume])
        created.append(("volume", volume))
        output(["docker", "run", "-d", "--name", pg, "--label", label, "--network", network,
                "--network-alias", "restore-db", "--tmpfs", "/var/lib/postgresql/data:rw,size=1g",
                "-e", "POSTGRES_USER=restore", "-e", "POSTGRES_DB=restored",
                "-e", "POSTGRES_PASSWORD=" + password, manifest["images"]["db"]])
        created.append(("container", pg))
        for _ in range(60):
            ready = subprocess.run(["docker", "exec", pg, "pg_isready", "-U", "restore", "-d", "restored"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Isolated PostgreSQL startup timeout")
        with (directory / "database.dump").open("rb") as source:
            run(["docker", "exec", "-i", pg, "pg_restore", "-U", "restore", "-d", "restored",
                 "--no-owner", "--no-acl", "--exit-on-error"], stdin=source, stdout=subprocess.DEVNULL)
        with (directory / "uploads-volume.tar.gz").open("rb") as source:
            run(["docker", "run", "--rm", "-i", "--network", "none", "--label", label,
                 "-v", volume + ":/app/uploads", "--entrypoint", "tar", manifest["images"]["app"],
                 "-xzf", "-", "-C", "/app/uploads"], stdin=source, stdout=subprocess.DEVNULL)
        output(["docker", "run", "-d", "--name", app, "--label", label, "--network", network,
                "-v", volume + ":/app/uploads", "-e", "SECRET_KEY=restore-test-only-not-production",
                "-e", "ENABLE_MAIL_WORKER=false", "-e", "ENABLE_AUTO_MIGRATIONS=false",
                "-e", "DATABASE_URL=postgresql+asyncpg://restore:" + password + "@restore-db/restored",
                manifest["images"]["app"]])
        created.append(("container", app))
        code = "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/api/health',timeout=2).read().decode())"
        for _ in range(60):
            health = subprocess.run(["docker", "exec", app, "python", "-c", code],
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            if health.returncode == 0 and json.loads(health.stdout).get("db") == "ok":
                break
            time.sleep(1)
        else:
            raise RuntimeError("Isolated restored application health timeout")
        check = '''import asyncio, json, os
from pathlib import Path
import asyncpg
async def main():
    db = await asyncpg.connect(os.environ['DATABASE_URL'].replace('+asyncpg',''))
    rows = await db.fetch('SELECT path, size FROM attachments')
    bad = 0
    for row in rows:
        path = Path(row['path'])
        if not path.is_absolute(): path = Path('/app') / path
        if not path.resolve().is_relative_to(Path('/app/uploads')) or not path.is_file() or path.stat().st_size != row['size']:
            bad += 1
    tickets = await db.fetchval('SELECT count(*) FROM tickets')
    await db.close()
    assert bad == 0, 'Missing or mismatched restored attachments'
    print(json.dumps({'attachments':len(rows), 'mismatches':bad, 'tickets':tickets, 'health':'ok'}))
asyncio.run(main())'''
        summary = json.loads(output(["docker", "exec", app, "python", "-c", check]))
        (directory / "RESTORE_TESTED.json").write_text(json.dumps(summary, indent=2) + "\n")
        return summary
    finally:
        for kind, name in reversed(created):
            inspected = json.loads(output(["docker", kind if kind != "container" else "container", "inspect", name]))[0]
            labels = inspected.get("Config", {}).get("Labels", {}) if kind == "container" else inspected.get("Labels", {})
            if labels.get("hubdesk.restore") != suffix:
                raise RuntimeError("Refusing cleanup of an unrelated restore resource")
            command = ["docker", "rm", "-f", name] if kind == "container" else ["docker", kind, "rm", name]
            output(command)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    print(json.dumps(probe(parser.parse_args().directory)))
