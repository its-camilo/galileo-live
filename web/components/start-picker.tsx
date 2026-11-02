"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/base/buttons/button";
import { Textarea } from "@/components/base/textarea/textarea";
import { HoldToTalk } from "@/components/hold-to-talk";
import { api, errorKey } from "@/lib/api";
import { EXPERIMENT_IDS, experimentUi, type ExperimentId } from "@/lib/catalog-ui";
import { t, type Lang } from "@/lib/i18n";

export function StartPicker({ lang }: { lang: Lang }) {
  const T = t(lang);
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ consented: boolean }>("/me")
      .then((me) => {
        if (!me.consented) router.replace("/consent");
      })
      .catch(() => setError(T.errGeneric));
  }, [router, T.errGeneric]);

  async function open(experiment: ExperimentId | null) {
    setBusy(true);
    setError(null);
    try {
      const s = await api<{ id: string }>("/sessions", { json: experiment ? { experiment, lang } : { lang } });
      router.push(`/lab/${s.id}`);
    } catch (e) {
      setError(fail(e));
      setBusy(false);
    }
  }

  async function describe() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api<{ id: string }>("/sessions", { json: { lang } });
      const agent = await api<{ actions: unknown[] }>("/agent", {
        json: { session_id: s.id, text },
      });
      if (agent.actions.length > 0) {
        router.push(`/lab/${s.id}`);
      } else {
        setError(T.describeNotFound);
        setBusy(false);
      }
    } catch (e) {
      setError(fail(e));
      setBusy(false);
    }
  }

  function fail(e: unknown): string {
    const key = errorKey(e);
    return T[`err${key.charAt(0).toUpperCase()}${key.slice(1)}` as "errGeneric"] ?? T.errGeneric;
  }

  return (
    <div>
      <header className="start-head">
        <h1>{T.startTitle}</h1>
        <p className="lede">{T.startLede}</p>
      </header>

      <section className="cards" aria-label={T.startTitle}>
        <article className="card free">
          <h2>{T.modeFree}</h2>
          <p>{T.modeFreeBody}</p>
          <div className="btn-wrap">
            <Button type="button" variant="primary" disabled={busy} onClick={() => open(null)}>
              {T.chooseExperiment}
            </Button>
          </div>
        </article>
        {EXPERIMENT_IDS.map((id) => {
          const ui = experimentUi(id, lang);
          return (
            <article key={id} className="card">
              <h2>{ui.title}</h2>
              <p>{ui.summary}</p>
              <div className="btn-wrap">
                <Button type="button" variant="secondary" disabled={busy} onClick={() => open(id)}>
                  {T.chooseExperiment}
                </Button>
              </div>
            </article>
          );
        })}
      </section>

      <section className="panel describe">
        <h2>{T.describeTitle}</h2>
        <div className="grid gap-3">
          <Textarea
            aria-label={T.describeTitle}
            rows={3}
            value={text}
            placeholder={T.describePlaceholder}
            onChange={setText}
          />
          <div className="row">
            <HoldToTalk
              lang={lang}
              label={T.voiceHold}
              onTranscript={(v) => setText((prev) => (prev ? `${prev} ${v}` : v))}
              onError={setError}
            />
            <Button type="button" variant="primary" disabled={busy || !text.trim()} onClick={describe}>
              {busy ? T.describeSearching : T.describeSearch}
            </Button>
          </div>
        </div>
        {error && (
          <p className="error mt-4" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
