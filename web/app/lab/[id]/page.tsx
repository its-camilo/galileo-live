import { auth } from "@/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Lab } from "@/components/lab";
import { Nav } from "@/components/nav";
import { pickLang } from "@/lib/i18n";

export default async function LabPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const { id } = await params;
  const lang = pickLang((await headers()).get("accept-language"));
  return (
    <>
      <Nav lang={lang} />
      <main className="page">
        <Lab sessionId={id} lang={lang} />
      </main>
    </>
  );
}
