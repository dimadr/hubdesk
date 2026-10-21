#!/usr/bin/env python3
"""Fail-closed backup; never restores into an existing database."""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
from datetime import datetime, timezone

REQUIRED = {"database.dump", "postgres_globals.sql", "project.tar.gz", "configuration-private.tar.gz",
            "uploads-volume.tar.gz", "redis-volume.tar.gz", "runtime-images.tar.gz"}


def run(args, **kwargs):
    result = subprocess.run(args, stderr=subprocess.PIPE, timeout=600, **kwargs)
    if result.returncode:
        raise RuntimeError(f"{args[0]} {args[1]} failed (exit {result.returncode})")
    return result


def output(args):
    return run(args, stdout=subprocess.PIPE).stdout


def export(args, path):
    with path.open("xb") as destination:
        run(args, stdout=destination)
    if not path.stat().st_size:
        raise RuntimeError(f"Empty backup component: {path.name}")


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def is_private(path):
    return (path.name.startswith(".env") or path.name.endswith(".env")
            or path.name == "opencode.json"
            or any(p in {".opencode", ".codex", ".agents"} for p in path.parts)
            or path.suffix.lower() in {".pem", ".key", ".pfx", ".p12", ".jks", ".keystore"}
            or path.name.startswith(("id_rsa", "id_ed25519", "credentials"))
            or "service-account" in path.name)


def project_files(project):
    for directory, dirs, files in os.walk(project):
        dirs[:] = sorted(d for d in dirs if d not in {
            ".git", "backup", "uploads", "node_modules", "__pycache__", "dist", "build", ".expo",
        } and not d.startswith((".audit-", ".h01-", ".high-", ".medium-")))
        for name in sorted(files):
            path = Path(directory) / name
            relative = path.relative_to(project)
            if is_private(relative):
                yield path, relative, True
                continue
            if name.endswith((".log", ".tar", ".tar.gz", ".tgz", ".zip", ".7z", ".enc", ".dump", ".backup", ".pyc", ".apk", ".aab")):
                continue
            if name.endswith(".sql") and not relative.as_posix().startswith(("backend/scripts/", "backend/migrations/")):
                continue
            if name.startswith("PRIVATE_") or name in {"AUDIT_REPORT.md", "HIGH_FIX_REPORT.md", "MEDIUM_FIX_REPORT.md", "H01_REPORT.md"}:
                continue
            yield path, relative, False


def add_json(archive, name, value):
    data = json.dumps(value, ensure_ascii=False, indent=2).encode()
    member = tarfile.TarInfo(name)
    member.size = len(data)
    member.mode = 0o600
    archive.addfile(member, io.BytesIO(data))


def verify(directory, require_complete=True):
    directory = Path(directory).resolve()
    if require_complete and not (directory / "COMPLETE").is_file():
        raise RuntimeError("Backup has no COMPLETE marker")
    manifest = json.loads((directory / "manifest.json").read_text())
    if set(manifest["files"]) != REQUIRED:
        raise RuntimeError("Backup component manifest is incomplete")
    for name, info in manifest["files"].items():
        path = directory / name
        if path.is_symlink() or path.stat().st_size != info["size"] or digest(path) != info["sha256"]:
            raise RuntimeError(f"Checksum/size mismatch: {name}")
        if name.endswith(".tar.gz"):
            with tarfile.open(path, "r:gz") as archive:
                for member in archive:
                    if member.name.startswith("/") or ".." in Path(member.name).parts:
                        raise RuntimeError(f"Unsafe archive path: {name}")
                    if member.isfile():
                        content = archive.extractfile(member)
                        while content.read(1024 * 1024):
                            pass
    with (directory / "database.dump").open("rb") as source:
        run(["docker", "run", "--rm", "-i", "--network", "none", "--entrypoint", "pg_restore",
             manifest["images"]["db"], "--file=/dev/null"], stdin=source, stdout=subprocess.DEVNULL)
    expected = {line.split("  ", 1)[1]: line.split("  ", 1)[0]
                for line in (directory / "SHA256SUMS").read_text().splitlines()}
    if set(expected) != REQUIRED | {"manifest.json"}:
        raise RuntimeError("SHA256SUMS is incomplete")
    if any(digest(directory / name) != value for name, value in expected.items()):
        raise RuntimeError("SHA256SUMS verification failed")
    return manifest


