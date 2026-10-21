#!/usr/bin/env python3
"""Fail closed on private files, credentials and personal email in a Git tree."""
import argparse
import json
import re
import subprocess
from pathlib import PurePosixPath


def forbidden_path(name):
    path = PurePosixPath(name)
    base = path.name.lower()
    if any(part in {"uploads", "backup", ".opencode", ".codex", ".agents"} for part in path.parts):
        return True
    if base.startswith(".env") or base.endswith(".env") or base == "opencode.json":
        return True
    if base.endswith((".log", ".dump", ".backup", ".enc", ".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".tar", ".tar.gz", ".zip", ".7z", ".tgz", ".apk", ".aab")):
        return True
    if base.startswith(("id_rsa", "id_ed25519", "credentials")) or "service-account" in base:
        return True
    if base.endswith(".sql") and not name.startswith(("backend/scripts/", "backend/migrations/")):
        return True
    return base in {"audit_report.md", "high_fix_report.md", "h01_report.md"} or base.startswith("private_")


def sensitive_content(data, check_emails=True):
    if b"\0" in data:
        return False
    value = data.decode("utf8", errors="replace")
    if re.search(r"-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|github_pat_[A-Za-z0-9_]{25,}|gh[pousr]_[A-Za-z0-9]{25,}|sk-[A-Za-z0-9_-]{24,}|\bAKIA[A-Z0-9]{16}\b", value):
        return True
    assignments = re.findall(r'''(?i)\b(?:password|password_hash|secret_key|api_key|access_token|refresh_token)\s*["']?\s*[:=]\s*["']([^"'\r\n]{12,})["']''', value)
    if any(not item.lower().startswith(("test", "example", "synthetic", "changeme", "${")) for item in assignments):
        return True
    if not check_emails:
        return False
    emails = re.findall(r"[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})", value)
    return any(domain.lower() not in {"example.test", "example.com", "example.org", "example.invalid"} for domain in emails)


def publication_content(data, name):
    if sensitive_content(data, check_emails=False):
        return True
    value = data.decode("utf8", errors="replace").replace(
        'placeholder="contact@domain.ru"', 'placeholder="contact@example.test"')
    if name.endswith("package-lock.json"):
        lock = json.loads(value)
        for package in lock.get("packages", {}).values():
            # Upstream npm deprecation notices are public vendor metadata.
            package.pop("deprecated", None)
        value = json.dumps(lock)
    return sensitive_content(value.encode())


def check(ref=None):
    if ref:
        raw = subprocess.check_output(["git", "ls-tree", "-rz", "--full-tree", ref])
        entries = [entry.split(b"\t", 1) for entry in raw.split(b"\0") if entry]
        files = [(name.decode(), metadata.split()[2].decode()) for metadata, name in entries]
    else:
        raw = subprocess.check_output(["git", "ls-files", "--stage", "-z"])
        entries = [entry.split(b"\t", 1) for entry in raw.split(b"\0") if entry]
        files = [(name.decode(), metadata.split()[1].decode()) for metadata, name in entries]
    rejected = []
    for name, blob in files:
        if forbidden_path(name) or publication_content(subprocess.check_output(["git", "cat-file", "blob", blob]), name):
            rejected.append(name)
    return rejected


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--ref")
    args = parser.parse_args()
    rejected = check(args.ref)
    for name in rejected:
        print("Publication blocked:", name)
    raise SystemExit(bool(rejected))
