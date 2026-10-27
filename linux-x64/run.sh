#!/usr/bin/env sh
set -eu
KIT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export DB_PATH="$KIT_ROOT/data/onboarding.sqlite"
export CONFIG_PATH="$KIT_ROOT/config.xml"
exec "$KIT_ROOT/linux-x64/onboarding-api"
