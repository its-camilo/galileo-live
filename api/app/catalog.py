import math
from dataclasses import dataclass

G = 9.81


@dataclass(frozen=True)
class Experiment:
    id: str
    key_name: str
    object_prompt: str
    keywords: tuple[str, ...]
    default_ref: float | None
    title: dict[str, str]


EXPERIMENTS: dict[str, Experiment] = {
    "mrua_ramp": Experiment(
        id="mrua_ramp",
        key_name="a",
        object_prompt="toy car",
        keywords=("car", "carrito", "cart", "ramp", "rampa", "incline", "mrua", "uniform", "toy"),
        default_ref=None,
        title={"en": "Uniformly accelerated motion (toy car on a ramp)", "es": "MRUA (carrito en rampa)"},
    ),
    "free_fall": Experiment(
        id="free_fall",
        key_name="g",
        object_prompt="ball",
        keywords=("ball", "pelota", "fall", "caída", "caida", "drop", "gravity", "gravedad", "libre"),
        default_ref=G,
        title={"en": "Free fall", "es": "Caída libre"},
    ),
}


def select_experiment(description: str) -> Experiment:
    text = description.lower()
    return max(EXPERIMENTS.values(), key=lambda e: sum(text.count(k) for k in e.keywords))


def ramp_reference(theta_deg: float) -> float:
    return G * math.sin(math.radians(theta_deg))
