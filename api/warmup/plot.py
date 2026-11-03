"""Genera una figura de prueba y deja la caché de fuentes de matplotlib en la imagen."""
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

fig, ax = plt.subplots(figsize=(5, 3), dpi=100)
ax.plot([0, 1, 2], [0, 1, 4], marker=".")
ax.set_xlabel("t (s)")
ax.set_ylabel("a (m/s²)")
fig.tight_layout()
fig.savefig(sys.argv[1])
