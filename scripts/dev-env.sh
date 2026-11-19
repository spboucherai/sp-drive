# Environment of the local development stack (sourced by dev-stack.sh and dev-invite.sh). No secret here.
export DATABASE_URL=postgres://127.0.0.1/sp_drive_dev SPD_ORIGIN=http://localhost:5183 SPD_RP_ID=localhost PORT=8661 HOST=127.0.0.1
export SPD_DATA_DIR="$PWD/.dev/data" SPD_MASTER_KEY_FILE="$PWD/.dev/master.key" SPD_INLINE_WORKER=on SPD_APP_DIR="$PWD"
export SPD_AV_MODE=${SPD_AV_MODE:-optional} SPD_CLAMD_SOCKET=${SPD_CLAMD_SOCKET:-/tmp/sp-drive-test/clamd.sock}
# AI providers are read from the stack's own file, never from the node's ~/.config/sp-drive/ai.env (that is production's).
export SPD_AI_ENV_FILE="$PWD/.dev/ai.env"
