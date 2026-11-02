import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { Button } from "@/components/base/buttons/button";
import { LANG_COOKIE } from "@/lib/lang";
import type { Lang } from "@/lib/i18n";

export function LangSwitch({ lang }: { lang: Lang }) {
  async function setLang(formData: FormData) {
    "use server";
    const value = formData.get("lang") === "es" ? "es" : "en";
    (await cookies()).set(LANG_COOKIE, value, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    revalidatePath("/", "layout");
  }
  return (
    <form action={setLang}>
      <Button type="submit" name="lang" value={lang === "es" ? "en" : "es"} variant="ghost" size="small" aria-label={lang === "es" ? "Switch to English" : "Cambiar a español"}>
        {lang === "es" ? "English" : "Español"}
      </Button>
    </form>
  );
}