def create_backup(project, root, version):
    os.umask(0o077)
    project, root = project.resolve(), root.resolve()
    if root == project or project in root.parents or Path("/var/lib/docker/volumes") in root.parents:
        raise RuntimeError("Backup output must be outside the project and Docker volumes")
    if not (project / "backend/.env").is_file():
        raise RuntimeError("Required backend/.env is missing")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if shutil.disk_usage(root).free < 1024 ** 3:
        raise RuntimeError("Less than 1 GiB free; backup not started")
    compose = ["docker", "compose", "-p", "docker", "-f", str(project / "docker/docker-compose.yml")]
    containers = {}
    for service in ("app", "db", "redis"):
        identifier = output(compose + ["ps", "-q", service]).decode().strip()
        if not identifier or "\n" in identifier:
            raise RuntimeError(f"Expected exactly one running {service} container")
        containers[service] = json.loads(output(["docker", "inspect", identifier]))[0]
    for container in containers.values():
        for mount in container.get("Mounts", []):
            source = Path(mount["Source"]).resolve()
            if root == source or source in root.parents:
                raise RuntimeError("Backup output is inside a mounted runtime directory")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%fZ")
    directory = Path(tempfile.mkdtemp(prefix=f"backup_{stamp}_", dir=root))
    try:
        db = containers["db"]["Id"]
        export(["docker", "exec", db, "sh", "-eu", "-c",
                'exec pg_dump -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-fsm}" -Fc'],
               directory / "database.dump")
        export(["docker", "exec", db, "sh", "-eu", "-c",
                'exec pg_dumpall -U "${POSTGRES_USER:-postgres}" --globals-only'],
               directory / "postgres_globals.sql")
        private_names = []
        with tarfile.open(directory / "project.tar.gz", "x:gz", dereference=False) as source_archive, \
                tarfile.open(directory / "configuration-private.tar.gz", "x:gz", dereference=False) as config_archive:
            for path, relative, private in project_files(project):
                if path.is_symlink():
                    raise RuntimeError(f"Review symlink before backup: {relative}")
                archive = config_archive if private else source_archive
                before = path.stat()
                archive.add(path, arcname=str(relative), recursive=False)
                after = path.stat()
                if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                    raise RuntimeError(f"Source changed during backup: {relative}")
                if private:
                    private_names.append(str(relative))
            add_json(config_archive, "runtime-containers.json", containers)
            add_json(config_archive, "private-files.json", private_names)
        export(["docker", "exec", containers["app"]["Id"], "tar", "-C", "/app/uploads", "-czf", "-", "."],
               directory / "uploads-volume.tar.gz")
        export(["docker", "exec", containers["redis"]["Id"], "tar", "-C", "/data", "-czf", "-", "."],
               directory / "redis-volume.tar.gz")
        redis_keys = int(output(["docker", "exec", containers["redis"]["Id"], "redis-cli", "--raw", "DBSIZE"]).strip())
        if redis_keys:
            raise RuntimeError("Non-empty Redis needs a reviewed consistent RDB snapshot procedure")
        images = {service: container["Image"] for service, container in containers.items()}
        with (directory / "runtime-images.tar.gz").open("xb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", compresslevel=6) as compressed:
            with tempfile.TemporaryFile() as errors:
                process = subprocess.Popen(["docker", "image", "save", *sorted(set(images.values()))],
                                           stdout=subprocess.PIPE, stderr=errors)
                try:
                    shutil.copyfileobj(process.stdout, compressed)
                finally:
                    process.stdout.close()
                    result = process.wait()
                if result:
                    raise RuntimeError("Docker image export failed")
        manifest = {
            "format": 1, "created_utc": datetime.now(timezone.utc).isoformat(), "version": version,
            "project": str(project), "images": images, "redis_keys": redis_keys,
            "consistency": "Logical PostgreSQL snapshot; online uploads require restore-time attachment reconciliation",
            "files": {name: {"size": (directory / name).stat().st_size, "sha256": digest(directory / name)}
                      for name in sorted(REQUIRED)},
        }
        (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        (directory / "SHA256SUMS").write_text("".join(
            f"{digest(directory / name)}  {name}\n" for name in sorted(REQUIRED | {"manifest.json"})))
        verify(directory, require_complete=False)
        return directory
    except BaseException:
        (directory / "FAILED").touch(exist_ok=False)
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("version", nargs="?", default="manual")
    parser.add_argument("--project", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output-root", type=Path, default=Path("/root/hubdesk-backups"))
    parser.add_argument("--verify", type=Path)
    args = parser.parse_args()
    if args.verify:
        verify(args.verify)
        print("VERIFIED", args.verify)
    else:
        from restore_backup_probe import probe
        directory = create_backup(args.project, args.output_root, args.version)
        try:
            probe(directory, require_complete=False)
            (directory / "COMPLETE").touch(exist_ok=False)
        except BaseException:
            (directory / "FAILED").touch(exist_ok=False)
            raise
        print("COMPLETE", directory)


if __name__ == "__main__":
    main()
