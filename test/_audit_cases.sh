#!/usr/bin/env bash
# 由 test/audit_xml_vs_cli.js 生成 —— 逐条问官方 CLI，得到权威 oracle
set -u
BIN='/home/gxb/spectre-webui/spectre'
ROOT=/tmp/spectre-oracle
rm -rf "$ROOT"; mkdir -p "$ROOT"
n=0
while IFS= read -r line; do
  case "$line" in ""|"#"*) continue;; esac
  IFS="|" read -r ID ALG USER SECRET SITE COUNTER TYPE PURPOSE CTX <<< "$line"
  n=$((n+1))
  h="$ROOT/h$n"; mkdir -p "$h"
  printf %s "$SECRET" > "$h/sec.txt"
  args=( -a "$ALG" -u "$USER" -s 3 -t "$TYPE" -f none -c "$COUNTER" )
  case "$PURPOSE" in
    Identification*) args+=( -p i );;
    Recovery*)       args+=( -p r );;
  esac
  [ -n "$CTX" ] && args+=( -C "$CTX" )
  args+=( "$SITE" )
  out=$(HOME="$h" SPECTRE_USERNAME="$USER" "$BIN" "${args[@]}" 3< "$h/sec.txt" 2>/dev/null)
  printf "ORACLE\t%s\t%s\n" "$ID" "$out"
