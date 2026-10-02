"use client";

import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";

type LeaveHandler = () => Promise<boolean>;

const GuardContext = createContext<{
  register: (handler: LeaveHandler | null) => void;
  requestLeave: () => Promise<boolean>;
} | null>(null);

export function NavigationGuard({ children }: { children: ReactNode }) {
  const handler = useRef<LeaveHandler | null>(null);
  const value = useMemo(
    () => ({
      register(next: LeaveHandler | null) {
        handler.current = next;
      },
      requestLeave() {
        if (!handler.current) return Promise.resolve(true);
        return handler.current();
      },
    }),
    [],
  );
  return <GuardContext.Provider value={value}>{children}</GuardContext.Provider>;
}

export function useNavigationGuard() {
  return useContext(GuardContext);
}
