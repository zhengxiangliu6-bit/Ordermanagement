import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isImageSource } from "./image-sources";

export function SafeImage({
  src,
  alt,
  className = "",
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  return failed || !isImageSource(src) ? (
    <span
      role="img"
      aria-label={t("items.imageFailed")}
      className={`flex items-center justify-center bg-slate-100 p-2 text-center text-xs text-slate-500 ${className}`}
    >
      {t("items.imageFailed")}
    </span>
  ) : (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
