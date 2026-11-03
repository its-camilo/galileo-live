#!/bin/sh
# El disco persistente se monta como root: se ajusta el dueño y se baja a un usuario sin privilegios.
set -eu
mkdir -p "${GALILEO_DATA_DIR:-/data}" "${GALILEO_DATA_DIR:-/data}/mpl" "${GALILEO_DATA_DIR:-/data}/cache"
chown -R galileo:galileo "${GALILEO_DATA_DIR:-/data}"
exec gosu galileo "$@"
