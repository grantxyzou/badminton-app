'use client';

interface BottomSheetBodyProps {
  children: React.ReactNode;
  className?: string;
}

export default function BottomSheetBody({ children, className }: BottomSheetBodyProps) {
  return (
    <div
      className={`overflow-y-auto p-5 pb-20 ${className ?? ''}`}
      style={{ maxHeight: 'calc(80vh - 40px)' }}
    >
      {children}
    </div>
  );
}
