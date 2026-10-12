// Small inline icons (stroke = currentColor), so pages need no icon package.
const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
type P = { size?: number };
const svg = (d: React.ReactNode, size = 18) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden {...base}>
    {d}
  </svg>
);
export const LogoMark = () => (
  <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 7l7 11 7-11" />
  </svg>
);
export const LockIcon = ({ size }: P) => svg(<><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>, size);
export const EyeIcon = ({ size }: P) => svg(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>, size);
export const GavelIcon = ({ size }: P) => svg(<><path d="M14 13l-7.5 7.5a2.1 2.1 0 0 1-3-3L11 10" /><path d="M16 16l6-6M8 8l6-6M9 7l8 8M21 11l-8-8" /></>, size);
export const ShieldIcon = ({ size }: P) => svg(<><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></>, size);
export const FileCheckIcon = ({ size }: P) => svg(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" /><path d="M14 3v5h5M9 14l2 2 4-4" /></>, size);
export const StarIcon = ({ size }: P) => svg(<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3z" />, size);
export const BriefcaseIcon = ({ size }: P) => svg(<><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" /></>, size);
export const KeyIcon = ({ size }: P) => svg(<><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3M15 8l2 2" /></>, size);
export const WalletIcon = ({ size }: P) => svg(<><path d="M3 7a2 2 0 0 1 2-2h13v4" /><rect x="3" y="7" width="18" height="13" rx="2" /><circle cx="16.5" cy="13.5" r="1.2" /></>, size);
export const ClockIcon = ({ size }: P) => svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>, size);
export const ArrowIcon = ({ size }: P) => svg(<path d="M5 12h14M13 6l6 6-6 6" />, size);
export const CheckIcon = ({ size }: P) => svg(<path d="M5 12l5 5L20 7" />, size);
export const GridIcon = ({ size }: P) => svg(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>, size);
export const ChevronIcon = ({ size }: P) => svg(<path d="M9 6l6 6-6 6" />, size);
export const LogoutIcon = ({ size }: P) => svg(<><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5M5 12h11" /></>, size);
export const FastForwardIcon = ({ size }: P) => svg(<path d="M4 6l8 6-8 6V6zM13 6l8 6-8 6V6z" />, size);
