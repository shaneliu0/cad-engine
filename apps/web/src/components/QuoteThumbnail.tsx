import { useState } from "react";
import type { JSX } from "react";
import { quoteThumbnailUrl } from "../api";

export function ThumbnailPlaceholder({ label }: { label: string }): JSX.Element {
  return (
    <span className="thumb thumb-empty" role="img" aria-label={label}>
      <svg viewBox="0 0 32 24" aria-hidden="true" fill="none">
        <path d="M6 8.5 16 3l10 5.5v8L16 22 6 16.5zM6 8.5 16 14l10-5.5M16 14v8" />
      </svg>
    </span>
  );
}

interface QuoteThumbnailProps {
  quoteId: number;
  fileName: string;
}

export function QuoteThumbnail({ quoteId, fileName }: QuoteThumbnailProps): JSX.Element {
  const [failed, setFailed] = useState<boolean>(false);
  if (failed) {
    return <ThumbnailPlaceholder label={`No preview available for ${fileName}`} />;
  }
  return (
    <img
      className="thumb"
      loading="lazy"
      decoding="async"
      alt={`Preview of ${fileName}`}
      src={quoteThumbnailUrl(quoteId)}
      onError={() => setFailed(true)}
    />
  );
}
