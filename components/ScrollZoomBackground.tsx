"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

import { cn } from "@/lib/utils";

interface ScrollZoomBackgroundProps {
  image: string;
  className?: string;
}

export function ScrollZoomBackground({
  image,
  className,
}: ScrollZoomBackgroundProps) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const scrollY = window.scrollY;
          const viewportHeight = window.innerHeight;
          const progress = Math.min(scrollY / viewportHeight, 1);
          setScale(1 + progress * 0.25);
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <div
      className={cn("absolute inset-0 overflow-hidden bg-ocean-950", className)}
    >
      <Image
        src={image}
        alt="Background"
        fill
        priority
        className="object-cover will-change-transform"
        style={{
          transform: `scale(${scale})`,
          transition: "transform 0.1s ease-out",
        }}
      />
      <div className="absolute inset-0 bg-ocean-900/60" />
      <div className="absolute inset-0 bg-linear-to-t from-ocean-900/80 via-transparent to-ocean-900/20" />
    </div>
  );
}
