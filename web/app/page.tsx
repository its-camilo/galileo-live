import { auth, signIn } from "@/auth";
import { Button, ButtonLink } from "@/components/base/buttons/button";
import { headers } from "next/headers";
import { Nav } from "@/components/nav";
import { Trajectory } from "@/components/trajectory";
import { pickLang, t } from "@/lib/i18n";
import { experimentUi } from "@/lib/catalog-ui";
import Link from "next/link";

export default async function Home() {
  const lang = pickLang((await headers()).get("accept-language"));
  const T = t(lang);
  const session = await auth();
  const mrua = experimentUi("mrua_ramp", lang);
  const fall = experimentUi("free_fall", lang);

  return (
    <>
      <Nav lang={lang} />
      <main className="home">
        <section className="hero">
          <div className="hero-copy">
            <h1>{T.heroTitle}</h1>
            <p className="lede">{T.heroLede}</p>
            {session?.user ? (
              <ButtonLink href="/start" variant="primary" className="hero-actions">
                {T.startCta}
              </ButtonLink>
            ) : (
              <form
                action={async () => {
                  "use server";
                  await signIn("google");
                }}
              >
                <Button type="submit" variant="primary" className="hero-actions">
                  {T.signIn}
                </Button>
              </form>
            )}
            <p className="fine">{T.heroFine}</p>
          </div>
          <Trajectory T={T} />
        </section>

        <section className="catalog" aria-labelledby="catalog-title">
          <h2 id="catalog-title">{T.catalogTitle}</h2>
          <div className="catalog-grid">
            <article className="catalog-item">
              <h3>{T.cardMruaTitle}</h3>
              <p>{T.cardMruaBody}</p>
              <span className="fine">{mrua.title}</span>
            </article>
            <article className="catalog-item">
              <h3>{T.cardFallTitle}</h3>
              <p>{T.cardFallBody}</p>
              <span className="fine">{fall.title}</span>
            </article>
          </div>
        </section>

        <footer className="site-foot">
          <Link href="/privacy">{T.privacy}</Link>
          <Link href="/terms">{T.terms}</Link>
        </footer>
      </main>
    </>
  );
}
