export type NewsroomCardSpan = "1x1" | "2x1" | "1x2" | "2x2" | "3x1" | "3x2";

export type NewsroomCardTemplateRole = "lead" | "priority" | "secondary" | "tall" | "wide" | "wideFeature" | "standard";

type NewsroomCardTemplateInput = {
  mode: "desk" | "overview";
  index: number;
  bodyLength?: number;
  isUrgent?: boolean;
  qualityRating?: number | null;
  sectionKey?: "assignments" | "messages" | "references" | string;
  title?: string | null;
  updatedAt?: string | null;
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
  qualityRating,
  sectionKey,
  title,
}: NewsroomCardTemplateInput): NewsroomCardTemplate {
  if (mode === "overview") {
    if (index === 0) return { role: "lead", span: "2x2" };
    if (index === 3) return { role: "secondary", span: "2x1" };
    return { role: "standard", span: "1x1" };
  }
  if (sectionKey === "references") {
    return resolveReferenceDeskTemplate({
      bodyLength,
      index,
      isUrgent,
      qualityRating,
      title: title ?? "",
    });
  }
  if (index === 0 || isUrgent && index < 3) return { role: "priority", span: "2x1" };
  if (bodyLength > 180 || index > 0 && index % 7 === 0) return { role: "tall", span: "1x2" };
  if (index > 0 && index % 11 === 0) return { role: "secondary", span: "2x1" };
  return { role: "standard", span: "1x1" };
}

function resolveReferenceDeskTemplate({
  bodyLength,
  index,
  isUrgent,
  qualityRating,
  title,
}: {
  bodyLength: number;
  index: number;
  isUrgent: boolean;
  qualityRating?: number | null;
  title: string;
}): NewsroomCardTemplate {
  if (isLowQualityRating(qualityRating)) return { role: "standard", span: "1x1" };

  const pressure = headlinePressure(title);
  const bandSlot = index % 12;
  const isBandLead = bandSlot === 0;
  const isBandSecondary = bandSlot === 4 || bandSlot === 8;

  if (pressure === "severe") {
    return isBandLead
      ? { role: "wideFeature", span: "3x2" }
      : { role: "wide", span: "3x1" };
  }
  if (pressure === "high") {
    return isBandLead || isBandSecondary
      ? { role: "wide", span: "3x1" }
      : { role: "secondary", span: "2x1" };
  }
  if (pressure === "medium" && (bandSlot === 1 || bandSlot === 5 || bandSlot === 9)) {
    return { role: "secondary", span: "2x1" };
  }
  if (bodyLength > 340 && bandSlot === 7) return { role: "tall", span: "2x2" };
  if (bodyLength > 220 && (bandSlot === 2 || bandSlot === 7 || bandSlot === 10)) return { role: "tall", span: "1x2" };
  if (index === 0 || isUrgent && index < 3) return { role: "priority", span: "2x1" };
  if (index > 0 && index % 11 === 0) return { role: "secondary", span: "2x1" };
  return { role: "standard", span: "1x1" };
}

function headlinePressure(title: string): "low" | "medium" | "high" | "severe" {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const characterCount = words.join(" ").length;
  const longestWord = words.reduce((max, word) => Math.max(max, word.length), 0);
  if (characterCount >= 96 || longestWord >= 24) return "severe";
  if (characterCount >= 72 || longestWord >= 18) return "high";
  if (characterCount >= 52 || longestWord >= 14) return "medium";
  return "low";
}

function isLowQualityRating(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value < 3;
}
