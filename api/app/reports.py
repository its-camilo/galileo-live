import subprocess
import tempfile
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from jinja2 import Environment, FileSystemLoader  # noqa: E402

TEMPLATES = Path(__file__).parent / "templates"

_LATEX_SPECIAL = {
    "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#", "_": r"\_",
    "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}", "^": r"\textasciicircum{}",
    "\\": r"\textbackslash{}",
}


def tex_escape(value) -> str:
    return "".join(_LATEX_SPECIAL.get(ch, ch) for ch in str(value))


def plot_series(series: dict, out_dir: Path, key_name: str) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    t = series["t"]
    panels = [("x", "x (m)", "x-t"), ("v", "v (m/s)", "v-t"), ("a", "a (m/s²)", "a-t")]
    paths = []
    for field, ylabel, title in panels:
        fig, ax = plt.subplots(figsize=(5, 3), dpi=150)
        ax.plot(t, series[field], marker=".", linewidth=1)
        ax.set_xlabel("t (s)")
        ax.set_ylabel(ylabel)
        ax.set_title(title)
        ax.grid(True, alpha=0.3)
        fig.tight_layout()
        path = out_dir / f"{field}_t.png"
        fig.savefig(path)
        plt.close(fig)
        paths.append(path)
    return paths


def build_pdf(context: dict, out_dir: Path) -> Path:
    env = Environment(loader=FileSystemLoader(TEMPLATES), autoescape=False, block_start_string="<%", block_end_string="%>",
                      variable_start_string="<<", variable_end_string=">>", comment_start_string="<#", comment_end_string="#>")
    env.filters["tex"] = tex_escape
    tex = env.get_template("report.tex.j2").render(**context)
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=out_dir) as tmp:
        tex_path = Path(tmp) / "report.tex"
        tex_path.write_text(tex, encoding="utf-8")
        subprocess.run(
            ["tectonic", "-X", "compile", "--outdir", tmp, str(tex_path)],
            check=True,
            capture_output=True,
            timeout=180,
        )
        final = out_dir / f"{context['session_id']}.pdf"
        (Path(tmp) / "report.pdf").replace(final)
    return final
