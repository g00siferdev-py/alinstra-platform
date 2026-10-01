import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function IndexPage() {
  const session = await getSession();
  redirect(session ? "/home" : "/login");
}
