export type NewsroomCardSpan = "1x1" | "2x1" | "1x2" | "2x2";

export type NewsroomCardTemplateRole = "lead" | "priority" | "secondary" | "tall" | "standard";

type NewsroomCardTemplateInput = {
  mode: "desk" | "overview";
  index: number;
  bodyLength?: number;
  isUrgent?: boolean;
};

type NewsroomCardTemplate = {
  role: NewsroomCardTemplateRole;
  span: NewsroomCardSpan;
};

export function resolveNewsroomCardTemplate({
  bodyLength = 0,
  index,
  isUrgent = false,
  mode,
}: NewsroomCardTemplateInput): NewsroomCardTemplate {
  if (mode === "overview") {
    if (index === 0) return { role: "lead", span: "2x2" };
    if (index === 3) return { role: "secondary", span: "2x1" };
    return { role: "standard", span: "1x1" };
  }
  if (index === 0 || isUrgent && index < 3) return { role: "priority", span: "2x1" };
  if (bodyLength > 180 || index > 0 && index % 7 === 0) return { role: "tall", span: "1x2" };
  if (index > 0 && index % 11 === 0) return { role: "secondary", span: "2x1" };
  return { role: "standard", span: "1x1" };
}
