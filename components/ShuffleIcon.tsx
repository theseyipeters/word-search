type ShuffleIconProps = {
  className?: string;
  size?: number | string;
};

export function ShuffleIcon({ className, size = "1em" }: ShuffleIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M16 3h5v5" />
      <path d="m21 3-6.4 6.4a2 2 0 0 1-1.4.6h-2.4a2 2 0 0 0-1.4.6L3 17" />
      <path d="M16 16h5v5" />
      <path d="m21 21-6.4-6.4a2 2 0 0 0-1.4-.6h-2.4a2 2 0 0 1-1.4-.6L3 7" />
    </svg>
  );
}
