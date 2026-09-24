export function Logo({ size = 20 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      {/* A square split in two: one half filled (settled), one half empty (open). */}
      <span
        aria-hidden
        className="grid grid-cols-2 border-[1.5px] border-verdict"
        style={{ width: size, height: size }}
      >
        <span className="bg-verdict" />
        <span />
      </span>
      <span className="font-sans text-base font-medium tracking-tight2 text-verdict">BountyAgent</span>
    </span>
  );
}
