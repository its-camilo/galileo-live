import { auth } from "@/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Nav } from "@/components/nav";
import { StartPicker } from "@/components/start-picker";
import { pickLang } from "@/lib/i18n";

export default async function StartPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const lang = pickLang((await headers()).get("accept-language"));
  return (
    <>
      <Nav lang={lang} />
      <main className="page">
        <StartPicker lang={lang} />
      </main>
    </>
  );
}
