import { createContext, useContext } from 'react';

export type NestedMediaResolutionMode = 'source' | 'proxy';

const NestedMediaResolutionContext = createContext<NestedMediaResolutionMode>('source');

export const NestedMediaResolutionProvider = NestedMediaResolutionContext.Provider;

export function useNestedMediaResolutionMode(): NestedMediaResolutionMode {
  return useContext(NestedMediaResolutionContext);
}
