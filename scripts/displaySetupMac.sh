#!/usr/bin/env zsh

# Associated article guide: https://www.yevelations.com/p/multi-machine-qol
if [[ "$(uname -s)" != "Darwin" ]]; then
	echo "This script is for macOS."
	exit 1
fi

if ! pgrep -x "BetterDisplay" &>/dev/null && [ ! -d "/Applications/BetterDisplay.app" ]; then
	echo "# Install BetterDisplay. It's safe as of 07/25/26 but may be subject to injection attacks."
	echo "brew install --cask betterdisplay"
	exit 1
fi

if ! command -v betterdisplaycli &>/dev/null; then
	echo "# Install BetterDisplayCLI. It's safe as of 07/25/26 but may be subject to injection attacks."
	echo "brew tap waydabber/betterdisplay && brew install waydabber/betterdisplay/betterdisplaycli"
	exit 1
fi

echo "Switch all your monitors to your Mac and press Enter to continue"
read -r

typeset -A mac_ddc

while read -r display; do
	if [ -n "$display" ]; then
		ddc_val=$(betterdisplaycli get -name="$display" -ddc -vcp=inputSelect 2>/dev/null)
		mac_ddc["$display"]="$ddc_val"
		echo "$display: $ddc_val"
	fi
done < <(echo "[$(betterdisplaycli get -identifiers)]" | jq -r '.[] | select(.deviceType == "Display" and (.name | contains("Built-in") | not)) | .name')

echo "\nMove this terminal window to your MBP's integrated display, switch all your monitors to your PC, and press Enter to continue"
read -r

typeset -A pc_ddc

while read -r display; do
	if [ -n "$display" ]; then
		ddc_val=$(betterdisplaycli get -name="$display" -ddc -vcp=inputSelect 2>/dev/null)
		pc_ddc["$display"]="$ddc_val"
		echo "$display: $ddc_val"
	fi
done < <(echo "[$(betterdisplaycli get -identifiers)]" | jq -r '.[] | select(.deviceType == "Display" and (.name | contains("Built-in") | not)) | .name')

echo "\nWhat terminal function name do you want to use for switching to Mac? (I use ,dmac)"
read -r mac_func_name
mac_func_name=${mac_func_name:-,bdmac}

echo "\nWhat terminal function name do you want to use for switching to PC? (I use ,dpc)"
read -r pc_func_name
pc_func_name=${pc_func_name:-,bdpc}

build_function() {
	local func_name="$1"
	local map_var="$2"
	local body=""
	local display val

	local -A m
	eval "m=(\"\${(@kv)${map_var}}\")"

	for display in "${(@k)m}"; do
		val="${m[$display]}"
		body+="  ( current=\$(betterdisplaycli get -name=${display} -ddc -vcp=inputSelect 2>/dev/null); [[ \"\$current\" != \"${val}\" ]] && betterdisplaycli set -name=${display} -ddc=${val} -vcp=inputSelect ) &"$'\n'
	done

	cat <<EOF
function ${func_name}() {
${body}  wait
}
EOF
}

mac_fn=$(build_function "$mac_func_name" "mac_ddc")
pc_fn=$(build_function "$pc_func_name" "pc_ddc")

echo ""
echo "$mac_fn"
echo ""
echo "$pc_fn"

echo "\nPress Enter to append to ~/.zshrc, or type append path (ex.: ~/.zprofile or ./JUST_HERE.sh)"
read -r response

if [[ -z "$response" ]]; then
	target_file="${ZDOTDIR:-$HOME}/.zshrc"
else
	eval target_file="$response"
fi

cat <<EOF >>"$target_file"

$mac_fn

$pc_fn
EOF
echo "Functions appended to $target_file"
