import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { HistoryList } from "@/components/history-list";
import { Nav } from "@/components/nav";
import { t } from "@/lib/i18n";
import { getLang } from "@/lib/lang";

export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const lang = await getLang();
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
