# Own Term starts zsh with ZDOTDIR pointing here to add its shell integration. The user's own files
# still load, and see ZDOTDIR as they would in any other terminal: theirs if they set one, else unset.
# DECKTERM_USER_ZDOTDIR carries it between the files; empty means unset.
_deckterm_user_zdotdir() { if [[ -n $DECKTERM_USER_ZDOTDIR ]]; then ZDOTDIR=$DECKTERM_USER_ZDOTDIR; else unset ZDOTDIR; fi }

_deckterm_user_zdotdir
[[ -f "${ZDOTDIR:-$HOME}/.zshenv" ]] && source "${ZDOTDIR:-$HOME}/.zshenv"
# Their .zshenv may set, move or unset ZDOTDIR; remember it, and come back here for .zprofile and .zshrc.
export DECKTERM_USER_ZDOTDIR=${ZDOTDIR-}
export ZDOTDIR=$DECKTERM_SHELL_DIR
