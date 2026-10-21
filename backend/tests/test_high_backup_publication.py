import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / (name + ".py"))
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


@pytest.mark.parametrize("name", ["backend/.env", ".env.production", "opencode.json",
                                  "backend/history.log", "uploads/a.png", "backup/database.dump",
                                  "keys/private.pem", "PRIVATE_GITHUB_SUPPORT.md"])
def test_publication_rejects_private_paths(name):
    assert module("check_publication").forbidden_path(name)


def test_publication_allows_code_and_synthetic_emails():
    guard = module("check_publication")
    assert not guard.forbidden_path("backend/scripts/restore_insert_name_uniqueness.sql")
    assert not guard.sensitive_content(b'email="user@example.test"')
    assert guard.sensitive_content(b'email="private' + b'@private.invalid"')
    assert guard.sensitive_content(b'-----BEGIN ' + b'OPENSSH PRIVATE KEY-----')
    assert guard.sensitive_content(b'api_key="' + b'A4b5C6d7E8f9G0h1I2j3K4l5' + b'"')


def test_publication_distinguishes_vendor_metadata_from_application_data():
    guard = module("check_publication")
    lock = {"packages": {"node_modules/example": {"deprecated": "Contact upstream" + "@vendor.invalid"}}}
    assert not guard.publication_content(json.dumps(lock).encode(), "mobile/package-lock.json")
    lock["application"] = {"email": "private" + "@private.invalid"}
    assert guard.publication_content(json.dumps(lock).encode(), "mobile/package-lock.json")


def test_dump_failure_stops_export_without_overwriting(tmp_path, monkeypatch):
    backup = module("backup")
    target = tmp_path / "database.dump"
    def fail(*args, **kwargs):
        return subprocess.CompletedProcess(args[0], 1, stderr=b"synthetic pg_dump failure")
    monkeypatch.setattr(backup.subprocess, "run", fail)
    with pytest.raises(RuntimeError):
        backup.export(["docker", "exec", "test", "pg_dump"], target)
    assert not (tmp_path / "COMPLETE").exists()
    target.write_bytes(b"existing backup")
    with pytest.raises(FileExistsError):
        backup.export(["docker", "exec", "test", "pg_dump"], target)
    assert target.read_bytes() == b"existing backup"


def test_source_and_private_configuration_are_separated(tmp_path):
    backup = module("backup")
    for name in ("backend/.env", "opencode.json", "backend/history.log", "backend/src/main.py",
                 "backend/tests/test_example.py", "backend/scripts/schema.sql", "db_old.sql"):
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("test")
    files = {str(relative): private for _, relative, private in backup.project_files(tmp_path)}
    assert files["backend/.env"] and files["opencode.json"]
    assert files["backend/src/main.py"] is False
    assert files["backend/tests/test_example.py"] is False
    assert files["backend/scripts/schema.sql"] is False
    assert "backend/history.log" not in files and "db_old.sql" not in files


def test_incomplete_backup_is_rejected(tmp_path):
    with pytest.raises(RuntimeError, match="COMPLETE"):
        module("backup").verify(tmp_path)


def test_backup_output_inside_project_is_rejected(tmp_path):
    with pytest.raises(RuntimeError, match="outside"):
        module("backup").create_backup(tmp_path, tmp_path / "backup", "test")


def test_corrupted_payload_is_rejected_before_restore(tmp_path):
    backup = module("backup")
    files = {}
    for name in ["database.dump", *sorted(backup.REQUIRED - {"database.dump"})]:
        path = tmp_path / name
        path.write_bytes(b"test")
        files[name] = {"size": 4, "sha256": backup.digest(path)}
    (tmp_path / "COMPLETE").touch()
    (tmp_path / "manifest.json").write_text(json.dumps({"files": files}))
    (tmp_path / "database.dump").write_bytes(b"corruption")
    with pytest.raises(RuntimeError, match="mismatch"):
        backup.verify(tmp_path)
