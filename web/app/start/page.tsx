import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Nav } from "@/components/nav";
import { StartPicker } from "@/components/start-picker";
import { getLang } from "@/lib/lang";

export default async function StartPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const lang = await getLang();
  return (
    <>
      <Nav lang={lang} />
      <main className="page">
        <StartPicker lang={lang} />
      </main>
    </>
  );
}
