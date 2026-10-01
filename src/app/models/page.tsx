import type { Metadata } from "next";
import ModelsPage from "@/components/models-page";

export const metadata: Metadata = {
  title: "Models and API keys · GENFORGE",
};

export default function Page() {
  return <ModelsPage />;
}
