# Back to the user's folder before their .zshrc, so it, their .zlogin and any shell started from this
# one see their usual ZDOTDIR. /etc/zshrc has put history in this folder; it belongs in theirs.
_deckterm_user_zdotdir
[[ $HISTFILE == $DECKTERM_SHELL_DIR/* ]] && HISTFILE=${ZDOTDIR:-$HOME}/.zsh_history
[[ -f "${ZDOTDIR:-$HOME}/.zshrc" ]] && source "${ZDOTDIR:-$HOME}/.zshrc"

# Marks where each prompt starts, where its command starts running, and where the output ends
# (OSC 133, the FinalTerm convention VS Code and others use), so deckterm can set the live
# input apart and draw a separator between commands.
autoload -Uz add-zsh-hook vcs_info
_deckterm_preexec() { _deckterm_ran=1; printf '\e]133;C\a' }
_deckterm_precmd() {
  local code=$?
  if [[ -n $_deckterm_ran ]]; then printf '\e]133;D;%s\a\n' "$code"; fi
  _deckterm_ran=
  vcs_info
  # OSC 7 reports the folder, so the session reopens there and its git info follows cd.
  # The path is a URL's, so the characters a URL treats specially are escaped.
  local dir=${PWD//\%/%25}
  dir=${dir//\#/%23}; dir=${dir//\?/%3F}; dir=${dir// /%20}
  printf '\e]7;file://%s%s\a' "$HOST" "$dir"
  printf '\e]133;A\a'
}

add-zsh-hook preexec _deckterm_preexec
add-zsh-hook precmd _deckterm_precmd

# macOS folders match any capitalization, so `cd documents` works but leaves the prompt, the session's
# folder and git saying "documents". This swaps in the name as it is on disk. Only case is changed: a
# path through a symlink keeps the symlink's name.
_deckterm_true_case() {
  local real=$(/bin/pwd -P 2>/dev/null)
  [[ -n $real && $real != $PWD && ${(L)real} == ${(L)PWD} ]] && builtin cd -q -- $real
}
add-zsh-hook chpwd _deckterm_true_case

# A two-line prompt like Warp's, unless the user has set their own.
if [[ $PROMPT == '%n@%m %1~ %# ' ]]; then
  setopt PROMPT_SUBST
  zstyle ':vcs_info:git:*' formats ' %F{green}git:(%b)%f'
  PROMPT=$'%F{244}%~%f${vcs_info_msg_0_}\n%F{75}❯%f '
fi

# Claude started here gets Own Term's own tools (electron/tools.cjs), allowed without asking. Only
# here: in any other terminal the server can't be reached, and Claude would report it as failed.
if [[ -n $DECKTERM_MCP_CONFIG ]]; then
  claude() { command claude --mcp-config="$DECKTERM_MCP_CONFIG" --allowedTools=mcp__own-term "$@" }
fi
