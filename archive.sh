#!/bin/bash
VERSION="${1:-$(date +%d.%m.%Y_v1bX)}"
DIR="$(dirname "$0")"
ARCHIVE="${DIR}/${VERSION}.tar.gz"

cd "$DIR" && tar czf "$ARCHIVE" \
  --exclude="__pycache__" \
  --exclude="*.pyc" \
  --exclude="node_modules" \
  --exclude=".git" \
  --exclude="tests" \
  --exclude="*.egg-info" \
  --exclude="dist" \
  --exclude="*.tar.gz" \
  backend/ frontend/

SIZE=$(du -h "$ARCHIVE" | cut -f1)
echo "✓ $VERSION.tar.gz ($SIZE)"
