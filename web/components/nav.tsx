import { auth, signIn, signOut } from "@/auth";
import { Button } from "@/components/base/buttons/button";
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
            <a className="text-sm font-medium" href="/history">
              {T.history}
            </a>
            <form
              action={async () => {
                "use server";
                await signOut();
              }}
            >
              <Button type="submit" variant="secondary" size="small">
                {T.signOut}
              </Button>
            </form>
          </>
        ) : (
          <form
            action={async () => {
              "use server";
              await signIn("google");
            }}
          >
            <Button type="submit" variant="secondary" size="small">
              {T.signIn}
            </Button>
          </form>
        )}
      </nav>
    </header>
  );
}
