export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
        <rect x="1" y="1" width="30" height="30" rx="8" fill="#0F131B" stroke="#212836" />
        {/* node -> node payout arc */}
        <circle cx="10" cy="16" r="3.2" fill="#4C82FB" />
        <circle cx="22" cy="16" r="3.2" fill="#34D399" />
        <path
          d="M12.8 14.6c3-2.4 5.2-2.4 6.4 0"
          stroke="#8B95A8"
          strokeWidth="1.6"
          strokeLinecap="round"
          fill="none"
        />
        <path d="M18.2 13l1.6 1.3-2 .6" fill="#8B95A8" />
      </svg>
      <span className="font-display text-[15px] font-semibold tracking-tight text-ink">
        Bounty<span className="text-accent">Agent</span>
      </span>
    </span>
  );
}
