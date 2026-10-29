import { useTranslation } from "react-i18next";
import { Badge, type BadgeTone } from "../../components/ui";

const STAGE_TONES: Record<string, BadgeTone> = {
  awaiting_payment: "neutral",
  review: "warning",
  packing: "info",
  ordering: "info",
  inspection: "warning",
  completed: "success",
  problem: "danger",
  cancelled: "danger",
};

/** Workflow stage badge (待审核 / 待发货 / 待下单 / 待抽检 / …). */
export function StageBadge({ stage }: { stage?: string | null }) {
  const { t } = useTranslation();
  if (!stage) return null;
  return (
    <Badge tone={STAGE_TONES[stage] ?? "neutral"}>
      {t(`stages.${stage}`, stage)}
    </Badge>
  );
}
