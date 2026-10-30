"use client";

import { useEffect, useState } from "react";

type LightboxImage = {
  src: string;
  alt: string;
};

/**
 * Global in-page lightbox for post images & statistical graphs.
 *
 * Intercepts clicks on:
 * - Inline chat markdown images (`.copilotKitMarkdown img`)
 * - Approved post gallery images (`.gallery-tile-image` / `.gallery-tile-image-btn`)
 *
 * Keeps the user on the same web page and displays the graph in a large modal
 * overlay. Closes on backdrop click, Close button click, or Escape key.
 */
export function ImageLightbox() {
  const [active, setActive] = useState<LightboxImage | null>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const img = target.closest(
        ".copilotKitMarkdown img, .gallery-tile-image",
      ) as HTMLImageElement | null;
      const btn = target.closest(".gallery-tile-image-btn") as HTMLElement | null;

      const resolvedImg =
        img ?? (btn ? (btn.querySelector("img") as HTMLImageElement | null) : null);

      if (!resolvedImg || !resolvedImg.src) return;

      e.preventDefault();
      e.stopPropagation();
      setActive({
        src: resolvedImg.src,
        alt: resolvedImg.alt || "Statistical graph",
      });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActive(null);
      }
    };

    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  if (!active) return null;

  return (
    <div
      className="image-lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={active.alt}
      onClick={() => setActive(null)}
    >
      <div
        className="image-lightbox-content"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="image-lightbox-close"
          onClick={() => setActive(null)}
          aria-label="Close enlarged image"
          title="Close (Esc)"
        >
          ✕
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="image-lightbox-img"
          src={active.src}
          alt={active.alt}
        />
      </div>
    </div>
  );
}

