import { auth, signIn, signOut } from "@/auth";
import { t, type Lang } from "@/lib/i18n";

export async function Nav({ lang }: { lang: Lang }) {
  const T = t(lang);
  const session = await auth();
  return (
    <header className="nav">
      <a className="brand" href="/">
        <span className="brand-mark" aria-hidden="true" />
        {T.brand}
      </a>
      <nav className="nav-links" aria-label="Principal">
        {session?.user ? (
          <>
            <a href="/history">{T.history}</a>
            <form
              action={async () => {
                "use server";
                await signOut();
              }}
            >
              <button type="submit" className="link-button">
                {T.signOut}
              </button>
            </form>
          </>
        ) : (
          <form
            action={async () => {
              "use server";
              await signIn("google");
            }}
          >
            <button type="submit" className="link-button">
              {T.signIn}
            </button>
          </form>
        )}
      </nav>
    </header>
  );
}
