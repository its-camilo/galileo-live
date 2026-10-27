import { headers } from "next/headers";
import { auth, signIn, signOut } from "@/auth";
import { dictionaries, pickLang } from "@/lib/i18n";

export default async function Home() {
  const lang = pickLang((await headers()).get("accept-language"));
  const t = dictionaries[lang];
  const session = await auth();

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 24 }}>
      <h1>{t.title}</h1>
      <p>{t.subtitle}</p>

      {session?.user ? (
        <>
          <button type="button">{t.start}</button>
          <p>
            <a href="/history">{t.history}</a>
          </p>
          <form
            action={async () => {
              "use server";
              await signOut();
            }}
          >
            <button type="submit">{t.signOut}</button>
          </form>
        </>
      ) : (
        <>
          <p>{t.needLogin}</p>
          <form
            action={async () => {
              "use server";
              await signIn("google");
            }}
          >
            <button type="submit">{t.signIn}</button>
          </form>
        </>
      )}
    </main>
  );
}
