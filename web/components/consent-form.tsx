"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorKey } from "@/lib/api";
import { t, type Lang } from "@/lib/i18n";
import { LEGAL } from "@/lib/legal";

const KEYS = ["age_confirmed", "data_processing", "meta_processing", "international_transfer"] as const;

export function ConsentForm({ lang }: { lang: Lang }) {
  const T = t(lang);
  const router = useRouter();
  const [checked, setChecked] = useState<Record<(typeof KEYS)[number], boolean>>({
    age_confirmed: false,
    data_processing: false,
    meta_processing: false,
    international_transfer: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels: Record<(typeof KEYS)[number], string> = {
    age_confirmed: T.consentAge,
    data_processing: T.consentData,
    meta_processing: T.consentMeta,
    international_transfer: T.consentTransfer,
  };
  const ready = KEYS.every((k) => checked[k]);

  async function accept() {
    setSaving(true);
    setError(null);
    try {
      await api("/consent", {
        json: { version: LEGAL.consentVersion, ...checked },
      });
      router.replace("/start");
    } catch (e) {
      setError(T[`err${cap(errorKey(e))}` as "errGeneric"] ?? T.errGeneric);
      setSaving(false);
    }
  }

  return (
    <section className="panel consent">
      <h1>{T.consentTitle}</h1>
      <p className="lede">{T.consentLede}</p>
      <ul className="checks">
        {KEYS.map((k) => (
          <li key={k}>
            <label>
              <input
                type="checkbox"
                checked={checked[k]}
                onChange={(e) => setChecked({ ...checked, [k]: e.target.checked })}
              />
              <span>{labels[k]}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="fine">
        <Link href="/privacy">{T.consentRead}</Link>
      </p>
      <p className="fine">{T.consentRevoke}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" className="btn btn-signal wide" disabled={!ready || saving} onClick={accept}>
        {saving ? T.consentSaving : T.consentAccept}
      </button>
    </section>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
