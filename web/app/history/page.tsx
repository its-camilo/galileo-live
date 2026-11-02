import { auth } from "@/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { HistoryList } from "@/components/history-list";
import { Nav } from "@/components/nav";
import { pickLang, t } from "@/lib/i18n";

export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const lang = pickLang((await headers()).get("accept-language"));
  const T = t(lang);
  return (
    <>
      <Nav lang={lang} />
      <main className="page">
        <h1>{T.historyTitle}</h1>
        <HistoryList lang={lang} />
      </main>
    </>
  );
}
