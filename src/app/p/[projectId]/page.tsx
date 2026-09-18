import { redirect } from "next/navigation";
import Studio from "@/components/studio";
import { getProject } from "@/lib/projects";

export default async function ProjectStudio({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  if (projectId === "none") {
    return <Studio projectId={null} projectName="Unassigned" />;
  }
  const project = await getProject(projectId);
  if (!project) redirect("/");
  return <Studio projectId={project.id} projectName={project.name} />;
}
