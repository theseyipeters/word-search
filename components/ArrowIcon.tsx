type ArrowIconProps = {
  className?: string;
  direction?: "left" | "right" | "up-right";
  size?: number | string;
};

export function ArrowIcon({
  className,
  direction = "right",
  size = "1em",
}: ArrowIconProps) {
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
      strokeWidth="1.5"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {direction === "up-right" ? (
        <>
          <path d="M17.657 6.343 6.343 17.657" />
          <path d="M18.101 16.733V7.437A1.53 1.53 0 0 0 16.563 5.9H7.267" />
        </>
      ) : direction === "left" ? (
        <path d="M20 12H4m0 0 6-6m-6 6 6 6" />
      ) : (
        <path d="M4 12h16m0 0-6-6m6 6-6 6" />
      )}
    </svg>
  );
}
