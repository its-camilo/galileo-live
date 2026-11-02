import { auth } from "@/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ConsentForm } from "@/components/consent-form";
import { Nav } from "@/components/nav";
import { pickLang } from "@/lib/i18n";

export default async function ConsentPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const lang = pickLang((await headers()).get("accept-language"));
  return (
    <>
      <Nav lang={lang} />
      <main className="page">
        <ConsentForm lang={lang} />
      </main>
    </>
  );
}
