#!/bin/bash
VERSION="${1:-v1bX}"
DATE=$(date +%d.%m.%Y)
DIR="$(dirname "$0")"
ARCHIVE="${DIR}/${DATE}_${VERSION}.tar.gz"

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
echo "✓ ${DATE}_${VERSION}.tar.gz ($SIZE)"
