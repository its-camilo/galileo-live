"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorKey } from "@/lib/api";
import { EXPERIMENT_IDS, experimentUi, type ExperimentId } from "@/lib/catalog-ui";
import { t, type Lang } from "@/lib/i18n";
import { HoldToTalk } from "@/components/hold-to-talk";

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

  async function open(experiment: ExperimentId) {
    setBusy(true);
    setError(null);
    try {
      const s = await api<{ id: string }>("/sessions", { json: { experiment, lang } });
      router.push(`/lab/${s.id}`);
    } catch (e) {
      setError(T[`err${cap(errorKey(e))}` as "errGeneric"] ?? T.errGeneric);
      setBusy(false);
    }
  }

  async function openFree() {
    setBusy(true);
    setError(null);
    try {
      const s = await api<{ id: string }>("/sessions", { json: { lang } });
      router.push(`/lab/${s.id}`);
    } catch (e) {
      setError(T[`err${cap(errorKey(e))}` as "errGeneric"] ?? T.errGeneric);
      setBusy(false);
    }
  }

  async function describe() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api<{ id: string }>("/sessions", { json: { lang } });
      const agent = await api<{ actions: { type: string; id: string }[] }>("/agent", {
        json: { session_id: s.id, text },
      });
      if (agent.actions.length > 0) {
        router.push(`/lab/${s.id}`);
      } else {
        setError(T.describeNotFound);
        setBusy(false);
      }
    } catch (e) {
      setError(T[`err${cap(errorKey(e))}` as "errGeneric"] ?? T.errGeneric);
      setBusy(false);
    }
  }

  return (
    <div className="start">
      <header className="start-head">
        <h1>{T.startTitle}</h1>
        <p className="lede">{T.startLede}</p>
      </header>

      <section className="cards" aria-label={T.startTitle}>
        <article className="card free">
          <h2>{T.modeFree}</h2>
          <p>{T.modeFreeBody}</p>
          <button type="button" className="btn btn-signal" disabled={busy} onClick={openFree}>
            {T.chooseExperiment}
          </button>
        </article>
        {EXPERIMENT_IDS.map((id) => {
          const ui = experimentUi(id, lang);
          return (
            <article key={id} className="card">
              <h2>{ui.title}</h2>
              <p>{ui.summary}</p>
              <button type="button" className="btn" disabled={busy} onClick={() => open(id)}>
                {T.chooseExperiment}
              </button>
            </article>
          );
        })}
      </section>

      <section className="panel describe">
        <h2>{T.describeTitle}</h2>
        <label className="field">
          <span className="sr-only">{T.describeTitle}</span>
          <textarea
            rows={3}
            value={text}
            placeholder={T.describePlaceholder}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="row">
          <HoldToTalk
            lang={lang}
            label={T.voiceHold}
            onTranscript={(v) => setText((prev) => (prev ? `${prev} ${v}` : v))}
            onError={setError}
          />
          <button type="button" className="btn btn-signal" disabled={busy || !text.trim()} onClick={describe}>
            {busy ? T.describeSearching : T.describeSearch}
          </button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </div>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
