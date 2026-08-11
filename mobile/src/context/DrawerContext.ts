import { createContext, useContext } from 'react';

type DrawerCtx = { openDrawer: () => void; hasDrawer: boolean };
export const DrawerContext = createContext<DrawerCtx>({ openDrawer: () => {}, hasDrawer: false });
export function useDrawer(): DrawerCtx { return useContext(DrawerContext); }
