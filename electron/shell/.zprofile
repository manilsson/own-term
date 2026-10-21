_deckterm_user_zdotdir
[[ -f "${ZDOTDIR:-$HOME}/.zprofile" ]] && source "${ZDOTDIR:-$HOME}/.zprofile"
# .zprofile can change ZDOTDIR too, and .zshrc should come from wherever it now points.
DECKTERM_USER_ZDOTDIR=${ZDOTDIR-}
export ZDOTDIR=$DECKTERM_SHELL_DIR
