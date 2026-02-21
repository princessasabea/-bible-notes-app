import { redirect } from "next/navigation";

export default function HomePage(): never {
  redirect("/read/NKJV/John/3");
}
