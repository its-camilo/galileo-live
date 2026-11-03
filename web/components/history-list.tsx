"use client";

import { useEffect, useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/base/buttons/button";
import { Spinner } from "@/components/base/spinner/spinner";
import { api, apiBlob, errorKey } from "@/lib/api";
import { experimentUi, isExperimentId } from "@/lib/catalog-ui";
import { t, type Lang } from "@/lib/i18n";

type Item = { id: string; experiment: string | null; date: string; pdf_url: string; key_value: number | null };

export function HistoryList({ lang }: { lang: Lang }) {
  const T = t(lang);
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Item[]>("/history")
      .then(setItems)
      .catch((e) => setError(T[`err${cap(errorKey(e))}` as "errGeneric"] ?? T.errGeneric));
  }, [T]);

  const [ready, setReady] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<string | null>(null);

  // Primer toque: trae el PDF. Segundo toque: lo abre con un gesto real (iOS Safari bloquea a.click() tras un await).
  async function fetchPdf(item: Item) {
    setLoading(item.id);
    try {
      const blob = await apiBlob(item.pdf_url);
      const url = URL.createObjectURL(blob);
      setReady((r) => ({ ...r, [item.id]: url }));
    } catch (e) {
      setError(T[`err${cap(errorKey(e))}` as "errGeneric"] ?? T.errGeneric);
    } finally {
      setLoading(null);
    }
  }

  const readyRef = useRef(ready);
  readyRef.current = ready;
  useEffect(() => () => Object.values(readyRef.current).forEach((u) => URL.revokeObjectURL(u)), []);

  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (items === null)
    return (
      <div className="flex items-center gap-3 py-6 text-text-secondary">
        <Spinner size="sm" aria-label={T.historyLoading} />
        <span className="fine">{T.historyLoading}</span>
      </div>
    );
  if (items.length === 0) return <p className="empty">{T.historyEmpty}</p>;

  return (
    <ul className="history">
      {items.map((item) => {
        const title = item.experiment && isExperimentId(item.experiment) ? experimentUi(item.experiment, lang).title : "—";
        return (
          <li key={item.id}>
            <div>
              <strong>{title}</strong>
              <span className="fine">
                {T.historyDate}: {item.date.slice(0, 10)}
              </span>
            </div>
            <span className="readout small">{item.key_value !== null ? item.key_value.toFixed(3) : "—"}</span>
            {ready[item.id] ? (
              <ButtonLink
                variant="primary"
                size="small"
                href={ready[item.id]}
                download={`galileo-${item.id.slice(0, 8)}.pdf`}
                target="_blank"
                rel="noopener"
              >
                {T.historyOpen}
              </ButtonLink>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="small"
                onClick={() => fetchPdf(item)}
                disabled={loading === item.id}
              >
                {loading === item.id ? <Spinner size="sm" aria-label={T.historyLoading} /> : T.historyDownload}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
