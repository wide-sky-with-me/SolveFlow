import { useContext } from 'react';
import { ReducedMotion } from './motion-provider';

export function useReducedMotion() {
  return useContext(ReducedMotion);
}