done <<'__CASES__'
v3|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
v3_mb_userName|3|⛄|banana colored duckling|spectre.app|1|long|Authentication|
v3_mb_userSecret|3|Robert Lee Mitchell|⛄|spectre.app|1|long|Authentication|
v3_mb_siteName|3|Robert Lee Mitchell|banana colored duckling|⛄|1|long|Authentication|
v3_loginName|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|name|Identification|
v3_securityAnswer|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Recovery|
v3_securityAnswer_context|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Recovery|question
v3_type_maximum|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|maximum|Authentication|
v3_type_medium|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|medium|Authentication|
v3_type_basic|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|basic|Authentication|
v3_type_short|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|short|Authentication|
v3_type_pin|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|pin|Authentication|
v3_type_name|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|name|Authentication|
v3_type_phrase|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Authentication|
v3_type_personal|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v3_type_personal_mb|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v3_counter_ceiling|3|Robert Lee Mitchell|banana colored duckling|spectre.app|4294967294|long|Authentication|
v2|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
v2_mb_userName|2|⛄|banana colored duckling|spectre.app|1|long|Authentication|
v2_mb_userSecret|2|Robert Lee Mitchell|⛄|spectre.app|1|long|Authentication|
v2_mb_siteName|2|Robert Lee Mitchell|banana colored duckling|⛄|1|long|Authentication|
v2_loginName|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|name|Identification|
v2_securityAnswer|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Recovery|
v2_securityAnswer_context|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Recovery|question
v2_type_maximum|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|maximum|Authentication|
v2_type_medium|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|medium|Authentication|
v2_type_basic|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|basic|Authentication|
v2_type_short|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|short|Authentication|
v2_type_pin|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|pin|Authentication|
v2_type_name|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|name|Authentication|
v2_type_phrase|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Authentication|
v2_type_personal|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v2_type_personal_mb|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v2_counter_ceiling|2|Robert Lee Mitchell|banana colored duckling|spectre.app|4294967294|long|Authentication|
v1|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
v1_mb_userName|1|⛄|banana colored duckling|spectre.app|1|long|Authentication|
v1_mb_userSecret|1|Robert Lee Mitchell|⛄|spectre.app|1|long|Authentication|
v1_mb_siteName|1|Robert Lee Mitchell|banana colored duckling|⛄|1|long|Authentication|
v1_loginName|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|name|Identification|
v1_securityAnswer|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Recovery|
v1_securityAnswer_context|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Recovery|question
v1_type_maximum|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|maximum|Authentication|
v1_type_medium|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|medium|Authentication|
v1_type_basic|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|basic|Authentication|
v1_type_short|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|short|Authentication|
v1_type_pin|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|pin|Authentication|
v1_type_name|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|name|Authentication|
v1_type_phrase|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Authentication|
v1_type_personal|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v1_type_personal_mb|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v1_counter_ceiling|1|Robert Lee Mitchell|banana colored duckling|spectre.app|4294967294|long|Authentication|
v0|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
v0_mb_userName|0|⛄|banana colored duckling|spectre.app|1|long|Authentication|
v0_mb_userSecret|0|Robert Lee Mitchell|⛄|spectre.app|1|long|Authentication|
v0_mb_siteName|0|Robert Lee Mitchell|banana colored duckling|⛄|1|long|Authentication|
v0_loginName|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|name|Identification|
v0_securityAnswer|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Recovery|
v0_securityAnswer_context|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Recovery|question
v0_type_maximum|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|maximum|Authentication|
v0_type_medium|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|medium|Authentication|
v0_type_basic|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|basic|Authentication|
v0_type_short|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|short|Authentication|
v0_type_pin|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|pin|Authentication|
v0_type_name|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|name|Authentication|
v0_type_phrase|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Authentication|
v0_type_personal|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v0_type_personal_mb|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v0_counter_ceiling|0|Robert Lee Mitchell|banana colored duckling|spectre.app|4294967294|long|Authentication|
v3_flat|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
v3_mb_userName_flat|3|⛄|banana colored duckling|spectre.app|1|long|Authentication|
v3_mb_userSecret_flat|3|Robert Lee Mitchell|⛄|spectre.app|1|long|Authentication|
v3_mb_siteName_flat|3|Robert Lee Mitchell|banana colored duckling|⛄|1|long|Authentication|
v3_type_maximum_flat|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|maximum|Authentication|
v3_type_medium_flat|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|medium|Authentication|
v3_type_basic_flat|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|basic|Authentication|
v3_type_short_flat|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|short|Authentication|
v3_type_pin_flat|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|pin|Authentication|
v3_type_name_flat|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|name|Authentication|
v3_type_phrase_flat|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Authentication|
v3_type_personal_flat|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v3_type_personal_mb_flat|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v3_counter_ceiling_flat|3|Robert Lee Mitchell|banana colored duckling|spectre.app|4294967294|long|Authentication|
v2_flat|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
v2_mb_userName_flat|2|⛄|banana colored duckling|spectre.app|1|long|Authentication|
v2_mb_userSecret_flat|2|Robert Lee Mitchell|⛄|spectre.app|1|long|Authentication|
v2_mb_siteName_flat|2|Robert Lee Mitchell|banana colored duckling|⛄|1|long|Authentication|
v2_type_maximum_flat|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|maximum|Authentication|
v2_type_medium_flat|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|medium|Authentication|
v2_type_basic_flat|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|basic|Authentication|
v2_type_short_flat|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|short|Authentication|
v2_type_pin_flat|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|pin|Authentication|
v2_type_name_flat|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|name|Authentication|
v2_type_phrase_flat|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Authentication|
v2_type_personal_flat|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v2_type_personal_mb_flat|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v2_counter_ceiling_flat|2|Robert Lee Mitchell|banana colored duckling|spectre.app|4294967294|long|Authentication|
v1_flat|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
v1_mb_userName_flat|1|⛄|banana colored duckling|spectre.app|1|long|Authentication|
v1_mb_userSecret_flat|1|Robert Lee Mitchell|⛄|spectre.app|1|long|Authentication|
v1_mb_siteName_flat|1|Robert Lee Mitchell|banana colored duckling|⛄|1|long|Authentication|
v1_type_maximum_flat|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|maximum|Authentication|
v1_type_medium_flat|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|medium|Authentication|
v1_type_basic_flat|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|basic|Authentication|
v1_type_short_flat|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|short|Authentication|
v1_type_pin_flat|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|pin|Authentication|
v1_type_name_flat|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|name|Authentication|
v1_type_phrase_flat|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Authentication|
v1_type_personal_flat|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v1_type_personal_mb_flat|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v1_counter_ceiling_flat|1|Robert Lee Mitchell|banana colored duckling|spectre.app|4294967294|long|Authentication|
v0_flat|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
v0_mb_userName_flat|0|⛄|banana colored duckling|spectre.app|1|long|Authentication|
v0_mb_userSecret_flat|0|Robert Lee Mitchell|⛄|spectre.app|1|long|Authentication|
v0_mb_siteName_flat|0|Robert Lee Mitchell|banana colored duckling|⛄|1|long|Authentication|
v0_type_maximum_flat|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|maximum|Authentication|
v0_type_medium_flat|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|medium|Authentication|
v0_type_basic_flat|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|basic|Authentication|
v0_type_short_flat|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|short|Authentication|
v0_type_pin_flat|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|pin|Authentication|
v0_type_name_flat|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|name|Authentication|
v0_type_phrase_flat|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Authentication|
v0_type_personal_flat|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v0_type_personal_mb_flat|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v0_counter_ceiling_flat|0|Robert Lee Mitchell|banana colored duckling|spectre.app|4294967294|long|Authentication|
v3_json|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
v3_mb_userName_json|3|⛄|banana colored duckling|spectre.app|1|long|Authentication|
v3_mb_userSecret_json|3|Robert Lee Mitchell|⛄|spectre.app|1|long|Authentication|
v3_mb_siteName_json|3|Robert Lee Mitchell|banana colored duckling|⛄|1|long|Authentication|
v3_loginName_json|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|name|Identification|
v3_securityAnswer_json|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Recovery|
v3_securityAnswer_context_json|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Recovery|question
v3_type_maximum_json|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|maximum|Authentication|
v3_type_medium_json|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|medium|Authentication|
v3_type_basic_json|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|basic|Authentication|
v3_type_short_json|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|short|Authentication|
v3_type_pin_json|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|pin|Authentication|
v3_type_name_json|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|name|Authentication|
v3_type_phrase_json|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Authentication|
v3_type_personal_json|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v3_type_personal_mb_json|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v3_counter_ceiling_json|3|Robert Lee Mitchell|banana colored duckling|spectre.app|4294967294|long|Authentication|
v2_json|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
v2_mb_userName_json|2|⛄|banana colored duckling|spectre.app|1|long|Authentication|
v2_mb_userSecret_json|2|Robert Lee Mitchell|⛄|spectre.app|1|long|Authentication|
v2_mb_siteName_json|2|Robert Lee Mitchell|banana colored duckling|⛄|1|long|Authentication|
v2_loginName_json|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|name|Identification|
v2_securityAnswer_json|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Recovery|
v2_securityAnswer_context_json|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Recovery|question
v2_type_maximum_json|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|maximum|Authentication|
v2_type_medium_json|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|medium|Authentication|
v2_type_basic_json|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|basic|Authentication|
v2_type_short_json|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|short|Authentication|
v2_type_pin_json|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|pin|Authentication|
v2_type_name_json|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|name|Authentication|
v2_type_phrase_json|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Authentication|
v2_type_personal_json|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v2_type_personal_mb_json|2|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v2_counter_ceiling_json|2|Robert Lee Mitchell|banana colored duckling|spectre.app|4294967294|long|Authentication|
v1_json|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
v1_mb_userName_json|1|⛄|banana colored duckling|spectre.app|1|long|Authentication|
v1_mb_userSecret_json|1|Robert Lee Mitchell|⛄|spectre.app|1|long|Authentication|
v1_mb_siteName_json|1|Robert Lee Mitchell|banana colored duckling|⛄|1|long|Authentication|
v1_loginName_json|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|name|Identification|
v1_securityAnswer_json|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Recovery|
v1_securityAnswer_context_json|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Recovery|question
v1_type_maximum_json|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|maximum|Authentication|
v1_type_medium_json|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|medium|Authentication|
v1_type_basic_json|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|basic|Authentication|
v1_type_short_json|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|short|Authentication|
v1_type_pin_json|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|pin|Authentication|
v1_type_name_json|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|name|Authentication|
v1_type_phrase_json|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Authentication|
v1_type_personal_json|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v1_type_personal_mb_json|1|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v1_counter_ceiling_json|1|Robert Lee Mitchell|banana colored duckling|spectre.app|4294967294|long|Authentication|
v0_json|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
v0_mb_userName_json|0|⛄|banana colored duckling|spectre.app|1|long|Authentication|
v0_mb_userSecret_json|0|Robert Lee Mitchell|⛄|spectre.app|1|long|Authentication|
v0_mb_siteName_json|0|Robert Lee Mitchell|banana colored duckling|⛄|1|long|Authentication|
v0_loginName_json|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|name|Identification|
v0_securityAnswer_json|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Recovery|
v0_securityAnswer_context_json|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Recovery|question
v0_type_maximum_json|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|maximum|Authentication|
v0_type_medium_json|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|medium|Authentication|
v0_type_basic_json|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|basic|Authentication|
v0_type_short_json|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|short|Authentication|
v0_type_pin_json|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|pin|Authentication|
v0_type_name_json|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|name|Authentication|
v0_type_phrase_json|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|phrase|Authentication|
v0_type_personal_json|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v0_type_personal_mb_json|0|Robert Lee Mitchell|banana colored duckling|spectre.app|1|personal|Authentication|
v0_counter_ceiling_json|0|Robert Lee Mitchell|banana colored duckling|spectre.app|4294967294|long|Authentication|
read_flat_format0|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_flat_format1|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_flat_format2|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_flat_version_absent|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_flat_counter_absent|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_flat_format_text|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_flat_algorithm_text|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_flat_avatar_text|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_flat_uses_suffix|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_flat_type_wrapped|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_flat_version_hex|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_flat_counter_text|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_flat_header_colon|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_flat_format_unsupported|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_flat_site_truncated|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_flat_header_unterminated|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_flat_first_error|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_flat_name_absent|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_flat_site_name_empty|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_format1|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_format2|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_format3|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_keyid_absent|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_keyid_malformed|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_keyid_short|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_wrong_secret|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_state_short|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_state_nonblock|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_state_notbase64|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_algorithm_high|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_type_unknown|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_counter_negative|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_counter_high|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_avatar_negative|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_algorithm_fraction|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_type_negative|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_uses_fraction|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_counter_string|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_site_name_empty|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_format_unsupported|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_format_text|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_format_absent|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_question_type_unknown|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_user_absent|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_empty_object|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_truncated|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
read_json_sites_array|3|Robert Lee Mitchell|banana colored duckling|spectre.app|1|long|Authentication|
__CASES__
rm -rf "$ROOT"
