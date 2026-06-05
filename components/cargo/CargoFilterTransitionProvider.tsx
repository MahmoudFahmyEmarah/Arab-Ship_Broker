"use client";

import { createContext, useContext, useTransition } from "react";

type CargoFilterTransition = {
  isPending: boolean;
  startTransition: (callback: () => void) => void;
};

const CargoFilterTransitionContext =
  createContext<CargoFilterTransition | null>(null);

export function CargoFilterTransitionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <CargoFilterTransitionContext.Provider
      value={{ isPending, startTransition }}
    >
      {children}
    </CargoFilterTransitionContext.Provider>
  );
}

export function useCargoFilterTransition() {
  return useContext(CargoFilterTransitionContext);
}
