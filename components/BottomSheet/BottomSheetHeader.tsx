'use client';

interface BottomSheetHeaderProps {
  children?: React.ReactNode;
  className?: string;
}

export default function BottomSheetHeader({ children, className }: BottomSheetHeaderProps) {
  return <div className={className}>{children}</div>;
}
