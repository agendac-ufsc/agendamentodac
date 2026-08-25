#!/bin/bash
set -e

if [ -f package.json ]; then
  npm install --no-audit --no-fund --prefer-offline
fi

echo "post-merge setup ok"
