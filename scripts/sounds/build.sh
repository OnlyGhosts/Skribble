#!/bin/bash
# Rebuilds client/public/sounds from the Kenney packs listed in client/public/sounds/CREDITS.md.
#
#   scripts/sounds/build.sh <packs dir> client/public/sounds scripts/sounds/map.txt
#
# <packs dir> holds one folder per pack, named as in map.txt, each with the pack's zip unpacked
# into x/ (so <packs dir>/casino-audio/x/Audio/card-slide-1.ogg). Every picked file is
# transcoded to mono MP3: silence trimmed at both ends, an optional max length with a short
# fade, loudness evened out (RMS towards -16 dB, at most 8 dB of transient limiting, peaks
# under -1 dB). Needs ffmpeg with libmp3lame.
set -euo pipefail
DL=$1; OUT=$2; MAP=$3
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
grep -v '^#' "$MAP" | while IFS='|' read -r name pack src max kbps; do
  [ -z "$name" ] && continue
  base="$DL/$pack/x/Audio"
  first=${src%%+*}
  inputs=(-i "$base/$first")
  filter="[0:a]aformat=channel_layouts=mono,aresample=44100[a0]"
  mixin="[a0]"
  if [[ "$src" == *+* ]]; then
    second=${src#*+}; file=${second%@*}; delay=${second##*@}
    ms=$(awk "BEGIN{print int($delay*1000)}")
    inputs+=(-i "$base/$file")
    filter="$filter;[1:a]aformat=channel_layouts=mono,aresample=44100,adelay=${ms}[a1];[a0][a1]amix=inputs=2:duration=longest:normalize=0[m]"
    mixin="[m]"
  fi
  trim="silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-60dB,areverse"
  if [ "$max" != "0" ]; then
    fs=$(awk "BEGIN{print $max-0.25}")
    trim="$trim,atrim=0:$max,afade=t=out:st=$fs:d=0.25"
  fi
  ffmpeg -nostdin -v error -y "${inputs[@]}" -filter_complex "$filter;${mixin}${trim}[o]" -map "[o]" -c:a pcm_f32le "$TMP/a.wav"
  stats=$(ffmpeg -nostdin -hide_banner -i "$TMP/a.wav" -af volumedetect -f null - 2>&1)
  mean=$(echo "$stats" | sed -n 's/.*mean_volume: \(-\?[0-9.]*\) dB/\1/p')
  peak=$(echo "$stats" | sed -n 's/.*max_volume: \(-\?[0-9.]*\) dB/\1/p')
  gain=$(awk "BEGIN{g=-16-($mean); p=7-($peak); if (p<g) g=p; print g}")
  mkdir -p "$OUT/$(dirname "$name")"
  ffmpeg -nostdin -v error -y -i "$TMP/a.wav" -af "volume=${gain}dB,alimiter=limit=0.89:attack=1:release=40:level=disabled" -ac 1 -ar 44100 -c:a libmp3lame -b:a "${kbps}k" -map_metadata -1 -write_xing 1 "$OUT/$name.mp3"
  printf '%-22s gain=%6.1f dB  %6d bytes  %s\n' "$name" "$gain" "$(stat -c %s "$OUT/$name.mp3")" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/$name.mp3")"
done
