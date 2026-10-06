#!/usr/bin/env bash

# exit on error
set -e

# position ourselves properly relative to script
cd $(dirname $0)/..

# try to find a clang that works: not sure why this hackery is necessary, but I
# get weird errors like <stddef.h> not found with clang, but not with clang19
# (even though clang -v says it's v19). add whatever works for you to the
# "try_clangs" list:
try_clangs="clang-20 clang-16 clang19 clang"
for clang in $try_clangs ; do
  CLANG=$(which $clang || true)
  if [ -n "$CLANG" ] ; then
    break
  fi
done
if [ -z $CLANG ] ; then
  echo "none of the binaries in try_clangs (\"$try_clangs\") were found (if you do have a clang you can try extending the try_clangs list)"
  exit 1
fi

mem=$(( 3200 * 65536 )) # duplicated in initMemory() in dough.js
echo "memory: $mem"

#out=dough.clang.wasm
out=dough.wasm

$CLANG \
  -DCLANGWASM \
  -DCLANGWASM_MAXMEM=$mem \
  -O2 \
  -Wall \
  -std=gnu99 \
  --target=wasm32 \
  -mbulk-memory \
  -matomics \
  -msimd128 \
  -nostdlib \
  -Wl,--no-entry \
  -Wl,--import-memory \
  -Wl,--shared-memory \
  -Wl,--export=dough_init \
  -Wl,--export=get_time \
  -Wl,--export=evaluate \
  -Wl,--export=dsp \
  -Wl,--initial-memory=$mem \
  -Wl,--max-memory=$mem \
  -Wl,--unresolved-symbols=import-dynamic \
  -o $out dough.c

echo -n "Size: "
wc -c $out
