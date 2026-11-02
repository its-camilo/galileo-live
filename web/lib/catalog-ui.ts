import type { Lang } from "@/lib/i18n";

export type ExperimentId = "mrua_ramp" | "free_fall";

type Copy = { title: string; summary: string; materials: string[]; steps: string[] };

const copy: Record<ExperimentId, Record<Lang, Copy>> = {
  mrua_ramp: {
    es: {
      title: "Carrito en rampa (MRUA)",
      summary: "Mide la aceleración de un carrito que baja por una rampa.",
      materials: ["Carrito de juguete", "Tabla o libro para inclinar la rampa", "Regla o cinta métrica", "Celular con soporte"],
      steps: [
        "Apoya un extremo de la tabla sobre un libro para dar una inclinación fija.",
        "Pon la regla a lo largo de la rampa, sobre el mismo plano del movimiento.",
        "Fija el celular a altura estable, con la rampa y la regla visibles completas.",
        "Suelta el carrito desde la parte alta, sin empujarlo.",
      ],
    },
    en: {
      title: "Cart on a ramp (uniform acceleration)",
      summary: "Measure the acceleration of a cart rolling down a ramp.",
      materials: ["Toy cart", "Board or book to tilt the ramp", "Ruler or tape measure", "Phone with a stand"],
      steps: [
        "Rest one end of the board on a book to set a fixed tilt.",
        "Lay the ruler along the ramp, on the same plane as the motion.",
        "Fix the phone at a steady height, with the whole ramp and ruler visible.",
        "Release the cart from the top without pushing it.",
      ],
    },
  },
  free_fall: {
    es: {
      title: "Caída libre",
      summary: "Mide g dejando caer una pelota desde al menos 1,5 m.",
      materials: ["Pelota", "Regla vertical o cinta métrica de al menos 1,5 m", "Celular con soporte"],
      steps: [
        "Sujeta la pelota a al menos 1,5 m de altura.",
        "Deja la regla vertical junto a la trayectoria de la pelota, visible en el cuadro.",
        "Fija el celular de lado, sin moverlo durante la toma.",
        "Suelta la pelota sin impulsarla.",
      ],
    },
    en: {
      title: "Free fall",
      summary: "Measure g by dropping a ball from at least 1.5 m.",
      materials: ["Ball", "Vertical ruler or tape measure of at least 1.5 m", "Phone with a stand"],
      steps: [
        "Hold the ball at least 1.5 m above the floor.",
        "Place the vertical ruler next to the ball's path, visible in frame.",
        "Fix the phone from the side and keep it still during the shot.",
        "Drop the ball without pushing it.",
      ],
    },
  },
};

export function experimentUi(id: ExperimentId, lang: Lang): Copy {
  return copy[id][lang];
}

export const EXPERIMENT_IDS: ExperimentId[] = ["mrua_ramp", "free_fall"];

export function isExperimentId(value: string | null): value is ExperimentId {
  return value === "mrua_ramp" || value === "free_fall";
}

export function customSteps(lang: Lang): string[] {
  return lang === "es"
    ? [
        "Coloca el objeto sobre una trayectoria recta, a la vista de la cámara.",
        "Pon una regla o cinta métrica a lo largo de la trayectoria.",
        "Fija el celular sin moverlo durante la medición.",
        "Suelta o impulsa el objeto según lo que quieras medir.",
      ]
    : [
        "Place the object on a straight path, in view of the camera.",
        "Lay a ruler or tape measure along the path.",
        "Fix the phone and keep it still during the measurement.",
        "Release or push the object, depending on what you want to measure.",
      ];
}
