import React from 'react';

type P = { size?: number; className?: string };
const S = ({ size = 22, className, children, w = 1.9 }: P & { children: React.ReactNode; w?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{children}</svg>
);

export const IFood = (p: P) => <S {...p}><path d="M7 3v8a3 3 0 0 0 3 3v7M7 3v5M10 3v5M13 3v5M17 3c-1.7 0-3 2-3 5s1.3 4 3 4v9" /></S>;
export const IWater = (p: P) => <S {...p}><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" /></S>;
export const IMove = (p: P) => <S {...p}><circle cx="13" cy="4.5" r="1.8" /><path d="M9 21l2.5-6 2.5 2v4M8 11l3-3 3 2 2 3h3M11.5 15L10 9" /></S>;
export const IToday = (p: P) => <S {...p}><path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" /></S>;
export const IWeek = (p: P) => <S {...p}><path d="M5 20V10M10 20V4M15 20v-7M20 20v-11" /></S>;
export const ISettings = (p: P) => <S {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></S>;
export const IHeart = (p: P) => <S {...p}><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></S>;
export const IInfo = (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></S>;
export const IX = (p: P) => <S {...p}><path d="M6 6l12 12M18 6L6 18" /></S>;
export const ITrash = (p: P) => <S {...p}><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" /></S>;
export const IBack = (p: P) => <S {...p}><path d="M15 5l-7 7 7 7" /></S>;
export const IChevron = (p: P) => <S {...p}><path d="M9 5l7 7-7 7" /></S>;
export const IPlus = (p: P) => <S {...p}><path d="M12 5v14M5 12h14" /></S>;
export const IMoon = (p: P) => <S {...p}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></S>;

/** The app mark: white crescent holding a heart on blush pink. */
export function Logo({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Momig">
      <rect width="48" height="48" rx="13" fill="#E8A0B4" />
      <g transform="translate(24 24) scale(0.8) translate(-24 -24)">
        <g transform="translate(-2 0)">
          <path d="M30 6a18 18 0 1 0 11 30A15 15 0 0 1 30 6z" fill="#FFFFFF" />
          <path transform="translate(30 22) scale(0.9) translate(-24 -25)" d="M24 31s-6.5-3.9-6.5-8.6a3.5 3.5 0 0 1 6.5-2 3.5 3.5 0 0 1 6.5 2c0 4.7-6.5 8.6-6.5 8.6z" fill="#FFFFFF" />
        </g>
      </g>
    </svg>
  );
}
